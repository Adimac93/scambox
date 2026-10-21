//! Skrzynki (sklep, otwieranie, skrzynki z pieniędzmi), sprzedaż, ulubione, kuźnia (kontrakt, ulepszacz),
//! codzienna nagroda i seria logowań.

use std::collections::HashSet;

use axum::extract::State;
use chrono::{Duration, Local, NaiveDate};
use rand::seq::SliceRandom;
use serde_json::{json, Map, Value};

use super::{ok, Body};
use crate::auth::Me;
use crate::catalog::Catalog;
use crate::data::g;
use crate::db::{lock_me, Conn};
use crate::error::{bad, bad_code, AppError, Res};
use crate::game::roll::{random, roll, roll_money, roll_variant};
use crate::game::views::{crate_json, public_person};
use crate::game::*;
use crate::py;
use crate::state::AppState;

const MAX_BULK_CONTRACTS: usize = 50; // ile kontraktów naraz

pub async fn config(State(st): State<AppState>, Me(me): Me) -> Res {
    let cx = Ctx::new(st, me);
    let g = g();
    let mut c = cx.st.db.acquire().await?;
    let found = discovered(&mut c, cx.uid()).await?;
    let people: Map<String, Value> = cx
        .cat
        .people
        .iter()
        .map(|(pid, p)| (pid.clone(), public_person(&cx.st.images, &cx.cat, p, found.contains(pid))))
        .collect();
    let mut crates = Map::new();
    for (cid, cr) in &cx.cat.crates {
        let mut j = crate_json(&cx.cat, cr);
        j.insert("canBuy".into(), json!(can_buy(&mut c, &cx.me, cr).await?));
        crates.insert(cid.clone(), Value::Object(j));
    }
    let contract_next: Map<String, Value> = g.contract_size.keys().map(|r| (r.clone(), json!(cx.cat.next_rarity(r)))).collect();
    ok(json!({
        "rarities": g.rarities_json,
        "rarityOrder": g.rarity_order,
        "variants": g.variants_json,
        "variantOrder": g.variant_order,
        "types": g.types_json,
        "abilityKinds": g.ability_kinds,
        // Arena (wersja testowa) - tylko admini; bez tego klucza przeglądarka chowa zakładkę i wyzwania
        "arena": if cx.me.admin() {
            json!({"rules": g.arena_json, "effects": g.arena_effects_json, "visuals": g.arena_visuals,
                   "targets": g.arena_targets, "effectTargets": g.arena_effect_targets})
        } else { Value::Null },
        "people": people,
        "crates": crates,
        "crateOrder": cx.cat.crates.keys().collect::<Vec<_>>(),
        "maxOpen": g.max_open,
        "startingBalance": g.starting_balance,
        "contractSize": g.contract_size_json,
        "contractNext": contract_next, // rzadkość wyniku (pusta rzadkość jest pomijana)
        "contractVariantBonus": g.contract_variant_bonus,
        "upgradeEdge": g.upgrade_edge,
        "upgradeMax": g.upgrade_max,
        "upgradeMaxItems": g.upgrade_max_items,
        "maxDeposit": g.max_deposit,
        "moneyChests": g.money_chests_json,
        "dailyStreak": g.daily_streak,
        "secretOdds": g.secret_odds,
        "showcaseSize": g.showcase_size,
        "market": g.market_json,
        "roulette": g.roulette_json,
        "jackpot": g.jackpot_json,
        "blackjack": g.blackjack_json,
        "specialVariants": g.special_variants,
        "specialSources": g.special_sources_json,
        "casinoSpecial": g.casino_special_json,
    }))
}

pub async fn state(State(st): State<AppState>, Me(me): Me) -> Res {
    let cx = Ctx::new(st, me);
    let mut c = cx.st.db.acquire().await?;
    let uid = cx.uid();
    ok(json!({
        "state": get_state(&mut c, uid).await?,
        "items": my_items(&mut c, &cx.cat, uid).await?,
        "showcase": showcase_ids(&mut c, uid).await?,
        "chests": get_chests(&mut c, &cx.cat, uid).await?,
        "collected": collected_list(&mut c, &cx.cat, uid).await?,
    }))
}

fn int_or(body: &Body, key: &str, default: i64) -> Result<i64, AppError> {
    match body.get(key) {
        None => Ok(default),
        Some(v) => py::int(v).ok_or_else(|| AppError::bad("Nieprawidłowe żądanie")),
    }
}

pub async fn open_crates(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let g = g();
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let cr = body.get("crate").and_then(Value::as_str).and_then(|c| cx.cat.crates.get(c));
    let count = int_or(&body, "count", 1)?;
    let Some(cr) = cr.filter(|_| (1..=g.max_open).contains(&count)) else { return bad("Nieprawidłowe żądanie") };
    if cr.special {
        return bad("Karty specjalne zdobywa się w kasynie albo z linku — tej skrzynki nie da się otworzyć");
    }
    if !cx.cat.crate_people(cr).any(|p| !p.is_special()) {
        return bad("Ta skrzynka jest pusta");
    }
    let use_owned = body.get("useOwned").map(py::truthy).unwrap_or(true);
    let owned =
        if use_owned { get_chests(&mut tx, &cx.cat, cx.uid()).await?.get(&cr.id).copied().unwrap_or(0) as i64 } else { 0 };
    let from_inv = owned.min(count);
    if from_inv < count && !can_buy(&mut tx, &cx.me, cr).await? {
        let msg =
            if cr.shop { "Ta skrzynka jest dostępna tylko dla wybranych graczy" } else { "Tej skrzynki nie ma teraz w sklepie" };
        let extra = if owned > 0 { format!(" — możesz otworzyć tylko te z ekwipunku ({owned})") } else { String::new() };
        return bad_code(format!("{msg}{extra}"), 403);
    }
    let cost = (count - from_inv) * cr.price;
    if get_state(&mut tx, cx.uid()).await?["balance"] < cost {
        return bad("Za mało pieniędzy!");
    }
    if from_inv > 0 {
        add_chests(&mut tx, cx.uid(), &cr.id, -from_inv).await?;
    }
    add_state(&mut tx, cx.uid(), "balance", -cost).await?;
    add_state(&mut tx, cx.uid(), "spent", cost).await?;
    add_state(&mut tx, cx.uid(), "opened", count).await?;
    let mut drops = vec![];
    for _ in 0..count {
        let Some((person, variant)) = roll(&cx.cat, cr) else { return bad("Ta skrzynka jest pusta") };
        drops.push(insert_item(&mut tx, &cx, &person.id, &variant, "drop").await?);
    }
    let new = note_drops(&mut tx, &cx, &drops_of(&drops), "drop").await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    let chests = get_chests(&mut tx, &cx.cat, cx.uid()).await?;
    tx.commit().await?;
    metrics::counter!("scambox_crates_opened_total", "crate" => cr.id.clone()).increment(count as u64);
    ok(json!({"drops": drops, "discovered": new, "state": state, "fromInventory": from_inv, "chests": chests}))
}

pub async fn buy_chests(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let cr = body.get("crate").and_then(Value::as_str).and_then(|c| cx.cat.crates.get(c));
    let count = int_or(&body, "count", 1)?;
    let Some(cr) = cr.filter(|_| (1..=100).contains(&count)) else { return bad("Nieprawidłowe żądanie") };
    if !can_buy(&mut tx, &cx.me, cr).await? {
        return bad_code("Nie możesz kupić tej skrzynki", 403);
    }
    let cost = count * cr.price;
    if get_state(&mut tx, cx.uid()).await?["balance"] < cost {
        return bad("Za mało pieniędzy!");
    }
    add_state(&mut tx, cx.uid(), "balance", -cost).await?;
    add_state(&mut tx, cx.uid(), "spent", cost).await?;
    add_chests(&mut tx, cx.uid(), &cr.id, count).await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    let chests = get_chests(&mut tx, &cx.cat, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"state": state, "chests": chests}))
}

pub async fn open_money_chest(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let Some(kind) = body.get("kind").and_then(Value::as_str).filter(|k| g().money_chests.contains_key(*k)) else {
        return bad("Nieznana skrzynka");
    };
    let key = format!("money_{kind}");
    if get_chests(&mut tx, &cx.cat, cx.uid()).await?.get(&key).copied().unwrap_or(0) < 1 {
        return bad("Nie masz takiej skrzynki");
    }
    let amount = roll_money(kind);
    add_chests(&mut tx, cx.uid(), &key, -1).await?;
    add_state(&mut tx, cx.uid(), "balance", amount).await?;
    add_state(&mut tx, cx.uid(), "daily_total", amount).await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    let chests = get_chests(&mut tx, &cx.cat, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"amount": amount, "kind": kind, "state": state, "chests": chests}))
}

fn ids_of(body: &Body, key: &str) -> Result<Vec<i64>, AppError> {
    py::int_list(body.get(key)).ok_or_else(|| AppError::bad("Nieprawidłowe żądanie"))
}

pub async fn sell(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let ids = ids_of(&body, "ids")?;
    if ids.is_empty() {
        return bad("Nic nie wybrano");
    }
    // ulubionych kart nie sprzedajemy, karty specjalne nie znikają z gry
    let rows =
        sqlx::query_as!(ItemRow, "SELECT * FROM items WHERE user_id = $1 AND favorite = 0 AND id = ANY($2)", cx.uid(), &ids)
            .fetch_all(&mut *tx)
            .await?;
    let rows: Vec<ItemRow> = rows.into_iter().filter(|r| !cx.person(&r.person_id).is_some_and(|p| p.is_special())).collect();
    let total: i64 = rows.iter().map(|r| row_value(&cx.cat, r)).sum();
    let sold: Vec<i64> = rows.iter().map(|r| r.id).collect();
    delete_items(&mut tx, cx.uid(), &sold).await?;
    add_state(&mut tx, cx.uid(), "balance", total).await?;
    add_state(&mut tx, cx.uid(), "earned", total).await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"sold": sold, "total": total, "state": state}))
}

pub async fn set_favorite(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let mut ids = ids_of(&body, "ids")?;
    ids.truncate(500);
    if ids.is_empty() {
        return bad("Nic nie wybrano");
    }
    let fav = body.get("fav").map(py::truthy).unwrap_or(true) as i32;
    sqlx::query!("UPDATE items SET favorite = $1 WHERE user_id = $2 AND id = ANY($3)", fav, me.id, &ids).execute(&st.db).await?;
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- kuźnia

/// Możliwe wyniki kontraktu ze skrzynki (None = ze wszystkich skrzynek w sklepie). Tylko karty ze skrzynek, które są
/// teraz w sklepie ("forge"); wynik nie może być "droższą" kartą niż najtańsza z włożonych.
fn contract_candidates<'a>(
    cat: &'a Catalog,
    crate_id: Option<&str>,
    target: &str,
    max_mult: f64,
) -> Vec<&'a crate::catalog::Person> {
    let people: Vec<&crate::catalog::Person> = match crate_id {
        Some(cid) => cat.crates.get(cid).map(|c| cat.crate_people(c).map(|p| p.as_ref()).collect()).unwrap_or_default(),
        None => cat.people.values().map(|p| p.as_ref()).collect(),
    };
    people.into_iter().filter(|p| p.rarity == target && p.value_mult <= max_mult && p.forge).collect()
}

/// Skrzynka, z której kontrakt losuje wynik za tę kartę: pierwsza skrzynka karty z kartami wyższej rzadkości
/// w sklepie; karta tylko ze skrzynek spoza sklepu - None (wszystkie skrzynki w sklepie)
fn contract_crate(cat: &Catalog, p: &crate::catalog::Person, target: &str, max_mult: f64) -> Option<String> {
    p.crates.iter().find(|c| !contract_candidates(cat, Some(c), target, max_mult).is_empty()).cloned()
}

struct Plan {
    ids: Vec<i64>,
    target: String,
    max_mult: f64,
    pool: Vec<Option<String>>,
    specials: usize,
}

/// Sprawdza karty jednego kontraktu (nic nie zmienia): plan albo komunikat dla gracza
async fn contract_check(c: &mut Conn, cx: &Ctx, ids: &[i64]) -> Result<Result<Plan, String>, AppError> {
    let g = g();
    let Some(rows) = owned_rows(c, &cx.cat, cx.uid(), ids).await? else { return Ok(Err("Nie masz tych kart".into())) };
    if rows.iter().any(|r| r.favorite != 0) {
        return Ok(Err(FAV_ERROR.into()));
    }
    if rows.iter().any(|r| cx.cat.people[&r.person_id].is_special()) {
        return Ok(Err(SPECIAL_ERROR.into()));
    }
    let rarities: HashSet<&str> = rows.iter().map(|r| cx.cat.people[&r.person_id].rarity.as_str()).collect();
    let rarity = if rarities.len() == 1 { rarities.into_iter().next() } else { None };
    let size = rarity.and_then(|r| g.contract_size.get(r).copied());
    if rarity.is_some() && size.is_none() {
        return Ok(Err("Z tych kart nie da się nic wytworzyć — tajnych kart nie można zrobić w kuźni".into()));
    }
    let (Some(rarity), Some(size)) = (rarity, size) else {
        return Ok(Err("Wszystkie karty muszą mieć tę samą rzadkość".into()));
    };
    if rows.len() != size {
        return Ok(Err(format!("Kontrakt wymaga {size} kart")));
    }
    let Some(target) = cx.cat.next_rarity(rarity) else { return Ok(Err("Nie ma kart wyższej rzadkości".into())) };
    let max_mult = rows.iter().map(|r| cx.cat.people[&r.person_id].value_mult).fold(f64::INFINITY, f64::min);
    let pool: Vec<Option<String>> = rows
        .iter()
        .map(|r| contract_crate(&cx.cat, &cx.cat.people[&r.person_id], &target, max_mult))
        .filter(|c| !contract_candidates(&cx.cat, c.as_deref(), &target, max_mult).is_empty())
        .collect();
    if pool.is_empty() {
        return Ok(Err("W skrzynkach ze sklepu nie ma kart wyższej rzadkości".into()));
    }
    Ok(Ok(Plan { ids: ids.to_vec(), target, max_mult, pool, specials: rows.iter().filter(|r| r.variant != "normal").count() }))
}

/// Wykonuje sprawdzony kontrakt: zabiera karty, losuje nową. Zwraca (karta, skrzynka wyniku).
async fn contract_exec(c: &mut Conn, cx: &Ctx, plan: &Plan) -> Res<(NewItem, Option<String>)> {
    let (crate_id, person_id, person_crate) = {
        let mut rng = rand::thread_rng();
        let crate_id = plan.pool.choose(&mut rng).cloned().flatten();
        let cands = contract_candidates(&cx.cat, crate_id.as_deref(), &plan.target, plan.max_mult);
        let person =
            cands.choose(&mut rng).ok_or_else(|| AppError::bad("W skrzynkach ze sklepu nie ma kart wyższej rzadkości"))?;
        (crate_id, person.id.clone(), person.crate_.clone())
    };
    delete_items(c, cx.uid(), &plan.ids).await?;
    let variant = roll_variant(1.0 + g().contract_variant_bonus * plan.specials as f64, &[]);
    let item = insert_item(c, cx, &person_id, &variant, "contract").await?;
    add_state(c, cx.uid(), "contracts", 1).await?;
    metrics::counter!("scambox_forge_total", "kind" => "contract").increment(1);
    Ok((item, crate_id.or(person_crate)))
}

pub async fn contract(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let ids = ids_of(&body, "ids")?;
    let plan = match contract_check(&mut tx, &cx, &ids).await? {
        Ok(p) => p,
        Err(e) => return bad(e),
    };
    let (item, crate_id) = contract_exec(&mut tx, &cx, &plan).await?;
    let new = note_drops(&mut tx, &cx, &drops_of(std::slice::from_ref(&item)), "contract").await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"item": item, "crate": crate_id, "consumed": ids, "discovered": new, "state": state}))
}

/// Wiele kontraktów naraz: groups = [[id, id, ...], ...]. Najpierw sprawdzamy wszystkie - błąd w jednym = nic się nie dzieje.
pub async fn contracts_bulk(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let Some(groups) = body.get("groups").and_then(Value::as_array).filter(|g| (1..=MAX_BULK_CONTRACTS).contains(&g.len()))
    else {
        return bad(format!("Naraz można zrobić od 1 do {MAX_BULK_CONTRACTS} kontraktów"));
    };
    let Some(groups) = groups
        .iter()
        .map(|g| g.as_array().and_then(|a| a.iter().map(py::int).collect::<Option<Vec<i64>>>()))
        .collect::<Option<Vec<Vec<i64>>>>()
    else {
        return bad("Nieprawidłowe żądanie");
    };
    let all_ids: Vec<i64> = groups.iter().flatten().copied().collect();
    if all_ids.iter().collect::<HashSet<_>>().len() != all_ids.len() {
        return bad("Ta sama karta nie może być w dwóch kontraktach");
    }
    let mut plans = vec![];
    for group in &groups {
        match contract_check(&mut tx, &cx, group).await? {
            Ok(p) => plans.push(p),
            Err(e) => return bad(e),
        }
    }
    let mut results = vec![];
    let mut items = vec![];
    for plan in &plans {
        let (item, crate_id) = contract_exec(&mut tx, &cx, plan).await?;
        results.push(json!({"item": item, "crate": crate_id}));
        items.push(item);
    }
    let new = note_drops(&mut tx, &cx, &drops_of(&items), "contract").await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"results": results, "consumed": all_ids, "discovered": new, "state": state}))
}

pub async fn upgrade(State(st): State<AppState>, Me(me): Me, body: Body) -> Res {
    let cx = Ctx::new(st, me);
    let g = g();
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let ids = ids_of(&body, "ids")?;
    let target = body.get("target").and_then(Value::as_str).and_then(|t| cx.cat.person(t)).cloned();
    let variant = match body.get("variant") {
        None => "normal".to_owned(),
        Some(v) => v.as_str().unwrap_or("").to_owned(),
    };
    let rows = owned_rows(&mut tx, &cx.cat, cx.uid(), &ids).await?;
    let (Some(rows), Some(target)) = (rows, target) else { return bad("Nieprawidłowy wybór kart") };
    if !(1..=g.upgrade_max_items).contains(&rows.len()) || !g.is_variant(&variant) {
        return bad("Nieprawidłowy wybór kart");
    }
    if rows.iter().any(|r| r.favorite != 0) {
        return bad(FAV_ERROR);
    }
    if rows.iter().any(|r| cx.cat.people[&r.person_id].is_special()) {
        return bad(SPECIAL_ERROR);
    }
    if target.is_secret() || target.is_special() {
        return bad("Tajnych kart nie da się wytworzyć w kuźni");
    }
    if !target.forge {
        return bad("Tej karty nie ma teraz w żadnej skrzynce w sklepie — nie da się jej wytworzyć");
    }
    if g.variants[&variant].exclusive {
        return bad(format!("Wariant „{}” wypada tylko ze skrzynek", g.variants[&variant].name));
    }
    let stake: i64 = rows.iter().map(|r| row_value(&cx.cat, r)).sum();
    let goal = target.value(&variant);
    if goal <= stake {
        return bad("Cel musi być wart więcej niż twoje karty");
    }
    let chance = g.upgrade_max.min(stake as f64 / goal as f64 * g.upgrade_edge);
    let roll_ = random();
    let win = roll_ < chance;
    delete_items(&mut tx, cx.uid(), &ids).await?;
    let (item, new) = if win {
        let item = insert_item(&mut tx, &cx, &target.id, &variant, "upgrade").await?;
        let new = note_drops(&mut tx, &cx, &drops_of(std::slice::from_ref(&item)), "upgrade").await?;
        (Some(item), new)
    } else {
        (None, vec![])
    };
    add_state(&mut tx, cx.uid(), if win { "upgrades_won" } else { "upgrades_lost" }, 1).await?;
    let state = get_state(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    metrics::counter!("scambox_forge_total", "kind" => if win { "upgrade_won" } else { "upgrade_lost" }).increment(1);
    ok(json!({"win": win, "chance": chance, "roll": roll_, "item": item, "consumed": ids, "discovered": new, "state": state}))
}

// ---------------------------------------------------------------- codzienna nagroda

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// Seria logowań: ile dni z rzędu (do wczoraj) gracz odebrał codzienną skrzynkę i czy odebrał ją dziś
async fn daily_streak(c: &mut Conn, uid: i64, today: NaiveDate) -> sqlx::Result<(i64, bool)> {
    let limit = (today + Duration::days(1)).to_string();
    let claimed: HashSet<String> =
        sqlx::query_scalar!("SELECT day FROM daily_claims WHERE user_id = $1 AND day < $2", uid, limit)
            .fetch_all(c)
            .await?
            .into_iter()
            .collect();
    let (mut before, mut d) = (0, today - Duration::days(1));
    while claimed.contains(&d.to_string()) {
        before += 1;
        d -= Duration::days(1);
    }
    Ok((before, claimed.contains(&today.to_string())))
}

/// Dzisiejsza skrzynka w serii DAILY_STREAK dni: dzień serii 1..7 (7. = MEGA), które dni serii są już odebrane
pub async fn daily_info(c: &mut Conn, uid: i64) -> sqlx::Result<Value> {
    let n = g().daily_streak;
    let today = today();
    let (before, done) = daily_streak(c, uid, today).await?;
    // dzień serii, który przypada dziś (po MEGA seria liczy się od nowa)
    let pos = before % n + 1;
    let kind = if pos == n { "mega" } else { "daily" };
    let days: Vec<Value> = (1..=n)
        .map(|i| {
            json!({"day": i, "kind": if i == n { "mega" } else { "daily" }, "claimed": i < pos || (i == pos && done),
                   "today": i == pos})
        })
        .collect();
    Ok(json!({"today": today.to_string(), "claimable": !done, "days": days, "todayKind": kind, "streakDay": pos,
              "streak": before + done as i64, "daysToJackpot": n - pos}))
}

pub async fn daily(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    ok(daily_info(&mut c, me.id).await?)
}

pub async fn daily_claim(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let info = daily_info(&mut tx, me.id).await?;
    let kind = info["todayKind"].as_str().unwrap_or("daily").to_owned(); // 7. dzień serii logowań = MEGA skrzynka
    let inserted = sqlx::query!(
        "INSERT INTO daily_claims (user_id, day, amount) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING",
        me.id,
        today().to_string()
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return bad("Dzisiejsza skrzynka jest już odebrana");
    }
    add_chests(&mut tx, me.id, &format!("money_{kind}"), 1).await?;
    let chests = get_chests(&mut tx, &cat, me.id).await?;
    let daily = daily_info(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"kind": kind, "chests": chests, "daily": daily}))
}
