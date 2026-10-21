//! Arena (wersja testowa - tylko dla adminów): walki i wyzwania w pamięci procesu (restart serwera kończy trwające
//! walki). Jeden wspólny zamek na całą Arenę - ruchy w walkach liczą się po kolei.

pub mod engine;
pub mod view;

use indexmap::IndexMap;
use serde::Serialize;

use crate::auth::UserView;
use crate::db::now;
pub use engine::{Battle, DeckCard, Mode, Side};

pub const CHALLENGE_SECONDS: f64 = 120.0; // wyzwanie bez odpowiedzi wygasa
pub const KEEP_FINISHED: f64 = 10.0 * 60.0; // zakończona walka zostaje w pamięci (wynik, nagrody) jeszcze 10 minut
pub const KEEP_IDLE: f64 = 30.0 * 60.0; // porzucona walka z komputerem znika po 30 minutach

/// Portret gracza w walce
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum Hero {
    Player(HeroUser),
    Bot { username: &'static str, bot: bool },
}

impl Hero {
    pub fn computer() -> Hero {
        Hero::Bot { username: "Komputer", bot: true }
    }
}

/// Gracz bez informacji, czy jest adminem
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeroUser {
    pub id: i64,
    pub username: String,
    pub avatar: String,
    pub avatar_card: Option<String>,
    pub avatar_rarity: Option<String>,
    pub avatar_variant: Option<String>,
}

impl From<UserView> for Hero {
    fn from(u: UserView) -> Hero {
        Hero::Player(HeroUser {
            id: u.id,
            username: u.username,
            avatar: u.avatar,
            avatar_card: u.avatar_card,
            avatar_rarity: u.avatar_rarity,
            avatar_variant: u.avatar_variant,
        })
    }
}

/// Dzienne nagrody za wygrane: ile wygranych dziś, skrzynka za tę walkę, progi nagród
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reward {
    pub wins: i64,
    pub chest: Option<String>,
    pub reward_wins: Vec<i64>,
    pub next: Option<i64>,
}

impl Reward {
    pub fn new(wins: i64, chest: Option<String>) -> Reward {
        let reward_wins = crate::data::g().arena.reward_wins.clone();
        let next = reward_wins.iter().copied().find(|w| *w > wins);
        Reward { wins, chest, reward_wins, next }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChallengeStatus {
    Pending,
    Accepted,
    Declined,
    Cancelled,
    Expired,
}

pub struct Challenge {
    pub id: String,
    pub from: i64,
    pub to: i64,
    pub from_user: Hero,
    pub to_user: Hero,
    pub deck: Vec<DeckCard>,
    pub status: ChallengeStatus,
    pub created: f64,
    pub battle: Option<String>,
}

#[derive(Serialize)]
pub struct ChallengeView<'a> {
    id: &'a str,
    from: &'a Hero,
    to: &'a Hero,
    status: ChallengeStatus,
    battle: Option<&'a str>,
    /// sekundy do wygaśnięcia
    left: i64,
}

impl Challenge {
    pub fn view(&self) -> ChallengeView<'_> {
        ChallengeView {
            id: &self.id,
            from: &self.from_user,
            to: &self.to_user,
            status: self.status,
            battle: self.battle.as_deref(),
            left: ((CHALLENGE_SECONDS - (now() - self.created)).round_ties_even() as i64).max(0),
        }
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
            let finished_long_ago = b.over.is_some() && now - b.finished_at.unwrap_or(now) > KEEP_FINISHED;
            !finished_long_ago && now - b.touched <= KEEP_IDLE
        });
        for c in self.challenges.values_mut() {
            if c.status == ChallengeStatus::Pending && now - c.created > CHALLENGE_SECONDS {
                c.status = ChallengeStatus::Expired;
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
    pub fn active_battle(&self, user: i64) -> Option<&Battle> {
        self.battles
            .values()
            .filter(|b| b.over.is_none() && b.side_of_user(user).is_some())
            .max_by(|a, b| a.created.total_cmp(&b.created))
    }

    pub fn new_challenge(&mut self, from: i64, to: i64, from_user: Hero, to_user: Hero, deck: Vec<DeckCard>) -> &Challenge {
        self.cleanup();
        for c in self.challenges.values_mut().filter(|c| c.status == ChallengeStatus::Pending && c.from == from) {
            c.status = ChallengeStatus::Cancelled; // nowe wyzwanie zastępuje poprzednie
        }
        let c = Challenge {
            id: engine::token(),
            from,
            to,
            from_user,
            to_user,
            deck,
            status: ChallengeStatus::Pending,
            created: now(),
            battle: None,
        };
        let id = c.id.clone();
        self.challenges.entry(id).or_insert(c)
    }

    /// (przychodzące wyzwania, moje ostatnie wyzwanie)
    pub fn challenges_for(&mut self, user: i64) -> (Vec<ChallengeView<'_>>, Option<ChallengeView<'_>>) {
        self.cleanup();
        let incoming = self
            .challenges
            .values()
            .filter(|c| c.to == user && c.status == ChallengeStatus::Pending)
            .map(Challenge::view)
            .collect();
        let outgoing = self
            .challenges
            .values()
            .filter(|c| c.from == user)
            .max_by(|a, b| a.created.total_cmp(&b.created))
            .map(Challenge::view);
        (incoming, outgoing)
    }
}
