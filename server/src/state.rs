//! Wspólny stan serwera (pula bazy, katalog w pamięci, szablony, zdjęcia, Arena, limit logowań).

use std::sync::Arc;

use arc_swap::ArcSwap;
use axum_extra::extract::cookie::Key;
use sqlx::PgPool;

use crate::arena::ArenaState;
use crate::auth::Limiter;
use crate::catalog::Catalog;
use crate::config::Config;
use crate::images::Images;
use crate::web::Templates;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub cfg: Arc<Config>,
    pub catalog: Arc<ArcSwap<Catalog>>,
    pub templates: Arc<Templates>,
    pub images: Arc<Images>,
    pub arena: Arc<ArenaState>,
    pub login: Limiter,
    pub cookie_key: Key,
}

impl AppState {
    /// Aktualny katalog (migawka na czas zapytania)
    pub fn cat(&self) -> Arc<Catalog> {
        self.catalog.load_full()
    }

    /// Katalog od nowa (po zmianie w panelu admina)
    pub async fn refresh_catalog(&self) -> anyhow::Result<()> {
        let mut c = self.db.acquire().await?;
        let cat = crate::catalog::load(&mut c).await?;
        self.catalog.store(Arc::new(cat));
        Ok(())
    }
}
