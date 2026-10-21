//! Arena (wersja testowa - tylko dla adminów): walki i wyzwania w pamięci procesu (restart serwera kończy trwające
//! walki). Jeden wspólny zamek na całą Arenę - ruchy w walkach liczą się po kolei.

pub mod engine;

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::db::now;
pub use engine::{Battle, DeckCard};

pub const CHALLENGE_SECONDS: f64 = 120.0; // wyzwanie bez odpowiedzi wygasa
pub const KEEP_FINISHED: f64 = 10.0 * 60.0; // zakończona walka zostaje w pamięci (wynik, nagrody) jeszcze 10 minut
pub const KEEP_IDLE: f64 = 30.0 * 60.0; // porzucona walka z komputerem znika po 30 minutach

pub struct Challenge {
    pub id: String,
    pub from: i64,
    pub to: i64,
    pub from_user: Value,
    pub to_user: Value,
    pub deck: Vec<DeckCard>,
    pub status: String,
    pub created: f64,
    pub battle: Option<String>,
}

impl Challenge {
    pub fn json(&self) -> Value {
        json!({"id": self.id, "from": self.from_user, "to": self.to_user, "status": self.status, "battle": self.battle,
               "left": ((CHALLENGE_SECONDS - (now() - self.created)).round_ties_even() as i64).max(0)})
    }
}

#[derive(Default)]
pub struct Arena {
    pub battles: IndexMap<String, Battle>,
    pub challenges: IndexMap<String, Challenge>,
}

#[derive(Default)]
pub struct ArenaState {
    pub inner: tokio::sync::Mutex<Arena>,
}

impl Arena {
    pub fn cleanup(&mut self) {
        let now = now();
        self.battles.retain(|_, b| {
            !((b.over.is_some() && now - b.finished_at.unwrap_or(now) > KEEP_FINISHED) || now - b.touched > KEEP_IDLE)
        });
        for c in self.challenges.values_mut() {
            if c.status == "pending" && now - c.created > CHALLENGE_SECONDS {
                c.status = "expired".into();
            }
        }
        self.challenges.retain(|_, c| now - c.created <= KEEP_FINISHED);
    }

    pub fn add_battle(&mut self, b: Battle) -> String {
        let id = b.id.clone();
        self.battles.insert(id.clone(), b);
        id
    }

    /// Trwająca walka gracza (najnowsza)
    pub fn active_battle(&self, user: i64) -> Option<String> {
        self.battles
            .values()
            .filter(|b| b.over.is_none() && b.side_of_user(user).is_some())
            .max_by(|a, b| a.created.total_cmp(&b.created))
            .map(|b| b.id.clone())
    }

    pub fn new_challenge(&mut self, from_user: Value, to_user: Value, deck: Vec<DeckCard>) -> String {
        self.cleanup();
        let from = from_user["id"].as_i64().unwrap_or(0);
        for c in self.challenges.values_mut() {
            if c.status == "pending" && c.from == from {
                c.status = "cancelled".into(); // nowe wyzwanie zastępuje poprzednie
            }
        }
        let c = Challenge {
            id: engine::token(),
            from,
            to: to_user["id"].as_i64().unwrap_or(0),
            from_user,
            to_user,
            deck,
            status: "pending".into(),
            created: now(),
            battle: None,
        };
        let id = c.id.clone();
        self.challenges.insert(id.clone(), c);
        id
    }

    /// (przychodzące wyzwania, moje ostatnie wyzwanie)
    pub fn challenges_for(&mut self, user: i64) -> (Vec<Value>, Option<Value>) {
        self.cleanup();
        let incoming = self.challenges.values().filter(|c| c.to == user && c.status == "pending").map(Challenge::json).collect();
        let outgoing = self
            .challenges
            .values()
            .filter(|c| c.from == user)
            .max_by(|a, b| a.created.total_cmp(&b.created))
            .map(Challenge::json);
        (incoming, outgoing)
    }
}
