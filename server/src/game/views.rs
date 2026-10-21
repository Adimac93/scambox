//! Karty i skrzynki w odpowiedziach dla przeglądarki (public_person, card_json, crate_json z app.py).

use serde_json::{json, Map, Value};

use crate::catalog::{Catalog, Crate, Person};
use crate::data::g;
use crate::images::{file_mtime, Images, Kind};

const PUBLIC_KEYS: &[&str] = &[
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
    "crate",
    "crates",
    "number",
    "valueMult",
    "country",
    "forge",
    "source",
    "fixedVariant",
    "style",
    "subtitle",
    "desc",
];

/// {wariant: wersja} - warianty tej karty, które mają własne zdjęcie (wersja = czas pliku, dla pamięci przeglądarki)
pub fn variant_photos(img: &Images, cat: &Catalog, pid: &str) -> Map<String, Value> {
    cat.photo_variants(pid)
        .into_iter()
        .filter_map(|v| {
            let path = img.find(pid, &Kind::Variant(v.clone()))?;
            Some((v, json!(file_mtime(&path) as i64 % 100000)))
        })
        .collect()
}

pub fn img_version(img: &Images, pid: &str) -> i64 {
    let total: f64 = [img.find(pid, &Kind::Main), img.find(pid, &Kind::Alt)].iter().flatten().map(|p| file_mtime(p)).sum();
    total as i64 % 100000
}

/// Karta dla przeglądarki - tajne karty są zamaskowane, dopóki ich nie zdobędziesz (known = znana graczowi)
pub fn public_person(img: &Images, cat: &Catalog, p: &Person, known: bool) -> Value {
    if p.is_secret() && !known {
        return json!({"id": p.id, "rarity": "secret", "crate": p.crate_, "crates": p.crates, "number": p.number,
                      "masked": true, "valueMult": p.value_mult, "name": "???", "type": "tv", "hp": 0, "attack": "???",
                      "dmg": 0, "imgv": 0});
    }
    let full = p.to_map();
    let mut base: Map<String, Value> =
        PUBLIC_KEYS.iter().map(|k| (k.to_string(), full.get(*k).cloned().unwrap_or(Value::Null))).collect();
    base.insert("imgv".into(), json!(img_version(img, &p.id)));
    let vp = variant_photos(img, cat, &p.id);
    if !vp.is_empty() {
        base.insert("variantPhotos".into(), Value::Object(vp));
    }
    Value::Object(base)
}

/// Prawdziwe dane tajnej karty, której gracz jeszcze nie odkrył (np. u znajomego) - albo None
pub fn reveal(img: &Images, cat: &Catalog, p: &Person, found: &std::collections::HashSet<String>) -> Option<Value> {
    (p.is_secret() && !found.contains(&p.id)).then(|| public_person(img, cat, p, true))
}

/// Karta w ofercie rynku / na stole jackpota (tajną kartę widać, nawet jeśli jej jeszcze nie odkryłem)
pub fn card_json(
    img: &Images,
    cat: &Catalog,
    pid: &str,
    variant: &str,
    found: &std::collections::HashSet<String>,
) -> Map<String, Value> {
    let p = &cat.people[pid];
    let mut out = Map::new();
    out.insert("person".into(), json!(pid));
    out.insert("variant".into(), json!(if g().is_variant(variant) { variant } else { "normal" }));
    out.insert("value".into(), json!(p.value(variant)));
    if let Some(r) = reveal(img, cat, p, found) {
        out.insert("reveal".into(), r);
    }
    out
}

pub fn crate_json(cat: &Catalog, c: &Crate) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("id".into(), json!(c.id));
    m.insert("name".into(), json!(c.name));
    m.insert("short".into(), c.short.clone());
    m.insert("code".into(), c.code.clone());
    m.insert("emoji".into(), json!(c.emoji));
    m.insert("color1".into(), c.color1.clone());
    m.insert("color2".into(), c.color2.clone());
    m.insert("price".into(), json!(c.price));
    m.insert("desc".into(), c.desc.clone());
    m.insert("shop".into(), json!(c.shop));
    m.insert("restricted".into(), json!(c.restricted));
    m.insert("special".into(), json!(c.special));
    m.insert("people".into(), json!(c.people.iter().filter(|p| cat.has(p)).collect::<Vec<_>>()));
    m.insert("variants".into(), json!(c.variants));
    m.insert("weights".into(), Value::Object(g().rarity_order.iter().map(|r| (r.clone(), json!(c.weight(r)))).collect()));
    m
}

/// Ukryta wbudowana skrzynka (surowe dane) w panelu admina - jak crate_json(dict(c, people=[]))
pub fn hidden_crate_json(c: &Map<String, Value>) -> Map<String, Value> {
    let mut m: Map<String, Value> =
        ["id", "name", "short", "code", "emoji", "color1", "color2", "price", "desc", "shop", "restricted", "special"]
            .iter()
            .map(|k| (k.to_string(), c.get(*k).cloned().unwrap_or(Value::Null)))
            .collect();
    m.insert("people".into(), json!([]));
    m.insert("variants".into(), c.get("variants").filter(|v| crate::py::truthy(v)).cloned().unwrap_or(json!([])));
    let weights = c.get("weights").and_then(Value::as_object);
    m.insert(
        "weights".into(),
        Value::Object(
            g().rarity_order
                .iter()
                .map(|r| {
                    let w = weights.and_then(|w| w.get(r)).and_then(crate::py::float).unwrap_or(g().rarities[r].weight);
                    (r.clone(), json!(w))
                })
                .collect(),
        ),
    );
    m
}
