//! Arena (wersja testowa - TYLKO DLA ADMINÓW). Walkę liczy serwer (arena/engine.rs) - przeglądarka wysyła ruchy
//! i odtwarza kroki walki z animacjami.

use std::collections::{HashMap, HashSet};

use axum::extract::{Path, Query, State};
use rand::seq::SliceRandom;
use serde_json::{json, Map, Value};

use super::shop::today as shop_today;
use super::{ok, Body};
use crate::arena::engine::{ai_deck, Battle, DeckCard, Player};
use crate::arena::Arena;
use crate::auth::{find_user, user_by_id, Admin, User};
use crate::catalog::Catalog;
use crate::data::g;
use crate::db::Conn;
use crate::error::{bad, bad_code, Res};
use crate::game::views::public_person;
use crate::game::{add_chests, discovered, get_chests};
use crate::py;
use crate::state::AppState;

fn deck_error() -> String {
    format!("Talia musi mieć {} różnych kart z twojej kolekcji", g().arena.deck_size)
}

/// Portret gracza w walce (None = komputer)
fn arena_hero(cat: &Catalog, u: Option<&User>) -> Value {
    match u {
        None => json!({"username": "Komputer", "bot": true}),
        Some(u) => {
            let mut j = u.json(cat);
            j.as_object_mut().map(|m| m.shift_remove("isAdmin"));
            j
        }
    }
}

/// Talia z moich kart: osoby bez powtórzeń, każda w najlepszym posiadanym wariancie (wariant to tylko wygląd)
async fn arena_deck(c: &mut Conn, cat: &Catalog, uid: i64, raw: Option<&Value>) -> sqlx::Result<Option<Vec<DeckCard>>> {
    let n = g().arena.deck_size;
    let Some(list) = raw.and_then(Value::as_array).filter(|l| l.len() == n) else { return Ok(None) };
    let pids: Vec<String> = list.iter().map(py::str_of).collect();
    if pids.iter().collect::<HashSet<_>>().len() != n {
        return Ok(None);
    }
    let rows = sqlx::query!("SELECT person_id, variant FROM items WHERE user_id = $1 AND person_id = ANY($2)", uid, &pids)
        .fetch_all(c)
        .await?;
    let mut best: HashMap<String, String> = HashMap::new();
    for r in rows {
        let Some(p) = cat.person(&r.person_id).filter(|p| p.hp > 0) else { continue };
        let v = if g().is_variant(&r.variant) { r.variant } else { "normal".into() };
        let cur = best.get(&p.id).map(String::as_str).unwrap_or("normal");
        if g().variant_idx(&v) >= g().variant_idx(cur) {
            best.insert(p.id.clone(), v);
        }
    }
    if best.len() != n {
        return Ok(None);
    }
    Ok(Some(pids.into_iter().map(|p| DeckCard { variant: best[&p].clone(), pid: p }).collect()))
}

async fn arena_wins_today(c: &mut Conn, uid: i64) -> sqlx::Result<i64> {
    let w = sqlx::query_scalar!("SELECT wins FROM arena_daily WHERE user_id = $1 AND day = $2", uid, shop_today().to_string())
        .fetch_optional(c)
        .await?;
    Ok(w.unwrap_or(0) as i64)
}

fn arena_reward_info(wins: i64, chest: Option<&str>) -> Value {
    let rw = &g().arena.reward_wins;
    json!({"wins": wins, "chest": chest, "rewardWins": rw, "next": rw.iter().find(|w| **w > wins)})
}

/// Koniec walki: wygrana liczy się do dziennych nagród - skrzynka z pieniędzmi za 1., 3. i 9. wygraną dnia.
/// Pod zamkiem Areny, więc nagroda nie zostanie przyznana dwa razy.
async fn arena_record(st: &AppState, b: &mut Battle) -> sqlx::Result<()> {
    if b.over.is_none() || b.recorded {
        return Ok(());
    }
    b.recorded = true;
    let day = shop_today().to_string();
    let mut tx = st.db.begin().await?;
    for k in ["a", "b"] {
        let Some(uid) = b.user_of(k) else { continue };
        let mut chest = None;
        if b.over.as_deref() == Some(k) && !b.no_reward {
            sqlx::query!(
                "INSERT INTO arena_daily (user_id, day, wins) VALUES ($1, $2, 0) ON CONFLICT (user_id, day) DO NOTHING",
                uid,
                day
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query!("UPDATE arena_daily SET wins = wins + 1 WHERE user_id = $1 AND day = $2", uid, day)
                .execute(&mut *tx)
                .await?;
            if g().arena.reward_wins.contains(&arena_wins_today(&mut tx, uid).await?) {
                chest = Some(g().arena.reward_chest.clone());
                add_chests(&mut tx, uid, &format!("money_{}", g().arena.reward_chest), 1).await?;
            }
        }
        let wins = arena_wins_today(&mut tx, uid).await?;
        b.set_reward(k, arena_reward_info(wins, chest.as_deref()));
    }
    tx.commit().await
}

async fn arena_reply(st: &AppState, me: &User, b: &mut Battle, side: &str, since: usize) -> Res {
    let cat = st.cat();
    arena_record(st, b).await?;
    let mut out = b.view(side, since);
    // tajne karty widoczne w walce (moje, na planszy, pokonane) - prawdziwe dane, choć ich jeszcze nie odkryłem
    let mut c = st.db.acquire().await?;
    let found = discovered(&mut c, me.id).await?;
    let mut seen: HashSet<String> = HashSet::new();
    let states = std::iter::once(&out["state"]).chain(out["steps"].as_array().into_iter().flatten().map(|s| &s["state"]));
    for state in states {
        for s in state["sides"].as_object().into_iter().flat_map(|m| m.values()) {
            for key in ["board", "bench", "ko"] {
                for u in s[key].as_array().into_iter().flatten() {
                    if let Some(pid) = u["pid"].as_str() {
                        seen.insert(pid.to_owned());
                    }
                }
            }
        }
    }
    let reveal: Map<String, Value> = seen
        .iter()
        .filter_map(|pid| cat.person(pid))
        .filter(|p| p.is_secret() && !found.contains(&p.id))
        .map(|p| (p.id.clone(), public_person(&st.images, &cat, p, true)))
        .collect();
    out["reveal"] = Value::Object(reveal);
    if b.reward(side).is_some_and(|r| !r["chest"].is_null()) {
        out["chests"] = json!(get_chests(&mut c, &cat, me.id).await?);
    }
    ok(out)
}

/// Nowa walka kończy porzuconą walkę z komputerem (porażka, bez nagród). Zwraca, czy trwa pojedynek z graczem.
async fn arena_abandon(st: &AppState, arena: &mut Arena, uid: i64) -> sqlx::Result<bool> {
    while let Some(bid) = arena.active_battle(uid) {
        let b = arena.battles.get_mut(&bid).expect("walka");
        if b.mode != "ai" {
            return Ok(true);
        }
        if let Some(k) = b.side_of_user(uid) {
            b.surrender(k);
        }
        arena_record(st, b).await?;
    }
    Ok(false)
}

/// Sprawdzane co kilka sekund: wyzwania od innych graczy, odpowiedź na moje wyzwanie, trwająca walka
pub async fn arena_inbox(State(st): State<AppState>, Admin(me): Admin) -> Res {
    let mut arena = st.arena.inner.lock().await;
    let battle = arena.active_battle(me.id);
    if let Some(b) = battle.as_ref().and_then(|id| arena.battles.get_mut(id)) {
        if let Some(k) = b.side_of_user(me.id) {
            b.touch_seen(k);
        }
    }
    let battle = battle.and_then(|id| arena.battles.get(&id)).map(|b| json!({"id": b.id, "mode": b.mode}));
    let (incoming, outgoing) = arena.challenges_for(me.id);
    drop(arena);
    let mut c = st.db.acquire().await?;
    ok(json!({"incoming": incoming, "outgoing": outgoing, "battle": battle,
              "rewards": arena_reward_info(arena_wins_today(&mut c, me.id).await?, None)}))
}

/// Nowa walka z komputerem
pub async fn arena_start(State(st): State<AppState>, Admin(me): Admin, body: Body) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let Some(deck) = arena_deck(&mut c, &cat, me.id, body.get("deck")).await? else { return bad(deck_error()) };
    let found = discovered(&mut c, me.id).await?;
    drop(c);
    let mut arena = st.arena.inner.lock().await;
    if arena_abandon(&st, &mut arena, me.id).await? {
        return bad("Masz trwający pojedynek z graczem");
    }
    arena.cleanup();
    let ai = ai_deck(&cat, &deck, &found);
    let mut b = Battle::new(
        &cat,
        "ai",
        Player { name: me.username.clone(), user: Some(me.id), deck, hero: arena_hero(&cat, Some(&me)) },
        Player { name: "Komputer".into(), user: None, deck: ai, hero: arena_hero(&cat, None) },
        "a",
    );
    b.start(&cat);
    let id = arena.add_battle(b);
    let b = arena.battles.get_mut(&id).expect("walka");
    arena_reply(&st, &me, b, "a", 0).await
}

pub async fn arena_battle(
    State(st): State<AppState>,
    Admin(me): Admin,
    Path(bid): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Res {
    let cat = st.cat();
    let mut arena = st.arena.inner.lock().await;
    let Some(b) = arena.battles.get_mut(&bid) else { return bad_code("Ta walka już się skończyła", 404) };
    let Some(side) = b.side_of_user(me.id) else { return bad_code("Ta walka już się skończyła", 404) };
    b.touch_seen(side);
    b.tick(&cat);
    let since = q.get("since").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0).max(0) as usize;
    arena_reply(&st, &me, b, side, since).await
}

/// Ruch gracza: place / retreat / use / end / surrender (+ auto - tylko admin, wtedy walka bez nagród)
pub async fn arena_act(State(st): State<AppState>, Admin(me): Admin, Path(bid): Path<String>, body: Body) -> Res {
    let cat = st.cat();
    let mut arena = st.arena.inner.lock().await;
    let Some(b) = arena.battles.get_mut(&bid) else { return bad_code("Ta walka już się skończyła", 404) };
    let Some(side) = b.side_of_user(me.id) else { return bad_code("Ta walka już się skończyła", 404) };
    b.touch_seen(side);
    b.tick(&cat);
    let kind = body.get("type").and_then(Value::as_str).unwrap_or("");
    let int = |k: &str| body.get(k).and_then(py::int);
    let res: Result<(), String> = (|| {
        match kind {
            "surrender" => b.surrender(side),
            "auto" => b.set_auto(side, body.get("on").is_some_and(py::truthy)),
            _ if b.over.is_some() => return Err("Walka już się skończyła".into()),
            "place" => b.place(&cat, side, int("uid").ok_or("Nieprawidłowy ruch")?).map_err(|e| e.0)?,
            "retreat" => b.retreat(side, int("uid").ok_or("Nieprawidłowy ruch")?).map_err(|e| e.0)?,
            "use" => {
                let target = match body.get("target") {
                    None | Some(Value::Null) => None,
                    Some(t) => Some(py::int(t).ok_or("Nieprawidłowy ruch")?),
                };
                let uid = int("uid").ok_or("Nieprawidłowy ruch")?;
                let ab = int("ab").ok_or("Nieprawidłowy ruch")?;
                b.use_ability(&cat, side, uid, ab, target).map_err(|e| e.0)?
            }
            "end" => b.end_turn(side, false).map_err(|e| e.0)?,
            _ => return Err("Nieznany ruch".into()),
        }
        b.run_bots(&cat);
        Ok(())
    })();
    if let Err(e) = res {
        return bad(e);
    }
    let since = body.get("since").filter(|v| py::truthy(v)).and_then(py::int).unwrap_or(0).max(0) as usize;
    arena_reply(&st, &me, b, side, since).await
}

/// Wyzwanie innego gracza na pojedynek (z jego profilu)
pub async fn arena_challenge(State(st): State<AppState>, Admin(me): Admin, body: Body) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let target = find_user(&mut c, &py::str_or_empty(body.get("username"))).await?;
    let Some(target) = target.filter(|t| t.banned == 0) else { return bad_code("Nie ma takiego gracza", 404) };
    if target.id == me.id {
        return bad("Nie możesz wyzwać samego siebie");
    }
    if !target.admin() {
        // wersja testowa: walczą tylko admini
        return bad(format!("Arena jest na razie tylko dla adminów — {} nie ma do niej dostępu", target.username));
    }
    let Some(deck) = arena_deck(&mut c, &cat, me.id, body.get("deck")).await? else { return bad(deck_error()) };
    drop(c);
    let mut arena = st.arena.inner.lock().await;
    for uid in [me.id, target.id] {
        if arena.active_battle(uid).and_then(|id| arena.battles.get(&id)).is_some_and(|b| b.mode == "pvp") {
            return bad(if uid == me.id {
                "Masz trwający pojedynek".to_owned()
            } else {
                format!("{} właśnie walczy z kimś innym", target.username)
            });
        }
    }
    let id = arena.new_challenge(arena_hero(&cat, Some(&me)), arena_hero(&cat, Some(&target)), deck);
    ok(arena.challenges[&id].json())
}

pub async fn arena_accept(State(st): State<AppState>, Admin(me): Admin, Path(cid): Path<String>, body: Body) -> Res {
    let cat = st.cat();
    let mut arena = st.arena.inner.lock().await;
    arena.cleanup();
    let Some(from) = arena.challenges.get(&cid).filter(|c| c.to == me.id).map(|c| c.from) else {
        return bad_code("To wyzwanie już wygasło", 404);
    };
    let mut c = st.db.acquire().await?;
    let Some(deck) = arena_deck(&mut c, &cat, me.id, body.get("deck")).await? else { return bad(deck_error()) };
    let rival = user_by_id(&mut c, from).await?;
    drop(c);
    if arena.challenges[&cid].status != "pending" {
        return bad("To wyzwanie jest już nieaktualne");
    }
    let Some(rival) = rival.filter(|r| r.banned == 0) else { return bad_code("Nie ma takiego gracza", 404) };
    for uid in [me.id, rival.id] {
        if arena_abandon(&st, &mut arena, uid).await? {
            return bad("Ktoś z was ma już trwający pojedynek");
        }
    }
    let ch = arena.challenges.get_mut(&cid).expect("wyzwanie");
    ch.status = "accepted".into();
    let rival_deck = ch.deck.clone();
    let first = *["a", "b"].choose(&mut rand::thread_rng()).unwrap_or(&"a");
    let mut b = Battle::new(
        &cat,
        "pvp",
        Player { name: rival.username.clone(), user: Some(rival.id), deck: rival_deck, hero: arena_hero(&cat, Some(&rival)) },
        Player { name: me.username.clone(), user: Some(me.id), deck, hero: arena_hero(&cat, Some(&me)) },
        first,
    );
    b.start(&cat);
    let id = arena.add_battle(b);
    arena.challenges.get_mut(&cid).expect("wyzwanie").battle = Some(id.clone());
    ok(json!({"battle": id}))
}

/// Odrzucenie wyzwania (przez wyzwanego) albo wycofanie (przez wyzywającego)
pub async fn arena_decline(State(st): State<AppState>, Admin(me): Admin, Path(cid): Path<String>) -> Res {
    let mut arena = st.arena.inner.lock().await;
    let Some(c) = arena.challenges.get_mut(&cid).filter(|c| c.from == me.id || c.to == me.id) else {
        return bad_code("To wyzwanie już wygasło", 404);
    };
    if c.status == "pending" {
        c.status = if me.id == c.to { "declined" } else { "cancelled" }.into();
    }
    ok(c.json())
}
