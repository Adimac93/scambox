//! Adaptery `serde_with` dla danych, które przychodzą jako liczby albo napisy z liczbą
//! (formularze panelu admina, stare zapisy katalogu w bazie).
//!
//! Użycie: `#[serde_as(as = "Num")] price: i64`, `#[serde_as(as = "DefaultOnError<Num>")] hp: i64`.

use serde_with::{DisplayFromStr, PickFirst, Same};

/// Liczba albo napis z liczbą: `12` i `"12"`
pub type Num = PickFirst<(Same, DisplayFromStr)>;

/// Pole formularza: liczba albo tekst (pusty = nie podano). Sprawdzane w handlerze, z komunikatem dla admina.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(untagged)]
pub enum NumOrText {
    Num(f64),
    Text(String),
}

/// Pole formularza to nie liczba
#[derive(Debug, Clone, Copy)]
pub struct NotANumber;

impl NumOrText {
    /// None = puste pole; Err = to nie jest liczba
    pub fn number(&self) -> Result<Option<f64>, NotANumber> {
        match self {
            NumOrText::Num(n) => Ok(Some(*n)),
            NumOrText::Text(t) if t.trim().is_empty() => Ok(None),
            NumOrText::Text(t) => t.trim().parse().map(Some).map_err(|_| NotANumber),
        }
    }

    /// Liczba całkowita (napis "12.5" to błąd, jak int() z formularza)
    pub fn integer(&self) -> Result<Option<i64>, NotANumber> {
        match self {
            NumOrText::Num(n) => Ok(Some(n.trunc() as i64)),
            NumOrText::Text(t) if t.trim().is_empty() => Ok(None),
            NumOrText::Text(t) => t.trim().parse().map(Some).map_err(|_| NotANumber),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_with::{serde_as, DefaultOnError};

    use super::Num;

    #[serde_as]
    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct T {
        #[serde_as(as = "Num")]
        a: i64,
        #[serde_as(as = "DefaultOnError<Num>")]
        b: i64,
        #[serde_as(as = "Option<Num>")]
        c: Option<f64>,
    }

    #[test]
    fn numbers_or_strings() {
        let t: T = serde_json::from_str(r#"{"a": "12", "b": "zle", "c": "2.5"}"#).unwrap();
        assert_eq!((t.a, t.b, t.c), (12, 0, Some(2.5)));
        let t: T = serde_json::from_str(r#"{"a": 7}"#).unwrap();
        assert_eq!((t.a, t.b, t.c), (7, 0, None));
        assert!(serde_json::from_str::<T>(r#"{"a": "x"}"#).is_err());
    }
}
