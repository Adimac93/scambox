//! Stałe zbiory wartości gry jako typy: rzadkości, rodzaje zdolności, cele i efekty w Arenie, źródła kart,
//! rodzaje skrzynek, klucze stanu gracza. Napisy (w bazie, w JSON-ie, w data/game.json) - przez serde / strum.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_with::{DeserializeFromStr, SerializeDisplay};
use strum::{AsRefStr, Display, EnumIter, EnumString, IntoStaticStr};

use crate::ids::CrateId;

/// Rzadkość karty - od najpospolitszej do najrzadszej (kolejność deklaracji = kolejność w grze)
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    AsRefStr,
    EnumString,
    EnumIter,
    Display,
    IntoStaticStr,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum Rarity {
    Green,
    Uncommon,
    Blue,
    Purple,
    Red,
    Gold,
    /// karty specjalne: tylko z kasyna albo z linku, zawsze w jednym wariancie
    Special,
    Ultra,
    Secret,
}

/// Rodzaj zdolności: co znaczy jej wartość
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, AsRefStr, EnumString)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum AbilityKind {
    /// obrażenia
    #[default]
    Off,
    /// osłona
    Def,
    /// leczone HP
    Heal,
    /// monety w Arenie
    Eco,
}

/// Cel zdolności w Arenie
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, AsRefStr, EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Target {
    Enemy,
    AllEnemies,
    #[serde(rename = "self")]
    #[strum(serialize = "self")]
    Me,
    Ally,
    AllAllies,
}

impl Target {
    /// cel wybierany przez gracza
    pub fn chosen(self) -> bool {
        matches!(self, Target::Enemy | Target::Ally)
    }
}

/// Cel efektu zdolności
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, AsRefStr, EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EffectTarget {
    /// ten sam co cel zdolności
    #[default]
    Target,
    #[serde(rename = "self")]
    #[strum(serialize = "self")]
    Me,
    AllAllies,
    AllEnemies,
    RandomEnemy,
}

/// Efekt zdolności (i stan karty w walce)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, AsRefStr, EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EffectId {
    Burn,
    Poison,
    Stun,
    Shield,
    Heal,
    Taunt,
    Boost,
    Weaken,
    Lifesteal,
    Splash,
    StealCoins,
    ExtraAction,
    Knockback,
}

/// Skąd gracz dostaje kartę specjalną
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, AsRefStr, EnumString)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum CardSource {
    /// szansa przy wygranej w kasynie
    #[default]
    Casino,
    /// link od admina
    Link,
}

/// Skrzynka z pieniędzmi
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, AsRefStr, EnumString, Display)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum MoneyChest {
    /// codzienna nagroda
    Daily,
    /// 7. dzień serii logowań
    Mega,
}

/// Skrzynka w ekwipunku gracza: z kartami albo z pieniędzmi ("money_daily")
#[derive(Debug, Clone, PartialEq, Eq, Hash, SerializeDisplay, DeserializeFromStr)]
pub enum ChestKind {
    Crate(CrateId),
    Money(MoneyChest),
}

impl fmt::Display for ChestKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChestKind::Crate(id) => id.fmt(f),
            ChestKind::Money(m) => write!(f, "money_{m}"),
        }
    }
}

impl FromStr for ChestKind {
    type Err = strum::ParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.strip_prefix("money_") {
            Some(m) => m.parse().map(ChestKind::Money),
            None => Ok(ChestKind::Crate(CrateId::new(s))),
        }
    }
}

/// Skąd gracz ma kartę (klaser, Hall of Fame)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type, AsRefStr)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum ItemSource {
    /// ze skrzynki
    Drop,
    Contract,
    Upgrade,
    /// karta specjalna z kasyna
    Joker,
    /// karta specjalna z linku od admina
    Link,
    /// zwykła wygrana w kasynie (bez Hall of Fame)
    Casino,
    /// rynek, jackpot
    Transfer,
    /// wymiana ze znajomym
    Trade,
}

impl ItemSource {
    /// liczy się do Hall of Fame
    pub fn counts_for_fame(self) -> bool {
        matches!(self, ItemSource::Drop | ItemSource::Contract | ItemSource::Upgrade | ItemSource::Joker | ItemSource::Link)
    }
}

/// Wpis w aktywności znajomych
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type, AsRefStr)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum FeedKind {
    Drop,
    Contract,
    Upgrade,
    Joker,
    Link,
    Casino,
    Blackjack,
    /// karta pokazana znajomym
    Show,
}

macro_rules! player_state {
    ($($key:ident => $field:ident),* $(,)?) => {
        /// Licznik w stanie gracza (tabela user_state)
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsRefStr, EnumString, EnumIter)]
        #[strum(serialize_all = "snake_case")]
        pub enum StateKey {
            $($key),*
        }

        /// Stan gracza: saldo i liczniki
        #[derive(Debug, Clone, Serialize)]
        pub struct PlayerState {
            $(pub $field: i64),*
        }

        impl PlayerState {
            pub fn get(&self, key: StateKey) -> i64 {
                match key {
                    $(StateKey::$key => self.$field),*
                }
            }

            pub fn set(&mut self, key: StateKey, value: i64) {
                match key {
                    $(StateKey::$key => self.$field = value),*
                }
            }
        }
    };
}

player_state! {
    Balance => balance,
    Opened => opened,
    Spent => spent,
    Earned => earned,
    Deposited => deposited,
    Contracts => contracts,
    UpgradesWon => upgrades_won,
    UpgradesLost => upgrades_lost,
    FeedSeen => feed_seen,
    DailyTotal => daily_total,
    // ostatnia obejrzana lista zmian
    PatchSeen => patch_seen,
    // kiedy gracz ostatnio oglądał rynek
    MarketSeen => market_seen,
    // koniec (ms) ostatniej gry w jackpot, której wynik gracz już widział
    JackpotSeen => jackpot_seen,
}

impl StateKey {
    /// wartość dla nowego gracza
    pub fn default_value(self, starting_balance: i64) -> i64 {
        if self == StateKey::Balance {
            starting_balance
        } else {
            0
        }
    }
}

impl PlayerState {
    pub fn new(starting_balance: i64) -> PlayerState {
        let mut st = PlayerState {
            balance: 0,
            opened: 0,
            spent: 0,
            earned: 0,
            deposited: 0,
            contracts: 0,
            upgrades_won: 0,
            upgrades_lost: 0,
            feed_seen: 0,
            daily_total: 0,
            patch_seen: 0,
            market_seen: 0,
            jackpot_seen: 0,
        };
        st.balance = starting_balance;
        st
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(Rarity::Secret > Rarity::Gold && Rarity::Special < Rarity::Ultra);
        assert_eq!(Rarity::Uncommon.as_ref(), "uncommon");
        assert_eq!("money_daily".parse::<ChestKind>().unwrap(), ChestKind::Money(MoneyChest::Daily));
        assert_eq!("pl".parse::<ChestKind>().unwrap(), ChestKind::Crate(CrateId::new("pl")));
        assert!("money_gold".parse::<ChestKind>().is_err());
        assert_eq!(ChestKind::Money(MoneyChest::Mega).to_string(), "money_mega");
        assert_eq!(serde_json::to_string(&Target::Me).unwrap(), "\"self\"");
        assert_eq!("steal_coins".parse::<EffectId>().unwrap(), EffectId::StealCoins);
        assert_eq!(StateKey::UpgradesWon.as_ref(), "upgrades_won");
        let st = serde_json::to_value(PlayerState::new(20_000)).unwrap();
        assert_eq!((st["balance"].as_i64(), st["jackpot_seen"].as_i64()), (Some(20_000), Some(0)));
    }
}
