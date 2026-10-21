//! Zachowanie jak w Pythonie przy czytaniu danych od przeglądarki: int(x), float(x), str(x), bool(x), napis[:n].

use serde_json::Value;

/// int(x): liczba (ułamek obcięty), napis z liczbą całkowitą, bool; inaczej None (TypeError/ValueError)
pub fn int(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f.trunc() as i64)),
        Value::String(s) => {
            let t = s.trim().replace('_', "");
            t.strip_prefix('+').unwrap_or(&t).parse::<i64>().ok().or_else(|| t.parse::<i64>().ok())
        }
        Value::Bool(b) => Some(*b as i64),
        _ => None,
    }
}

/// float(x)
pub fn float(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        Value::Bool(b) => Some(*b as i64 as f64),
        _ => None,
    }
}

/// bool(x) - prawdziwość jak w Pythonie
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// str(x)
pub fn str_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "None".into(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        other => other.to_string(),
    }
}

/// (x or "") - napis albo pusty, gdy fałszywe; nie-napisy jak str()
pub fn str_or_empty(v: Option<&Value>) -> String {
    match v {
        Some(v) if truthy(v) => str_of(v),
        _ => String::new(),
    }
}

/// napis[:n] (znaki, nie bajty)
pub fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// (body.get(key) or "").strip()[:n]
pub fn text(body: &Value, key: &str, n: usize) -> String {
    cut(str_or_empty(body.get(key)).trim(), n)
}

/// [int(i) for i in raw] - None, gdy któryś nie jest liczbą
pub fn int_list(v: Option<&Value>) -> Option<Vec<i64>> {
    match v {
        None | Some(Value::Null) => Some(vec![]),
        Some(Value::Array(a)) => a.iter().map(int).collect(),
        Some(Value::String(s)) => s.chars().map(|c| c.to_digit(10).map(i64::from)).collect(),
        Some(_) => None,
    }
}

/// int_ids(raw) z app.py: lista liczb albo [] przy błędzie
pub fn int_ids(v: Option<&Value>) -> Vec<i64> {
    match v {
        Some(v) if truthy(v) => int_list(Some(v)).unwrap_or_default(),
        _ => vec![],
    }
}

/// "12 345 gr" - fmt_money() z app.py
pub fn fmt_money(amount: i64) -> String {
    format!("{} gr", group(amount))
}

/// "+12 345 gr" / "-500 gr"
pub fn money_txt(amount: i64) -> String {
    format!("{}{} gr", if amount >= 0 { "+" } else { "" }, group(amount))
}

/// 1234567 -> "1 234 567"
pub fn group(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(' ');
        }
        out.push(ch);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn python_like() {
        assert_eq!(int(&json!("12")), Some(12));
        assert_eq!(int(&json!(" -3 ")), Some(-3));
        assert_eq!(int(&json!(2.9)), Some(2));
        assert_eq!(int(&json!("2.5")), None);
        assert_eq!(int(&json!(null)), None);
        assert_eq!(fmt_money(1234567), "1 234 567 gr");
        assert_eq!(money_txt(-500), "-500 gr");
        assert_eq!(money_txt(1000), "+1 000 gr");
        assert_eq!(cut("żółw", 2), "żó");
        assert!(!truthy(&json!(0)));
        assert!(truthy(&json!("0")));
    }
}
