//! Identyfikatory jako osobne typy - id gracza nie da się pomylić z id karty, oferty czy lobby.
//! W bazie i w JSON-ie wyglądają jak zwykłe liczby / napisy (`transparent`).

use std::borrow::Borrow;
use std::fmt;

use serde::{Deserialize, Serialize};

macro_rules! int_id {
    ($($(#[$doc:meta])* $name:ident),* $(,)?) => {$(
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, sqlx::Type)]
        #[sqlx(transparent)]
        #[serde(transparent)]
        pub struct $name(pub i64);

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    )*};
}

macro_rules! str_id {
    ($($(#[$doc:meta])* $name:ident),* $(,)?) => {$(
        $(#[$doc])*
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, sqlx::Type)]
        #[sqlx(transparent)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(id: impl Into<String>) -> Self {
                Self(id.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        /// pozwala szukać w `IndexMap<Id, _>` po `&str`
        impl Borrow<str> for $name {
            fn borrow(&self) -> &str {
                &self.0
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl PartialEq<str> for $name {
            fn eq(&self, other: &str) -> bool {
                self.0 == other
            }
        }

        impl PartialEq<&str> for $name {
            fn eq(&self, other: &&str) -> bool {
                self.0 == *other
            }
        }
    )*};
}

int_id!(
    /// Gracz
    UserId,
    /// Karta gracza (wiersz items)
    ItemId,
    /// Oferta na rynku
    ListingId,
    /// Propozycja niższej ceny
    OfferId,
    /// Zlecenie "Szukam"
    WantedId,
    /// Wymiana między znajomymi
    TradeId,
    /// Lobby jackpota
    JackpotId,
    /// Link do karty specjalnej
    LinkId,
    /// Wiadomość od adminów
    MessageId,
);

str_id!(
    /// Osoba z karty (np. "pl_walesa")
    PersonId,
    /// Skrzynka (np. "pl", "halloween")
    CrateId,
    /// Wariant karty (np. "gold", "flag+gold")
    VariantId,
    /// Kategoria karty (np. "sport")
    TypeId,
);

impl UserId {
    /// "Właściciel" kart wystawionych na rynek / postawionych w blackjacku (czekają na koniec transakcji)
    pub const ESCROW: UserId = UserId(0);
}

impl VariantId {
    pub fn normal() -> VariantId {
        VariantId::new("normal")
    }

    pub fn is_normal(&self) -> bool {
        self.0 == "normal"
    }

    /// Wariant-warstwa (flaga) + zwykły wariant: "flag" + "gold" -> "flag+gold" (+ zwykła = sama flaga)
    pub fn combine(layer: &VariantId, base: &VariantId) -> VariantId {
        if base.is_normal() {
            layer.clone()
        } else {
            VariantId(format!("{layer}+{base}"))
        }
    }

    /// Części połączonego wariantu ("flag+gold" -> "flag", "gold")
    pub fn parts(&self) -> impl Iterator<Item = &str> {
        self.0.split('+')
    }
}

impl Default for VariantId {
    fn default() -> Self {
        VariantId::normal()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;

    #[test]
    fn ids_are_transparent() {
        assert_eq!(serde_json::to_string(&UserId(7)).unwrap(), "7");
        assert_eq!(serde_json::from_str::<ItemId>("12").unwrap(), ItemId(12));
        assert_eq!(serde_json::to_string(&PersonId::new("pl_x")).unwrap(), "\"pl_x\"");
        let mut m: IndexMap<PersonId, i32> = IndexMap::new();
        m.insert(PersonId::new("pl_x"), 1);
        assert_eq!(m.get("pl_x"), Some(&1));
        let gold = VariantId::new("gold");
        assert_eq!(VariantId::combine(&VariantId::new("flag"), &gold), "flag+gold");
        assert_eq!(VariantId::combine(&VariantId::new("flag"), &VariantId::normal()), "flag");
    }
}
