//! Napisy dla gracza: obcinanie po znakach (limity pól z panelu i od graczy) i kwoty w groszach.

/// Obcięcie napisu do `n` znaków (nie bajtów - polskie litery i emoji zostają całe)
pub trait Truncate {
    fn truncate_chars(&self, n: usize) -> String;
}

impl Truncate for str {
    fn truncate_chars(&self, n: usize) -> String {
        self.chars().take(n).collect()
    }
}

/// Tekst od gracza: bez białych znaków na brzegach, najwyżej `n` znaków
pub fn clean(s: &str, n: usize) -> String {
    s.trim().truncate_chars(n)
}

/// 1234567 -> "1 234 567"
pub fn group_thousands(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if n < 0 {
        out.push('-');
    }
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(' ');
        }
        out.push(ch);
    }
    out
}

/// "12 345 gr"
pub fn fmt_money(amount: i64) -> String {
    format!("{} gr", group_thousands(amount))
}

/// "+12 345 gr" / "-500 gr" (dziennik adminów)
pub fn fmt_money_signed(amount: i64) -> String {
    format!("{}{}", if amount >= 0 { "+" } else { "" }, fmt_money(amount))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formatting() {
        assert_eq!(fmt_money(1_234_567), "1 234 567 gr");
        assert_eq!(fmt_money(999), "999 gr");
        assert_eq!(fmt_money_signed(-500), "-500 gr");
        assert_eq!(fmt_money_signed(1000), "+1 000 gr");
        assert_eq!("żółw".truncate_chars(2), "żó");
        assert_eq!(clean("  ala ma kota ", 6), "ala ma");
    }
}
