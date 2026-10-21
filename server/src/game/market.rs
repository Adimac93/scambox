//! Rynek: rozliczanie licytacji i porzuconych lobby jackpota (settle_market), zwroty pieniędzy z ofert.
//! Karta wystawiona na rynek należy do ESCROW, aż transakcja się skończy; pieniądze z ofert kupna, licytacji
//! i zleceń "Szukam" są od razu zabierane kupującemu (i oddawane, gdy oferta przepada).

use sqlx::PgPool;

use crate::catalog::Catalog;
use crate::data::g;
use crate::db::{now, Conn};
use crate::game::{add_state, give_items};

#[derive(Debug, Clone)]
pub struct Listing {
    pub id: i64,
    pub seller_id: i64,
    pub item_id: i64,
    pub person_id: String,
    pub variant: String,
    pub kind: String,
    pub price: i64,
    pub step: i64,
    pub status: String,
    pub buyer_id: Option<i64>,
    pub final_price: i64,
    pub created_at: f64,
    pub ends_at: Option<f64>,
    pub updated_at: f64,
}

// wiersz tabeli (SELECT *) - nie wszystkie kolumny są używane
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct Bid {
    pub id: i64,
    pub listing_id: i64,
    pub bidder_id: i64,
    pub amount: i64,
    pub status: String,
    pub created_at: f64,
    pub updated_at: f64,
}

// wiersz tabeli (SELECT *) - nie wszystkie kolumny są używane
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct Offer {
    pub id: i64,
    pub listing_id: i64,
    pub buyer_id: i64,
    pub price: i64,
    pub status: String,
    pub created_at: f64,
    pub updated_at: f64,
}

pub fn after_fee(price: i64) -> i64 {
    price - (price as f64 * g().market.fee) as i64
}

pub async fn get_listing(c: &mut Conn, lid: i64) -> sqlx::Result<Option<Listing>> {
    sqlx::query_as!(Listing, "SELECT * FROM market_listings WHERE id = $1", lid).fetch_optional(c).await
}

/// Warunek dodatkowy dla claim_listing
pub enum Claim {
    Any,
    Fixed,
    AuctionOpen(f64),
    Ended(f64),
    Seller(i64),
}

/// Blokuje ofertę do końca transakcji (blokada wiersza). Świeży wiersz albo None, jeśli oferta nie jest już aktywna
/// (albo nie spełnia warunku).
pub async fn claim_listing(c: &mut Conn, lid: i64, cond: Claim) -> sqlx::Result<Option<Listing>> {
    let t = now();
    let q = match cond {
        Claim::Any => sqlx::query!("UPDATE market_listings SET updated_at = $1 WHERE id = $2 AND status = 'active'", t, lid)
            .execute(&mut *c)
            .await?,
        Claim::Fixed => sqlx::query!(
            "UPDATE market_listings SET updated_at = $1 WHERE id = $2 AND status = 'active' AND kind = 'fixed'",
            t,
            lid
        )
        .execute(&mut *c)
        .await?,
        Claim::AuctionOpen(at) => sqlx::query!(
            "UPDATE market_listings SET updated_at = $1 WHERE id = $2 AND status = 'active' AND kind = 'auction' AND ends_at > $3",
            t,
            lid,
            at
        )
        .execute(&mut *c)
        .await?,
        Claim::Ended(at) => sqlx::query!(
            "UPDATE market_listings SET updated_at = $1 WHERE id = $2 AND status = 'active' AND ends_at <= $3",
            t,
            lid,
            at
        )
        .execute(&mut *c)
        .await?,
        Claim::Seller(uid) => sqlx::query!(
            "UPDATE market_listings SET updated_at = $1 WHERE id = $2 AND status = 'active' AND seller_id = $3",
            t,
            lid,
            uid
        )
        .execute(&mut *c)
        .await?,
    };
    if q.rows_affected() == 0 {
        return Ok(None);
    }
    get_listing(c, lid).await
}

pub async fn top_bid(c: &mut Conn, lid: i64) -> sqlx::Result<Option<Bid>> {
    sqlx::query_as!(
        Bid,
        "SELECT * FROM market_bids WHERE listing_id = $1 AND status = 'active' ORDER BY amount DESC, id LIMIT 1",
        lid
    )
    .fetch_optional(c)
    .await
}

/// Propozycje cen do tej oferty przepadają - pieniądze wracają do kupujących
pub async fn refund_offers(c: &mut Conn, lid: i64, now: f64, status: &str) -> sqlx::Result<()> {
    let offers = sqlx::query_as!(Offer, "SELECT * FROM market_offers WHERE listing_id = $1 AND status = 'pending'", lid)
        .fetch_all(&mut *c)
        .await?;
    for o in offers {
        let r = sqlx::query!(
            "UPDATE market_offers SET status = $1, updated_at = $2 WHERE id = $3 AND status = 'pending'",
            status,
            now,
            o.id
        )
        .execute(&mut *c)
        .await?;
        if r.rows_affected() > 0 {
            add_state(c, o.buyer_id, "balance", o.price).await?;
        }
    }
    Ok(())
}

/// Koniec licytacji i porzucone lobby jackpota. Nie ma osobnego zegara - sprawdzamy przy zapytaniach graczy
/// (rynek, kasyno i /api/me, które każdy otwarty ekran gry odpytuje co 30 s). Osobna transakcja.
pub async fn settle_market(pool: &PgPool, cat: &Catalog) -> sqlx::Result<()> {
    let now = now();
    let mut tx = pool.begin().await?;
    let ended =
        sqlx::query_scalar!("SELECT id FROM market_listings WHERE status = 'active' AND kind = 'auction' AND ends_at <= $1", now)
            .fetch_all(&mut *tx)
            .await?;
    let old = sqlx::query_scalar!(
        "SELECT id FROM jackpots WHERE status = 'open' AND COALESCE(updated_at, created_at) <= $1",
        now - g().jackpot.expire_hours * 3600.0
    )
    .fetch_all(&mut *tx)
    .await?;
    if ended.is_empty() && old.is_empty() {
        return Ok(());
    }
    for lid in ended {
        let Some(l) = claim_listing(&mut tx, lid, Claim::Ended(now)).await? else { continue };
        if let Some(top) = top_bid(&mut tx, lid).await? {
            // karta dla najwyższej oferty, pieniądze dla sprzedającego
            sqlx::query!(
                "UPDATE market_listings SET status = 'sold', buyer_id = $1, final_price = $2, updated_at = $3 WHERE id = $4",
                top.bidder_id,
                top.amount,
                now,
                lid
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query!("UPDATE market_bids SET status = 'won', updated_at = $1 WHERE id = $2", now, top.id)
                .execute(&mut *tx)
                .await?;
            give_items(&mut tx, cat, &[l.item_id], top.bidder_id, "transfer").await?;
            add_state(&mut tx, l.seller_id, "balance", after_fee(top.amount)).await?;
            metrics::counter!("scambox_market_trades_total", "kind" => "auction").increment(1);
        } else {
            // nikt nie licytował - karta wraca
            sqlx::query!("UPDATE market_listings SET status = 'expired', updated_at = $1 WHERE id = $2", now, lid)
                .execute(&mut *tx)
                .await?;
            give_items(&mut tx, cat, &[l.item_id], l.seller_id, "transfer").await?;
        }
    }
    for jid in old {
        // karty w lobby nie są blokowane - wystarczy zamknąć lobby
        sqlx::query!("UPDATE jackpots SET status = 'expired', finished_at = $1 WHERE id = $2 AND status = 'open'", now, jid)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await
}

/// Znaczek na zakładce Rynek: propozycje cen do moich ofert + nowości od ostatniej wizyty
pub async fn market_badge(c: &mut Conn, me: i64, seen: i64) -> sqlx::Result<i64> {
    let seen = seen as f64;
    let n = sqlx::query_scalar!(
        r#"SELECT (SELECT COUNT(*) FROM market_offers o JOIN market_listings l ON l.id = o.listing_id 
                 WHERE l.seller_id = $1 AND l.status = 'active' AND o.status = 'pending') 
              + (SELECT COUNT(*) FROM market_listings WHERE status IN ('sold', 'expired') AND updated_at > $2 
                 AND (seller_id = $1 OR buyer_id = $1)) 
              + (SELECT COUNT(*) FROM market_wanted WHERE status = 'filled' AND buyer_id = $1 AND updated_at > $2) 
              + (SELECT COUNT(*) FROM market_offers WHERE buyer_id = $1 AND status IN ('declined', 'lost') AND updated_at > $2) 
              + (SELECT COUNT(*) FROM market_bids WHERE bidder_id = $1 AND status = 'outbid' AND updated_at > $2) AS "n!""#,
        me,
        seen
    )
    .fetch_one(c)
    .await?;
    Ok(n)
}
