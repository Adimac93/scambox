//! Karty i skrzynki w odpowiedziach dla przeglądarki.

use std::collections::HashSet;
use std::sync::Arc;

use indexmap::IndexMap;
use serde::Serialize;

use crate::catalog::{default_weight, Catalog, Crate, Person, RawCrate};
use crate::data::g;
use crate::images::{file_mtime, Images, Kind};

/// Karta dla przeglądarki: pełne dane albo zamaskowana tajna karta
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum PublicPerson {
    Known(KnownPerson),
    Masked(MaskedPerson),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownPerson {
    #[serde(flatten)]
    pub person: Arc<Person>,
    pub imgv: i64,
    /// warianty z własnym zdjęciem: {wariant: wersja}
    #[serde(skip_serializing_if = "IndexMap::is_empty")]
    pub variant_photos: IndexMap<String, i64>,
}

/// Tajna karta, której gracz jeszcze nie zdobył - bez nazwy i zdjęcia
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskedPerson {
    pub id: String,
    pub rarity: &'static str,
    #[serde(rename = "crate")]
    pub crate_: Option<String>,
    pub crates: Vec<String>,
    pub number: i64,
    pub masked: bool,
    pub value_mult: f64,
    pub name: &'static str,
    #[serde(rename = "type")]
    pub type_: &'static str,
    pub hp: i64,
    pub attack: &'static str,
    pub dmg: i64,
    pub imgv: i64,
}

/// {wariant: wersja} - warianty tej karty, które mają własne zdjęcie (wersja = czas pliku, dla pamięci przeglądarki)
pub fn variant_photos(img: &Images, cat: &Catalog, pid: &str) -> IndexMap<String, i64> {
    cat.photo_variants(pid)
        .into_iter()
        .filter_map(|v| {
            let path = img.find(pid, &Kind::Variant(v.clone()))?;
            Some((v, file_mtime(&path) as i64 % 100_000))
        })
        .collect()
}

/// Wersja zdjęcia karty (do adresów ?v=)
pub fn img_version(img: &Images, pid: &str) -> i64 {
    let total: f64 = [Kind::Main, Kind::Alt].iter().filter_map(|k| img.find(pid, k)).map(|p| file_mtime(&p)).sum();
    total as i64 % 100_000
}

/// Karta dla przeglądarki - tajne karty są zamaskowane, dopóki ich nie zdobędziesz (known = znana graczowi)
pub fn public_person(img: &Images, cat: &Catalog, p: &Arc<Person>, known: bool) -> PublicPerson {
    if p.is_secret() && !known {
        return PublicPerson::Masked(MaskedPerson {
            id: p.id.clone(),
            rarity: "secret",
            crate_: p.crate_.clone(),
            crates: p.crates.clone(),
            number: p.number,
            masked: true,
            value_mult: p.value_mult,
            name: "???",
            type_: "tv",
            hp: 0,
            attack: "???",
            dmg: 0,
            imgv: 0,
        });
    }
    PublicPerson::Known(KnownPerson {
        person: p.clone(),
        imgv: img_version(img, &p.id),
        variant_photos: variant_photos(img, cat, &p.id),
    })
}

/// Prawdziwe dane tajnej karty, której gracz jeszcze nie odkrył (np. u znajomego) - albo None
pub fn reveal(img: &Images, cat: &Catalog, p: &Arc<Person>, found: &HashSet<String>) -> Option<PublicPerson> {
    (p.is_secret() && !found.contains(&p.id)).then(|| public_person(img, cat, p, true))
}

/// Karta w ofercie rynku / na stole jackpota (tajną kartę widać, nawet jeśli jej jeszcze nie odkryłem)
#[derive(Debug, Clone, Serialize)]
pub struct CardJson {
    pub person: String,
    pub variant: String,
    pub value: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reveal: Option<PublicPerson>,
}

impl CardJson {
    /// `pid` musi być w katalogu
    pub fn new(img: &Images, cat: &Catalog, pid: &str, variant: &str, found: &HashSet<String>) -> CardJson {
        let p = &cat.people[pid];
        CardJson {
            person: pid.to_owned(),
            variant: if g().is_variant(variant) { variant } else { "normal" }.to_owned(),
            value: p.value(variant),
            reveal: reveal(img, cat, p, found),
        }
    }
}

/// Skrzynka dla przeglądarki
#[derive(Debug, Clone, Serialize)]
pub struct CrateJson {
    pub id: String,
    pub name: String,
    pub short: String,
    pub code: String,
    pub emoji: String,
    pub color1: String,
    pub color2: String,
    pub price: i64,
    pub desc: String,
    pub shop: bool,
    pub restricted: bool,
    pub special: bool,
    pub people: Vec<String>,
    pub variants: Vec<String>,
    /// szansa każdej rzadkości (w kolejności RARITY_ORDER)
    pub weights: IndexMap<String, f64>,
}

impl CrateJson {
    pub fn new(cat: &Catalog, c: &Crate) -> CrateJson {
        CrateJson {
            id: c.id.clone(),
            name: c.name.clone(),
            short: c.short.clone(),
            code: c.code.clone(),
            emoji: c.emoji.clone(),
            color1: c.color1.clone(),
            color2: c.color2.clone(),
            price: c.price,
            desc: c.desc.clone(),
            shop: c.shop,
            restricted: c.restricted,
            special: c.special,
            people: c.people.iter().filter(|p| cat.has(p)).cloned().collect(),
            variants: c.variants.clone(),
            weights: g().rarity_order.iter().map(|r| (r.clone(), c.weight(r))).collect(),
        }
    }

    /// Ukryta wbudowana skrzynka (dane przed sprawdzeniem) w panelu admina
    pub fn hidden(cid: &str, c: &RawCrate) -> CrateJson {
        let g = g();
        CrateJson {
            id: cid.to_owned(),
            name: c.name.clone(),
            short: c.short.clone(),
            code: c.code.clone(),
            emoji: c.emoji.clone(),
            color1: c.color1.clone(),
            color2: c.color2.clone(),
            price: c.price.unwrap_or(g.crate_price),
            desc: c.desc.clone(),
            shop: c.shop.unwrap_or(true),
            restricted: c.restricted.unwrap_or(false),
            special: g.crates.get(cid).is_some_and(|b| b.special),
            people: vec![],
            variants: c.variants.clone().unwrap_or_default(),
            weights: g
                .rarity_order
                .iter()
                .map(|r| (r.clone(), c.weights.get(r).copied().unwrap_or_else(|| default_weight(r))))
                .collect(),
        }
    }
}
