//! Kasyno: ruletka, blackjack, jackpot (lobby dla 2 graczy). Stawką są karty; wygrane - w kartach
//! (house_cards, także w wariantach) + reszta w pieniądzach; przy wygranej szansa na kartę specjalną z kasyna.

use std::sync::LazyLock;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use rand::seq::SliceRandom;
use rand::Rng;
use regex::Regex;
use serde_json::{json, Map, Value};

use super::{ok, Body};
use crate::auth::{find_user, Me};
use crate::data::g;
use crate::db::{lock_me, lock_users, now, Conn};
use crate::error::{bad, bad_code, AppError, Res};
use crate::game::market::settle_market;
use crate::game::roll::{house_cards, random};
use crate::game::views::card_json;
use crate::game::*;
use crate::py::{self, fmt_money};
use crate::state::AppState;

// ---------------------------------------------------------------- wygrane

/// Karty specjalne, które wypadają w kasynie (pole karty "source" = casino, panel admina)
fn casino_special_pool(cx: &Ctx) -> Vec<std::sync::Arc<crate::catalog::Person>> {
    cx.cat.people.values().filter(|p| p.is_special() && p.source.as_deref() == Some("casino")).cloned().collect()
}

/// Wygrana w grze kasyna, która daje nowe karty: z szansą wygrana / CASINO_SPECIAL["per"] (najwyżej "max") gracz dostaje
/// dodatkowo kartę specjalną z kasyna - zawsze w jej jedynym wariancie (np. Jokerowa). Zwraca nową kartę albo None.
async fn casino_special_drop(c: &mut Conn, cx: &Ctx, payout: i64) -> sqlx::Result<Option<NewItem>> {
    let cs = &g().casino_special;
    let pool = casino_special_pool(cx);
    if pool.is_empty() || random() >= cs.max.min(payout as f64 / cs.per) {
        return Ok(None);
    }
    let p = pool.choose(&mut rand::thread_rng()).cloned().expect("pula");
    let item = insert_item(c, cx, &p.id, &p.fixed(), "joker").await?;
    note_drops(c, cx, &drops_of(std::slice::from_ref(&item)), "joker").await?;
    Ok(Some(item))
}

/// Wygrana w kartach + reszta w pieniądzach
async fn pay_out(c: &mut Conn, cx: &Ctx, payout: i64, feed_kind: &str) -> sqlx::Result<(Vec<NewItem>, i64)> {
    let (cards, money) = house_cards(&cx.cat, payout);
    let mut items = vec![];
    for (p, v) in cards {
        items.push(insert_item(c, cx, &p.id, &v, "casino").await?);
    }
    add_state(c, cx.uid(), "balance", money).await?;
    note_drops(c, cx, &drops_of(&items), feed_kind).await?;
    metrics::counter!("scambox_casino_payout_total", "game" => feed_kind.to_owned()).increment(payout.max(0) as u64);
    Ok((items, money))
}

// ---------------------------------------------------------------- ruletka

pub async fn casino_roulette(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let g = g();
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let bet_key = body.get("bet").and_then(Value::as_str).unwrap_or("");
    let ids = py::int_ids(body.get("ids"));
    let Some(bet) = g.roulette_bets.get(bet_key) else { return bad("Wybierz zakład na stole") };
    if !(1..=g.roulette.max_cards).contains(&ids.len()) {
        return bad(format!("Postaw od 1 do {} kart", g.roulette.max_cards));
    }
    let rows = match take_my_items(&mut tx, &cx.cat, cx.uid(), &ids, true).await? {
        Ok(r) => r,
        Err(e) => return bad(e),
    };
    let stake: i64 = rows.iter().map(|r| row_value(&cx.cat, r)).sum();
    let number = rand::thread_rng().gen_range(0..37);
    let win = bet.numbers.contains(&number);
    let mut out = json!({"number": number, "win": win, "bet": bet_key, "stake": stake});
    if win {
        // karty zostają u gracza + wygrana w kartach
        let payout = stake * bet.pays;
        let (items, money) = pay_out(&mut tx, &cx, payout, "casino").await?;
        out["items"] = json!(items);
        out["money"] = json!(money);
        out["payout"] = json!(payout);
        out["special"] = json!(casino_special_drop(&mut tx, &cx, payout).await?);
    // karta specjalna z kasyna (Joker) albo None
    } else {
        delete_items(&mut tx, cx.uid(), &ids).await?;
        out["consumed"] = json!(ids);
    }
    out["state"] = json!(get_state(&mut tx, cx.uid()).await?);
    tx.commit().await?;
    metrics::counter!("scambox_casino_games_total", "game" => "roulette", "win" => win.to_string()).increment(1);
    ok(out)
}

// ---------------------------------------------------------------- blackjack
// Gracz przeciw krupierowi, stawką są karty (jak w ruletce). Rozdanie trwa kilka zapytań (dobierz / stój / podwój),
// więc czeka w blackjack_games, a postawione karty są w ESCROW - w tym czasie nie da się ich sprzedać ani zużyć.
// Z gabloty ich nie zdejmujemy: karta w ESCROW się w niej nie pokazuje, a po remisie albo wygranej wraca na swoje
// miejsce. Talię i zakrytą kartę krupiera zna tylko serwer.

const BJ_RANKS: &str = "A23456789TJQK"; // T = dziesiątka
const BJ_SUITS: &str = "SHDC"; // piki, kiery, kara, trefle
const BJ_GONE: &str = "To rozdanie już się skończyło";

// wiersz tabeli (SELECT *) - nie wszystkie kolumny są używane
#[allow(dead_code)]
struct BjGame {
    user_id: i64,
    item_ids: String,
    stake: i64,
    double_ids: String,
    double_stake: i64,
    deck: String,
    player: String,
    dealer: String,
    created_at: f64,
}

fn ids_json(s: &str) -> Vec<i64> {
    serde_json::from_str(s).unwrap_or_default()
}

fn cards_json(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

/// (suma punktów, miękka?) - as liczy się za 11, dopóki suma nie przekracza 21
fn bj_total(hand: &[String]) -> (i64, bool) {
    let rank = |c: &String| c.chars().next().unwrap_or('2');
    let mut total: i64 = hand
        .iter()
        .map(|c| match rank(c) {
            'A' => 11,
            'T' | 'J' | 'Q' | 'K' => 10,
            d => d.to_digit(10).unwrap_or(0) as i64,
        })
        .sum();
    let mut aces = hand.iter().filter(|c| rank(c) == 'A').count();
    while total > 21 && aces > 0 {
        total -= 10;
        aces -= 1;
    }
    (total, aces > 0)
}

fn bj_blackjack(hand: &[String]) -> bool {
    hand.len() == 2 && bj_total(hand).0 == 21
}

async fn my_blackjack(c: &mut Conn, uid: i64) -> sqlx::Result<Option<BjGame>> {
    sqlx::query_as!(BjGame, "SELECT * FROM blackjack_games WHERE user_id = $1", uid).fetch_optional(c).await
}

/// Postawione karty (w ESCROW) do pokazania przy stole
async fn bj_cards(c: &mut Conn, cx: &Ctx, ids: &[i64]) -> sqlx::Result<Vec<ItemJson>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let rows = sqlx::query_as!(ItemRow, "SELECT * FROM items WHERE user_id = $1 AND id = ANY($2) ORDER BY id DESC", ESCROW, ids)
        .fetch_all(c)
        .await?;
    Ok(rows.iter().filter_map(|r| item_json(&cx.cat, r)).collect())
}

/// Rozdanie w trakcie dla przeglądarki - druga karta krupiera jest zakryta ("??")
async fn bj_json(c: &mut Conn, cx: &Ctx, gm: &BjGame) -> sqlx::Result<Value> {
    let player = cards_json(&gm.player);
    let dealer = cards_json(&gm.dealer);
    Ok(json!({"player": player, "dealer": [dealer.first(), "??"], "stake": gm.stake, "doubleStake": gm.double_stake,
              "items": bj_cards(c, cx, &ids_json(&gm.item_ids)).await?,
              "doubleItems": bj_cards(c, cx, &ids_json(&gm.double_ids)).await?,
              "canDouble": player.len() == 2 && gm.double_stake == 0}))
}

/// Koniec rozdania: krupier dobiera (jeśli trzeba), rozliczenie kart i wygranej, rozdanie znika
async fn bj_end(
    mut tx: sqlx::Transaction<'static, sqlx::Postgres>,
    cx: &Ctx,
    gm: &BjGame,
    player: Vec<String>,
    mut dealer: Vec<String>,
    mut deck: Vec<String>,
) -> Res {
    let ids: Vec<i64> = ids_json(&gm.item_ids).into_iter().chain(ids_json(&gm.double_ids)).collect();
    let stake = gm.stake + gm.double_stake;
    let total = bj_total(&player).0;
    if total <= 21 && !bj_blackjack(&player) && !bj_blackjack(&dealer) {
        while bj_total(&dealer).0 < 17 {
            // krupier dobiera do 16 i staje na każdej 17
            dealer.push(deck.pop().unwrap_or_else(|| "2S".into()));
        }
    }
    let dealer_total = bj_total(&dealer).0;
    let result = if total > 21 {
        "lose"
    } else if bj_blackjack(&player) {
        if bj_blackjack(&dealer) {
            "push"
        } else {
            "blackjack"
        }
    } else if bj_blackjack(&dealer) || (total < dealer_total && dealer_total <= 21) {
        "lose"
    } else if total == dealer_total {
        "push"
    } else {
        "win"
    };
    let mut out = json!({"result": result, "player": player, "dealer": dealer, "stake": stake, "items": [], "money": 0,
                         "special": null});
    if result == "lose" {
        sqlx::query!("DELETE FROM items WHERE user_id = $1 AND id = ANY($2)", ESCROW, &ids).execute(&mut *tx).await?;
        sqlx::query!("DELETE FROM showcase WHERE item_id = ANY($1)", &ids).execute(&mut *tx).await?;
    } else {
        // remis / wygrana - postawione karty wracają do gracza
        out["returned"] = json!(bj_cards(&mut tx, cx, &ids).await?);
        sqlx::query!("UPDATE items SET user_id = $1 WHERE user_id = $2 AND id = ANY($3)", cx.uid(), ESCROW, &ids)
            .execute(&mut *tx)
            .await?;
    }
    if result == "win" || result == "blackjack" {
        // + wygrana w kartach, jak w ruletce
        let payout = if result == "blackjack" { (stake as f64 * g().blackjack.blackjack_pays) as i64 } else { stake };
        let (items, money) = pay_out(&mut tx, cx, payout, "blackjack").await?;
        out["items"] = json!(items);
        out["money"] = json!(money);
        out["payout"] = json!(payout);
        out["special"] = json!(casino_special_drop(&mut tx, cx, payout).await?);
    }
    sqlx::query!("DELETE FROM blackjack_games WHERE user_id = $1", cx.uid()).execute(&mut *tx).await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    metrics::counter!("scambox_casino_games_total", "game" => "blackjack", "win" => result.to_owned()).increment(1);
    ok(json!({"game": null, "end": out, "state": state}))
}

/// Usuwany gracz: jego rozdanie znika razem z postawionymi kartami (są w ESCROW)
pub async fn blackjack_forget_user(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    let Some(gm) = my_blackjack(c, uid).await? else { return Ok(()) };
    let ids: Vec<i64> = ids_json(&gm.item_ids).into_iter().chain(ids_json(&gm.double_ids)).collect();
    sqlx::query!("DELETE FROM items WHERE user_id = $1 AND id = ANY($2)", ESCROW, &ids).execute(&mut *c).await?;
    sqlx::query!("DELETE FROM blackjack_games WHERE user_id = $1", uid).execute(c).await?;
    Ok(())
}

pub async fn casino_blackjack(State(st): State<AppState>, Me(me): Me) -> Res {
    let cx = Ctx::new(st, me);
    let mut c = cx.st.db.acquire().await?;
    let game = match my_blackjack(&mut c, cx.uid()).await? {
        Some(gm) => bj_json(&mut c, &cx, &gm).await?,
        None => Value::Null,
    };
    ok(json!({"game": game}))
}

pub async fn casino_blackjack_deal(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let g = g();
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    if my_blackjack(&mut tx, cx.uid()).await?.is_some() {
        return bad("Najpierw dokończ rozdanie");
    }
    let ids = py::int_ids(body.get("ids"));
    if !(1..=g.blackjack.max_cards).contains(&ids.len()) {
        return bad(format!("Postaw od 1 do {} kart", g.blackjack.max_cards));
    }
    let rows = match take_my_items(&mut tx, &cx.cat, cx.uid(), &ids, true).await? {
        Ok(r) => r,
        Err(e) => return bad(e),
    };
    // postawione karty do ESCROW na czas rozdania
    sqlx::query!("UPDATE items SET user_id = $1 WHERE user_id = $2 AND id = ANY($3)", ESCROW, cx.uid(), &ids)
        .execute(&mut *tx)
        .await?;
    let mut deck: Vec<String> = Vec::new();
    for _ in 0..g.blackjack.decks {
        for r in BJ_RANKS.chars() {
            for s in BJ_SUITS.chars() {
                deck.push(format!("{r}{s}"));
            }
        }
    }
    deck.shuffle(&mut rand::thread_rng());
    // na zmianę: gracz, krupier, gracz, krupier (zakryta)
    let mut player = vec![deck.pop().unwrap_or_default()];
    let mut dealer = vec![deck.pop().unwrap_or_default()];
    player.push(deck.pop().unwrap_or_default());
    dealer.push(deck.pop().unwrap_or_default());
    let stake: i64 = rows.iter().map(|r| row_value(&cx.cat, r)).sum();
    sqlx::query!(
        "INSERT INTO blackjack_games (user_id, item_ids, stake, deck, player, dealer, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        cx.uid(),
        json!(ids).to_string(),
        stake,
        json!(deck).to_string(),
        json!(player).to_string(),
        json!(dealer).to_string(),
        now()
    )
    .execute(&mut *tx)
    .await?;
    let gm = my_blackjack(&mut tx, cx.uid()).await?.ok_or_else(|| AppError::bad(BJ_GONE))?;
    if bj_blackjack(&player) || bj_blackjack(&dealer) {
        // krupier od razu sprawdza blackjacka - koniec rozdania
        return bj_end(tx, &cx, &gm, player, dealer, deck).await;
    }
    let game = bj_json(&mut tx, &cx, &gm).await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"game": game, "end": null, "state": state}))
}

async fn bj_load(c: &mut Conn, uid: i64) -> sqlx::Result<Option<(BjGame, Vec<String>, Vec<String>, Vec<String>)>> {
    Ok(my_blackjack(c, uid).await?.map(|gm| {
        let (p, d, k) = (cards_json(&gm.player), cards_json(&gm.dealer), cards_json(&gm.deck));
        (gm, p, d, k)
    }))
}

pub async fn casino_blackjack_hit(State(st): State<AppState>, Me(me): Me) -> Res {
    let cx = Ctx::new(st, me);
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let Some((gm, mut player, dealer, mut deck)) = bj_load(&mut tx, cx.uid()).await? else { return bad(BJ_GONE) };
    player.push(deck.pop().unwrap_or_default());
    if bj_total(&player).0 >= 21 {
        // fura albo 21 - nie ma już czego dobierać
        return bj_end(tx, &cx, &gm, player, dealer, deck).await;
    }
    sqlx::query!(
        "UPDATE blackjack_games SET deck = $1, player = $2 WHERE user_id = $3",
        json!(deck).to_string(),
        json!(player).to_string(),
        cx.uid()
    )
    .execute(&mut *tx)
    .await?;
    let gm = my_blackjack(&mut tx, cx.uid()).await?.ok_or_else(|| AppError::bad(BJ_GONE))?;
    let game = bj_json(&mut tx, &cx, &gm).await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"game": game, "end": null, "state": state}))
}

pub async fn casino_blackjack_stand(State(st): State<AppState>, Me(me): Me) -> Res {
    let cx = Ctx::new(st, me);
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let Some((gm, player, dealer, deck)) = bj_load(&mut tx, cx.uid()).await? else { return bad(BJ_GONE) };
    bj_end(tx, &cx, &gm, player, dealer, deck).await
}

/// Podwojenie: dokładam karty warte najwyżej tyle, co stawka, dostaję dokładnie jedną kartę i krupier gra
pub async fn casino_blackjack_double(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let g = g();
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let Some((gm, mut player, dealer, mut deck)) = bj_load(&mut tx, cx.uid()).await? else { return bad(BJ_GONE) };
    if player.len() != 2 || gm.double_stake != 0 {
        return bad("Podwoić można tylko na dwóch pierwszych kartach");
    }
    let ids = py::int_ids(body.get("ids"));
    if !(1..=g.blackjack.max_cards).contains(&ids.len()) {
        return bad(format!("Dołóż od 1 do {} kart", g.blackjack.max_cards));
    }
    let rows = match take_my_items(&mut tx, &cx.cat, cx.uid(), &ids, true).await? {
        Ok(r) => r,
        Err(e) => return bad(e),
    };
    let extra: i64 = rows.iter().map(|r| row_value(&cx.cat, r)).sum();
    if extra > gm.stake {
        return bad(format!("Dołożone karty mogą być warte najwyżej tyle, co stawka ({})", fmt_money(gm.stake)));
    }
    sqlx::query!("UPDATE items SET user_id = $1 WHERE user_id = $2 AND id = ANY($3)", ESCROW, cx.uid(), &ids)
        .execute(&mut *tx)
        .await?;
    sqlx::query!(
        "UPDATE blackjack_games SET double_ids = $1, double_stake = $2 WHERE user_id = $3",
        json!(ids).to_string(),
        extra,
        cx.uid()
    )
    .execute(&mut *tx)
    .await?;
    player.push(deck.pop().unwrap_or_default());
    let gm = my_blackjack(&mut tx, cx.uid()).await?.ok_or_else(|| AppError::bad(BJ_GONE))?;
    bj_end(tx, &cx, &gm, player, dealer, deck).await
}

// ---------------------------------------------------------------- jackpot (lobby dla 2 graczy)
// Gracz zakłada lobby: publiczne (każdy może dołączyć) albo prywatne (tylko zaproszeni po nicku) - założyciel może to
// później zmienić i zapraszać kolejnych graczy. Obaj gracze wybierają karty w lobby i mogą je zmieniać (każda zmiana
// cofa akceptację obu). Gdy obaj zaakceptują, serwer od razu losuje zwycięzcę (szansa = wartość moich kart / wartość
// wszystkich kart), a zwycięzca bierze wszystkie karty. Karty w lobby NIE są blokowane: przy losowaniu sprawdzamy,
// czy gracze nadal je mają.

const JACKPOT_GONE: &str = "To lobby jest już nieaktualne";
static INVITE_SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[,;\s]+").unwrap());

// wiersz tabeli (SELECT *) - nie wszystkie kolumny są używane
#[allow(dead_code)]
pub struct Jackpot {
    pub id: i64,
    pub creator_id: i64,
    pub invite_id: Option<i64>,
    pub joiner_id: Option<i64>,
    pub status: String,
    pub value_a: i64,
    pub value_b: i64,
    pub winner_id: Option<i64>,
    pub roll: Option<f64>,
    pub created_at: f64,
    pub finished_at: Option<f64>,
    pub is_public: i32,
    pub ready_a: i32,
    pub ready_b: i32,
    pub updated_at: Option<f64>,
}

impl Jackpot {
    /// Miejsce gracza w lobby: "a" (założyciel), "b" (drugi gracz) albo None
    pub fn side(&self, uid: i64) -> Option<&'static str> {
        if self.creator_id == uid {
            Some("a")
        } else if self.joiner_id == Some(uid) {
            Some("b")
        } else {
            None
        }
    }
}

struct JackpotItem {
    side: String,
    item_id: i64,
    person_id: String,
    variant: String,
    value: i64,
}

async fn jackpot_cards(c: &mut Conn, jid: i64) -> sqlx::Result<Vec<JackpotItem>> {
    sqlx::query_as!(JackpotItem, "SELECT side, item_id, person_id, variant, value FROM jackpot_items WHERE jackpot_id = $1", jid)
        .fetch_all(c)
        .await
}

pub async fn get_jackpot(c: &mut Conn, jid: i64) -> sqlx::Result<Option<Jackpot>> {
    sqlx::query_as!(Jackpot, "SELECT * FROM jackpots WHERE id = $1", jid).fetch_optional(c).await
}

async fn jackpot_invited(c: &mut Conn, jid: i64) -> sqlx::Result<Vec<i64>> {
    sqlx::query_scalar!("SELECT user_id FROM jackpot_invites WHERE jackpot_id = $1", jid).fetch_all(c).await
}

/// Otwarte lobby, w którym siedzi gracz (najwyżej jedno naraz), albo None
pub async fn my_lobby(c: &mut Conn, uid: i64) -> sqlx::Result<Option<Jackpot>> {
    sqlx::query_as!(
        Jackpot,
        "SELECT * FROM jackpots WHERE status = 'open' AND (creator_id = $1 OR joiner_id = $1) ORDER BY id DESC LIMIT 1",
        uid
    )
    .fetch_optional(c)
    .await
}

pub async fn jackpot_can_see(c: &mut Conn, j: &Jackpot, uid: i64) -> sqlx::Result<bool> {
    Ok(j.is_public != 0 || j.side(uid).is_some() || jackpot_invited(c, j.id).await?.contains(&uid))
}

/// Lobby / gry dla przeglądarki: gracze, zaproszeni, karty i wartość obu stron, akceptacje, wynik
async fn jackpots_json(c: &mut Conn, cx: &Ctx, rows: &[Jackpot]) -> sqlx::Result<Vec<Value>> {
    let mut invited = vec![];
    for j in rows {
        invited.push(jackpot_invited(c, j.id).await?);
    }
    let ids = rows
        .iter()
        .flat_map(|j| [Some(j.creator_id), j.joiner_id, j.winner_id])
        .chain(invited.iter().flatten().map(|i| Some(*i)));
    let users = users_by_id(c, &cx.cat, ids).await?;
    let found = discovered(c, cx.uid()).await?;
    let me = cx.uid();
    let mut out = vec![];
    for (j, inv) in rows.iter().zip(&invited) {
        let (mut a, mut b, mut va, mut vb) = (vec![], vec![], 0, 0);
        for r in jackpot_cards(c, j.id).await? {
            if r.side == "a" {
                va += r.value
            } else {
                vb += r.value
            }
            if cx.cat.has(&r.person_id) {
                let mut card = card_json(&cx.st.images, &cx.cat, &r.person_id, &r.variant, &found);
                card.insert("id".into(), json!(r.item_id));
                card.insert("value".into(), json!(r.value));
                if r.side == "a" {
                    a.push(card)
                } else {
                    b.push(card)
                }
            }
        }
        out.push(json!({
            "id": j.id, "status": j.status, "public": j.is_public != 0,
            "creator": users.get(&j.creator_id), "joiner": j.joiner_id.and_then(|u| users.get(&u)),
            "invites": inv.iter().filter_map(|i| users.get(i)).collect::<Vec<_>>(), "invited": inv.contains(&me),
            "side": j.side(me), "a": a, "b": b, "valueA": va, "valueB": vb,
            "readyA": j.ready_a != 0, "readyB": j.ready_b != 0,
            "winner": j.winner_id.map(|w| if w == j.creator_id { "a" } else { "b" }),
            "roll": j.roll, "created": j.created_at, "finished": j.finished_at,
        }));
    }
    Ok(out)
}

async fn lobby_json(c: &mut Conn, cx: &Ctx, jid: i64, extra: Map<String, Value>) -> sqlx::Result<Value> {
    let rows: Vec<Jackpot> = get_jackpot(c, jid).await?.into_iter().collect();
    let mut out = extra;
    out.insert("jackpot".into(), jackpots_json(c, cx, &rows).await?.into_iter().next().unwrap_or(Value::Null));
    Ok(Value::Object(out))
}

/// Ostatnia rozstrzygnięta gra gracza, której wyniku jeszcze nie widział
pub async fn jackpot_news(c: &mut Conn, cx: &Ctx, seen_ms: i64) -> sqlx::Result<Value> {
    let j = sqlx::query_as!(
        Jackpot,
        "SELECT * FROM jackpots WHERE status = 'done' AND (creator_id = $1 OR joiner_id = $1) AND finished_at > $2
         ORDER BY finished_at DESC LIMIT 1",
        cx.uid(),
        seen_ms as f64 / 1000.0
    )
    .fetch_optional(&mut *c)
    .await?;
    let rows: Vec<Jackpot> = j.into_iter().collect();
    Ok(jackpots_json(c, cx, &rows).await?.into_iter().next().unwrap_or(Value::Null))
}

/// Nicki do zaproszenia ("ala, bartek" albo lista) -> lista id albo błąd
async fn jackpot_invite_ids(c: &mut Conn, me: i64, raw: Option<&Value>) -> Result<Result<Vec<i64>, String>, AppError> {
    let names: Vec<String> = match raw {
        Some(Value::Array(a)) => a.iter().map(py::str_of).collect(),
        other => INVITE_SPLIT.split(&py::str_or_empty(other)).map(str::to_owned).collect(),
    };
    let mut out: Vec<i64> = vec![];
    for name in names.iter().map(|n| n.trim()).filter(|n| !n.is_empty()).take(10) {
        let u = find_user(c, name).await?;
        let Some(u) = u.filter(|u| u.banned == 0) else { return Ok(Err(format!("Nie ma gracza „{name}”"))) };
        if u.id == me {
            return Ok(Err("Nie możesz zaprosić samego siebie 🙂".into()));
        }
        if !out.contains(&u.id) {
            out.push(u.id);
        }
    }
    Ok(Ok(out))
}

/// Moje otwarte lobby o tym id (świeży wiersz) albo None
async fn open_lobby(c: &mut Conn, uid: i64, jid: i64, side_needed: bool) -> sqlx::Result<Option<Jackpot>> {
    Ok(get_jackpot(c, jid).await?.filter(|j| j.status == "open" && (!side_needed || j.side(uid).is_some())))
}

/// Blokuje obu graczy lobby (zawsze w tej samej kolejności) i zwraca świeży wiersz mojego otwartego lobby albo None
async fn lock_lobby(c: &mut Conn, uid: i64, jid: i64) -> sqlx::Result<Option<Jackpot>> {
    let Some(j) = open_lobby(c, uid, jid, true).await? else { return Ok(None) };
    lock_users(c, &[Some(j.creator_id), j.joiner_id]).await?;
    open_lobby(c, uid, jid, true).await
}

/// Lobby, które widzę (publiczne, z zaproszeniem dla mnie, moje), moje lobby, ostatnie gry i moja historia
pub async fn casino_jackpot(State(st): State<AppState>, Me(me): Me) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut c = cx.st.db.acquire().await?;
    let me = cx.uid();
    let lobbies = sqlx::query_as!(
        Jackpot,
        "SELECT * FROM jackpots j WHERE status = 'open' AND (is_public = 1 OR creator_id = $1 OR joiner_id = $1
         OR EXISTS (SELECT 1 FROM jackpot_invites i WHERE i.jackpot_id = j.id AND i.user_id = $1)) ORDER BY id DESC LIMIT 60",
        me
    )
    .fetch_all(&mut *c)
    .await?;
    let recent = sqlx::query_as!(Jackpot, "SELECT * FROM jackpots WHERE status = 'done' ORDER BY finished_at DESC LIMIT 12")
        .fetch_all(&mut *c)
        .await?;
    let mine = sqlx::query_as!(
        Jackpot,
        "SELECT * FROM jackpots WHERE status != 'open' AND (creator_id = $1 OR joiner_id = $1)
         ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 12",
        me
    )
    .fetch_all(&mut *c)
    .await?;
    let current: Vec<Jackpot> = my_lobby(&mut c, me).await?.into_iter().collect();
    ok(json!({
        "lobbies": jackpots_json(&mut c, &cx, &lobbies).await?,
        "current": jackpots_json(&mut c, &cx, &current).await?.into_iter().next(),
        "recent": jackpots_json(&mut c, &cx, &recent).await?,
        "mine": jackpots_json(&mut c, &cx, &mine).await?,
    }))
}

/// Nowe lobby: public (bool) i invites (nicki graczy). Karty wybiera się już w lobby.
pub async fn casino_jackpot_create(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    if my_lobby(&mut tx, cx.uid()).await?.is_some() {
        return bad("Jesteś już w lobby — najpierw je opuść");
    }
    let invites = match jackpot_invite_ids(&mut tx, cx.uid(), body.get("invites")).await? {
        Ok(i) => i,
        Err(e) => return bad(e),
    };
    let now = now();
    let public = body.get("public").map(py::truthy).unwrap_or(true) as i32;
    let jid = sqlx::query_scalar!(
        "INSERT INTO jackpots (creator_id, is_public, created_at, updated_at) VALUES ($1, $2, $3, $3) RETURNING id",
        cx.uid(),
        public,
        now
    )
    .fetch_one(&mut *tx)
    .await?;
    for u in invites {
        sqlx::query!("INSERT INTO jackpot_invites (jackpot_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", jid, u)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    let mut c = cx.st.db.acquire().await?;
    ok(lobby_json(&mut c, &cx, jid, Map::new()).await?)
}

/// Zajęcie wolnego miejsca w lobby (publicznym albo z zaproszeniem dla mnie)
pub async fn casino_jackpot_join(State(st): State<AppState>, Me(me): Me, Path(jid): Path<i64>) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let Some(j) = open_lobby(&mut tx, cx.uid(), jid, false).await? else { return bad(JACKPOT_GONE) };
    if j.side(cx.uid()).is_none() {
        if !jackpot_can_see(&mut tx, &j, cx.uid()).await? {
            return bad_code("To lobby jest prywatne — potrzebujesz zaproszenia", 403);
        }
        if my_lobby(&mut tx, cx.uid()).await?.is_some() {
            return bad("Jesteś już w innym lobby — najpierw je opuść");
        }
        let n = sqlx::query!(
            "UPDATE jackpots SET joiner_id = $1, ready_a = 0, ready_b = 0, updated_at = $2 WHERE id = $3
             AND status = 'open' AND joiner_id IS NULL",
            cx.uid(),
            now(),
            jid
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if n == 0 {
            return bad("Ktoś był szybszy — w tym lobby nie ma już miejsca");
        }
    }
    tx.commit().await?;
    let mut c = cx.st.db.acquire().await?;
    ok(lobby_json(&mut c, &cx, jid, Map::new()).await?)
}

/// Drugi gracz wychodzi (albo założyciel go wyprasza): jego karty znikają z lobby, akceptacje się cofają
pub async fn free_seat(c: &mut Conn, jid: i64) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM jackpot_items WHERE jackpot_id = $1 AND side = 'b'", jid).execute(&mut *c).await?;
    sqlx::query!("UPDATE jackpots SET joiner_id = NULL, ready_a = 0, ready_b = 0, updated_at = $1 WHERE id = $2", now(), jid)
        .execute(c)
        .await?;
    Ok(())
}

/// Wyjście z lobby - założyciel zamyka całe lobby (karty niczyje nie były zablokowane)
pub async fn casino_jackpot_leave(State(st): State<AppState>, Me(me): Me, Path(jid): Path<i64>) -> Res {
    let cat = st.cat();
    settle_market(&st.db, &cat).await?;
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let Some(j) = open_lobby(&mut tx, me.id, jid, true).await? else { return bad(JACKPOT_GONE) };
    if j.side(me.id) == Some("a") {
        let t = now();
        sqlx::query!(
            "UPDATE jackpots SET status = 'cancelled', finished_at = $1, updated_at = $1 WHERE id = $2 AND status = 'open'",
            t,
            jid
        )
        .execute(&mut *tx)
        .await?;
    } else {
        free_seat(&mut tx, jid).await?;
    }
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn casino_jackpot_kick(State(st): State<AppState>, Me(me): Me, Path(jid): Path<i64>) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let j = open_lobby(&mut tx, cx.uid(), jid, true).await?;
    let Some(j) = j.filter(|j| j.side(cx.uid()) == Some("a")) else { return bad(JACKPOT_GONE) };
    if j.joiner_id.is_some_and(|u| u != 0) {
        free_seat(&mut tx, jid).await?;
    }
    tx.commit().await?;
    let mut c = cx.st.db.acquire().await?;
    ok(lobby_json(&mut c, &cx, jid, Map::new()).await?)
}

/// Założyciel: public (bool), invite (nicki do zaproszenia), uninvite (id gracza do usunięcia z zaproszonych)
pub async fn casino_jackpot_settings(State(st): State<AppState>, Me(me): Me, Path(jid): Path<i64>, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let j = open_lobby(&mut tx, cx.uid(), jid, true).await?;
    if j.is_none_or(|j| j.side(cx.uid()) != Some("a")) {
        return bad(JACKPOT_GONE);
    }
    if let Some(p) = body.get("public") {
        sqlx::query!("UPDATE jackpots SET is_public = $1 WHERE id = $2", py::truthy(p) as i32, jid).execute(&mut *tx).await?;
    }
    if body.get("invite").is_some_and(py::truthy) {
        let invites = match jackpot_invite_ids(&mut tx, cx.uid(), body.get("invite")).await? {
            Ok(i) => i,
            Err(e) => return bad(e),
        };
        for u in invites {
            sqlx::query!("INSERT INTO jackpot_invites (jackpot_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", jid, u)
                .execute(&mut *tx)
                .await?;
        }
    }
    if let Some(u) = body.get("uninvite").filter(|v| py::truthy(v)) {
        let Some(u) = py::int(u) else { return bad("Nieprawidłowe żądanie") };
        sqlx::query!("DELETE FROM jackpot_invites WHERE jackpot_id = $1 AND user_id = $2", jid, u).execute(&mut *tx).await?;
    }
    sqlx::query!("UPDATE jackpots SET updated_at = $1 WHERE id = $2", now(), jid).execute(&mut *tx).await?;
    tx.commit().await?;
    let mut c = cx.st.db.acquire().await?;
    ok(lobby_json(&mut c, &cx, jid, Map::new()).await?)
}

/// Moje karty w lobby (cała nowa lista). Każda zmiana cofa akceptację obu graczy.
pub async fn casino_jackpot_cards(State(st): State<AppState>, Me(me): Me, Path(jid): Path<i64>, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    let Some(j) = lock_lobby(&mut tx, cx.uid(), jid).await? else { return bad(JACKPOT_GONE) };
    let side = j.side(cx.uid()).unwrap_or("b");
    let ids = py::int_ids(body.get("ids"));
    if ids.len() > g().jackpot.max_cards {
        return bad(format!("Najwyżej {} kart", g().jackpot.max_cards));
    }
    let rows = if ids.is_empty() {
        vec![]
    } else {
        match take_my_items(&mut tx, &cx.cat, cx.uid(), &ids, true).await? {
            Ok(r) => r,
            Err(e) => return bad(e),
        }
    };
    sqlx::query!("DELETE FROM jackpot_items WHERE jackpot_id = $1 AND side = $2", jid, side).execute(&mut *tx).await?;
    for r in &rows {
        sqlx::query!(
            "INSERT INTO jackpot_items (jackpot_id, side, item_id, person_id, variant, value) VALUES ($1, $2, $3, $4, $5, $6)",
            jid,
            side,
            r.id,
            r.person_id,
            r.variant,
            row_value(&cx.cat, r)
        )
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query!("UPDATE jackpots SET ready_a = 0, ready_b = 0, updated_at = $1 WHERE id = $2", now(), jid)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let mut c = cx.st.db.acquire().await?;
    ok(lobby_json(&mut c, &cx, jid, Map::new()).await?)
}

/// Obaj zaakceptowali: sprawdzamy, czy gracze nadal mają swoje karty, losujemy zwycięzcę i dajemy mu wszystkie karty.
/// Zwraca komunikat błędu (wtedy brakujące karty znikają z lobby, a akceptacje się cofają) albo None.
async fn jackpot_play(c: &mut Conn, cx: &Ctx, j: &Jackpot) -> sqlx::Result<Option<&'static str>> {
    let now = now();
    let rows = jackpot_cards(c, j.id).await?;
    let (mut gone, mut va, mut vb) = (vec![], 0i64, 0i64);
    for r in &rows {
        let owner = if r.side == "a" { Some(j.creator_id) } else { j.joiner_id };
        let it =
            sqlx::query_as!(ItemRow, "SELECT * FROM items WHERE id = $1 AND user_id = $2 AND favorite = 0", r.item_id, owner)
                .fetch_optional(&mut *c)
                .await?;
        let it = it.filter(|it| cx.person(&it.person_id).is_some_and(|p| !p.is_special()));
        let Some(it) = it else {
            gone.push(r.item_id);
            continue;
        };
        let v = row_value(&cx.cat, &it);
        if r.side == "a" {
            va += v
        } else {
            vb += v
        }
        sqlx::query!("UPDATE jackpot_items SET value = $1 WHERE jackpot_id = $2 AND item_id = $3", v, j.id, it.id)
            .execute(&mut *c)
            .await?;
    }
    if !gone.is_empty() || va == 0 || vb == 0 {
        for item in &gone {
            sqlx::query!("DELETE FROM jackpot_items WHERE jackpot_id = $1 AND item_id = $2", j.id, item).execute(&mut *c).await?;
        }
        sqlx::query!("UPDATE jackpots SET ready_a = 0, ready_b = 0, updated_at = $1 WHERE id = $2", now, j.id)
            .execute(&mut *c)
            .await?;
        return Ok(Some(if !gone.is_empty() {
            "Część kart z lobby nie jest już u graczy (sprzedane, oznaczone ⭐ albo użyte gdzie indziej) — usunęliśmy je, \
             zaakceptujcie jeszcze raz"
        } else {
            "Obaj gracze muszą postawić karty"
        }));
    }
    let roll = random();
    let winner = if roll < va as f64 / (va + vb) as f64 { j.creator_id } else { j.joiner_id.unwrap_or(j.creator_id) };
    let n = sqlx::query!(
        "UPDATE jackpots SET status = 'done', value_a = $1, value_b = $2, winner_id = $3, roll = $4, finished_at = $5,
         updated_at = $5 WHERE id = $6 AND status = 'open'",
        va,
        vb,
        winner,
        roll,
        now,
        j.id
    )
    .execute(&mut *c)
    .await?
    .rows_affected();
    if n == 0 {
        return Ok(Some(JACKPOT_GONE));
    }
    let ids: Vec<i64> = rows.iter().map(|r| r.item_id).collect();
    give_items(c, &cx.cat, &ids, winner, "transfer").await?; // zwycięzca: swoje karty z powrotem + karty rywala
    metrics::counter!("scambox_casino_games_total", "game" => "jackpot", "win" => "done").increment(1);
    Ok(None)
}

/// Akceptacja (ready: true / false). Gdy zaakceptują obaj - od razu losowanie.
pub async fn casino_jackpot_ready(State(st): State<AppState>, Me(me): Me, Path(jid): Path<i64>, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    let Some(j) = lock_lobby(&mut tx, cx.uid(), jid).await? else { return bad(JACKPOT_GONE) };
    let side = j.side(cx.uid()).unwrap_or("b");
    let want = body.get("ready").map(py::truthy).unwrap_or(true);
    if want && j.joiner_id.is_none_or(|u| u == 0) {
        return bad("Poczekaj na drugiego gracza");
    }
    if want && !jackpot_cards(&mut tx, jid).await?.iter().any(|r| r.side == side) {
        return bad("Najpierw wybierz swoje karty");
    }
    if side == "a" {
        sqlx::query!("UPDATE jackpots SET ready_a = $1, updated_at = $2 WHERE id = $3", want as i32, now(), jid)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query!("UPDATE jackpots SET ready_b = $1, updated_at = $2 WHERE id = $3", want as i32, now(), jid)
            .execute(&mut *tx)
            .await?;
    }
    let j = get_jackpot(&mut tx, jid).await?.ok_or_else(|| AppError::bad(JACKPOT_GONE))?;
    if j.ready_a != 0 && j.ready_b != 0 {
        let err = jackpot_play(&mut tx, &cx, &j).await?;
        tx.commit().await?;
        let mut c = cx.st.db.acquire().await?;
        if let Some(err) = err {
            let mut extra = Map::new();
            extra.insert("error".into(), json!(err));
            return Err(AppError::Json(StatusCode::CONFLICT, lobby_json(&mut c, &cx, jid, extra).await?));
        }
        let mut extra = Map::new();
        extra.insert("items".into(), json!(my_items(&mut c, &cx.cat, cx.uid()).await?));
        extra.insert("state".into(), json!(get_state(&mut c, cx.uid()).await?));
        return ok(lobby_json(&mut c, &cx, jid, extra).await?);
    }
    tx.commit().await?;
    let mut c = cx.st.db.acquire().await?;
    ok(lobby_json(&mut c, &cx, jid, Map::new()).await?)
}

/// Gracz obejrzał wynik gry - nie pokazujemy go ponownie (zapamiętany koniec gry w ms)
pub async fn casino_jackpot_seen(State(st): State<AppState>, Me(me): Me, Path(jid): Path<i64>) -> Res {
    let mut c = st.db.acquire().await?;
    if let Some(j) = get_jackpot(&mut c, jid).await? {
        if j.status == "done" && j.side(me.id).is_some() {
            let ms = (j.finished_at.unwrap_or(0.0) * 1000.0) as i64 + 1;
            if ms > get_state(&mut c, me.id).await?["jackpot_seen"] {
                set_state(&mut c, me.id, "jackpot_seen", ms).await?;
            }
        }
    }
    ok(json!({"ok": true}))
}
