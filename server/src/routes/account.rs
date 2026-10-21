//! Konta: rejestracja, logowanie, wylogowanie, zmiana hasła.

use std::net::SocketAddr;
use std::sync::LazyLock;
use std::time::Duration;

use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use axum_extra::extract::cookie::SignedCookieJar;
use regex::Regex;
use serde::Deserialize;
use serde_json::json;

use super::{ok, JsonBody};
use crate::auth::{
    check_password_async, clear_session, client_ip, find_user, hash_password_async, password_error, session_cookie, Me,
    MIN_PASSWORD,
};
use crate::data::g;
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, fail, Res};
use crate::game::ensure_state;
use crate::state::AppState;

static USERNAME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,20}$").unwrap());

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Credentials {
    username: String,
    password: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct PasswordChange {
    old: String,
    new: String,
}

/// Pierwsze konto przejmuje zapis gry sprzed wprowadzenia kont
async fn adopt_legacy_save(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    sqlx::query!("UPDATE items SET user_id = $1 WHERE user_id IS NULL", uid).execute(&mut *c).await?;
    sqlx::query!(
        "INSERT INTO user_state (user_id, key, value) SELECT $1, key, value FROM state
         ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value",
        uid
    )
    .execute(&mut *c)
    .await?;
    sqlx::query!(
        "INSERT INTO user_discovered (user_id, person_id) SELECT $1, person_id FROM discovered ON CONFLICT DO NOTHING",
        uid
    )
    .execute(&mut *c)
    .await?;
    sqlx::query!("DELETE FROM state").execute(&mut *c).await?;
    sqlx::query!("DELETE FROM discovered").execute(c).await?;
    Ok(())
}

pub async fn register(State(st): State<AppState>, jar: SignedCookieJar, JsonBody(body): JsonBody<Credentials>) -> Res {
    let name = body.username.trim();
    if !USERNAME_RE.is_match(name) {
        return bad("Nazwa: 3–20 znaków (litery, cyfry, _ . -)");
    }
    if body.password.chars().count() < MIN_PASSWORD {
        return bad(password_error());
    }
    let hash = hash_password_async(body.password).await;
    let mut tx = st.db.begin().await?;
    if find_user(&mut tx, name).await?.is_some() {
        return bad("Ta nazwa jest już zajęta");
    }
    let first = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "n!" FROM users"#).fetch_one(&mut *tx).await? == 0;
    let new_id = sqlx::query_scalar!(
        "INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
        name,
        hash,
        i32::from(first),
        now()
    )
    .fetch_one(&mut *tx)
    .await?;
    if first {
        adopt_legacy_save(&mut tx, new_id).await?;
    }
    ensure_state(&mut tx, new_id).await?;
    // nowy gracz nie musi czytać starych list zmian - zobaczy dopiero następną aktualizację
    sqlx::query!("UPDATE user_state SET value = $1 WHERE user_id = $2 AND key = 'patch_seen'", g().patch_version(), new_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let jar = jar.add(session_cookie(new_id, st.cfg.cookie_secure));
    Ok((jar, Json(json!({"ok": true, "first": first}))).into_response())
}

pub async fn login(
    State(st): State<AppState>,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: SignedCookieJar,
    JsonBody(body): JsonBody<Credentials>,
) -> Res {
    let name = body.username.trim();
    let ip = client_ip(&st, &headers, Some(&addr));
    let wait = st.login.blocked(name, &ip);
    if wait > 0 {
        let msg = format!("Za dużo nieudanych prób logowania. Spróbuj ponownie za {} min.", wait / 60 + 1);
        return fail(StatusCode::TOO_MANY_REQUESTS, msg);
    }
    let mut c = st.db.acquire().await?;
    let user = find_user(&mut c, name).await?;
    let ok = match &user {
        Some(u) => check_password_async(u.password_hash.clone(), body.password).await,
        None => false,
    };
    let Some(user) = user.filter(|_| ok) else {
        st.login.note(name, &ip, false);
        metrics::counter!("scambox_login_failures_total").increment(1);
        tokio::time::sleep(Duration::from_millis(400)).await;
        return bad("Zła nazwa użytkownika lub hasło");
    };
    st.login.note(name, &ip, true);
    if user.banned != 0 {
        let reason = if user.ban_reason.is_empty() { String::new() } else { format!(" Powód: {}", user.ban_reason) };
        return fail(StatusCode::FORBIDDEN, format!("To konto zostało zablokowane przez admina.{reason}"));
    }
    ensure_state(&mut c, user.id).await?;
    let jar = jar.add(session_cookie(user.id, st.cfg.cookie_secure));
    Ok((jar, Json(json!({"ok": true}))).into_response())
}

pub async fn logout(jar: SignedCookieJar) -> impl IntoResponse {
    (clear_session(jar), Json(json!({"ok": true})))
}

pub async fn change_password(
    State(st): State<AppState>,
    Me(me): Me,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    JsonBody(body): JsonBody<PasswordChange>,
) -> Res {
    let ip = client_ip(&st, &headers, Some(&addr));
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if st.login.blocked(&me.username, &ip) > 0 {
        return fail(StatusCode::TOO_MANY_REQUESTS, "Za dużo nieudanych prób. Spróbuj ponownie za kilka minut.");
    }
    if !check_password_async(me.password_hash.clone(), body.old).await {
        st.login.note(&me.username, &ip, false);
        return bad("Obecne hasło jest nieprawidłowe");
    }
    if body.new.chars().count() < MIN_PASSWORD {
        return bad(format!("Nowe hasło musi mieć co najmniej {MIN_PASSWORD} znaków"));
    }
    let hash = hash_password_async(body.new).await;
    sqlx::query!("UPDATE users SET password_hash = $1 WHERE id = $2", hash, me.id).execute(&mut *tx).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}
