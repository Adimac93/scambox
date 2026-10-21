//! Błędy zapytań: {"error": "..."} z kodem HTTP (jak jsonify({"error": ...}), 400 w wersji Python).
//! Zwrócenie błędu porzuca transakcję (rollback) - jak bad() w app.py.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use serde_json::{json, Value};

#[derive(Debug)]
pub enum AppError {
    /// komunikat dla gracza
    Msg(StatusCode, String),
    /// własna odpowiedź JSON z kodem (np. 409 z danymi lobby)
    Json(StatusCode, Value),
    /// strona (nie API) - przekierowanie
    Redirect(String),
    /// pusta odpowiedź z kodem (np. 404 zdjęcia)
    Status(StatusCode),
    Internal(anyhow::Error),
}

pub type Res<T = Response> = Result<T, AppError>;

impl AppError {
    pub fn bad(msg: impl Into<String>) -> Self {
        AppError::Msg(StatusCode::BAD_REQUEST, msg.into())
    }
    pub fn code(code: u16, msg: impl Into<String>) -> Self {
        AppError::Msg(StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_REQUEST), msg.into())
    }
}

/// `return bad("...")` - błąd 400 z komunikatem
pub fn bad<T>(msg: impl Into<String>) -> Res<T> {
    Err(AppError::bad(msg))
}

/// błąd z kodem (403, 404, 429...)
pub fn bad_code<T>(msg: impl Into<String>, code: u16) -> Res<T> {
    Err(AppError::code(code, msg))
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::Msg(code, msg) => (code, Json(json!({ "error": msg }))).into_response(),
            AppError::Json(code, v) => (code, Json(v)).into_response(),
            AppError::Redirect(to) => Redirect::to(&to).into_response(),
            AppError::Status(code) => code.into_response(),
            AppError::Internal(e) => {
                tracing::error!("błąd serwera: {e:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Błąd serwera" }))).into_response()
            }
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Internal(e.into())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Internal(e)
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Internal(e.into())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.into())
    }
}
