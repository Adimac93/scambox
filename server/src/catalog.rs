//! Katalog kart i skrzynek (port catalog.py).
//!
//! Domyślne dane pochodzą z data/game.json. Zmiany z panelu admina są zapisane w bazie
//! (tabele catalog_crates / catalog_cards) i nakładane na dane domyślne:
//!   - wiersz z deleted=1 ukrywa skrzynkę/kartę,
//!   - wiersz z danymi nadpisuje pola wbudowanej skrzynki/karty albo dodaje nową.
//!
//! Karta może należeć do kilku skrzynek: pole "crates" (lista), "crate" to skrzynka główna
//! (jej kod i numer są nadrukowane na karcie). Katalog jest w pamięci procesu (ArcSwap) - po zmianie
//! w panelu admina budowany od nowa (`rebuild`), dlatego serwer działa jako jeden proces.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock};

use indexmap::IndexMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::data::{card_value, g, CRATE_FIELDS};
use crate::db::Conn;
use crate::py;

pub const SUBTITLE_MAX: usize = 40; // podtytuł (krótki tekst na karcie)
pub const DESC_MAX: usize = 1000; // opis (obok karty w podglądzie)
static COUNTRY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z]{2}(-[a-z0-9]{1,3})?$").unwrap());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Ability {
    pub name: String,
    pub kind: String,
    pub value: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArenaEffectCfg {
    pub id: String,
    pub value: i64,
    pub turns: i64,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArenaCfg {
    pub visual: String,
    pub cost: Option<i64>,
    pub target: Option<String>,
    pub effects: Vec<ArenaEffectCfg>,
}

#[derive(Debug, Clone)]
pub struct Person {
    pub id: String,
    pub name: String,
    pub wiki: Option<(String, String)>,
    pub rarity: String,
    pub type_: String,
    pub hp: i64,
    pub attack: Value,
    pub dmg: i64,
    pub attack2: Option<String>,
    pub dmg2: i64,
    pub kind1: String,
    pub kind2: String,
    pub abilities: Vec<Ability>,
    pub arena: Vec<ArenaCfg>,
    pub crate_: Option<String>,
    pub crates: Vec<String>,
    pub number: i64,
    pub value_mult: f64,
    pub country: String,
    pub forge: bool,
    pub source: Option<String>,
    pub fixed_variant: Option<String>,
    pub style: Option<i64>,
    pub subtitle: String,
    pub desc: String,
    pub builtin: bool,
    pub modified: bool,
}

impl Person {
    pub fn value(&self, variant: &str) -> i64 {
        card_value(&self.rarity, self.value_mult, variant)
    }

    /// Karta specjalna (rzadkość Specjalna): tylko z kasyna albo z linku, zawsze w jednym wariancie, nie znika z gry
    pub fn is_special(&self) -> bool {
        self.rarity == "special"
    }

    pub fn is_secret(&self) -> bool {
        self.rarity == "secret"
    }

    pub fn fixed(&self) -> String {
        self.fixed_variant.clone().unwrap_or_else(|| "normal".into())
    }

    /// Wszystkie pola karty (jak słownik karty w Pythonie) - do wyboru kluczy w odpowiedziach
    pub fn to_map(&self) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("name".into(), json!(self.name));
        m.insert("wiki".into(), self.wiki.as_ref().map(|(l, t)| json!([l, t])).unwrap_or(Value::Null));
        m.insert("rarity".into(), json!(self.rarity));
        m.insert("type".into(), json!(self.type_));
        m.insert("hp".into(), json!(self.hp));
        m.insert("attack".into(), self.attack.clone());
        m.insert("dmg".into(), json!(self.dmg));
        m.insert("attack2".into(), json!(self.attack2));
        m.insert("dmg2".into(), json!(self.dmg2));
        m.insert("kind1".into(), json!(self.kind1));
        m.insert("kind2".into(), json!(self.kind2));
        m.insert("abilities".into(), json!(self.abilities));
        m.insert("arena".into(), json!(self.arena));
        m.insert("crate".into(), json!(self.crate_));
        m.insert("crates".into(), json!(self.crates));
        m.insert("number".into(), json!(self.number));
        m.insert("valueMult".into(), json!(self.value_mult));
        m.insert("country".into(), json!(self.country));
        m.insert("forge".into(), json!(self.forge));
        m.insert("source".into(), json!(self.source));
        m.insert("fixedVariant".into(), json!(self.fixed_variant));
        m.insert("style".into(), json!(self.style));
        m.insert("subtitle".into(), json!(self.subtitle));
        m.insert("desc".into(), json!(self.desc));
        m.insert("builtin".into(), json!(self.builtin));
        m.insert("modified".into(), json!(self.modified));
        m
    }
}

#[derive(Debug, Clone)]
pub struct Crate {
    pub id: String,
    pub name: String,
    pub short: Value,
    pub code: Value,
    pub emoji: String,
    pub color1: Value,
    pub color2: Value,
    pub price: i64,
    pub desc: Value,
    pub shop: bool,
    pub restricted: bool,
    pub special: bool,
    pub variants: Vec<String>,
    pub weights: IndexMap<String, f64>,
    pub auto_secret: bool,
    pub builtin: bool,
    pub modified: bool,
    /// karty w kolejności numerów (id)
    pub people: Vec<String>,
}

impl Crate {
    /// Szansa (waga) rzadkości w danej skrzynce - własna albo domyślna
    pub fn weight(&self, rarity: &str) -> f64 {
        self.weights.get(rarity).copied().unwrap_or_else(|| g().rarities.get(rarity).map(|r| r.weight).unwrap_or(0.0))
    }
}

#[derive(Default)]
pub struct Catalog {
    pub crates: IndexMap<String, Crate>,
    pub people: IndexMap<String, Arc<Person>>,
    /// wbudowane, ukryte przez admina (surowe dane, jak w Pythonie)
    pub hidden_crates: IndexMap<String, Map<String, Value>>,
    pub hidden_cards: IndexMap<String, Map<String, Value>>,
}

// ---------------------------------------------------------------- czyszczenie pól z panelu admina

fn clamp_int(v: Option<&Value>, lo: i64, hi: i64) -> Option<i64> {
    v.and_then(py::int).map(|x| x.clamp(lo, hi))
}

/// Dodatkowe zdolności karty: [{"name", "kind": off/def/heal/eco, "value"}], najwyżej MAX_EXTRA_ABILITIES
pub fn clean_abilities(raw: Option<&Value>) -> Vec<Ability> {
    let mut out = vec![];
    for a in raw.and_then(Value::as_array).into_iter().flatten() {
        let Some(a) = a.as_object() else { continue };
        let name = py::cut(py::str_or_empty(a.get("name")).trim(), 40);
        if name.is_empty() {
            continue;
        }
        let value = match a.get("value") {
            Some(v) if py::truthy(v) => py::int(v).map(|x| x.clamp(0, 9999)).unwrap_or(0),
            _ => 0,
        };
        let kind = a.get("kind").and_then(Value::as_str).filter(|k| g().ability_kinds.get(*k).is_some());
        out.push(Ability { name, kind: kind.unwrap_or("off").into(), value });
    }
    out.truncate(g().max_extra_abilities);
    out
}

/// Kod kraju karty (do wariantu flagowego): "PL" -> "pl"; nieprawidłowy -> ""
pub fn clean_country(raw: Option<&Value>) -> String {
    let code = py::str_or_empty(raw).trim().to_lowercase().replace('_', "-");
    if COUNTRY_RE.is_match(&code) {
        code
    } else {
        String::new()
    }
}

/// Ustawienia zdolności w Arenie - po jednym na zdolność (1., 2., dodatkowe), w tej samej kolejności
pub fn clean_arena(raw: Option<&Value>) -> Vec<ArenaCfg> {
    let g = g();
    let mut out = vec![];
    let list = raw.and_then(Value::as_array).cloned().unwrap_or_default();
    for cfg in list.iter().take(2 + g.max_extra_abilities) {
        let empty = Map::new();
        let cfg = cfg.as_object().unwrap_or(&empty);
        let mut effects = vec![];
        let raw_effects = cfg.get("effects").and_then(Value::as_array).cloned().unwrap_or_default();
        for e in raw_effects.iter().take(g.max_ability_effects) {
            let Some(e) = e.as_object() else { continue };
            let Some(id) = e.get("id").and_then(Value::as_str).filter(|id| g.arena_effects.contains_key(*id)) else {
                continue;
            };
            let target = e.get("target").and_then(Value::as_str).filter(|t| g.arena_effect_targets.get(*t).is_some());
            effects.push(ArenaEffectCfg {
                id: id.into(),
                value: clamp_int(e.get("value"), 0, 9999).unwrap_or(0),
                turns: clamp_int(e.get("turns"), 1, 9).unwrap_or(1),
                target: target.unwrap_or("target").into(),
            });
        }
        let cost = match cfg.get("cost") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) if s.is_empty() || s == "auto" => None,
            Some(v) => clamp_int(Some(v), 0, 10),
        };
        out.push(ArenaCfg {
            visual: cfg
                .get("visual")
                .and_then(Value::as_str)
                .filter(|v| g.arena_visuals.get(*v).is_some())
                .unwrap_or("hit")
                .into(),
            cost,
            target: cfg.get("target").and_then(Value::as_str).filter(|t| g.arena_targets.get(*t).is_some()).map(str::to_owned),
            effects,
        });
    }
    out
}

// ---------------------------------------------------------------- dane wbudowane

/// Pola wbudowanej skrzynki (CRATE_FIELDS) albo None
pub fn builtin_crate(cid: &str) -> Option<Map<String, Value>> {
    let c = g().crates.get(cid)?;
    Some(c.fields.iter().filter(|(k, _)| CRATE_FIELDS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect())
}

/// Wbudowana karta (z "crate" i "crates") albo None
pub fn builtin_card(pid: &str) -> Option<Map<String, Value>> {
    for (cid, c) in &g().crates {
        for p in &c.people {
            if p.get("id").and_then(Value::as_str) == Some(pid) {
                let mut crates = vec![cid.clone()];
                crates.extend(
                    g().crates.iter().filter(|(x, cc)| *x != cid && cc.shared.iter().any(|s| s == pid)).map(|(x, _)| x.clone()),
                );
                let mut m = p.clone();
                m.insert("crate".into(), json!(cid));
                m.insert("crates".into(), json!(crates));
                return Some(m);
            }
        }
    }
    None
}

fn s(m: &Map<String, Value>, k: &str) -> Option<String> {
    m.get(k).and_then(Value::as_str).map(str::to_owned)
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()).unwrap_or_default()
}

fn dedup(v: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    v.into_iter().filter(|x| seen.insert(x.clone())).collect()
}

/// Odczyt zmian admina i złożenie katalogu (catalog.rebuild z Pythona)
pub async fn load(c: &mut Conn) -> anyhow::Result<Catalog> {
    // bez ORDER BY - kolejność skrzynek w sklepie jak w wersji Python (kolejność w tabeli)
    let crate_rows = sqlx::query!("SELECT id, data, deleted FROM catalog_crates").fetch_all(&mut *c).await?;
    let card_rows = sqlx::query!("SELECT id, data, deleted FROM catalog_cards").fetch_all(&mut *c).await?;
    let parse = |data: &str| -> Map<String, Value> {
        serde_json::from_str::<Value>(if data.is_empty() { "{}" } else { data })
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default()
    };
    let crates: Vec<_> = crate_rows.into_iter().map(|r| (r.id, parse(&r.data), r.deleted != 0)).collect();
    let cards: Vec<_> = card_rows.into_iter().map(|r| (r.id, parse(&r.data), r.deleted != 0)).collect();
    Ok(build(&crates, &cards))
}

pub fn build(crate_rows: &[(String, Map<String, Value>, bool)], card_rows: &[(String, Map<String, Value>, bool)]) -> Catalog {
    let g = g();
    let mut crates: IndexMap<String, Map<String, Value>> = IndexMap::new();
    let mut people: IndexMap<String, Map<String, Value>> = IndexMap::new();
    let mut hidden_crates = IndexMap::new();
    let mut hidden_cards = IndexMap::new();

    for (cid, c) in &g.crates {
        let mut m = Map::new();
        m.insert("shop".into(), json!(true));
        m.insert("restricted".into(), json!(false));
        m.insert("weights".into(), json!({}));
        m.extend(builtin_crate(cid).unwrap_or_default());
        m.insert("id".into(), json!(cid));
        m.insert("builtin".into(), json!(true));
        m.insert("modified".into(), json!(false));
        crates.insert(cid.clone(), m);
        for p in &c.people {
            let mut pm = p.clone();
            pm.insert("crate".into(), json!(cid));
            pm.insert("crates".into(), json!([cid]));
            pm.insert("builtin".into(), json!(true));
            pm.insert("modified".into(), json!(false));
            people.insert(s(p, "id").unwrap_or_default(), pm);
        }
    }
    for (cid, c) in &g.crates {
        for pid in &c.shared {
            if let Some(p) = people.get_mut(pid) {
                let mut list = strings(p.get("crates"));
                if !list.contains(cid) {
                    list.push(cid.clone());
                    p.insert("crates".into(), json!(list));
                }
            }
        }
    }

    for (cid, d, deleted) in crate_rows {
        if *deleted {
            if let Some(c) = crates.shift_remove(cid) {
                hidden_crates.insert(cid.clone(), c);
            }
            continue;
        }
        if let Some(cur) = crates.get_mut(cid) {
            // szanse: zmiany admina + domyślne
            let mut merged = cur.get("weights").and_then(Value::as_object).cloned().unwrap_or_default();
            if let Some(w) = d.get("weights").and_then(Value::as_object) {
                merged.extend(w.clone());
            }
            cur.extend(d.clone());
            cur.insert("weights".into(), Value::Object(merged));
            cur.insert("modified".into(), json!(true));
        } else {
            let mut m = Map::new();
            m.insert("name".into(), json!(cid));
            m.insert("short".into(), json!(cid));
            m.insert("code".into(), json!(py::cut(cid, 2).to_uppercase()));
            m.insert("emoji".into(), json!("📦"));
            m.insert("color1".into(), json!("#888888"));
            m.insert("color2".into(), json!("#333333"));
            m.insert("price".into(), json!(g.crate_price));
            m.insert("desc".into(), json!(""));
            m.insert("shop".into(), json!(true));
            m.insert("restricted".into(), json!(false));
            m.insert("weights".into(), json!({}));
            m.extend(d.clone());
            m.insert("id".into(), json!(cid));
            m.insert("builtin".into(), json!(false));
            m.insert("modified".into(), json!(false));
            crates.insert(cid.clone(), m);
        }
    }

    let all_builtin: HashSet<&String> = g.crates.keys().collect();
    for (pid, d, deleted) in card_rows {
        if *deleted {
            if let Some(p) = people.shift_remove(pid) {
                hidden_cards.insert(pid.clone(), p);
            }
            continue;
        }
        if let Some(cur) = people.get_mut(pid) {
            let old_crates = strings(cur.get("crates"));
            cur.extend(d.clone());
            cur.insert("modified".into(), json!(true));
            if !d.contains_key("crates") && d.contains_key("crate") {
                // starszy zapis z jedną skrzynką - zachowaj pozostałe
                let main = s(d, "crate").unwrap_or_default();
                let mut list = vec![main.clone()];
                list.extend(old_crates.into_iter().filter(|c| *c != main));
                cur.insert("crates".into(), json!(list));
            } else if d.contains_key("crates") {
                // skrzynki dodane w kodzie PO zapisaniu karty w panelu dopisujemy; skrzynki, które już istniały
                // i admin je odznaczył ("crates_seen"), zostają odznaczone
                let seen: HashSet<String> = match d.get("crates_seen") {
                    Some(v) if py::truthy(v) => strings(Some(v)).into_iter().collect(),
                    _ => all_builtin.iter().filter(|c| !g.crates_added_later.contains(**c)).map(|c| (*c).clone()).collect(),
                };
                let chosen = strings(d.get("crates"));
                let mut list = chosen.clone();
                list.extend(old_crates.into_iter().filter(|c| !seen.contains(c) && !chosen.contains(c)));
                cur.insert("crates".into(), json!(list));
            }
        } else {
            let mut m = d.clone();
            m.insert("id".into(), json!(pid));
            m.insert("builtin".into(), json!(false));
            m.insert("modified".into(), json!(false));
            if !m.contains_key("crates") {
                m.insert("crates".into(), json!([d.get("crate").cloned().unwrap_or(Value::Null)]));
            }
            people.insert(pid.clone(), m);
        }
    }

    // ---- karty: pola znormalizowane jak w catalog.rebuild
    let mut persons: IndexMap<String, Person> = IndexMap::new();
    for (pid, p) in &people {
        let wiki = p.get("wiki").and_then(Value::as_array).and_then(|w| {
            let l = w.first()?.as_str()?.to_owned();
            let t = w.get(1)?.as_str()?.to_owned();
            Some((l, t))
        });
        let num = |k: &str| match p.get(k) {
            Some(v) if py::truthy(v) => py::int(v).unwrap_or(0),
            _ => 0,
        };
        let attack2 = Some(py::str_or_empty(p.get("attack2")).trim().to_owned()).filter(|a| !a.is_empty());
        let kind = |k: &str| p.get(k).and_then(Value::as_str).filter(|x| g.ability_kinds.get(*x).is_some()).map(str::to_owned);
        let rarity = s(p, "rarity").filter(|r| g.rarities.contains_key(r)).unwrap_or_else(|| "green".into());
        let crates_list: Vec<String> = dedup(strings(p.get("crates"))).into_iter().filter(|c| crates.contains_key(c)).collect();
        let (source, fixed_variant, style) = if rarity == "special" {
            let source = s(p, "source").filter(|x| g.special_sources.contains_key(x)).unwrap_or_else(|| "casino".into());
            let fixed = s(p, "fixedVariant").filter(|x| g.special_variants.contains(x)).unwrap_or_else(|| {
                if source == "link" {
                    "jeans".into()
                } else {
                    "joker".into()
                }
            });
            let styles = g.variants.get(&fixed).map(|v| v.styles.len()).filter(|n| *n > 0).unwrap_or(1) as i64;
            let style = clamp_int(p.get("style"), 1, styles).unwrap_or(1);
            (Some(source), Some(fixed), Some(style))
        } else {
            (None, None, None)
        };
        persons.insert(
            pid.clone(),
            Person {
                id: pid.clone(),
                name: s(p, "name").unwrap_or_default(),
                wiki,
                rarity,
                type_: s(p, "type").filter(|t| g.types.contains_key(t)).unwrap_or_else(|| "tv".into()),
                hp: num("hp"),
                attack: p.get("attack").cloned().unwrap_or(Value::Null),
                dmg: num("dmg"),
                dmg2: if attack2.is_some() { num("dmg2") } else { 0 },
                kind2: if attack2.is_some() { kind("kind2") } else { None }.unwrap_or_else(|| "off".into()),
                attack2,
                kind1: kind("kind1").unwrap_or_else(|| "off".into()),
                abilities: clean_abilities(p.get("abilities")),
                arena: clean_arena(p.get("arena")),
                crate_: crates_list.first().cloned(),
                crates: crates_list,
                number: 0,
                value_mult: 1.0,
                country: clean_country(p.get("country")),
                forge: false,
                source,
                fixed_variant,
                style,
                subtitle: py::cut(py::str_or_empty(p.get("subtitle")).trim(), SUBTITLE_MAX),
                desc: py::cut(py::str_or_empty(p.get("desc")).trim(), DESC_MAX),
                builtin: p.get("builtin").and_then(Value::as_bool).unwrap_or(false),
                modified: p.get("modified").and_then(Value::as_bool).unwrap_or(false),
            },
        );
    }

    // ---- skrzynki: lista kart (numery), cena, warianty, szanse
    let mut out_crates: IndexMap<String, Crate> = IndexMap::new();
    let mut final_ids: IndexMap<String, ()> = IndexMap::new();
    for (cid, c) in &crates {
        let mut members: Vec<&Person> = persons.values().filter(|p| p.crates.contains(cid)).collect();
        members.sort_by(|a, b| g.rarity_idx(&b.rarity).cmp(&g.rarity_idx(&a.rarity)).then_with(|| a.name.cmp(&b.name)));
        let member_ids: Vec<String> = members.iter().map(|p| p.id.clone()).collect();
        for id in &member_ids {
            final_ids.insert(id.clone(), ());
        }
        let price = match c.get("price") {
            Some(v) if py::truthy(v) => py::int(v).unwrap_or(g.crate_price),
            _ => g.crate_price,
        }
        .max(1);
        // skrzynka kart specjalnych: nigdy w sklepie, nie da się jej kupić ani otworzyć
        let special = g.crates.get(cid).map(|b| b.special).unwrap_or(false);
        let shop = c.get("shop").map(py::truthy).unwrap_or(true) && !special;
        let restricted = c.get("restricted").map(py::truthy).unwrap_or(false);
        // warianty wyjątkowe - tylko te, które admin włączył (albo domyślne)
        let chosen: Vec<String> = if c.contains_key("variants") {
            strings(c.get("variants"))
        } else {
            g.default_crate_variants.get(cid).cloned().unwrap_or_default()
        };
        let variants = g.crate_variants.iter().filter(|v| chosen.contains(v)).cloned().collect();
        let mut weights: IndexMap<String, f64> = IndexMap::new();
        for (r, w) in c.get("weights").and_then(Value::as_object).into_iter().flatten() {
            if g.rarities.contains_key(r) {
                weights.insert(r.clone(), py::float(w).unwrap_or(0.0));
            }
        }
        let mut crate_ = Crate {
            id: cid.clone(),
            name: py::str_of(c.get("name").unwrap_or(&Value::Null)),
            short: c.get("short").cloned().unwrap_or(Value::Null),
            code: c.get("code").cloned().unwrap_or(Value::Null),
            emoji: c.get("emoji").and_then(Value::as_str).unwrap_or("📦").into(),
            color1: c.get("color1").cloned().unwrap_or(Value::Null),
            color2: c.get("color2").cloned().unwrap_or(Value::Null),
            price,
            desc: c.get("desc").cloned().unwrap_or(Value::Null),
            shop,
            restricted,
            special,
            variants,
            weights,
            auto_secret: false,
            builtin: c.get("builtin").and_then(Value::as_bool).unwrap_or(false),
            modified: c.get("modified").and_then(Value::as_bool).unwrap_or(false),
            people: member_ids,
        };
        // tajna karta: zawsze 1 na SECRET_ODDS otwartych skrzynek (chyba że admin ustawi inaczej)
        crate_.auto_secret = !crate_.weights.contains_key("secret");
        if crate_.auto_secret {
            let present: HashSet<&str> = members.iter().map(|p| p.rarity.as_str()).collect();
            let others: f64 = present.iter().filter(|r| **r != "secret").map(|r| crate_.weight(r)).sum();
            let w = if others != 0.0 { others / (g.secret_odds - 1) as f64 } else { 0.0 };
            crate_.weights.insert("secret".into(), w);
        }
        // numer karty na skrzynce głównej
        for (n, id) in crate_.people.iter().enumerate() {
            if let Some(p) = persons.get_mut(id) {
                if p.crate_.as_deref() == Some(cid) {
                    p.number = n as i64 + 1;
                }
            }
        }
        out_crates.insert(cid.clone(), crate_);
    }

    // wartość karty rośnie z ceną NAJTAŃSZEJ skrzynki, w której można ją zdobyć; kuźnia i kasyno: tylko karty
    // ze skrzynek, które są teraz w sklepie
    let mut final_people = IndexMap::new();
    for id in final_ids.keys() {
        let mut p = persons.swap_remove(id).expect("karta");
        let cheapest = p.crates.iter().map(|c| out_crates[c].price).min().unwrap_or(g.crate_price);
        p.value_mult = (cheapest as f64 / g.crate_price as f64).max(1.0);
        p.forge = p.crates.iter().any(|c| out_crates[c].shop);
        final_people.insert(id.clone(), Arc::new(p));
    }

    Catalog { crates: out_crates, people: final_people, hidden_crates, hidden_cards }
}

// ---------------------------------------------------------------- zapis zmian admina

/// Tabela zmian admina
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Table {
    Crates,
    Cards,
}

async fn override_data(c: &mut Conn, table: Table, key: &str) -> sqlx::Result<Option<String>> {
    match table {
        Table::Crates => sqlx::query_scalar!("SELECT data FROM catalog_crates WHERE id = $1", key).fetch_optional(c).await,
        Table::Cards => sqlx::query_scalar!("SELECT data FROM catalog_cards WHERE id = $1", key).fetch_optional(c).await,
    }
}

pub async fn save_override(c: &mut Conn, table: Table, key: &str, fields: &Map<String, Value>) -> sqlx::Result<()> {
    let row = override_data(c, table, key).await?;
    let mut current: Map<String, Value> =
        row.and_then(|d| serde_json::from_str::<Value>(&d).ok()).and_then(|v| v.as_object().cloned()).unwrap_or_default();
    current.extend(fields.clone());
    let data = Value::Object(current).to_string();
    match table {
        Table::Crates => {
            sqlx::query!(
                "INSERT INTO catalog_crates (id, data, deleted) VALUES ($1, $2, 0) \
             ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted = 0",
                key,
                data
            )
            .execute(c)
            .await?
        }
        Table::Cards => {
            sqlx::query!(
                "INSERT INTO catalog_cards (id, data, deleted) VALUES ($1, $2, 0) \
             ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted = 0",
                key,
                data
            )
            .execute(c)
            .await?
        }
    };
    Ok(())
}

pub async fn mark_deleted(c: &mut Conn, table: Table, key: &str) -> sqlx::Result<()> {
    match table {
        Table::Crates => {
            sqlx::query!(
                "INSERT INTO catalog_crates (id, data, deleted) VALUES ($1, '{}', 1) ON CONFLICT(id) DO UPDATE SET deleted = 1",
                key
            )
            .execute(c)
            .await?
        }
        Table::Cards => {
            sqlx::query!(
                "INSERT INTO catalog_cards (id, data, deleted) VALUES ($1, '{}', 1) ON CONFLICT(id) DO UPDATE SET deleted = 1",
                key
            )
            .execute(c)
            .await?
        }
    };
    Ok(())
}

pub async fn remove_row(c: &mut Conn, table: Table, key: &str) -> sqlx::Result<()> {
    match table {
        Table::Crates => sqlx::query!("DELETE FROM catalog_crates WHERE id = $1", key).execute(c).await?,
        Table::Cards => sqlx::query!("DELETE FROM catalog_cards WHERE id = $1", key).execute(c).await?,
    };
    Ok(())
}

// ---------------------------------------------------------------- pytania o katalog

impl Catalog {
    pub fn person(&self, pid: &str) -> Option<&Arc<Person>> {
        self.people.get(pid)
    }

    pub fn has(&self, pid: &str) -> bool {
        self.people.contains_key(pid)
    }

    pub fn crate_people<'a>(&'a self, c: &'a Crate) -> impl Iterator<Item = &'a Arc<Person>> + 'a {
        c.people.iter().filter_map(|id| self.people.get(id))
    }

    /// Warianty wyjątkowe, które mogą wypaść z tej skrzynki (dla tej karty: flagowy tylko z ustawionym krajem,
    /// plus warianty przypisane do samej karty, np. Rzulty)
    pub fn crate_variants(&self, c: &Crate, person: Option<&Person>) -> Vec<String> {
        let mut out: Vec<String> =
            c.variants.iter().filter(|v| *v != "flag" || person.is_none_or(|p| !p.country.is_empty())).cloned().collect();
        if let Some(p) = person {
            out.extend(g().card_variants(&p.id));
        }
        out
    }

    /// Warianty, dla których ta karta może mieć własne zdjęcie: przypisane do karty (np. Rzulty JP2) i wyjątkowe
    /// warianty z polem "photo" (np. Halloweenowa), jeśli są włączone w którejś skrzynce karty
    pub fn photo_variants(&self, pid: &str) -> Vec<String> {
        let g = g();
        let mut out = g.card_variants(pid);
        if let Some(p) = self.people.get(pid) {
            for c in &p.crates {
                if let Some(cr) = self.crates.get(c) {
                    for v in &cr.variants {
                        if g.variants[v].photo && !out.contains(v) {
                            out.push(v.clone());
                        }
                    }
                }
            }
        }
        out
    }

    /// Warianty, w których ta karta może istnieć: zwykłe zawsze, wyjątkowe tylko z jej skrzynek (flagowy - z krajem),
    /// własne warianty karty i połączenia flagi z każdym z nich (bez "noCombo"). Karta specjalna - tylko jej jeden wariant.
    pub fn possible_variants(&self, p: &Person) -> Vec<String> {
        let g = g();
        if p.is_special() {
            return vec![p.fixed()];
        }
        let mut extra: HashSet<String> = g.card_variants(&p.id).into_iter().collect();
        for c in &p.crates {
            if let Some(cr) = self.crates.get(c) {
                extra.extend(self.crate_variants(cr, Some(p)));
            }
        }
        let base: Vec<&String> = g
            .variant_order
            .iter()
            .filter(|v| !g.variants[*v].combo && (!g.variants[*v].exclusive || extra.contains(*v)))
            .collect();
        let mut combos = HashSet::new();
        for layer in &base {
            let lx = &g.variants[*layer];
            if lx.layer && !lx.no_combo {
                for b in &base {
                    if *b != "normal" && !g.variants[*b].layer {
                        combos.insert(crate::data::combine_variant(layer, b));
                    }
                }
            }
        }
        g.variant_order.iter().filter(|v| base.contains(v) || combos.contains(*v)).cloned().collect()
    }

    /// Rzadkość wyniku kontraktu: następna, która ma karty w sklepie (pusta rzadkość jest pomijana)
    pub fn next_rarity(&self, rarity: &str) -> Option<String> {
        let g = g();
        let present: HashSet<&str> = self.people.values().filter(|p| p.forge).map(|p| p.rarity.as_str()).collect();
        let start = g.rarity_order.iter().position(|r| r == rarity)? + 1;
        g.rarity_order[start..].iter().find(|r| present.contains(r.as_str()) && *r != "secret").cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_catalog() {
        let cat = build(&[], &[]);
        let jp2 = cat.person("pl_secret").unwrap();
        assert_eq!(jp2.crates, vec!["pl", "prl"]);
        assert_eq!(jp2.number, 1);
        assert_eq!(jp2.value_mult, 1.0);
        assert!(cat.possible_variants(jp2).contains(&"rzulty".to_string()));
        let tusk = cat.person("pl_tusk").unwrap();
        assert!(tusk.crates.contains(&"halloween".to_string()));
        let pv = cat.possible_variants(tusk);
        assert!(pv.contains(&"halloween+gold".to_string()) && pv.contains(&"devil".to_string()));
        assert!(!pv.contains(&"devil+gold".to_string()));
        assert!(!cat.crates["specjalne"].shop);
        assert_eq!(cat.next_rarity("green").as_deref(), Some("blue"));
    }
}
