//! Eksport zmian z panelu admina (karty i skrzynki) do repozytorium i ich wczytanie w nowej instalacji:
//!   - catalog_export.json - skrzynki i karty dodane/zmienione/ukryte w panelu admina (BEZ danych graczy),
//!   - custom_images/      - zdjęcia wgrane w panelu admina (karty bez artykułu w Wikipedii albo z własnym plikiem).

use std::collections::BTreeSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::PgPool;

use crate::catalog::Table;
use crate::config::Config;
use crate::data::g;
use crate::images::{Images, Kind};

const EXPORT_FILE: &str = "catalog_export.json";
const IMAGES_DIR: &str = "custom_images";

/// Zmiana z panelu admina (wiersz catalog_crates / catalog_cards)
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportRow {
    pub id: String,
    pub data: Map<String, Value>,
    pub deleted: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ExportFile {
    pub crates: Vec<ExportRow>,
    pub cards: Vec<ExportRow>,
}

fn parse(data: &str) -> Map<String, Value> {
    serde_json::from_str(data).unwrap_or_default()
}

/// Wczytuje eksport do pustej bazy (nowa instalacja). Istniejących zmian nigdy nie nadpisuje.
pub async fn import_if_empty(pool: &PgPool, base: &Path) -> anyhow::Result<bool> {
    let file = base.join(EXPORT_FILE);
    if !file.exists() {
        return Ok(false);
    }
    let mut tx = pool.begin().await?;
    let existing =
        sqlx::query_scalar!(r#"SELECT (SELECT COUNT(*) FROM catalog_crates) + (SELECT COUNT(*) FROM catalog_cards) AS "n!""#)
            .fetch_one(&mut *tx)
            .await?;
    if existing > 0 {
        return Ok(false);
    }
    let export: ExportFile = serde_json::from_str(&std::fs::read_to_string(&file)?)?;
    for (table, rows) in [(Table::Crates, &export.crates), (Table::Cards, &export.cards)] {
        for row in rows {
            let data = Value::Object(row.data.clone()).to_string();
            let deleted = i32::from(row.deleted);
            match table {
                Table::Crates => sqlx::query!(
                    "INSERT INTO catalog_crates (id, data, deleted) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                    row.id,
                    data,
                    deleted
                ),
                Table::Cards => sqlx::query!(
                    "INSERT INTO catalog_cards (id, data, deleted) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                    row.id,
                    data,
                    deleted
                ),
            }
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(true)
}

/// Własne zdjęcia z repozytorium -> image_cache (tylko brakujące). Przy każdym starcie, bo na nowym serwerze baza bywa
/// przeniesiona ze starego zapisu (nie jest pusta), a folder ze zdjęciami jest pusty.
pub fn copy_custom_images(base: &Path, data_dir: &Path) -> std::io::Result<()> {
    let src = base.join(IMAGES_DIR);
    if !src.is_dir() {
        return Ok(());
    }
    let cache = data_dir.join("image_cache");
    std::fs::create_dir_all(&cache)?;
    for entry in std::fs::read_dir(&src)? {
        let entry = entry?;
        let target = cache.join(entry.file_name());
        if !target.exists() {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// catalog_export.json + custom_images/. Zwraca (skrzynki, karty, zdjęcia).
pub async fn export_catalog(pool: &PgPool, cfg: &Config) -> anyhow::Result<(usize, usize, usize)> {
    let crates = sqlx::query!("SELECT id, data, deleted FROM catalog_crates ORDER BY id")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| ExportRow { data: parse(&r.data), id: r.id, deleted: r.deleted != 0 })
        .collect();
    let cards = sqlx::query!("SELECT id, data, deleted FROM catalog_cards ORDER BY id")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| ExportRow { data: parse(&r.data), id: r.id, deleted: r.deleted != 0 })
        .collect();
    let export = ExportFile { crates, cards };
    // wcięcie 1 spacja - jak json.dump(..., indent=1) w wersji Python (mniejsze różnice w git)
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, serde_json::ser::PrettyFormatter::with_indent(b" "));
    export.serialize(&mut ser)?;
    std::fs::write(cfg.base_dir.join(EXPORT_FILE), buf)?;

    let images = Images::new(&cfg.data_dir);
    let dir = cfg.base_dir.join(IMAGES_DIR);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    // własne zdjęcia: karty bez artykułu w Wikipedii albo z wgranym plikiem (nie-JPG z Wikipedii)
    let mut files: BTreeSet<std::path::PathBuf> = export
        .cards
        .iter()
        .filter(|c| !c.deleted)
        .filter_map(|c| {
            let path = images.find(&c.id, &Kind::Main)?;
            let from_wiki = c.data.get("wiki").is_some_and(|w| !w.is_null());
            let jpg = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("jpg"));
            (!from_wiki || !jpg).then_some(path)
        })
        .collect();
    // zdjęcia wariantów przypisanych do kart (np. Rzulty) i własne zdjęcia wariantów z polem "photo" (np. Halloweenowa)
    let g = g();
    let all_ids: BTreeSet<String> = g
        .crates
        .values()
        .flat_map(|c| c.people.iter().filter_map(|p| p.get("id")?.as_str().map(str::to_owned)))
        .chain(export.cards.iter().map(|c| c.id.clone()))
        .collect();
    for (variant, info) in &g.variants {
        let pids: Vec<&String> = if !info.cards.is_empty() {
            info.cards.iter().collect()
        } else if info.photo {
            all_ids.iter().collect()
        } else {
            vec![]
        };
        files.extend(pids.into_iter().filter_map(|pid| images.find(pid, &Kind::Variant(variant.clone()))));
    }
    for path in &files {
        std::fs::copy(path, dir.join(path.file_name().unwrap_or_default()))?;
    }
    Ok((export.crates.len(), export.cards.len(), files.len()))
}
