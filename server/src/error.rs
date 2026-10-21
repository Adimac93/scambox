//! Błędy zapytań. Komunikat dla gracza trafia do przeglądarki jako `{"error": "..."}` z kodem HTTP.
//! Zwrócenie błędu z handlera porzuca otwartą transakcję (rollback).

use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use serde_json::{json, Value};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// komunikat dla gracza (400, 403, 404, 429...)
    #[error("{1}")]
    Msg(StatusCode, String),
    /// własna odpowiedź JSON z kodem (np. 409 z danymi lobby)
    #[error("odpowiedź {0}")]
    Json(StatusCode, Value),
    /// strona (nie API) - przekierowanie
    #[error("przekierowanie do {0}")]
    Redirect(String),
    /// pusta odpowiedź z kodem (np. 404 zdjęcia)
    #[error("kod {0}")]
    Status(StatusCode),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub type Res<T = Response> = Result<T, AppError>;

impl AppError {
    /// 400 z komunikatem dla gracza
    pub fn bad(msg: impl Into<String>) -> Self {
        AppError::Msg(StatusCode::BAD_REQUEST, msg.into())
    }

    pub fn with_status(status: StatusCode, msg: impl Into<String>) -> Self {
        AppError::Msg(status, msg.into())
    }

    pub fn not_found() -> Self {
        AppError::Status(StatusCode::NOT_FOUND)
    }
}

/// `return bad("...")` - błąd 400 z komunikatem
pub fn bad<T>(msg: impl Into<String>) -> Res<T> {
    Err(AppError::bad(msg))
}

/// `return fail(StatusCode::FORBIDDEN, "...")` - błąd z innym kodem
pub fn fail<T>(status: StatusCode, msg: impl Into<String>) -> Res<T> {
    Err(AppError::with_status(status, msg))
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::Msg(status, msg) => (status, Json(json!({ "error": msg }))).into_response(),
            AppError::Json(status, v) => (status, Json(v)).into_response(),
            AppError::Redirect(to) => Redirect::to(&to).into_response(),
            AppError::Status(status) => status.into_response(),
            AppError::Db(e) => internal(&e),
            AppError::Internal(e) => internal(&*e),
        }
    }
}

fn internal(e: &dyn std::fmt::Display) -> Response {
    tracing::error!("błąd serwera: {e:#}");
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Błąd serwera" }))).into_response()
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Internal(e.into())
    }
}
