//! Znajomi, aktywność (feed), pokazywanie kart, wymiany, gablota, profile, ranking, /api/me, wiadomości od adminów,
//! Hall of Fame, lista zmian, linki do kart specjalnych.

use std::collections::{HashMap, HashSet};

use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use axum_extra::extract::cookie::SignedCookieJar;
use serde_json::{json, Map, Value};

use super::{ok, Body};
use crate::auth::{find_user, session_cookie, user_by_id, Me, User};
use crate::data::g;
use crate::db::{lock_me, lock_users, now, Conn};
use crate::error::{bad, bad_code, Res};
use crate::game::market::{market_badge, settle_market};
use crate::game::views::reveal;
use crate::game::*;
use crate::py;
use crate::state::AppState;

const TRADE_MAX_LINES: usize = 30;
// Wymiany są tylko na karty - pieniędzy nie da się przekazać (kolumny money_give / money_want zostają dla starych wymian)
const TRADE_NO_MONEY: &str = "W wymianach można dawać tylko karty — bez pieniędzy";

fn name_of(body: &Body, key: &str) -> String {
    py::str_or_empty(body.get(key))
}

// ---------------------------------------------------------------- znajomi

pub async fn friends(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let stats = collection_stats(&mut c, &cat).await?;
    let users: HashMap<i64, User> =
        sqlx::query_as!(User, "SELECT * FROM users").fetch_all(&mut *c).await?.into_iter().map(|u| (u.id, u)).collect();
    let rows =
        sqlx::query!("SELECT * FROM friendships WHERE requester_id = $1 OR addressee_id = $1", me.id).fetch_all(&mut *c).await?;
    let mut out: [(&str, Vec<Value>); 3] = [("friends", vec![]), ("incoming", vec![]), ("outgoing", vec![])];
    for r in rows {
        let other = if r.requester_id == me.id { r.addressee_id } else { r.requester_id };
        let Some(u) = users.get(&other) else { continue };
        let key = if r.status == "accepted" {
            0
        } else if r.requester_id == me.id {
            2
        } else {
            1
        };
        out[key].1.push(brief(&cat, u, &stats));
    }
    let mut res = Map::new();
    for (k, mut list) in out {
        list.sort_by_key(|x| x["username"].as_str().unwrap_or("").to_lowercase());
        res.insert(k.into(), json!(list));
    }
    ok(res)
}

pub async fn friend_request(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let Some(other) = find_user(&mut tx, &name_of(&body, "username")).await? else {
        return bad_code("Nie ma takiego gracza", 404);
    };
    match relation(&mut tx, me.id, other.id).await? {
        "me" => return bad("Nie możesz zaprosić samego siebie 🙂"),
        "friend" => return bad("Już jesteście znajomymi"),
        "outgoing" => return bad("Zaproszenie już wysłane"),
        "incoming" => {
            // ta osoba już nas zaprosiła - od razu akceptujemy
            sqlx::query!(
                "UPDATE friendships SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2",
                other.id,
                me.id
            )
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            return ok(json!({"ok": true, "status": "friend"}));
        }
        _ => {}
    }
    sqlx::query!(
        "INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES ($1, $2, 'pending', $3)",
        me.id,
        other.id,
        now()
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ok(json!({"ok": true, "status": "outgoing"}))
}

pub async fn friend_respond(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let other = find_user(&mut tx, &name_of(&body, "username")).await?;
    let other = match other {
        Some(o) if relation(&mut tx, me.id, o.id).await? == "incoming" => o,
        _ => return bad("Brak takiego zaproszenia"),
    };
    if body.get("accept").is_some_and(py::truthy) {
        sqlx::query!("UPDATE friendships SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2", other.id, me.id)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query!("DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2", other.id, me.id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn friend_remove(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let mut c = st.db.acquire().await?;
    let Some(other) = find_user(&mut c, &name_of(&body, "username")).await? else {
        return bad_code("Nie ma takiego gracza", 404);
    };
    sqlx::query!(
        "DELETE FROM friendships WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)",
        me.id,
        other.id
    )
    .execute(&mut *c)
    .await?;
    ok(json!({"ok": true}))
}

pub async fn user_search(State(st): State<AppState>, Me(_): Me, Query(q): Query<HashMap<String, String>>) -> Res {
    let q = q.get("q").map(|s| s.trim().to_owned()).unwrap_or_default();
    if q.is_empty() {
        return ok(json!({"users": []}));
    }
    let cat = st.cat();
    let pattern = format!("%{}%", q.replace('%', "").replace('_', "\\_"));
    let rows = sqlx::query_as!(
        User,
        r"SELECT * FROM users WHERE banned = 0 AND LOWER(username) LIKE LOWER($1) ESCAPE '\' ORDER BY LOWER(username) LIMIT 10",
        pattern
    )
    .fetch_all(&st.db)
    .await?;
    ok(json!({"users": rows.iter().map(|u| u.json(&cat)).collect::<Vec<_>>()}))
}

// ---------------------------------------------------------------- aktywność / pokazywanie kart

pub async fn feed(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let rows = sqlx::query!(
        "SELECT f.id, f.author_id, f.kind, f.person_id, f.variant, f.message, f.created_at, u.username, u.avatar, u.avatar_card,
                u.avatar_variant, (SELECT username FROM users WHERE id = f.to_user_id) AS to_name
         FROM feed f JOIN users u ON u.id = f.author_id
         WHERE (f.author_id = $1 OR f.to_user_id = $1
            OR (f.to_user_id IS NULL AND f.author_id IN (
                SELECT addressee_id FROM friendships WHERE requester_id = $1 AND status = 'accepted'
                UNION SELECT requester_id FROM friendships WHERE addressee_id = $1 AND status = 'accepted')))
         ORDER BY f.id DESC LIMIT 60",
        me.id
    )
    .fetch_all(&mut *c)
    .await?;
    let found = discovered(&mut c, me.id).await?;
    let mut out = vec![];
    for r in rows {
        let Some(p) = cat.person(&r.person_id) else { continue };
        let avatar = cat.person(&r.avatar_card);
        out.push(json!({
            "id": r.id, "kind": r.kind, "person": r.person_id, "variant": r.variant,
            // tajną kartę znajomego widać w aktywności, nawet jeśli samemu jej jeszcze nie odkryłeś
            "reveal": reveal(&st.images, &cat, p, &found),
            "message": r.message, "created": r.created_at, "mine": r.author_id == me.id,
            "author": {"username": r.username, "avatar": r.avatar,
                       "avatarCard": avatar.map(|a| &a.id), "avatarRarity": avatar.map(|a| &a.rarity),
                       "avatarVariant": if g().is_variant(&r.avatar_variant) { r.avatar_variant.as_str() } else { "normal" }},
            "to": r.to_name,
            "value": p.value(&r.variant),
        }));
    }
    let seen = get_state(&mut c, me.id).await?["feed_seen"];
    ok(json!({"feed": out, "seen": seen}))
}

pub async fn feed_seen(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let last = sqlx::query_scalar!("SELECT MAX(id) FROM feed").fetch_one(&mut *c).await?.unwrap_or(0);
    set_state(&mut c, me.id, "feed_seen", last).await?;
    ok(json!({"ok": true}))
}

pub async fn show_card(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let item_id = match body.get("item_id") {
        None => 0,
        Some(v) => py::int(v).unwrap_or(0),
    };
    let Some(rows) = owned_rows(&mut c, &cat, me.id, &[item_id]).await? else { return bad("Nie masz tej karty") };
    let to = match body.get("to") {
        Some(v) if py::truthy(v) => py::str_of(v),
        _ => "all".into(),
    };
    let friends = friend_ids(&mut c, me.id).await?;
    let mut to_id = None;
    if to != "all" {
        match find_user(&mut c, &to).await? {
            Some(o) if friends.contains(&o.id) => to_id = Some(o.id),
            _ => return bad("Możesz pokazywać karty tylko znajomym"),
        }
    } else if friends.is_empty() {
        return bad("Nie masz jeszcze znajomych 🙂");
    }
    let msg = py::text(&body.0, "message", 140);
    let r = &rows[0];
    sqlx::query!(
        "INSERT INTO feed (author_id, to_user_id, kind, person_id, variant, message, created_at) VALUES ($1, $2, 'show', $3, $4, $5, $6)",
        me.id,
        to_id,
        r.person_id,
        r.variant,
        msg,
        now()
    )
    .execute(&mut *c)
    .await?;
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- wymiany

struct Trade {
    id: i64,
    from_id: i64,
    to_id: i64,
    status: String,
    message: String,
    money_give: i64,
    money_want: i64,
    created_at: f64,
    updated_at: f64,
}

async fn get_trade(c: &mut Conn, tid: i64) -> sqlx::Result<Option<Trade>> {
    sqlx::query_as!(Trade, "SELECT * FROM trades WHERE id = $1", tid).fetch_optional(c).await
}

/// Wybiera konkretne karty gracza do oddania (najpierw te spoza gabloty)
async fn pick_want_items(c: &mut Conn, uid: i64, pid: &str, variant: &str, count: i32) -> sqlx::Result<Option<Vec<i64>>> {
    let rows = sqlx::query_scalar!(
        "SELECT i.id FROM items i LEFT JOIN showcase s ON s.item_id = i.id AND s.user_id = i.user_id
         WHERE i.user_id = $1 AND i.person_id = $2 AND i.variant = $3
         ORDER BY (s.item_id IS NOT NULL), i.id LIMIT $4",
        uid,
        pid,
        variant,
        count as i64
    )
    .fetch_all(c)
    .await?;
    Ok((rows.len() == count as usize).then_some(rows))
}

/// Opis, dlaczego wymiany nie da się już zrealizować, albo None
async fn trade_problem(c: &mut Conn, t: &Trade) -> sqlx::Result<Option<&'static str>> {
    let give = sqlx::query_scalar!("SELECT item_id FROM trade_lines WHERE trade_id = $1 AND side = 'give'", t.id)
        .fetch_all(&mut *c)
        .await?;
    for item in give {
        let has = sqlx::query_scalar!("SELECT 1 AS one FROM items WHERE id = $1 AND user_id = $2", item, t.from_id)
            .fetch_optional(&mut *c)
            .await?;
        if has.is_none() {
            return Ok(Some("Oferujący nie ma już wszystkich kart z oferty"));
        }
    }
    let want = sqlx::query!("SELECT person_id, variant, count FROM trade_lines WHERE trade_id = $1 AND side = 'want'", t.id)
        .fetch_all(&mut *c)
        .await?;
    for r in want {
        if pick_want_items(c, t.to_id, &r.person_id, &r.variant, r.count).await?.is_none() {
            return Ok(Some("Odbiorca nie ma już wszystkich chcianych kart"));
        }
    }
    if t.money_give != 0 || t.money_want != 0 {
        return Ok(Some(TRADE_NO_MONEY)); // stara oferta z pieniędzmi - już nie do przyjęcia
    }
    Ok(None)
}

async fn trade_json(c: &mut Conn, cx: &Ctx, t: &Trade, found: &HashSet<String>) -> sqlx::Result<Value> {
    let users: HashMap<i64, User> = sqlx::query_as!(User, "SELECT * FROM users WHERE id IN ($1, $2)", t.from_id, t.to_id)
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|u| (u.id, u))
        .collect();
    let mut give = vec![];
    let mut want = vec![];
    let lines = sqlx::query!("SELECT side, person_id, variant, count FROM trade_lines WHERE trade_id = $1", t.id)
        .fetch_all(&mut *c)
        .await?;
    for r in lines {
        let Some(p) = cx.person(&r.person_id) else { continue };
        let owner = users.get(if r.side == "give" { &t.from_id } else { &t.to_id });
        let mut line = json!({"person": p.id, "variant": r.variant, "count": r.count, "value": p.value(&r.variant),
                              "owner": owner.map(|o| &o.username)});
        // tajną kartę znajomego widać w ofercie (jak na jego profilu)
        if let Some(rv) = reveal(&cx.st.images, &cx.cat, p, found) {
            line["reveal"] = rv;
        }
        if r.side == "give" {
            give.push(line)
        } else {
            want.push(line)
        }
    }
    let mut out = json!({"id": t.id, "status": t.status, "message": t.message, "created": t.created_at,
                         "updated": t.updated_at, "moneyGive": t.money_give, "moneyWant": t.money_want,
                         "from": users.get(&t.from_id).map(|u| u.json(&cx.cat)),
                         "to": users.get(&t.to_id).map(|u| u.json(&cx.cat)),
                         "mine": t.from_id == cx.uid(), "give": give, "want": want});
    if t.status == "pending" {
        out["problem"] = json!(trade_problem(c, t).await?);
    }
    Ok(out)
}

pub async fn trades_list(State(st): State<AppState>, Me(me): Me) -> Res {
    let cx = Ctx::new(st, me);
    let mut c = cx.st.db.acquire().await?;
    let me = cx.uid();
    let pending = sqlx::query_as!(
        Trade,
        "SELECT * FROM trades WHERE status = 'pending' AND (from_id = $1 OR to_id = $1) ORDER BY id DESC",
        me
    )
    .fetch_all(&mut *c)
    .await?;
    let history = sqlx::query_as!(
        Trade,
        "SELECT * FROM trades WHERE status != 'pending' AND (from_id = $1 OR to_id = $1) ORDER BY updated_at DESC LIMIT 15",
        me
    )
    .fetch_all(&mut *c)
    .await?;
    let found = discovered(&mut c, me).await?;
    let (mut incoming, mut outgoing, mut hist) = (vec![], vec![], vec![]);
    for t in &pending {
        let j = trade_json(&mut c, &cx, t, &found).await?;
        if t.to_id == me {
            incoming.push(j.clone());
        }
        if t.from_id == me {
            outgoing.push(j);
        }
    }
    for t in &history {
        hist.push(trade_json(&mut c, &cx, t, &found).await?);
    }
    ok(json!({"incoming": incoming, "outgoing": outgoing, "history": hist}))
}

pub async fn trade_create(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let g = g();
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let other = find_user(&mut tx, &name_of(&body, "to")).await?;
    let friends = friend_ids(&mut tx, cx.uid()).await?;
    let Some(other) = other.filter(|o| friends.contains(&o.id)) else { return bad("Wymieniać się możesz tylko ze znajomymi") };
    if other.banned != 0 {
        return bad("To konto jest zablokowane");
    }
    let give_ids = py::int_list(body.get("give"));
    let want: Option<Vec<(String, String, i64)>> = match body.get("want") {
        None | Some(Value::Null) => Some(vec![]),
        Some(Value::Array(a)) => a
            .iter()
            .map(|w| {
                let person = w.get("person")?.as_str()?.to_owned();
                let variant = match w.get("variant") {
                    None => "normal".to_owned(),
                    Some(v) => v.as_str()?.to_owned(),
                };
                let count = match w.get("count") {
                    None => 1,
                    Some(v) => py::int(v)?,
                };
                Some((person, variant, count))
            })
            .collect(),
        Some(_) => None,
    };
    let (Some(give_ids), Some(want)) = (give_ids, want) else { return bad("Nieprawidłowa oferta") };
    if body.get("moneyGive").is_some_and(py::truthy) || body.get("moneyWant").is_some_and(py::truthy) {
        return bad(TRADE_NO_MONEY);
    }
    if give_ids.is_empty() && want.is_empty() {
        return bad("Oferta jest pusta");
    }
    if give_ids.is_empty() || want.is_empty() {
        return bad("Coś dajesz i coś chcesz w zamian — obie strony muszą mieć karty");
    }
    if give_ids.len() + want.len() > TRADE_MAX_LINES {
        return bad("Oferta jest za duża");
    }
    let Some(rows) = owned_rows(&mut tx, &cx.cat, cx.uid(), &give_ids).await? else {
        return bad("Nie masz wszystkich kart, które chcesz dać");
    };
    for (person, variant, count) in &want {
        if !cx.cat.has(person) || !g.is_variant(variant) || !(1..=100).contains(count) {
            return bad("Nieprawidłowa karta w ofercie");
        }
        if pick_want_items(&mut tx, other.id, person, variant, *count as i32).await?.is_none() {
            return bad(format!("{} nie ma tylu kart: {}", other.username, cx.cat.people[person].name));
        }
    }
    let now = now();
    let tid = sqlx::query_scalar!(
        "INSERT INTO trades (from_id, to_id, message, money_give, money_want, created_at, updated_at)
         VALUES ($1, $2, $3, 0, 0, $4, $4) RETURNING id",
        cx.uid(),
        other.id,
        py::text(&body.0, "message", 140),
        now
    )
    .fetch_one(&mut *tx)
    .await?;
    for r in &rows {
        sqlx::query!(
            "INSERT INTO trade_lines (trade_id, side, item_id, person_id, variant, count) VALUES ($1, 'give', $2, $3, $4, 1)",
            tid,
            r.id,
            r.person_id,
            r.variant
        )
        .execute(&mut *tx)
        .await?;
    }
    for (person, variant, count) in &want {
        sqlx::query!(
            "INSERT INTO trade_lines (trade_id, side, item_id, person_id, variant, count) VALUES ($1, 'want', NULL, $2, $3, $4)",
            tid,
            person,
            variant,
            *count as i32
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    ok(json!({"ok": true, "id": tid}))
}

/// /api/trades/<id>/accept | decline | cancel
pub async fn trade_action(State(st): State<AppState>, Me(me): Me, Path((tid, action)): Path<(i64, String)>) -> Res {
    if action == "accept" {
        return trade_accept(st, me, tid).await;
    }
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let t = get_trade(&mut tx, tid).await?;
    let Some(t) = t.filter(|t| t.status == "pending" && (action == "decline" || action == "cancel")) else {
        return bad("Nieprawidłowa operacja");
    };
    if (action == "decline" && t.to_id != me.id) || (action == "cancel" && t.from_id != me.id) {
        return bad_code("To nie twoja oferta", 403);
    }
    let status = if action == "decline" { "declined" } else { "cancelled" };
    sqlx::query!("UPDATE trades SET status = $1, updated_at = $2 WHERE id = $3", status, now(), tid).execute(&mut *tx).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

async fn trade_accept(st: AppState, me: User, tid: i64) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    let mut t = get_trade(&mut tx, tid).await?;
    if let Some(tr) = &t {
        // blokujemy obie strony wymiany, potem czytamy świeży stan oferty
        lock_users(&mut tx, &[Some(tr.from_id), Some(tr.to_id)]).await?;
        t = get_trade(&mut tx, tid).await?;
    }
    let Some(t) = t.filter(|t| t.to_id == me.id && t.status == "pending") else {
        return bad("Tej oferty nie można już przyjąć");
    };
    if let Some(problem) = trade_problem(&mut tx, &t).await? {
        return bad(problem);
    }
    let give: Vec<i64> = sqlx::query_scalar!("SELECT item_id FROM trade_lines WHERE trade_id = $1 AND side = 'give'", tid)
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .flatten()
        .collect();
    let mut want = vec![];
    let lines = sqlx::query!("SELECT person_id, variant, count FROM trade_lines WHERE trade_id = $1 AND side = 'want'", tid)
        .fetch_all(&mut *tx)
        .await?;
    for r in lines {
        want.extend(pick_want_items(&mut tx, t.to_id, &r.person_id, &r.variant, r.count).await?.unwrap_or_default());
    }
    // nowy właściciel dostaje kartę bez gwiazdki
    sqlx::query!("UPDATE items SET user_id = $1, favorite = 0 WHERE id = ANY($2)", t.to_id, &give).execute(&mut *tx).await?;
    sqlx::query!("UPDATE items SET user_id = $1, favorite = 0 WHERE id = ANY($2)", t.from_id, &want).execute(&mut *tx).await?;
    let moved: Vec<i64> = give.iter().chain(&want).copied().collect();
    sqlx::query!("DELETE FROM showcase WHERE item_id = ANY($1)", &moved).execute(&mut *tx).await?;
    // tajne karty, które ktoś dostał w wymianie, są dla niego odkryte
    for (ids, uid) in [(&give, t.to_id), (&want, t.from_id)] {
        for id in ids {
            let r = sqlx::query!("SELECT person_id, variant FROM items WHERE id = $1", id).fetch_one(&mut *tx).await?;
            note_collected(&mut tx, uid, &r.person_id, &r.variant, "trade").await?;
            if cat.person(&r.person_id).is_some_and(|p| p.is_secret()) {
                discover(&mut tx, uid, &r.person_id).await?;
            }
        }
    }
    sqlx::query!("UPDATE trades SET status = 'accepted', updated_at = $1 WHERE id = $2", now(), tid).execute(&mut *tx).await?;
    tx.commit().await?;
    let mut c = st.db.acquire().await?;
    ok(json!({"ok": true, "state": get_state(&mut c, me.id).await?, "items": my_items(&mut c, &cat, me.id).await?,
              "showcase": showcase_ids(&mut c, me.id).await?}))
}

// ---------------------------------------------------------------- profile, gablota, ranking

pub async fn set_showcase(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let Some(mut ids) = py::int_list(body.get("ids")) else { return bad("Nie masz tych kart") };
    ids.truncate(g().showcase_size);
    if !ids.is_empty() && owned_rows(&mut tx, &cat, me.id, &ids).await?.is_none() {
        return bad("Nie masz tych kart");
    }
    sqlx::query!("DELETE FROM showcase WHERE user_id = $1", me.id).execute(&mut *tx).await?;
    for (pos, id) in ids.iter().enumerate() {
        sqlx::query!("INSERT INTO showcase (user_id, pos, item_id) VALUES ($1, $2, $3)", me.id, pos as i32, id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    ok(json!({"ok": true, "showcase": ids}))
}

pub async fn set_profile(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if body.get("avatarCard").is_some() {
        // ikona ze zdjęcia karty - tylko z kart, które gracz ma (żadnych własnych plików)
        let pid = py::str_or_empty(body.get("avatarCard"));
        let variant = match body.get("avatarVariant") {
            Some(v) if py::truthy(v) => py::str_of(v),
            _ => "normal".into(),
        };
        if !g().is_variant(&variant) {
            return bad("Nieznany wariant");
        }
        if !pid.is_empty() {
            let has = cat.has(&pid)
                && sqlx::query_scalar!(
                    "SELECT 1 AS one FROM items WHERE user_id = $1 AND person_id = $2 AND variant = $3 LIMIT 1",
                    me.id,
                    pid,
                    variant
                )
                .fetch_optional(&mut *tx)
                .await?
                .is_some();
            if !has {
                return bad("Możesz ustawić tylko kartę (w wariancie), którą masz");
            }
        }
        sqlx::query!("UPDATE users SET avatar_card = $1, avatar_variant = $2 WHERE id = $3", pid, variant, me.id)
            .execute(&mut *tx)
            .await?;
    }
    if body.get("avatar").is_some() {
        let avatar = py::str_or_empty(body.get("avatar")).trim().to_owned();
        if !(1..=8).contains(&avatar.chars().count()) {
            return bad("Nieprawidłowy awatar");
        }
        sqlx::query!("UPDATE users SET avatar = $1, avatar_card = '' WHERE id = $2", avatar, me.id).execute(&mut *tx).await?;
    }
    let u = user_by_id(&mut tx, me.id).await?.unwrap_or(me);
    tx.commit().await?;
    ok(json!({"ok": true, "user": u.json(&cat)}))
}

pub async fn profile(State(st): State<AppState>, Me(me): Me, Path(name): Path<String>) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let Some(u) = find_user(&mut c, &name).await? else { return bad_code("Nie ma takiego gracza", 404) };
    let st_ = get_state(&mut c, u.id).await?;
    let stats = collection_stats(&mut c, &cat).await?;
    let collection: Vec<(String, String, i64)> = sqlx::query!(
        r#"SELECT person_id, variant, COUNT(*) AS "n!" FROM items WHERE user_id = $1 GROUP BY person_id, variant"#,
        u.id
    )
    .fetch_all(&mut *c)
    .await?
    .into_iter()
    .filter(|r| cat.has(&r.person_id))
    .map(|r| (r.person_id, r.variant, r.n))
    .collect();
    let mut show = vec![];
    for id in showcase_ids(&mut c, u.id).await? {
        if let Some(it) = item_by_id(&mut c, id).await?.and_then(|r| item_json(&cat, &r)) {
            show.push(it);
        }
    }
    let rel = relation(&mut c, me.id, u.id).await?;
    let collected = collected_list(&mut c, &cat, u.id).await?;
    // tajne karty znajomego widać na jego profilu, nawet jeśli samemu się ich jeszcze nie odkryło
    let mut rv = Map::new();
    if rel == "friend" {
        let found = discovered(&mut c, me.id).await?;
        let pids: HashSet<&String> = collection.iter().map(|c| &c.0).chain(collected.iter().map(|c| &c.0)).collect();
        for pid in pids {
            if let Some(v) = reveal(&st.images, &cat, &cat.people[pid], &found) {
                rv.insert(pid.clone(), v);
            }
        }
    }
    let mut user = brief(&cat, &u, &stats);
    user["created"] = json!(u.created_at);
    let s = |k: &str| st_.get(k).copied().unwrap_or(0);
    ok(json!({
        "user": user,
        "relation": rel,
        "reveal": rv,
        "stats": {"opened": s("opened"), "contracts": s("contracts"), "upgradesWon": s("upgrades_won"), "upgradesLost": s("upgrades_lost")},
        "collection": collection.iter().map(|(p, v, n)| json!({"person": p, "variant": v, "count": n})).collect::<Vec<_>>(),
        "collected": collected,
        "showcase": show,
    }))
}

pub async fn ranking(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let stats = collection_stats(&mut c, &cat).await?;
    let opened: HashMap<i64, i64> = sqlx::query!("SELECT user_id, value FROM user_state WHERE key = 'opened'")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|r| (r.user_id, r.value))
        .collect();
    let friends = friend_ids(&mut c, me.id).await?;
    // bez zablokowanych, ukrytych przez admina i tych, którzy dostali pieniądze / skrzynki od admina
    let users = sqlx::query_as!(User, "SELECT * FROM users WHERE banned = 0 AND ranking_hidden = 0 AND money_generated = 0")
        .fetch_all(&mut *c)
        .await?;
    let players: Vec<Value> = users
        .iter()
        .map(|u| {
            let mut b = brief(&cat, u, &stats);
            b["opened"] = json!(opened.get(&u.id).copied().unwrap_or(0));
            b["friend"] = json!(friends.contains(&u.id));
            b["me"] = json!(u.id == me.id);
            b
        })
        .collect();
    ok(json!({"players": players, "totalCards": cat.people.len()}))
}

/// Odpytywane co 30 s (w lobby co 5 s) przez każdy otwarty ekran gry. Odnawia też ciasteczko logowania.
pub async fn me(State(st): State<AppState>, Me(me): Me, jar: SignedCookieJar) -> Res {
    let cat = st.cat();
    settle_market(&st.db, &cat).await?; // licytacje kończą się na czas
    let cx = Ctx { st: st.clone(), cat: cat.clone(), me: me.clone() };
    let mut c = st.db.acquire().await?;
    let uid = me.id;
    let incoming =
        sqlx::query_scalar!(r#"SELECT COUNT(*) AS "n!" FROM friendships WHERE addressee_id = $1 AND status = 'pending'"#, uid)
            .fetch_one(&mut *c)
            .await?;
    let state = get_state(&mut c, uid).await?;
    let unread = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "n!" FROM feed f JOIN users u ON u.id = f.author_id
           WHERE (f.author_id = $1 OR f.to_user_id = $1
              OR (f.to_user_id IS NULL AND f.author_id IN (
                  SELECT addressee_id FROM friendships WHERE requester_id = $1 AND status = 'accepted'
                  UNION SELECT requester_id FROM friendships WHERE addressee_id = $1 AND status = 'accepted')))
           AND f.author_id != $1 AND f.id > $2"#,
        uid,
        state["feed_seen"]
    )
    .fetch_one(&mut *c)
    .await?;
    let trades = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "n!" FROM trades WHERE to_id = $1 AND status = 'pending'"#, uid)
        .fetch_one(&mut *c)
        .await?;
    // "odcisk" ekwipunku i saldo: przeglądarka pobiera świeży ekwipunek, gdy coś zmieniło się bez jej udziału
    let inv = sqlx::query!(r#"SELECT COUNT(*) AS "n!", COALESCE(SUM(id), 0)::BIGINT AS "s!" FROM items WHERE user_id = $1"#, uid)
        .fetch_one(&mut *c)
        .await?;
    let lobby = super::casino::my_lobby(&mut c, uid).await?;
    let invites = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "n!" FROM jackpots j JOIN jackpot_invites i ON i.jackpot_id = j.id WHERE i.user_id = $1
           AND j.status = 'open' AND j.joiner_id IS NULL AND j.creator_id != $1"#,
        uid
    )
    .fetch_one(&mut *c)
    .await?;
    let seen = state["patch_seen"];
    let notes: Vec<&Value> = g().patch_notes.iter().filter(|n| n["v"].as_i64().unwrap_or(0) > seen).take(3).collect();
    let body = json!({
        "user": me.json(&cat),
        "dailyClaimable": super::shop::daily_info(&mut c, uid).await?["claimable"],
        "incoming": incoming, "unread": unread, "trades": trades,
        "market": market_badge(&mut c, uid, state["market_seen"]).await?,
        "inv": [inv.n, inv.s], "balance": state["balance"],
        "jackpot": super::casino::jackpot_news(&mut c, &cx, state["jackpot_seen"]).await?, // wynik gry w jackpot, którego jeszcze nie widział
        "jackpotLobby": lobby.map(|l| l.id), "jackpotInvites": invites,
        "patchNotes": notes, // nowości od ostatniej wizyty
        "messages": active_messages(&mut c, uid).await?, // wiadomości od adminów, których jeszcze nie widział
    });
    let jar = jar.add(session_cookie(uid, st.cfg.cookie_secure));
    Ok((jar, Json(body)).into_response())
}

/// Wiadomości od adminów, które gracz ma teraz zobaczyć: trwa ich czas i jeszcze ich nie widział
async fn active_messages(c: &mut Conn, uid: i64) -> sqlx::Result<Vec<Value>> {
    let now = now();
    let rows = sqlx::query!(
        "SELECT id, title, body, starts_at FROM admin_messages m WHERE starts_at <= $1 AND ends_at > $1 AND NOT EXISTS
         (SELECT 1 FROM admin_message_seen s WHERE s.message_id = m.id AND s.user_id = $2) ORDER BY starts_at",
        now,
        uid
    )
    .fetch_all(c)
    .await?;
    Ok(rows.into_iter().map(|r| json!({"id": r.id, "title": r.title, "body": r.body, "at": r.starts_at})).collect())
}

/// Gracz zobaczył wiadomości od adminów - w tym czasie już mu się nie pokażą
pub async fn messages_seen(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let mut c = st.db.acquire().await?;
    for mid in body.get("ids").and_then(Value::as_array).into_iter().flatten() {
        let Some(mid) = mid.as_i64() else { continue };
        sqlx::query!(
            "INSERT INTO admin_message_seen (message_id, user_id, seen_at) SELECT id, $2, $3 FROM admin_messages WHERE id = $1
             ON CONFLICT DO NOTHING",
            mid,
            me.id,
            now()
        )
        .execute(&mut *c)
        .await?;
    }
    ok(json!({"ok": true}))
}

/// Hall of Fame: dla każdej karty i wariantu - kto pierwszy ją zdobył, kiedy, skąd i ile ich wypadło
pub async fn hall_of_fame(State(st): State<AppState>, Me(_): Me) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let rows = sqlx::query!("SELECT * FROM hall_of_fame").fetch_all(&mut *c).await?;
    let all_users = sqlx::query_as!(User, "SELECT * FROM users").fetch_all(&mut *c).await?;
    let hidden: HashSet<i64> = all_users.iter().filter(|u| u.hidden_from_ranking()).map(|u| u.id).collect();
    let mut out = vec![];
    for r in rows.into_iter().filter(|r| cat.has(&r.person_id)) {
        let mut first = (r.first_user_id, r.first_at, r.source.clone());
        if r.first_user_id.is_some_and(|u| hidden.contains(&u)) {
            // gracz poza rankingiem - pokazujemy pierwszego widocznego (albo nikogo)
            first = match hof_first(&mut c, &r.person_id, &r.variant, Some(&hidden)).await? {
                Some((u, at, s)) => (Some(u), at, s),
                None => (None, r.first_at, r.source),
            };
        }
        out.push(json!({"p": r.person_id, "v": r.variant, "u": first.0, "t": first.1, "s": first.2, "n": r.drops}));
    }
    let ids: HashSet<i64> = out.iter().filter_map(|r| r["u"].as_i64()).filter(|u| *u != 0).collect();
    let users: Map<String, Value> =
        all_users.iter().filter(|u| ids.contains(&u.id)).map(|u| (u.id.to_string(), u.json(&cat))).collect();
    ok(json!({"rows": out, "users": users}))
}

pub async fn patch_notes(Me(_): Me) -> Res {
    ok(json!({"notes": g().patch_notes}))
}

pub async fn patch_notes_seen(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    set_state(&mut c, me.id, "patch_seen", g().patch_version()).await?;
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- linki do kart specjalnych

/// Gracz otworzył link od admina: dostaje kartę specjalną (w jej jedynym wariancie) - każdy gracz raz na link
pub async fn link_claim(State(st): State<AppState>, Me(me): Me, Path(token): Path<String>) -> Res {
    let cx = Ctx::new(st, me);
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let r = sqlx::query!("SELECT id, person_id, active FROM card_links WHERE token = $1", token).fetch_optional(&mut *tx).await?;
    let link = r.and_then(|r| {
        let p = super::admin::link_card(&cx.cat, &r.person_id)?.clone();
        (r.active != 0).then_some((r.id, p))
    });
    let Some((link_id, p)) = link else { return bad_code("Ten link nie działa (wyłączony albo nieprawidłowy)", 404) };
    let used =
        sqlx::query_scalar!("SELECT 1 AS one FROM card_link_claims WHERE link_id = $1 AND user_id = $2", link_id, cx.uid())
            .fetch_optional(&mut *tx)
            .await?;
    if used.is_some() {
        return bad("Ten link już wykorzystałeś — każdy gracz może go użyć tylko raz");
    }
    let n = sqlx::query!("UPDATE card_links SET uses = uses + 1 WHERE id = $1 AND (max_uses = 0 OR uses < max_uses)", link_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return bad("Limit graczy dla tego linku już się wyczerpał");
    }
    let item = insert_item(&mut tx, &cx, &p.id, &p.fixed(), "link").await?;
    sqlx::query!(
        "INSERT INTO card_link_claims (link_id, user_id, item_id, claimed_at) VALUES ($1, $2, $3, $4)",
        link_id,
        cx.uid(),
        item.id,
        now()
    )
    .execute(&mut *tx)
    .await?;
    note_drops(&mut tx, &cx, &drops_of(std::slice::from_ref(&item)), "link").await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"item": item, "state": state}))
}
