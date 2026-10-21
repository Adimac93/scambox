//! Panel admina: katalog (skrzynki, karty, zdjęcia), gracze (blokady, pieniądze, skrzynki, dostęp, hasła), wiadomości
//! do graczy, linki do kart specjalnych, dziennik działań adminów.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock};

use axum::extract::{Multipart, Path, Query, State};
use regex::Regex;
use serde_json::{json, Map, Value};
use unicode_normalization::UnicodeNormalization;

use super::{ok, Body};
use crate::auth::{hash_password_async, password_error, Admin, User, MIN_PASSWORD};
use crate::catalog::{self, Catalog, Person, Table};
use crate::data::g;
use crate::db::{now, Conn};
use crate::error::{bad, bad_code, AppError, Res};
use crate::game::views::{crate_json, hidden_crate_json, img_version, variant_photos};
use crate::game::*;
use crate::images::Kind;
use crate::py::{self, money_txt};
use crate::state::AppState;

fn slug(text: &str) -> String {
    static NON_ALNUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-zA-Z0-9]+").unwrap());
    let ascii: String = text.replace('ł', "l").replace('Ł', "L").nfkd().filter(char::is_ascii).collect();
    let t = NON_ALNUM.replace_all(&ascii, "_").trim_matches('_').to_lowercase();
    if t.is_empty() {
        "x".into()
    } else {
        t
    }
}

fn unique_id(base: &str, taken: &HashSet<&String>) -> String {
    let (mut i, mut key) = (2, base.to_owned());
    while taken.contains(&key) {
        key = format!("{base}_{i}");
        i += 1;
    }
    key
}

/// Karta w panelu admina (pola karty + zdjęcia). p: słownik karty (ukryte karty - surowe dane z data/game.json)
fn admin_card_json(st: &AppState, cat: &Catalog, p: &Map<String, Value>) -> Map<String, Value> {
    let keys = [
        "id",
        "name",
        "rarity",
        "type",
        "hp",
        "attack",
        "dmg",
        "attack2",
        "dmg2",
        "kind1",
        "kind2",
        "abilities",
        "arena",
        "country",
        "source",
        "fixedVariant",
        "style",
        "subtitle",
        "desc",
        "crate",
        "crates",
        "number",
        "builtin",
        "modified",
    ];
    let mut m: Map<String, Value> = keys.iter().map(|k| (k.to_string(), p.get(*k).cloned().unwrap_or(Value::Null))).collect();
    let pid = p.get("id").and_then(Value::as_str).unwrap_or("");
    m.insert("wiki".into(), p.get("wiki").filter(|w| py::truthy(w)).cloned().unwrap_or(Value::Null));
    m.insert("hasImage".into(), json!(st.images.find(pid, &Kind::Main).is_some()));
    m.insert("hasAlt".into(), json!(st.images.find(pid, &Kind::Alt).is_some()));
    m.insert("cardVariants".into(), json!(cat.photo_variants(pid)));
    m.insert("variantPhotos".into(), Value::Object(variant_photos(&st.images, cat, pid)));
    m.insert("imgv".into(), json!(img_version(&st.images, pid)));
    m
}

fn chest_name(cat: &Catalog, kind: &str) -> String {
    match g().money_kind(kind) {
        Some(m) => g().money_chests[m].name.clone(),
        None => cat.crates.get(kind).map(|c| c.name.clone()).unwrap_or_default(),
    }
}

/// Gracz dostał pieniądze / skrzynki od admina - na stałe znika z rankingu
async fn mark_money_generated(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    sqlx::query!("UPDATE users SET money_generated = 1 WHERE id = $1", uid).execute(c).await?;
    Ok(())
}

// ---------------------------------------------------------------- wiadomości do graczy
// Admin wybiera od kiedy do kiedy wiadomość jest aktywna (przeglądarka wysyła gotowe znaczniki czasu); każdy gracz,
// który wejdzie do gry w tym czasie, zobaczy ją raz.

pub async fn admin_messages_list(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let rows = sqlx::query!(
        r#"SELECT m.id, m.title, m.body, m.starts_at, m.ends_at, m.admin_name,
                  (SELECT COUNT(*) FROM admin_message_seen s WHERE s.message_id = m.id) AS "seen!"
           FROM admin_messages m ORDER BY starts_at DESC"#
    )
    .fetch_all(&st.db)
    .await?;
    let messages: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({"id": r.id, "title": r.title, "body": r.body, "start": r.starts_at, "end": r.ends_at,
                        "admin": r.admin_name, "seen": r.seen})
        })
        .collect();
    ok(json!({"messages": messages}))
}

pub async fn admin_messages_add(State(st): State<AppState>, Admin(me): Admin, body: Body) -> Res {
    let title = py::cut(py::str_or_empty(body.get("title")).trim(), 100);
    let text = py::cut(py::str_or_empty(body.get("body")).replace("\r\n", "\n").trim(), 2000);
    let (Some(start), Some(end)) = (body.get("start").and_then(py::float), body.get("end").and_then(py::float)) else {
        return bad("Podaj początek i koniec wyświetlania");
    };
    if title.is_empty() || text.is_empty() {
        return bad("Podaj tytuł i treść wiadomości");
    }
    if end <= start {
        return bad("Koniec musi być później niż początek");
    }
    if end <= now() {
        return bad("Ta wiadomość już by się skończyła - wybierz późniejszy koniec");
    }
    let mut tx = st.db.begin().await?;
    sqlx::query!(
        "INSERT INTO admin_messages (title, body, starts_at, ends_at, created_at, admin_name) VALUES ($1, $2, $3, $4, $5, $6)",
        title,
        text,
        start,
        end,
        now(),
        me.username
    )
    .execute(&mut *tx)
    .await?;
    log_admin(&mut tx, &me, "message_add", None, &title).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_messages_delete(State(st): State<AppState>, Admin(me): Admin, Path(mid): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    let Some(title) = sqlx::query_scalar!("SELECT title FROM admin_messages WHERE id = $1", mid).fetch_optional(&mut *tx).await?
    else {
        return bad_code("Nie ma takiej wiadomości", 404);
    };
    sqlx::query!("DELETE FROM admin_message_seen WHERE message_id = $1", mid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM admin_messages WHERE id = $1", mid).execute(&mut *tx).await?;
    log_admin(&mut tx, &me, "message_delete", None, &title).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_log_list(State(st): State<AppState>, Admin(_): Admin, Query(q): Query<HashMap<String, String>>) -> Res {
    let limit = q.get("limit").filter(|l| !l.is_empty()).map(|l| l.trim().parse::<i64>()).transpose();
    let Ok(limit) = limit else { return bad("Nieprawidłowe żądanie") };
    let limit = limit.unwrap_or(300).clamp(1, 1000);
    let rows = sqlx::query!("SELECT * FROM admin_log ORDER BY id DESC LIMIT $1", limit).fetch_all(&st.db).await?;
    let log: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({"id": r.id, "time": r.created_at, "admin": r.admin_name, "action": r.action, "target": r.target_name,
                        "details": r.details})
        })
        .collect();
    ok(json!({"log": log}))
}

// ---------------------------------------------------------------- katalog

pub async fn admin_catalog(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let cat = st.cat();
    let g = g();
    let mut c = st.db.acquire().await?;
    let counts: HashMap<String, i64> = sqlx::query!(r#"SELECT person_id, COUNT(*) AS "n!" FROM items GROUP BY person_id"#)
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|r| (r.person_id, r.n))
        .collect();
    let mut access: HashMap<String, Vec<i64>> = HashMap::new();
    for r in sqlx::query!("SELECT user_id, crate_id FROM crate_access").fetch_all(&mut *c).await? {
        access.entry(r.crate_id).or_default().push(r.user_id);
    }
    let mut crates: Vec<Value> = cat
        .crates
        .values()
        .map(|cr| {
            let mut j = crate_json(&cat, cr);
            let custom: Map<String, Value> = cr
                .weights
                .iter()
                .filter(|(r, _)| !(*r == "secret" && cr.auto_secret))
                .map(|(r, w)| (r.clone(), json!(w)))
                .collect();
            j.insert("builtin".into(), json!(cr.builtin));
            j.insert("modified".into(), json!(cr.modified));
            j.insert("hidden".into(), json!(false));
            j.insert("customWeights".into(), Value::Object(custom));
            j.insert("allowed".into(), json!(access.get(&cr.id).cloned().unwrap_or_default()));
            Value::Object(j)
        })
        .collect();
    for (cid, cr) in &cat.hidden_crates {
        let mut j = hidden_crate_json(cr);
        j.insert("builtin".into(), json!(true));
        j.insert("modified".into(), json!(false));
        j.insert("hidden".into(), json!(true));
        j.insert("customWeights".into(), cr.get("weights").filter(|w| py::truthy(w)).cloned().unwrap_or(json!({})));
        j.insert("allowed".into(), json!(access.get(cid).cloned().unwrap_or_default()));
        crates.push(Value::Object(j));
    }
    let mut cards: Vec<Value> = cat
        .people
        .values()
        .map(|p| {
            let mut j = admin_card_json(&st, &cat, &p.to_map());
            j.insert("owned".into(), json!(counts.get(&p.id).copied().unwrap_or(0)));
            j.insert("hidden".into(), json!(false));
            Value::Object(j)
        })
        .collect();
    for (pid, p) in &cat.hidden_cards {
        if !p.get("crate").and_then(Value::as_str).is_some_and(|c| cat.crates.contains_key(c)) {
            continue;
        }
        let mut raw = p.clone();
        raw.insert("number".into(), json!(0));
        let mut j = admin_card_json(&st, &cat, &raw);
        j.insert("owned".into(), json!(counts.get(pid).copied().unwrap_or(0)));
        j.insert("hidden".into(), json!(true));
        cards.push(Value::Object(j));
    }
    let users: Vec<Value> = sqlx::query_as!(User, "SELECT * FROM users ORDER BY LOWER(username)")
        .fetch_all(&mut *c)
        .await?
        .iter()
        .map(|u| u.json(&cat))
        .collect();
    ok(json!({"crates": crates, "cards": cards, "rarities": g.rarities_json, "rarityOrder": g.rarity_order,
              "types": g.types_json, "abilityKinds": g.ability_kinds, "maxExtraAbilities": g.max_extra_abilities,
              "arena": {"effects": g.arena_effects_json, "visuals": g.arena_visuals, "targets": g.arena_targets,
                        "effectTargets": g.arena_effect_targets, "maxEffects": g.max_ability_effects},
              "variants": g.variants_json, "exclusiveVariants": g.crate_variants,
              "specialVariants": g.special_variants, "specialSources": g.special_sources_json, "specialCrate": g.special_crate,
              "defaultPrice": g.crate_price, "users": users}))
}

pub async fn admin_save_crate(State(st): State<AppState>, Admin(me): Admin, body: Body) -> Res {
    let cat = st.cat();
    let g = g();
    let name = py::str_or_empty(body.get("name")).trim().to_owned();
    if name.is_empty() {
        return bad("Podaj nazwę skrzynki");
    }
    let price = match body.get("price") {
        Some(v) if py::truthy(v) => match py::int(v) {
            Some(p) => p,
            None => return bad("Nieprawidłowa cena"),
        },
        _ => g.crate_price,
    }
    .clamp(1, 1_000_000);
    let text_or = |key: &str, default: &str| -> String {
        match body.get(key) {
            Some(v) if py::truthy(v) => py::str_of(v),
            _ => default.to_owned(),
        }
    };
    let chosen: Vec<String> =
        body.get("variants").and_then(Value::as_array).map(|a| a.iter().map(py::str_of).collect()).unwrap_or_default();
    let mut fields = Map::new();
    fields.insert("name".into(), json!(py::cut(&name, 60)));
    fields.insert("short".into(), json!(py::cut(text_or("short", &name).trim(), 24)));
    fields.insert("code".into(), json!(py::cut(&text_or("code", &py::cut(&name, 2)).trim().to_uppercase(), 4)));
    fields.insert("emoji".into(), json!(py::cut(text_or("emoji", "📦").trim(), 8)));
    fields.insert("color1".into(), json!(text_or("color1", "#888888")));
    fields.insert("color2".into(), json!(text_or("color2", "#333333")));
    fields.insert("price".into(), json!(price));
    fields.insert("desc".into(), json!(py::cut(text_or("desc", "").trim(), 120)));
    fields.insert("shop".into(), json!(body.get("shop").map(py::truthy).unwrap_or(true)));
    fields.insert("restricted".into(), json!(body.get("restricted").map(py::truthy).unwrap_or(false)));
    // warianty wyjątkowe (Królewski, Flagowy...) - wypadają tylko ze skrzynek, w których są włączone
    fields.insert("variants".into(), json!(g.crate_variants.iter().filter(|v| chosen.contains(v)).collect::<Vec<_>>()));
    let mut weights = Map::new();
    for (r, w) in body.get("weights").and_then(Value::as_object).into_iter().flatten() {
        if g.rarities.contains_key(r) && !w.is_null() && w != "" {
            let Some(w) = py::float(w) else { return bad("Szanse muszą być liczbami") };
            weights.insert(r.clone(), json!(w.clamp(0.0, 1000.0)));
        }
    }
    fields.insert("weights".into(), Value::Object(weights));
    let given = body.get("id").filter(|v| py::truthy(v)).map(py::str_of);
    let cid = match &given {
        Some(id) => id.clone(),
        None => unique_id(&slug(&name), &cat.crates.keys().chain(cat.hidden_crates.keys()).collect()),
    };
    let mut tx = st.db.begin().await?;
    let details =
        format!("{}{} · cena {price} $", if given.is_none() { "nowa: " } else { "" }, fields["name"].as_str().unwrap_or(""));
    log_admin(&mut tx, &me, "crate_save", None, &details).await?;
    catalog::save_override(&mut tx, Table::Crates, &cid, &fields).await?;
    if let Some(allowed) = body.get("allowed") {
        // lista graczy z dostępem do skrzynki
        sqlx::query!("DELETE FROM crate_access WHERE crate_id = $1", cid).execute(&mut *tx).await?;
        let ids: HashSet<i64> = allowed.as_array().into_iter().flatten().filter_map(py::int).collect();
        for uid in ids {
            sqlx::query!("INSERT INTO crate_access (user_id, crate_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", uid, cid)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    st.refresh_catalog().await?;
    ok(json!({"ok": true, "id": cid}))
}

pub async fn admin_delete_crate(State(st): State<AppState>, Admin(me): Admin, Path(cid): Path<String>) -> Res {
    let cat = st.cat();
    let Some(cr) = cat.crates.get(&cid) else { return bad_code("Nie ma takiej skrzynki", 404) };
    let mut tx = st.db.begin().await?;
    log_admin(&mut tx, &me, "crate_delete", None, &format!("{}{}", cr.name, if cr.builtin { " (ukryta)" } else { "" })).await?;
    if cr.builtin {
        catalog::mark_deleted(&mut tx, Table::Crates, &cid).await?; // wbudowaną tylko ukrywamy
    } else {
        catalog::remove_row(&mut tx, Table::Crates, &cid).await?;
        sqlx::query!("DELETE FROM crate_access WHERE crate_id = $1", cid).execute(&mut *tx).await?;
        for p in cat.crate_people(cr) {
            if !p.builtin && p.crates == [cid.clone()] {
                // karty tylko z tej skrzynki
                catalog::remove_row(&mut tx, Table::Cards, &p.id).await?;
            }
        }
    }
    tx.commit().await?;
    st.refresh_catalog().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_restore_crate(State(st): State<AppState>, Admin(me): Admin, Path(cid): Path<String>) -> Res {
    let Some(b) = catalog::builtin_crate(&cid) else { return bad("To nie jest wbudowana skrzynka") };
    let mut tx = st.db.begin().await?;
    catalog::remove_row(&mut tx, Table::Crates, &cid).await?;
    log_admin(&mut tx, &me, "crate_restore", None, b.get("name").and_then(Value::as_str).unwrap_or("")).await?;
    tx.commit().await?;
    st.refresh_catalog().await?;
    ok(json!({"ok": true}))
}

/// Formularz karty z panelu admina (multipart: pola + pliki zdjęć)
#[derive(Default)]
struct Form {
    fields: Vec<(String, String)>,
    files: HashMap<String, (String, Vec<u8>)>,
}

impl Form {
    async fn read(mut mp: Multipart) -> Result<Form, AppError> {
        let mut f = Form::default();
        while let Some(field) = mp.next_field().await.map_err(|e| AppError::bad(format!("Nieprawidłowy formularz: {e}")))? {
            let name = field.name().unwrap_or("").to_owned();
            if let Some(filename) = field.file_name().map(str::to_owned) {
                let bytes = field.bytes().await.map_err(|e| AppError::bad(format!("Nieprawidłowy plik: {e}")))?;
                f.files.insert(name, (filename, bytes.to_vec()));
            } else {
                let text = field.text().await.map_err(|e| AppError::bad(format!("Nieprawidłowy formularz: {e}")))?;
                f.fields.push((name, text));
            }
        }
        Ok(f)
    }

    fn get(&self, key: &str) -> Option<&str> {
        self.fields.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    /// (f.get(key) or "")
    fn s(&self, key: &str) -> &str {
        self.get(key).unwrap_or("")
    }

    fn list(&self, key: &str) -> Vec<&str> {
        self.fields.iter().filter(|(k, _)| k == key).map(|(_, v)| v.as_str()).collect()
    }

    fn upload(&self, key: &str) -> Option<&Vec<u8>> {
        self.files.get(key).filter(|(name, _)| !name.is_empty()).map(|(_, b)| b)
    }
}

pub async fn admin_save_card(State(st): State<AppState>, Admin(me): Admin, mp: Multipart) -> Res {
    let f = Form::read(mp).await?;
    let cat = st.cat();
    let g = g();
    let name = f.s("name").trim().to_owned();
    let mut picked: Vec<&str> = f.list("crates");
    if picked.is_empty() {
        picked = f.get("crate").into_iter().collect();
    }
    let mut seen = HashSet::new();
    let mut crates: Vec<String> =
        picked.into_iter().filter(|c| seen.insert(*c) && cat.crates.contains_key(*c)).map(str::to_owned).collect();
    // karta specjalna jest tylko w skrzynce kart specjalnych (której nie da się otworzyć), a zwykła karta - nigdy
    if f.get("rarity") == Some("special") && cat.crates.contains_key(&g.special_crate) {
        crates = vec![g.special_crate.clone()];
    } else {
        crates.retain(|c| !cat.crates[c].special);
    }
    if name.is_empty() {
        return bad("Podaj nazwę karty");
    }
    let Some(crate_) = crates.first().cloned() else { return bad("Wybierz co najmniej jedną skrzynkę") };
    let (Some(rarity), Some(type_)) =
        (f.get("rarity").filter(|r| g.rarities.contains_key(*r)), f.get("type").filter(|t| g.types.contains_key(*t)))
    else {
        return bad("Nieprawidłowa rzadkość lub typ");
    };
    let num = |key: &str, default: i64| -> Option<i64> {
        let v = f.s(key);
        if v.is_empty() {
            Some(default)
        } else {
            py::int(&json!(v))
        }
    };
    let (Some(hp), Some(dmg)) = (num("hp", 50), num("dmg", 30)) else { return bad("HP i obrażenia muszą być liczbami") };
    let dmg2_raw = f.s("dmg2").trim();
    let dmg2 = if !dmg2_raw.is_empty()
        && dmg2_raw.trim_start_matches('-').chars().all(|c| c.is_ascii_digit())
        && !dmg2_raw.trim_start_matches('-').is_empty()
    {
        py::int(&json!(f.s("dmg2"))).unwrap_or(0).clamp(0, 9999)
    } else {
        0
    };
    let wiki_title = f.s("wiki_title").trim().to_owned();
    let kind = |k: &str| f.get(k).filter(|x| g.ability_kinds.get(*x).is_some()).unwrap_or("off").to_owned();
    let abilities: Vec<Value> = f
        .list("ab_name")
        .iter()
        .zip(f.list("ab_kind"))
        .zip(f.list("ab_value"))
        .map(|((n, k), v)| json!({"name": n, "kind": k, "value": v}))
        .collect();
    let attack = match f.get("attack") {
        Some(a) if !a.is_empty() => a,
        _ => "Atak",
    };
    let attack2 = py::cut(f.s("attack2").trim(), 40);
    let wiki_lang = match f.get("wiki_lang") {
        Some(l) if !l.is_empty() => l,
        _ => "pl",
    };
    let mut crates_seen: Vec<&String> =
        cat.crates.keys().chain(cat.hidden_crates.keys()).collect::<HashSet<_>>().into_iter().collect();
    crates_seen.sort();
    let arena_raw = match f.get("arena_json") {
        Some(a) if !a.is_empty() => a,
        _ => "[]",
    };
    let Ok(arena_val) = serde_json::from_str::<Value>(arena_raw) else { return bad("Nieprawidłowe ustawienia Areny") };
    let arena = catalog::clean_arena(Some(&arena_val));
    let mut fields = Map::new();
    fields.insert("name".into(), json!(py::cut(&name, 60)));
    fields.insert("crate".into(), json!(crate_));
    fields.insert("crates".into(), json!(crates));
    fields.insert("rarity".into(), json!(rarity));
    fields.insert("type".into(), json!(type_));
    fields.insert("hp".into(), json!(hp.clamp(0, 9999)));
    fields.insert("dmg".into(), json!(dmg.clamp(0, 9999)));
    fields.insert("attack".into(), json!(py::cut(attack.trim(), 40)));
    fields.insert("attack2".into(), if attack2.is_empty() { Value::Null } else { json!(attack2) });
    fields.insert("dmg2".into(), json!(dmg2));
    fields.insert(
        "wiki".into(),
        if wiki_title.is_empty() { Value::Null } else { json!([py::cut(wiki_lang.trim(), 5), wiki_title]) },
    );
    fields.insert("kind1".into(), json!(kind("kind1")));
    fields.insert("kind2".into(), json!(kind("kind2")));
    fields.insert("abilities".into(), json!(catalog::clean_abilities(Some(&json!(abilities)))));
    fields.insert("country".into(), json!(catalog::clean_country(f.get("country").map(|c| json!(c)).as_ref())));
    // podtytuł - krótki tekst na karcie; opis - dłuższy tekst obok karty w podglądzie
    fields.insert("subtitle".into(), json!(py::cut(f.s("subtitle").trim(), catalog::SUBTITLE_MAX)));
    fields.insert("desc".into(), json!(py::cut(f.s("desc").replace("\r\n", "\n").trim(), catalog::DESC_MAX)));
    // karta specjalna: skąd (kasyno / link), jedyny wariant i wygląd (catalog sprawdza)
    fields.insert("source".into(), json!(f.get("source")));
    fields.insert("fixedVariant".into(), json!(f.get("fixed_variant")));
    fields.insert("style".into(), json!(f.get("style")));
    // skrzynki istniejące w chwili zapisu - nowe wbudowane skrzynki dodane później dopiszą tę kartę
    fields.insert("crates_seen".into(), json!(crates_seen));
    fields.insert("arena".into(), json!(arena));
    // efekt unikalny może mieć tylko jedna karta
    let pid_now = f.get("id").unwrap_or("");
    for cfg in &arena {
        for e in &cfg.effects {
            let Some(info) = g.arena_effects.get(&e.id).filter(|i| i.unique) else { continue };
            let other =
                cat.people.values().find(|p| p.id != pid_now && p.arena.iter().any(|c| c.effects.iter().any(|x| x.id == e.id)));
            if let Some(other) = other {
                return bad(format!("Efekt „{}” jest unikalny - ma go już karta {}", info.name, other.name));
            }
        }
    }
    let given = f.get("id").filter(|p| !p.is_empty()).map(str::to_owned);
    let old: Option<Arc<Person>> = given.as_ref().and_then(|p| cat.person(p).cloned());
    let pid = match given {
        Some(p) => p,
        None => {
            let prefix = if crate_ == "world" { "w".to_owned() } else { crate_.clone() };
            unique_id(&format!("{prefix}_{}", slug(&name)), &cat.people.keys().chain(cat.hidden_cards.keys()).collect())
        }
    };
    let mut tx = st.db.begin().await?;
    catalog::save_override(&mut tx, Table::Cards, &pid, &fields).await?;
    let details = format!(
        "{}{} · {}",
        if old.is_none() { "nowa: " } else { "" },
        fields["name"].as_str().unwrap_or(""),
        g.rarities[rarity].name
    );
    log_admin(&mut tx, &me, "card_save", None, &details).await?;
    tx.commit().await?;
    st.refresh_catalog().await?;
    let cat = st.cat();

    // zdjęcia: plik > URL > Wikipedia (gdy zmienił się artykuł albo brak zdjęcia)
    let mut warnings: Vec<String> = vec![];
    let new_wiki = (!wiki_title.is_empty()).then(|| (py::cut(wiki_lang.trim(), 5), wiki_title.clone()));
    for alt in [false, true] {
        let (suffix, kind) = if alt { ("_alt", Kind::Alt) } else { ("", Kind::Main) };
        let url = f.s(&format!("image_url{suffix}")).trim().to_owned();
        let res: Result<(), String> = if let Some(blob) = f.upload(&format!("image{suffix}")) {
            st.images.save(&pid, blob, &kind)
        } else if !url.is_empty() {
            st.images.save_url(&pid, &url, &kind).await
        } else if f.get(&format!("remove{suffix}")) == Some("1") {
            st.images.delete(&pid, &kind);
            Ok(())
        } else if !alt
            && new_wiki.is_some()
            && (st.images.find(&pid, &Kind::Main).is_none() || old.as_ref().is_some_and(|o| o.wiki != new_wiki))
        {
            let res = st.images.fetch(&[(pid.clone(), new_wiki.clone())], true).await;
            if !res.get(&pid).copied().unwrap_or(false) {
                warnings.push("Nie znaleziono zdjęcia w artykule Wikipedii".into());
            }
            Ok(())
        } else {
            Ok(())
        };
        if let Err(e) = res {
            warnings.push(format!("Zdjęcie{}: {e}", if alt { " alt" } else { "" }));
        }
    }
    for v in cat.photo_variants(&pid) {
        // własne zdjęcie wariantu tej karty (Rzulty, Halloweenowa...)
        let kind = Kind::Variant(v.clone());
        let url = f.s(&format!("image_url_v_{v}")).trim().to_owned();
        let res = if let Some(blob) = f.upload(&format!("image_v_{v}")) {
            st.images.save(&pid, blob, &kind)
        } else if !url.is_empty() {
            st.images.save_url(&pid, &url, &kind).await
        } else {
            if f.get(&format!("remove_v_{v}")) == Some("1") {
                st.images.delete(&pid, &kind);
            }
            Ok(())
        };
        if let Err(e) = res {
            warnings.push(format!("Zdjęcie wariantu {}: {e}", g.variants[&v].name));
        }
    }
    ok(json!({"ok": true, "id": pid, "warnings": warnings}))
}

pub async fn admin_delete_card(State(st): State<AppState>, Admin(me): Admin, Path(pid): Path<String>) -> Res {
    let cat = st.cat();
    let Some(p) = cat.person(&pid) else { return bad_code("Nie ma takiej karty", 404) };
    let mut tx = st.db.begin().await?;
    log_admin(&mut tx, &me, "card_delete", None, &format!("{}{}", p.name, if p.builtin { " (ukryta)" } else { "" })).await?;
    if p.builtin {
        catalog::mark_deleted(&mut tx, Table::Cards, &pid).await?;
    } else {
        catalog::remove_row(&mut tx, Table::Cards, &pid).await?;
        st.images.delete(&pid, &Kind::Main);
        st.images.delete(&pid, &Kind::Alt);
    }
    tx.commit().await?;
    st.refresh_catalog().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_restore_card(State(st): State<AppState>, Admin(me): Admin, Path(pid): Path<String>) -> Res {
    let Some(b) = catalog::builtin_card(&pid) else { return bad("To nie jest wbudowana karta") };
    let mut tx = st.db.begin().await?;
    catalog::remove_row(&mut tx, Table::Cards, &pid).await?;
    log_admin(&mut tx, &me, "card_restore", None, b.get("name").and_then(Value::as_str).unwrap_or("")).await?;
    tx.commit().await?;
    st.refresh_catalog().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_refetch(State(st): State<AppState>, Admin(_): Admin, Path(pid): Path<String>) -> Res {
    let cat = st.cat();
    let Some(p) = cat.person(&pid) else { return bad_code("Nie ma takiej karty", 404) };
    let res = st.images.fetch(&[(pid.clone(), p.wiki.clone())], true).await;
    ok(json!({"ok": true, "main": res.get(&pid).copied().unwrap_or(false)}))
}

// ---------------------------------------------------------------- linki do kart specjalnych
// Admin tworzy link do karty specjalnej (źródło "link"): każdy gracz, który go otworzy, dostaje tę kartę - raz na link.
// max_uses = 0 - bez limitu graczy. Wyłączony link przestaje działać.

pub fn link_card<'a>(cat: &'a Catalog, pid: &str) -> Option<&'a Arc<Person>> {
    cat.person(pid).filter(|p| p.is_special() && p.source.as_deref() == Some("link"))
}

pub async fn admin_links(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let users: HashMap<i64, String> = sqlx::query!("SELECT id, username FROM users")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|r| (r.id, r.username))
        .collect();
    let rows = sqlx::query!("SELECT * FROM card_links ORDER BY id DESC").fetch_all(&mut *c).await?;
    let mut claims: HashMap<i64, Vec<String>> = HashMap::new();
    for r in sqlx::query!("SELECT link_id, user_id FROM card_link_claims ORDER BY claimed_at DESC").fetch_all(&mut *c).await? {
        claims.entry(r.link_id).or_default().push(users.get(&r.user_id).cloned().unwrap_or_else(|| "?".into()));
    }
    let links: Vec<Value> = rows
        .iter()
        .map(|r| {
            let p = cat.person(&r.person_id);
            json!({"id": r.id, "token": r.token, "path": format!("/link/{}", r.token), "person": r.person_id,
                   "name": p.map(|p| p.name.clone()).unwrap_or_else(|| r.person_id.clone()),
                   "variant": p.and_then(|p| p.fixed_variant.clone()),
                   "note": r.note, "created": r.created_at, "createdBy": r.created_by.and_then(|u| users.get(&u)),
                   "active": r.active != 0, "maxUses": r.max_uses, "uses": r.uses,
                   "claimedBy": claims.get(&r.id).cloned().unwrap_or_default()})
        })
        .collect();
    let cards: Vec<Value> = cat
        .people
        .values()
        .filter(|p| link_card(&cat, &p.id).is_some())
        .map(|p| json!({"id": p.id, "name": p.name, "variant": p.fixed_variant}))
        .collect();
    ok(json!({"links": links, "cards": cards}))
}

pub async fn admin_link_create(State(st): State<AppState>, Admin(me): Admin, body: Body) -> Res {
    let cat = st.cat();
    let Some(p) = body.get("person").and_then(Value::as_str).and_then(|p| link_card(&cat, p)) else {
        return bad("Wybierz kartę specjalną ze źródłem „Link od admina”");
    };
    let max_uses = match body.get("maxUses") {
        Some(v) if py::truthy(v) => match py::int(v) {
            Some(n) => n,
            None => return bad("Limit graczy musi być liczbą"),
        },
        _ => 0,
    }
    .clamp(0, 100_000);
    let note = py::cut(py::str_or_empty(body.get("note")).trim(), 80);
    let token = crate::arena::engine::token();
    let mut tx = st.db.begin().await?;
    sqlx::query!(
        "INSERT INTO card_links (token, person_id, note, created_by, created_at, max_uses) VALUES ($1, $2, $3, $4, $5, $6)",
        token,
        p.id,
        note,
        me.id,
        now(),
        max_uses as i32
    )
    .execute(&mut *tx)
    .await?;
    let details = format!(
        "{}{}{}",
        p.name,
        if note.is_empty() { String::new() } else { format!(" · {note}") },
        if max_uses > 0 { format!(" · max {max_uses}") } else { String::new() }
    );
    log_admin(&mut tx, &me, "link_create", None, &details).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "path": format!("/link/{token}")}))
}

pub async fn admin_link_toggle(State(st): State<AppState>, Admin(me): Admin, Path(link_id): Path<i64>, body: Body) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    let Some(r) = sqlx::query!("SELECT person_id, note FROM card_links WHERE id = $1", link_id).fetch_optional(&mut *tx).await?
    else {
        return bad_code("Nie ma takiego linku", 404);
    };
    let active = body.get("active").is_some_and(py::truthy);
    sqlx::query!("UPDATE card_links SET active = $1 WHERE id = $2", active as i32, link_id).execute(&mut *tx).await?;
    let name = cat.person(&r.person_id).map(|p| p.name.clone()).unwrap_or_else(|| r.person_id.clone());
    let details = format!("{name}{}", if r.note.is_empty() { String::new() } else { format!(" · {}", r.note) });
    log_admin(&mut tx, &me, if active { "link_on" } else { "link_off" }, None, &details).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- gracze

pub async fn admin_users(State(st): State<AppState>, Admin(me): Admin) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let stats = collection_stats(&mut c, &cat).await?;
    let bal: HashMap<i64, i64> = sqlx::query!("SELECT user_id, value FROM user_state WHERE key = 'balance'")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|r| (r.user_id, r.value))
        .collect();
    let mut access: HashMap<i64, Vec<String>> = HashMap::new();
    for r in sqlx::query!("SELECT user_id, crate_id FROM crate_access").fetch_all(&mut *c).await? {
        access.entry(r.user_id).or_default().push(r.crate_id);
    }
    let all = sqlx::query_as!(User, "SELECT * FROM users ORDER BY id").fetch_all(&mut *c).await?;
    let mut users = vec![];
    for u in &all {
        let mut b = brief(&cat, u, &stats);
        b["balance"] = json!(bal.get(&u.id).copied().unwrap_or(0));
        b["created"] = json!(u.created_at);
        b["chests"] = json!(get_chests(&mut c, &cat, u.id).await?);
        b["banned"] = json!(u.banned != 0);
        b["banReason"] = json!(u.ban_reason);
        b["access"] = json!(access.get(&u.id).cloned().unwrap_or_default());
        b["rankingHidden"] = json!(u.ranking_hidden != 0);
        b["moneyGenerated"] = json!(u.money_generated != 0);
        users.push(b);
    }
    let restricted: Vec<Value> = cat
        .crates
        .values()
        .filter(|c| c.restricted)
        .map(|c| json!({"id": c.id, "name": c.name, "emoji": c.emoji, "shop": c.shop}))
        .collect();
    let mut kinds: Vec<Value> =
        cat.crates.values().filter(|c| !c.special).map(|c| json!({"kind": c.id, "name": c.name, "emoji": c.emoji})).collect();
    kinds.extend(g().money_chests.iter().map(|(k, m)| json!({"kind": format!("money_{k}"), "name": m.name, "emoji": m.emoji})));
    ok(json!({"users": users, "me": me.id, "chestKinds": kinds, "restrictedCrates": restricted}))
}

pub async fn admin_ban(State(st): State<AppState>, Admin(me): Admin, Path(uid): Path<i64>, body: Body) -> Res {
    if uid == me.id {
        return bad("Nie możesz zablokować samego siebie");
    }
    let ban = body.get("ban").map(py::truthy).unwrap_or(true);
    let reason = if ban { py::cut(py::str_or_empty(body.get("reason")).trim(), 200) } else { String::new() };
    let mut tx = st.db.begin().await?;
    sqlx::query!("UPDATE users SET banned = $1, ban_reason = $2 WHERE id = $3", ban as i32, reason, uid)
        .execute(&mut *tx)
        .await?;
    log_admin(&mut tx, &me, if ban { "ban" } else { "unban" }, Some(uid), &reason).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_ranking_hidden(State(st): State<AppState>, Admin(me): Admin, Path(uid): Path<i64>, body: Body) -> Res {
    let hidden = body.get("hidden").map(py::truthy).unwrap_or(true);
    let mut tx = st.db.begin().await?;
    sqlx::query!("UPDATE users SET ranking_hidden = $1 WHERE id = $2", hidden as i32, uid).execute(&mut *tx).await?;
    log_admin(&mut tx, &me, if hidden { "ranking_hide" } else { "ranking_show" }, Some(uid), "").await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_user_cards(State(st): State<AppState>, Admin(_): Admin, Path(uid): Path<i64>) -> Res {
    let cat = st.cat();
    let g = g();
    let rows = sqlx::query!(
        r#"SELECT person_id, variant, COUNT(*) AS "n!" FROM items WHERE user_id = $1 GROUP BY person_id, variant"#,
        uid
    )
    .fetch_all(&st.db)
    .await?;
    let mut cards: Vec<(usize, String, String, Value)> = rows
        .into_iter()
        .filter_map(|r| {
            let p = cat.person(&r.person_id)?;
            Some((
                g.rarity_idx(&p.rarity),
                p.name.clone(),
                r.variant.clone(),
                json!({"person": p.id, "name": p.name, "rarity": p.rarity, "variant": r.variant, "count": r.n,
                       "value": p.value(&r.variant)}),
            ))
        })
        .collect();
    cards.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2)));
    let variants: Map<String, Value> = g.variants.iter().map(|(k, v)| (k.clone(), json!(v.name))).collect();
    ok(json!({"cards": cards.into_iter().map(|c| c.3).collect::<Vec<_>>(), "variants": variants}))
}

pub async fn admin_delete_user_cards(State(st): State<AppState>, Admin(me): Admin, Path(uid): Path<i64>, body: Body) -> Res {
    let cat = st.cat();
    let all = body.get("all").is_some_and(py::truthy);
    let person = body.get("person").and_then(Value::as_str).unwrap_or("").to_owned();
    let variant = body.get("variant").and_then(Value::as_str).unwrap_or("").to_owned();
    let mut tx = st.db.begin().await?;
    let ids: Vec<i64> = if all {
        sqlx::query_scalar!("SELECT id FROM items WHERE user_id = $1", uid).fetch_all(&mut *tx).await?
    } else {
        let n = match body.get("count") {
            Some(v) if py::truthy(v) => py::int(v).unwrap_or(1),
            _ => 1,
        }
        .max(1);
        sqlx::query_scalar!(
            "SELECT id FROM items WHERE user_id = $1 AND person_id = $2 AND variant = $3 ORDER BY id DESC LIMIT $4",
            uid,
            person,
            variant,
            n
        )
        .fetch_all(&mut *tx)
        .await?
    };
    if !ids.is_empty() {
        sqlx::query!("DELETE FROM items WHERE id = ANY($1)", &ids).execute(&mut *tx).await?;
        sqlx::query!("DELETE FROM showcase WHERE item_id = ANY($1)", &ids).execute(&mut *tx).await?;
        let what = if all {
            "wszystkie karty".to_owned()
        } else {
            let pname = cat.person(&person).map(|p| p.name.clone()).unwrap_or_else(|| person.clone());
            let vname = g().variants.get(&variant).map(|v| v.name.clone()).unwrap_or_else(|| "?".into());
            format!("{pname} · {vname}")
        };
        log_admin(&mut tx, &me, "cards_delete", Some(uid), &format!("{} szt. ({what})", ids.len())).await?;
    }
    tx.commit().await?;
    ok(json!({"ok": true, "deleted": ids.len()}))
}

pub async fn admin_set_access(State(st): State<AppState>, Admin(me): Admin, Path(uid): Path<i64>, body: Body) -> Res {
    let cat = st.cat();
    let crates: Vec<String> = body
        .get("crates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|c| c.as_str().filter(|c| cat.crates.contains_key(*c)).map(str::to_owned))
        .collect();
    let mut tx = st.db.begin().await?;
    sqlx::query!("DELETE FROM crate_access WHERE user_id = $1", uid).execute(&mut *tx).await?;
    for cid in &crates {
        sqlx::query!("INSERT INTO crate_access (user_id, crate_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", uid, cid)
            .execute(&mut *tx)
            .await?;
    }
    let names: Vec<&str> = crates.iter().map(|c| cat.crates[c].name.as_str()).collect();
    let details = if names.is_empty() { "brak".to_owned() } else { names.join(", ") };
    log_admin(&mut tx, &me, "access", Some(uid), &details).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_give_chests(State(st): State<AppState>, Admin(me): Admin, Path(uid): Path<i64>, body: Body) -> Res {
    let cat = st.cat();
    let kind = py::str_or_empty(body.get("kind"));
    let count = body.get("count").and_then(py::int).unwrap_or(0);
    if !valid_chest_kind(&cat, &kind) || !(-1000..=1000).contains(&count) || count == 0 {
        return bad("Nieprawidłowa skrzynka lub ilość");
    }
    let mut tx = st.db.begin().await?;
    if crate::auth::user_by_id(&mut tx, uid).await?.is_none() {
        return bad_code("Nie ma takiego gracza", 404);
    }
    add_chests(&mut tx, uid, &kind, count).await?;
    if count > 0 {
        mark_money_generated(&mut tx, uid).await?; // skrzynki od admina to darmowe pieniądze / karty
    }
    log_admin(&mut tx, &me, "chests", Some(uid), &format!("{} {count:+}", chest_name(&cat, &kind))).await?;
    let chests = get_chests(&mut tx, &cat, uid).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "chests": chests}))
}

pub async fn admin_money(State(st): State<AppState>, Admin(me): Admin, Path(uid): Path<i64>, body: Body) -> Res {
    let amount = body.get("amount").and_then(py::int).unwrap_or(0);
    let max = g().max_deposit;
    if !(-max..=max).contains(&amount) || amount == 0 {
        return bad("Nieprawidłowa kwota");
    }
    let mut tx = st.db.begin().await?;
    ensure_state(&mut tx, uid).await?;
    add_state(&mut tx, uid, "balance", amount).await?;
    if amount > 0 {
        add_state(&mut tx, uid, "deposited", amount).await?;
        mark_money_generated(&mut tx, uid).await?;
    }
    log_admin(&mut tx, &me, "money", Some(uid), &money_txt(amount)).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_toggle(State(st): State<AppState>, Admin(me): Admin, Path(uid): Path<i64>) -> Res {
    if uid == me.id {
        return bad("Nie możesz odebrać uprawnień samemu sobie");
    }
    let mut tx = st.db.begin().await?;
    sqlx::query!("UPDATE users SET is_admin = 1 - is_admin WHERE id = $1", uid).execute(&mut *tx).await?;
    let now_admin = sqlx::query_scalar!("SELECT is_admin FROM users WHERE id = $1", uid).fetch_optional(&mut *tx).await?;
    log_admin(&mut tx, &me, if now_admin.is_some_and(|a| a != 0) { "admin_grant" } else { "admin_revoke" }, Some(uid), "")
        .await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_password(State(st): State<AppState>, Admin(me): Admin, Path(uid): Path<i64>, body: Body) -> Res {
    let pw = py::str_or_empty(body.get("password"));
    if pw.chars().count() < MIN_PASSWORD {
        return bad(password_error());
    }
    let hash = hash_password_async(pw).await;
    let mut tx = st.db.begin().await?;
    sqlx::query!("UPDATE users SET password_hash = $1 WHERE id = $2", hash, uid).execute(&mut *tx).await?;
    log_admin(&mut tx, &me, "password", Some(uid), "").await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_delete_user(State(st): State<AppState>, Admin(me): Admin, Path(uid): Path<i64>) -> Res {
    if uid == me.id {
        return bad("Nie możesz usunąć samego siebie");
    }
    let mut tx = st.db.begin().await?;
    log_admin(&mut tx, &me, "user_delete", Some(uid), "").await?; // przed usunięciem - żeby zapisać nazwę gracza
    super::market::market_forget_user(&mut tx, uid).await?; // jego oferty na rynku i lobby jackpota
    super::casino::blackjack_forget_user(&mut tx, uid).await?; // rozdanie w trakcie i postawione w nim karty
    sqlx::query!("DELETE FROM items WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM user_state WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM user_discovered WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM daily_claims WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM user_collected WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM showcase WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM feed WHERE author_id = $1 OR to_user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM user_chests WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM crate_access WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM arena_daily WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM card_link_claims WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM admin_message_seen WHERE user_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM trade_lines WHERE trade_id IN (SELECT id FROM trades WHERE from_id = $1 OR to_id = $1)", uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query!("DELETE FROM trades WHERE from_id = $1 OR to_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM friendships WHERE requester_id = $1 OR addressee_id = $1", uid).execute(&mut *tx).await?;
    sqlx::query!("DELETE FROM users WHERE id = $1", uid).execute(&mut *tx).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use super::slug;

    #[test]
    fn slugs() {
        assert_eq!(slug("Skrzynia Królów"), "skrzynia_krolow");
        assert_eq!(slug("Łódź!"), "lodz");
        assert_eq!(slug("???"), "x");
    }
}
