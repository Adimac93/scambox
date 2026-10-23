//! PostgreSQL: pula połączeń, schemat przy starcie, blokowanie graczy (lock_me).

use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{PgConnection, PgPool};

use crate::config::Config;

pub type Conn = PgConnection;

pub const SCHEMA: &str = include_str!("../schema.sql");

/// Czas jak time.time() w Pythonie (sekundy, z ułamkiem) - tak są zapisane czasy w bazie
pub fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

pub async fn connect(cfg: &Config) -> anyhow::Result<PgPool> {
    let opts: PgConnectOptions = cfg.database_url.parse()?;
    let schema = cfg.db_schema.clone();
    let pool = PgPoolOptions::new()
        .max_connections(cfg.pool_size)
        .min_connections(1)
        .test_before_acquire(true) // zerwane połączenia (restart serwera bazy)
        .after_connect(move |conn, _meta| {
            let schema = schema.clone();
            Box::pin(async move {
                // tabele gry w schemacie DB_SCHEMA (jeśli ustawiony) - nazwa sprawdzona w Config::load
                if let Some(s) = schema {
                    sqlx::raw_sql(sqlx::AssertSqlSafe(format!("CREATE SCHEMA IF NOT EXISTS {s}; SET search_path TO {s}")))
                        .execute(&mut *conn)
                        .await?;
                }
                Ok(())
            })
        })
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(opts)
        .await
        .map_err(|e| anyhow::anyhow!("Brak połączenia z bazą ({}): {e}", cfg.describe_db()))?;
    Ok(pool)
}

pub async fn init_schema(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::raw_sql(SCHEMA).execute(pool).await?;
    Ok(())
}

/// Blokuje graczy do końca transakcji - dwa równoległe zapytania tego samego gracza (np. szybkie podwójne
/// kliknięcie) nie wydadzą tych samych pieniędzy ani kart dwa razy. Zawsze w kolejności rosnących id,
/// żeby dwie wymiany się nie zakleszczyły.
pub async fn lock_users(c: &mut Conn, ids: &[Option<i64>]) -> sqlx::Result<()> {
    let mut ids: Vec<i64> = ids.iter().flatten().copied().collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Ok(());
    }
    sqlx::query_scalar!("SELECT id FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE", &ids).fetch_all(c).await?;
    Ok(())
}

/// Na początku zapytań, które sprawdzają stan gracza i potem go zmieniają (pieniądze, karty, skrzynki)
pub async fn lock_me(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    lock_users(c, &[Some(uid)]).await
}

