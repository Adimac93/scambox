//! ScamBox - serwer gry (Rust: axum + tokio + sqlx/PostgreSQL). Przeglądarka (static/, templates/) bez zmian.
//!
//!   cargo run --release                 gra na http://127.0.0.1:5000
//!   cargo run --release -- --lan        dostęp z innych komputerów w sieci
//!   cargo run --release -- --test       osobna baza (TEST_DATABASE_URL), port 5001
//!   cargo run --release -- export-catalog
//!   cargo run --release -- fetch-images [--force]

mod arena;
mod auth;
mod catalog;
mod config;
mod data;
mod db;
mod error;
mod game;
mod images;
mod py;
mod routes;
mod state;
mod web;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use arc_swap::ArcSwap;
use axum::extract::{MatchedPath, Request};
use axum::middleware::{self, Next};
use axum::response::Response;
use clap::Parser;
use serde_json::{json, Value};
use sqlx::PgPool;
use tower_http::compression::{CompressionLayer, CompressionLevel};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

use crate::config::{Cli, Command, Config};
use crate::db::now;
use crate::game::ESCROW;
use crate::images::{Images, Kind};
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let cli = Cli::parse();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            if cli.dev {
                "scambox=debug,tower_http=debug".into()
            } else {
                "scambox=info".into()
            }
        }))
        .init();
    let cfg = Config::load(&cli)?;
    match cli.command.clone().unwrap_or(Command::Serve) {
        Command::Serve => serve(cfg).await,
        Command::ExportCatalog => {
            let pool = db::connect(&cfg).await?;
            let (crates, cards, imgs) = export_catalog(&pool, &cfg).await?;
            println!(
                "Wyeksportowano: {crates} skrzynek, {cards} kart, {imgs} własnych zdjęć -> catalog_export.json, custom_images/"
            );
            Ok(())
        }
        Command::FetchImages { force } => {
            let pool = db::connect(&cfg).await?;
            db::init_schema(&pool).await?;
            let cat = catalog::load(&mut *pool.acquire().await?).await?;
            let images = Arc::new(Images::new(&cfg.data_dir));
            let people: Vec<_> = cat.people.values().map(|p| (p.id.clone(), p.wiki.clone())).collect();
            let res = images.fetch(&people, force).await;
            let missing: Vec<&String> = res.iter().filter(|(_, ok)| !**ok).map(|(p, _)| p).collect();
            println!(
                "Główne: {}/{}{}",
                res.len() - missing.len(),
                res.len(),
                if missing.is_empty() {
                    String::new()
                } else {
                    format!(" | brak: {}", missing.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "))
                }
            );
            let n = images.fetch_alt(&people, force).await;
            let have = people.iter().filter(|(p, _)| images.find(p, &Kind::Alt).is_some()).count();
            println!("Alternatywne: {have}/{} (nowe: {n})", people.len());
            Ok(())
        }
    }
}

async fn serve(cfg: Config) -> anyhow::Result<()> {
    // druga kopia gry na zajętym porcie się nie uruchomi
    let listener = match tokio::net::TcpListener::bind(cfg.addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("\n  !!! Gra już działa (port {} jest zajęty) - prawdopodobnie w innym oknie: {e}", cfg.addr.port());
            eprintln!("  Zamknij tamto okno (Ctrl+C) i uruchom grę jeszcze raz.\n");
            std::process::exit(1);
        }
    };
    if let Some(addr) = cfg.metrics_addr {
        match metrics_exporter_prometheus::PrometheusBuilder::new().with_http_listener(addr).install() {
            Ok(()) => tracing::info!("metryki Prometheus: http://{addr}/metrics"),
            Err(e) => tracing::warn!("metryki wyłączone ({addr}): {e}"),
        }
    }

    let pool = db::connect(&cfg).await?;
    let cat = init_db(&pool, &cfg).await?;
    let images = Arc::new(Images::new(&cfg.data_dir));
    let st = AppState {
        db: pool,
        cfg: Arc::new(cfg.clone()),
        catalog: Arc::new(ArcSwap::from_pointee(cat)),
        templates: Arc::new(web::Templates::new(&cfg.base_dir, cfg.dev)),
        images: images.clone(),
        arena: Arc::default(),
        login: Arc::default(),
        cookie_key: auth::cookie_key(&cfg.secret_key),
    };

    // zdjęcia kart i miniatury - w tle
    let people: Vec<_> = st.cat().people.values().map(|p| (p.id.clone(), p.wiki.clone())).collect();
    tokio::spawn(async move { images.prefetch_all(people).await });
    // porzucone walki i wyzwania w Arenie
    let arena = st.arena.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        loop {
            tick.tick().await;
            arena.inner.lock().await.cleanup();
        }
    });

    let static_dir = cfg.base_dir.join("static");
    let app = routes::router(st)
        .nest_service("/static", ServeDir::new(static_dir))
        .layer(middleware::from_fn(web::cache_headers))
        .layer(CompressionLayer::new().quality(CompressionLevel::Precise(5)).compress_when(web::gzip_predicate()))
        .layer(RequestBodyLimitLayer::new(20 * 1024 * 1024))
        .layer(axum::extract::DefaultBodyLimit::max(20 * 1024 * 1024))
        .layer(middleware::from_fn(track_metrics))
        .layer(TraceLayer::new_for_http());

    if cfg.lan {
        println!("\n  Znajomi w tej samej sieci wchodzą na:  http://{}:{}\n", lan_address(), cfg.addr.port());
    }
    println!("\n  Gra działa na:  http://127.0.0.1:{}   (baza: {})\n", cfg.addr.port(), cfg.describe_db());
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

/// Liczba i czas zapytań (metryki Prometheus)
async fn track_metrics(req: Request, next: Next) -> Response {
    let start = Instant::now();
    let path = req.extensions().get::<MatchedPath>().map(|p| p.as_str().to_owned()).unwrap_or_else(|| "other".into());
    let method = req.method().to_string();
    let resp = next.run(req).await;
    let labels = [("method", method), ("path", path), ("status", resp.status().as_u16().to_string())];
    metrics::counter!("scambox_http_requests_total", &labels).increment(1);
    metrics::histogram!("scambox_http_request_duration_seconds", &labels).record(start.elapsed().as_secs_f64());
    resp
}

fn lan_address() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("10.255.255.255:1")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "?".into())
}

// ---------------------------------------------------------------- start bazy (init_db z wersji Python)

async fn init_db(pool: &PgPool, cfg: &Config) -> anyhow::Result<catalog::Catalog> {
    db::init_schema(pool).await?;
    let mut tx = pool.begin().await?;
    // klaser pamięta karty, które gracz kiedykolwiek miał: uzupełniamy z obecnych kart i z aktywności
    sqlx::query!(
        "INSERT INTO user_collected (user_id, person_id, variant) SELECT DISTINCT user_id, person_id, variant
         FROM items WHERE user_id > 0 ON CONFLICT DO NOTHING"
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "INSERT INTO user_collected (user_id, person_id, variant) SELECT DISTINCT author_id, person_id, variant
         FROM feed WHERE author_id IS NOT NULL ON CONFLICT DO NOTHING"
    )
    .execute(&mut *tx)
    .await?;
    // kiedy gracz pierwszy raz miał kartę (starsze wpisy bez czasu): najstarsza jego karta albo wpis w aktywności
    sqlx::query!(
        "UPDATE user_collected SET at = (SELECT MIN(i.created_at) FROM items i WHERE i.user_id = user_collected.user_id
         AND i.person_id = user_collected.person_id AND i.variant = user_collected.variant) WHERE at IS NULL"
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE user_collected SET at = (SELECT MIN(f.created_at) FROM feed f WHERE f.author_id = user_collected.user_id
         AND f.person_id = user_collected.person_id AND f.variant = user_collected.variant AND f.kind != 'show')
         WHERE at IS NULL"
    )
    .execute(&mut *tx)
    .await?;
    // kto kiedykolwiek dostał pieniądze z bankomatu / od admina (statystyka "deposited") - poza rankingiem
    sqlx::query!(
        "UPDATE users SET money_generated = 1 WHERE money_generated = 0 AND id IN
         (SELECT user_id FROM user_state WHERE key = 'deposited' AND value > 0)"
    )
    .execute(&mut *tx)
    .await?;
    // jackpot jako lobby nie blokuje kart - stoły z pierwszej wersji (karty założyciela w ESCROW) zamykamy, karty wracają
    let open = sqlx::query!("SELECT id, creator_id FROM jackpots WHERE status = 'open'").fetch_all(&mut *tx).await?;
    for j in open {
        let held = sqlx::query_scalar!(
            "SELECT ji.item_id FROM jackpot_items ji JOIN items i ON i.id = ji.item_id WHERE ji.jackpot_id = $1 AND i.user_id = $2",
            j.id,
            ESCROW
        )
        .fetch_all(&mut *tx)
        .await?;
        if !held.is_empty() {
            sqlx::query!("UPDATE items SET user_id = $1 WHERE user_id = $2 AND id = ANY($3)", j.creator_id, ESCROW, &held)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("UPDATE jackpots SET status = 'cancelled', finished_at = $1 WHERE id = $2", now(), j.id)
                .execute(&mut *tx)
                .await?;
        }
    }
    // wyniki jackpota sprzed tej wersji uznajemy za obejrzane (nowi gracze dostają 0 przy rejestracji)
    sqlx::query!(
        "INSERT INTO user_state (user_id, key, value) SELECT id, 'jackpot_seen', $1 FROM users WHERE id > 0 ON CONFLICT DO NOTHING",
        (now() * 1000.0) as i64
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if import_if_empty(pool, &cfg.base_dir).await? {
        tracing::info!("Wczytano karty i skrzynki z catalog_export.json");
    }
    copy_custom_images(&cfg.base_dir, &cfg.data_dir)?;
    let cat = catalog::load(&mut *pool.acquire().await?).await?;
    backfill_hall_of_fame(pool).await?;
    Ok(cat)
}

/// Hall of Fame zapisujemy od tej aktualizacji. Jednorazowo (pusta tabela) uzupełniamy ją z historii: karty, które gracze
/// mają teraz (czas wylosowania) i aktywność (legendarne+ - też te później sprzedane). Liczby są przybliżone.
async fn backfill_hall_of_fame(pool: &PgPool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    if sqlx::query_scalar!("SELECT 1 AS one FROM hall_of_fame LIMIT 1").fetch_optional(&mut *tx).await?.is_some() {
        return Ok(());
    }
    // (osoba, wariant) -> (gracz, czas, ile kart, ile wpisów w aktywności)
    type First = (Option<i64>, Option<f64>, i32, i32);
    let mut best: indexmap::IndexMap<(String, String), First> = indexmap::IndexMap::new();
    for r in
        sqlx::query!(r#"SELECT person_id, variant, user_id, created_at FROM items WHERE user_id > 0"#).fetch_all(&mut *tx).await?
    {
        let b = best.entry((r.person_id, r.variant)).or_insert((None, None, 0, 0));
        b.2 += 1;
        if b.1.is_none_or(|t| r.created_at < t) {
            (b.0, b.1) = (r.user_id, Some(r.created_at));
        }
    }
    for r in
        sqlx::query!("SELECT author_id, person_id, variant, created_at FROM feed WHERE kind IN ('drop', 'contract', 'upgrade')")
            .fetch_all(&mut *tx)
            .await?
    {
        let b = best.entry((r.person_id, r.variant)).or_insert((None, None, 0, 0));
        b.3 += 1;
        if b.1.is_none_or(|t| r.created_at < t) {
            (b.0, b.1) = (Some(r.author_id), Some(r.created_at));
        }
    }
    for ((pid, variant), (uid, at, n_items, n_feed)) in best {
        sqlx::query!(
            "INSERT INTO hall_of_fame (person_id, variant, first_user_id, first_at, source, drops)
             VALUES ($1, $2, $3, $4, 'drop', $5) ON CONFLICT DO NOTHING",
            pid,
            variant,
            uid,
            at.unwrap_or(0.0),
            n_items.max(n_feed)
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------- eksport katalogu (export_catalog.py)

/// Wczytuje eksport do pustej bazy (nowa instalacja). Istniejących zmian nigdy nie nadpisuje.
async fn import_if_empty(pool: &PgPool, base: &Path) -> anyhow::Result<bool> {
    let file = base.join("catalog_export.json");
    if !file.exists() {
        return Ok(false);
    }
    let mut tx = pool.begin().await?;
    let n = sqlx::query_scalar!(r#"SELECT (SELECT COUNT(*) FROM catalog_crates) + (SELECT COUNT(*) FROM catalog_cards) AS "n!""#)
        .fetch_one(&mut *tx)
        .await?;
    if n > 0 {
        return Ok(false);
    }
    let data: Value = serde_json::from_str(&std::fs::read_to_string(&file)?)?;
    for (table, key) in [(catalog::Table::Crates, "crates"), (catalog::Table::Cards, "cards")] {
        for row in data[key].as_array().into_iter().flatten() {
            let id = row["id"].as_str().unwrap_or_default();
            let d = row["data"].to_string();
            let deleted = row["deleted"].as_bool().unwrap_or(false) as i32;
            match table {
                catalog::Table::Crates => {
                    sqlx::query!(
                        "INSERT INTO catalog_crates (id, data, deleted) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                        id,
                        d,
                        deleted
                    )
                    .execute(&mut *tx)
                    .await?
                }
                catalog::Table::Cards => {
                    sqlx::query!(
                        "INSERT INTO catalog_cards (id, data, deleted) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                        id,
                        d,
                        deleted
                    )
                    .execute(&mut *tx)
                    .await?
                }
            };
        }
    }
    tx.commit().await?;
    Ok(true)
}

/// Własne zdjęcia z repozytorium -> image_cache (tylko brakujące). Przy każdym starcie, bo na nowym serwerze baza bywa
/// przeniesiona ze starego zapisu (nie jest pusta), a folder ze zdjęciami jest pusty.
fn copy_custom_images(base: &Path, data_dir: &Path) -> anyhow::Result<()> {
    let src = base.join("custom_images");
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

/// catalog_export.json (zmiany z panelu admina, BEZ danych graczy) + custom_images/ (zdjęcia wgrane w panelu)
async fn export_catalog(pool: &PgPool, cfg: &Config) -> anyhow::Result<(usize, usize, usize)> {
    let parse = |d: &str| serde_json::from_str::<Value>(if d.is_empty() { "{}" } else { d }).unwrap_or(json!({}));
    let crates: Vec<Value> = sqlx::query!("SELECT id, data, deleted FROM catalog_crates ORDER BY id")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| json!({"id": r.id, "data": parse(&r.data), "deleted": r.deleted != 0}))
        .collect();
    let cards: Vec<Value> = sqlx::query!("SELECT id, data, deleted FROM catalog_cards ORDER BY id")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| json!({"id": r.id, "data": parse(&r.data), "deleted": r.deleted != 0}))
        .collect();
    let out = json!({"crates": crates, "cards": cards});
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, serde_json::ser::PrettyFormatter::with_indent(b" "));
    serde::Serialize::serialize(&out, &mut ser)?;
    std::fs::write(cfg.base_dir.join("catalog_export.json"), buf)?;

    // własne zdjęcia: karty bez artykułu w Wikipedii albo z wgranym plikiem (nie-JPG z Wikipedii)
    let images = Images::new(&cfg.data_dir);
    let dir = cfg.base_dir.join("custom_images");
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    let mut copied = 0;
    let copy = |path: &Path| -> anyhow::Result<()> {
        std::fs::copy(path, dir.join(path.file_name().unwrap_or_default()))?;
        Ok(())
    };
    for card in &cards {
        if card["deleted"].as_bool().unwrap_or(false) {
            continue;
        }
        let id = card["id"].as_str().unwrap_or_default();
        if let Some(path) = images.find(id, &Kind::Main) {
            let no_wiki = !crate::py::truthy(&card["data"]["wiki"]);
            if no_wiki || !path.to_string_lossy().to_lowercase().ends_with(".jpg") {
                copy(&path)?;
                copied += 1;
            }
        }
    }
    // zdjęcia wariantów przypisanych do kart (np. Rzulty) i własne zdjęcia wariantów z polem "photo" (np. Halloweenowa)
    let g = data::g();
    let mut all_ids: Vec<String> = g
        .crates
        .values()
        .flat_map(|c| c.people.iter().filter_map(|p| p["id"].as_str().map(str::to_owned)))
        .chain(cards.iter().filter_map(|c| c["id"].as_str().map(str::to_owned)))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    all_ids.sort();
    let mut done: HashMap<String, ()> = HashMap::new();
    for (v, info) in &g.variants {
        let pids: Vec<String> = if !info.cards.is_empty() {
            info.cards.clone()
        } else if info.photo {
            all_ids.clone()
        } else {
            vec![]
        };
        for pid in pids {
            if let Some(path) = images.find(&pid, &Kind::Variant(v.clone())) {
                if done.insert(path.to_string_lossy().into_owned(), ()).is_none() {
                    copy(&path)?;
                    copied += 1;
                }
            }
        }
    }
    Ok((crates.len(), cards.len(), copied))
}
