//! Rynek kart: oferty za stałą cenę (z propozycjami niższej ceny), licytacje i zlecenia "Szukam".

use std::collections::HashMap;

use axum::extract::{Path, State};
use serde_json::{json, Map, Value};

use super::{ok, Body};
use crate::auth::Me;
use crate::data::g;
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, bad_code, Res};
use crate::game::market::*;
use crate::game::views::card_json;
use crate::game::*;
use crate::py::{self, fmt_money};
use crate::state::AppState;

const MARKET_GONE: &str = "Ta oferta jest już nieaktualna";

fn market_price(raw: Option<&Value>, lo: i64) -> Option<i64> {
    raw.and_then(py::int).filter(|v| (lo..=g().market.max_price).contains(v))
}

fn price_error() -> String {
    format!("Cena: od 1 do {} gr", py::group(g().market.max_price))
}

struct Wanted {
    id: i64,
    buyer_id: i64,
    person_id: String,
    variant: String,
    price: i64,
    status: String,
    seller_id: Option<i64>,
    created_at: f64,
    updated_at: f64,
}

fn with(mut m: Map<String, Value>, extra: Value) -> Value {
    if let Value::Object(e) = extra {
        m.extend(e);
    }
    Value::Object(m)
}

pub async fn market(State(st): State<AppState>, Me(me): Me) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut c = cx.st.db.acquire().await?;
    let (me, now) = (cx.uid(), now());
    let found = discovered(&mut c, me).await?;
    let known = |r: &str| cx.cat.has(r);
    let listings: Vec<Listing> =
        sqlx::query_as!(Listing, "SELECT * FROM market_listings WHERE status = 'active' ORDER BY id DESC LIMIT 1000")
            .fetch_all(&mut *c)
            .await?
            .into_iter()
            .filter(|r| known(&r.person_id))
            .collect();
    let history: Vec<Listing> = sqlx::query_as!(
        Listing,
        "SELECT * FROM market_listings WHERE status != 'active' AND (seller_id = $1 OR buyer_id = $1) ORDER BY updated_at DESC LIMIT 40",
        me
    )
    .fetch_all(&mut *c)
    .await?
    .into_iter()
    .filter(|r| known(&r.person_id))
    .collect();
    let wanted: Vec<Wanted> =
        sqlx::query_as!(Wanted, "SELECT * FROM market_wanted WHERE status = 'active' ORDER BY id DESC LIMIT 500")
            .fetch_all(&mut *c)
            .await?
            .into_iter()
            .filter(|r| known(&r.person_id))
            .collect();
    let filled: Vec<Wanted> = sqlx::query_as!(
        Wanted,
        "SELECT * FROM market_wanted WHERE status = 'filled' AND (buyer_id = $1 OR seller_id = $1) ORDER BY updated_at DESC LIMIT 20",
        me
    )
    .fetch_all(&mut *c)
    .await?
    .into_iter()
    .filter(|r| known(&r.person_id))
    .collect();
    let my_offers = sqlx::query!(
        "SELECT o.id, o.listing_id, o.price, o.status, o.updated_at, l.person_id, l.variant, l.price AS list_price, l.seller_id
         FROM market_offers o JOIN market_listings l ON l.id = o.listing_id WHERE o.buyer_id = $1
         AND (o.status = 'pending' OR o.updated_at > $2) ORDER BY o.id DESC LIMIT 40",
        me,
        now - 7.0 * 86400.0
    )
    .fetch_all(&mut *c)
    .await?;
    let lids: Vec<i64> = listings.iter().map(|r| r.id).collect();
    let mut tops: HashMap<i64, Bid> = HashMap::new();
    for b in sqlx::query_as!(Bid, "SELECT * FROM market_bids WHERE status = 'active' AND listing_id = ANY($1)", &lids)
        .fetch_all(&mut *c)
        .await?
    {
        if tops.get(&b.listing_id).is_none_or(|t| b.amount > t.amount) {
            tops.insert(b.listing_id, b);
        }
    }
    let counts: HashMap<i64, i64> = sqlx::query!(
        r#"SELECT listing_id, COUNT(*) AS "n!" FROM market_bids WHERE listing_id = ANY($1) GROUP BY listing_id"#,
        &lids
    )
    .fetch_all(&mut *c)
    .await?
    .into_iter()
    .map(|r| (r.listing_id, r.n))
    .collect();
    let mut offers: HashMap<i64, Vec<Offer>> = HashMap::new();
    for o in sqlx::query_as!(
        Offer,
        "SELECT * FROM market_offers WHERE status = 'pending' AND listing_id = ANY($1) ORDER BY price DESC",
        &lids
    )
    .fetch_all(&mut *c)
    .await?
    {
        offers.entry(o.listing_id).or_default().push(o);
    }
    let ids = listings
        .iter()
        .chain(&history)
        .map(|r| Some(r.seller_id))
        .chain(history.iter().map(|r| r.buyer_id))
        .chain(tops.values().map(|b| Some(b.bidder_id)))
        .chain(offers.values().flatten().map(|o| Some(o.buyer_id)))
        .chain(wanted.iter().chain(&filled).map(|r| Some(r.buyer_id)))
        .chain(filled.iter().map(|r| r.seller_id))
        .chain(my_offers.iter().map(|o| Some(o.seller_id)))
        .collect::<Vec<_>>();
    let users = users_by_id(&mut c, &cx.cat, ids).await?;
    let user = |id: Option<i64>| id.and_then(|i| users.get(&i)).cloned().unwrap_or(Value::Null);
    let card =
        |pid: &str, variant: &str, f: &std::collections::HashSet<String>| card_json(&cx.st.images, &cx.cat, pid, variant, f);

    let listing_json: Vec<Value> = listings
        .iter()
        .map(|r| {
            let (top, mine) = (tops.get(&r.id), r.seller_id == me);
            let list_offers = offers.get(&r.id).map(Vec::as_slice).unwrap_or(&[]);
            let own = list_offers.iter().find(|o| o.buyer_id == me);
            with(
                card(&r.person_id, &r.variant, &found),
                json!({"id": r.id, "kind": r.kind, "price": r.price, "step": r.step, "endsAt": r.ends_at, "created": r.created_at,
                       "seller": user(Some(r.seller_id)), "mine": mine,
                       "topBid": top.map(|t| t.amount),
                       "topBidder": top.map(|t| user(Some(t.bidder_id))["username"].clone()),
                       "myTop": top.is_some_and(|t| t.bidder_id == me), "bids": counts.get(&r.id).copied().unwrap_or(0),
                       "offers": if mine { list_offers.iter().map(|o| json!({"id": o.id, "price": o.price, "buyer": user(Some(o.buyer_id)), "created": o.created_at})).collect::<Vec<_>>() } else { vec![] },
                       "myOffer": own.map(|o| json!({"id": o.id, "price": o.price}))}),
            )
        })
        .collect();
    let wanted_json: Vec<Value> = wanted
        .iter()
        .map(|r| {
            let own: std::collections::HashSet<String> = [r.person_id.clone()].into();
            let f = if r.buyer_id == me { &own } else { &found };
            with(
                card(&r.person_id, &r.variant, f),
                json!({"id": r.id, "price": r.price, "created": r.created_at, "buyer": user(Some(r.buyer_id)), "mine": r.buyer_id == me}),
            )
        })
        .collect();
    let mut hist: Vec<Value> = history
        .iter()
        .map(|r| {
            let seller = r.seller_id == me;
            with(
                card(&r.person_id, &r.variant, &found),
                json!({"id": r.id, "type": r.kind, "status": r.status, "role": if seller { "seller" } else { "buyer" },
                       "price": if r.final_price != 0 { r.final_price } else { r.price }, "at": r.updated_at,
                       "other": user(if seller { r.buyer_id } else { Some(r.seller_id) })}),
            )
        })
        .chain(filled.iter().map(|r| {
            let buyer = r.buyer_id == me;
            with(
                card(&r.person_id, &r.variant, &found),
                json!({"id": r.id, "type": "wanted", "status": "filled", "role": if buyer { "buyer" } else { "seller" },
                       "price": r.price, "at": r.updated_at, "other": user(if buyer { r.seller_id } else { Some(r.buyer_id) })}),
            )
        }))
        .collect();
    hist.sort_by(|a, b| b["at"].as_f64().unwrap_or(0.0).total_cmp(&a["at"].as_f64().unwrap_or(0.0)));
    hist.truncate(50);
    let my_offers_json: Vec<Value> = my_offers
        .iter()
        .filter(|o| known(&o.person_id))
        .map(|o| {
            with(
                card(&o.person_id, &o.variant, &found),
                json!({"id": o.id, "listing": o.listing_id, "price": o.price, "listPrice": o.list_price, "status": o.status,
                       "at": o.updated_at, "seller": user(Some(o.seller_id))}),
            )
        })
        .collect();
    set_state(&mut c, me, "market_seen", now as i64).await?;
    ok(json!({"now": now, "listings": listing_json, "wanted": wanted_json, "history": hist, "myOffers": my_offers_json}))
}

/// Wystawienie karty: kind = fixed (stała cena) albo auction (licytacja: cena wywoławcza, min. przebicie, czas)
pub async fn market_list(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let m = &g().market;
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let kind = body.get("kind").and_then(Value::as_str).unwrap_or("");
    let Some(item_id) = body.get("item").and_then(py::int) else { return bad("Wybierz kartę") };
    if kind != "fixed" && kind != "auction" {
        return bad("Nieprawidłowy rodzaj oferty");
    }
    let rows = match take_my_items(&mut tx, &cx.cat, cx.uid(), &[item_id], false).await? {
        Ok(r) => r,
        Err(e) => return bad(e),
    };
    let Some(price) = market_price(body.get("price"), 1) else { return bad(price_error()) };
    let now = now();
    let (mut step, mut ends) = (0, None);
    if kind == "auction" {
        let raw = body.get("step").filter(|v| py::truthy(v)).cloned().unwrap_or(json!(1));
        let Some(s) = market_price(Some(&raw), 1) else { return bad("Minimalne przebicie: od 1 $") };
        step = s;
        let hours = match body.get("hours") {
            Some(v) if py::truthy(v) => py::int(v).unwrap_or(0),
            _ => 24,
        };
        if !m.auction_hours.contains(&hours) {
            return bad("Nieprawidłowy czas licytacji");
        }
        ends = Some(now + hours as f64 * 3600.0);
    }
    let active = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "n!" FROM market_listings WHERE seller_id = $1 AND status = 'active'"#,
        cx.uid()
    )
    .fetch_one(&mut *tx)
    .await?;
    if active >= m.max_listings {
        return bad(format!("Możesz mieć najwyżej {} ofert naraz", m.max_listings));
    }
    let r = &rows[0];
    escrow_items(&mut tx, cx.uid(), &[item_id]).await?;
    let lid = sqlx::query_scalar!(
        "INSERT INTO market_listings (seller_id, item_id, person_id, variant, kind, price, step, created_at, ends_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8) RETURNING id",
        cx.uid(),
        item_id,
        r.person_id,
        r.variant,
        kind,
        price,
        step,
        now,
        ends
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    ok(json!({"ok": true, "id": lid, "consumed": [item_id]}))
}

pub async fn market_buy(State(st): State<AppState>, Me(me): Me, Path(lid): Path<i64>) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let l = claim_listing(&mut tx, lid, Claim::Fixed).await?;
    let Some(l) = l.filter(|l| cx.cat.has(&l.person_id)) else { return bad(MARKET_GONE) };
    if l.seller_id == cx.uid() {
        return bad("To twoja oferta");
    }
    if get_state(&mut tx, cx.uid()).await?["balance"] < l.price {
        return bad("Za mało pieniędzy!");
    }
    let now = now();
    sqlx::query!(
        "UPDATE market_listings SET status = 'sold', buyer_id = $1, final_price = $2, updated_at = $3 WHERE id = $4",
        cx.uid(),
        l.price,
        now,
        lid
    )
    .execute(&mut *tx)
    .await?;
    add_state(&mut tx, cx.uid(), "balance", -l.price).await?;
    add_state(&mut tx, l.seller_id, "balance", after_fee(l.price)).await?;
    give_items(&mut tx, &cx.cat, &[l.item_id], cx.uid(), "transfer").await?;
    refund_offers(&mut tx, lid, now, "lost").await?;
    tx.commit().await?;
    metrics::counter!("scambox_market_trades_total", "kind" => "fixed").increment(1);
    let mut c = cx.st.db.acquire().await?;
    let item = item_by_id(&mut c, l.item_id).await?.and_then(|r| item_json(&cx.cat, &r));
    ok(json!({"ok": true, "item": item, "state": get_state(&mut c, cx.uid()).await?}))
}

/// Propozycja niższej ceny - pieniądze są od razu blokowane; sprzedający może ją przyjąć albo odrzucić
pub async fn market_offer(State(st): State<AppState>, Me(me): Me, Path(lid): Path<i64>, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let price = market_price(body.get("price"), 1);
    let l = claim_listing(&mut tx, lid, Claim::Fixed).await?;
    let Some(l) = l.filter(|l| cx.cat.has(&l.person_id)) else { return bad(MARKET_GONE) };
    if l.seller_id == cx.uid() {
        return bad("To twoja oferta");
    }
    let Some(price) = price.filter(|p| *p < l.price) else {
        return bad(format!("Zaproponuj cenę niższą niż {} (albo po prostu kup kartę)", fmt_money(l.price)));
    };
    let now = now();
    let old = sqlx::query_as!(
        Offer,
        "SELECT * FROM market_offers WHERE listing_id = $1 AND buyer_id = $2 AND status = 'pending'",
        lid,
        cx.uid()
    )
    .fetch_optional(&mut *tx)
    .await?;
    if get_state(&mut tx, cx.uid()).await?["balance"] + old.as_ref().map(|o| o.price).unwrap_or(0) < price {
        return bad("Za mało pieniędzy!");
    }
    if let Some(old) = old {
        // nowa propozycja zastępuje poprzednią
        sqlx::query!("UPDATE market_offers SET status = 'cancelled', updated_at = $1 WHERE id = $2", now, old.id)
            .execute(&mut *tx)
            .await?;
        add_state(&mut tx, cx.uid(), "balance", old.price).await?;
    }
    add_state(&mut tx, cx.uid(), "balance", -price).await?;
    sqlx::query!(
        "INSERT INTO market_offers (listing_id, buyer_id, price, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
        lid,
        cx.uid(),
        price,
        now
    )
    .execute(&mut *tx)
    .await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "state": state}))
}

/// accept / decline - sprzedający; cancel - kupujący wycofuje swoją propozycję
pub async fn market_offer_action(State(st): State<AppState>, Me(me): Me, Path((oid, action)): Path<(i64, String)>) -> Res {
    if !["accept", "decline", "cancel"].contains(&action.as_str()) {
        return Err(crate::error::AppError::Status(axum::http::StatusCode::NOT_FOUND));
    }
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let (me, now) = (cx.uid(), now());
    let o = sqlx::query_as!(Offer, "SELECT * FROM market_offers WHERE id = $1", oid).fetch_optional(&mut *tx).await?;
    let l = match &o {
        Some(o) => get_listing(&mut tx, o.listing_id).await?,
        None => None,
    };
    let (Some(o), Some(l)) = (o, l) else { return bad(MARKET_GONE) };
    if o.status != "pending" {
        return bad(MARKET_GONE);
    }
    if action == "cancel" {
        if o.buyer_id != me {
            return bad_code("To nie twoja propozycja", 403);
        }
        let n = sqlx::query!(
            "UPDATE market_offers SET status = 'cancelled', updated_at = $1 WHERE id = $2 AND status = 'pending'",
            now,
            oid
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if n > 0 {
            add_state(&mut tx, me, "balance", o.price).await?;
        }
    } else if l.seller_id != me {
        return bad_code("To nie twoja oferta", 403);
    } else if action == "decline" {
        let n = sqlx::query!(
            "UPDATE market_offers SET status = 'declined', updated_at = $1 WHERE id = $2 AND status = 'pending'",
            now,
            oid
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if n > 0 {
            add_state(&mut tx, o.buyer_id, "balance", o.price).await?;
        }
    } else {
        let l = claim_listing(&mut tx, l.id, Claim::Any).await?;
        let Some(l) = l.filter(|l| cx.cat.has(&l.person_id)) else { return bad(MARKET_GONE) };
        let n = sqlx::query!(
            "UPDATE market_offers SET status = 'accepted', updated_at = $1 WHERE id = $2 AND status = 'pending'",
            now,
            oid
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if n == 0 {
            return bad("Kupujący wycofał już tę propozycję");
        }
        sqlx::query!(
            "UPDATE market_listings SET status = 'sold', buyer_id = $1, final_price = $2, updated_at = $3 WHERE id = $4",
            o.buyer_id,
            o.price,
            now,
            l.id
        )
        .execute(&mut *tx)
        .await?;
        add_state(&mut tx, me, "balance", after_fee(o.price)).await?;
        give_items(&mut tx, &cx.cat, &[l.item_id], o.buyer_id, "transfer").await?;
        refund_offers(&mut tx, l.id, now, "lost").await?;
        metrics::counter!("scambox_market_trades_total", "kind" => "offer").increment(1);
    }
    let state = get_state(&mut tx, me).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "state": state}))
}

pub async fn market_bid(State(st): State<AppState>, Me(me): Me, Path(lid): Path<i64>, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let m = &g().market;
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let now = now();
    let amount = market_price(body.get("amount"), 1);
    let l = claim_listing(&mut tx, lid, Claim::AuctionOpen(now)).await?;
    let Some(l) = l.filter(|l| cx.cat.has(&l.person_id)) else { return bad("Ta licytacja już się skończyła") };
    if l.seller_id == cx.uid() {
        return bad("Nie możesz licytować własnej karty");
    }
    let top = top_bid(&mut tx, lid).await?;
    if top.as_ref().is_some_and(|t| t.bidder_id == cx.uid()) {
        return bad("Twoja oferta jest już najwyższa");
    }
    let need = top.as_ref().map(|t| t.amount + l.step.max(1)).unwrap_or(l.price);
    let Some(amount) = amount.filter(|a| *a >= need) else {
        return bad(format!("Najmniejsza możliwa oferta: {}", fmt_money(need)));
    };
    if get_state(&mut tx, cx.uid()).await?["balance"] < amount {
        return bad("Za mało pieniędzy!");
    }
    add_state(&mut tx, cx.uid(), "balance", -amount).await?;
    sqlx::query!(
        "INSERT INTO market_bids (listing_id, bidder_id, amount, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
        lid,
        cx.uid(),
        amount,
        now
    )
    .execute(&mut *tx)
    .await?;
    if let Some(top) = top {
        // przebity gracz dostaje pieniądze z powrotem
        sqlx::query!("UPDATE market_bids SET status = 'outbid', updated_at = $1 WHERE id = $2", now, top.id)
            .execute(&mut *tx)
            .await?;
        add_state(&mut tx, top.bidder_id, "balance", top.amount).await?;
    }
    if l.ends_at.unwrap_or(now) - now < m.snipe_seconds {
        sqlx::query!("UPDATE market_listings SET ends_at = $1 WHERE id = $2", now + m.snipe_seconds, lid)
            .execute(&mut *tx)
            .await?;
    }
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "state": state}))
}

/// Wycofanie mojej oferty - karta wraca do ekwipunku (licytacji, w której ktoś już licytuje, nie da się wycofać)
pub async fn market_cancel(State(st): State<AppState>, Me(me): Me, Path(lid): Path<i64>) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let Some(l) = claim_listing(&mut tx, lid, Claim::Seller(cx.uid())).await? else { return bad(MARKET_GONE) };
    if top_bid(&mut tx, lid).await?.is_some() {
        return bad("Ktoś już licytuje — tej licytacji nie można wycofać");
    }
    let now = now();
    sqlx::query!("UPDATE market_listings SET status = 'cancelled', updated_at = $1 WHERE id = $2", now, lid)
        .execute(&mut *tx)
        .await?;
    give_items(&mut tx, &cx.cat, &[l.item_id], cx.uid(), "transfer").await?;
    refund_offers(&mut tx, lid, now, "lost").await?;
    tx.commit().await?;
    let mut c = cx.st.db.acquire().await?;
    let item = item_by_id(&mut c, l.item_id).await?.and_then(|r| item_json(&cx.cat, &r));
    ok(json!({"ok": true, "item": item}))
}

/// Zlecenie "Szukam": kupię tę kartę (w tym wariancie) za tyle - pieniądze są blokowane do realizacji / wycofania
pub async fn market_wanted_create(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let m = &g().market;
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let p = body.get("person").and_then(Value::as_str).and_then(|p| cx.cat.person(p)).cloned();
    let variant = match body.get("variant") {
        Some(v) if py::truthy(v) => py::str_of(v),
        _ => "normal".into(),
    };
    let Some(p) = p.filter(|_| g().is_variant(&variant)) else { return bad("Wybierz kartę") };
    if !cx.cat.possible_variants(&p).contains(&variant) {
        // np. Rzulty tylko dla Jana Pawła II, Królewska tylko ze Skrzyni Królów
        return bad("Ta karta nie występuje w tym wariancie");
    }
    if p.is_secret() && !discovered(&mut tx, cx.uid()).await?.contains(&p.id) {
        return bad("Tej tajnej karty jeszcze nie znasz");
    }
    let Some(price) = market_price(body.get("price"), 1) else { return bad(price_error()) };
    let active =
        sqlx::query_scalar!(r#"SELECT COUNT(*) AS "n!" FROM market_wanted WHERE buyer_id = $1 AND status = 'active'"#, cx.uid())
            .fetch_one(&mut *tx)
            .await?;
    if active >= m.max_wanted {
        return bad(format!("Możesz mieć najwyżej {} zleceń naraz", m.max_wanted));
    }
    if get_state(&mut tx, cx.uid()).await?["balance"] < price {
        return bad("Za mało pieniędzy!");
    }
    let now = now();
    add_state(&mut tx, cx.uid(), "balance", -price).await?;
    sqlx::query!(
        "INSERT INTO market_wanted (buyer_id, person_id, variant, price, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)",
        cx.uid(),
        p.id,
        variant,
        price,
        now
    )
    .execute(&mut *tx)
    .await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "state": state}))
}

pub async fn market_wanted_cancel(State(st): State<AppState>, Me(me): Me, Path(wid): Path<i64>) -> Res {
    let cat = st.cat();
    settle_market(&st.db, &cat).await?;
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let w = sqlx::query_as!(Wanted, "SELECT * FROM market_wanted WHERE id = $1 AND buyer_id = $2", wid, me.id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(w) = w else { return bad(MARKET_GONE) };
    let n = sqlx::query!(
        "UPDATE market_wanted SET status = 'cancelled', updated_at = $1 WHERE id = $2 AND status = 'active'",
        now(),
        wid
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        return bad(MARKET_GONE);
    }
    add_state(&mut tx, me.id, "balance", w.price).await?;
    let state = get_state(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "state": state}))
}

/// Sprzedaję moją kartę komuś, kto jej szuka - od razu, za cenę ze zlecenia
pub async fn market_wanted_fill(State(st): State<AppState>, Me(me): Me, Path(wid): Path<i64>, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    settle_market(&cx.st.db, &cx.cat).await?;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let Some(item_id) = body.get("item").and_then(py::int) else { return bad("Wybierz kartę") };
    let w = sqlx::query_as!(Wanted, "SELECT * FROM market_wanted WHERE id = $1", wid).fetch_optional(&mut *tx).await?;
    let Some(w) = w.filter(|w| w.status == "active") else { return bad(MARKET_GONE) };
    if w.buyer_id == cx.uid() {
        return bad("To twoje zlecenie");
    }
    let rows = match take_my_items(&mut tx, &cx.cat, cx.uid(), &[item_id], false).await? {
        Ok(r) => r,
        Err(e) => return bad(e),
    };
    if rows[0].person_id != w.person_id || rows[0].variant != w.variant {
        return bad("Ta karta nie pasuje do zlecenia");
    }
    let n = sqlx::query!(
        "UPDATE market_wanted SET status = 'filled', seller_id = $1, updated_at = $2 WHERE id = $3 AND status = 'active'",
        cx.uid(),
        now(),
        wid
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        return bad(MARKET_GONE);
    }
    give_items(&mut tx, &cx.cat, &[item_id], w.buyer_id, "transfer").await?;
    add_state(&mut tx, cx.uid(), "balance", after_fee(w.price)).await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    metrics::counter!("scambox_market_trades_total", "kind" => "wanted").increment(1);
    ok(json!({"ok": true, "consumed": [item_id], "state": state}))
}

/// Usuwany gracz: jego karty z rynku znikają razem z nim, pieniądze innych graczy wracają, jego własne propozycje,
/// licytacje i zlecenia przepadają (pieniądze były już zabrane z jego konta)
pub async fn market_forget_user(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    let now = now();
    let listings = sqlx::query_as!(Listing, "SELECT * FROM market_listings WHERE seller_id = $1 AND status = 'active'", uid)
        .fetch_all(&mut *c)
        .await?;
    for l in listings {
        sqlx::query!("UPDATE market_listings SET status = 'cancelled', updated_at = $1 WHERE id = $2", now, l.id)
            .execute(&mut *c)
            .await?;
        refund_offers(c, l.id, now, "lost").await?;
        let bids = sqlx::query_as!(Bid, "SELECT * FROM market_bids WHERE listing_id = $1 AND status = 'active'", l.id)
            .fetch_all(&mut *c)
            .await?;
        for b in bids {
            sqlx::query!("UPDATE market_bids SET status = 'refunded', updated_at = $1 WHERE id = $2", now, b.id)
                .execute(&mut *c)
                .await?;
            add_state(c, b.bidder_id, "balance", b.amount).await?;
        }
        sqlx::query!("DELETE FROM items WHERE id = $1 AND user_id = $2", l.item_id, ESCROW).execute(&mut *c).await?;
    }
    sqlx::query!(
        "UPDATE market_offers SET status = 'cancelled', updated_at = $1 WHERE buyer_id = $2 AND status = 'pending'",
        now,
        uid
    )
    .execute(&mut *c)
    .await?;
    sqlx::query!(
        "UPDATE market_bids SET status = 'refunded', updated_at = $1 WHERE bidder_id = $2 AND status = 'active'",
        now,
        uid
    )
    .execute(&mut *c)
    .await?;
    sqlx::query!(
        "UPDATE market_wanted SET status = 'cancelled', updated_at = $1 WHERE buyer_id = $2 AND status = 'active'",
        now,
        uid
    )
    .execute(&mut *c)
    .await?;
    // jego lobby jackpota: założone - zamykamy, w cudzym - zwalniamy miejsce; znika też z zaproszeń
    sqlx::query!(
        "UPDATE jackpots SET status = 'cancelled', finished_at = $1 WHERE creator_id = $2 AND status = 'open'",
        now,
        uid
    )
    .execute(&mut *c)
    .await?;
    let joined =
        sqlx::query_scalar!("SELECT id FROM jackpots WHERE joiner_id = $1 AND status = 'open'", uid).fetch_all(&mut *c).await?;
    for jid in joined {
        super::casino::free_seat(c, jid).await?;
    }
    sqlx::query!("DELETE FROM jackpot_invites WHERE user_id = $1", uid).execute(c).await?;
    Ok(())
}
