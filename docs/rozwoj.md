# Zmiany w kodzie serwera Rust

Opis plików: [`server/README.md`](../server/README.md). Zasady skrótem także w `CLAUDE.md`.

## Zapytania do bazy

Wszystkie zapytania przez makra `sqlx::query!` / `query_as!` / `query_scalar!` - kompilator sprawdza SQL
(tabele, kolumny, typy) z prawdziwym schematem.

- Zwykłe budowanie korzysta z zapisanych sprawdzeń w `server/.sqlx/` (`SQLX_OFFLINE=true` w `.env`) - baza
  niepotrzebna.
- **Po zmianie lub dodaniu zapytania:**
  1. w `.env`: `SQLX_OFFLINE=false` i `DATABASE_URL` do bazy z aktualnym schematem (np. `scambox_dev`
     - schemat tworzy sam serwer przy starcie albo `psql -d scambox_dev < server/schema.sql`),
  2. `cargo build` (błędy SQL wychodzą jako błędy kompilacji),
  3. `cargo sqlx prepare` (narzędzie: `cargo install sqlx-cli`; na NixOS `nixpkgs#sqlx-cli`),
  4. commit razem z `server/.sqlx/`,
  5. z powrotem `SQLX_OFFLINE=true`.
- Typy: `COUNT(*)` i wyrażenia wymagają `AS "n!"` (nie-null). Kolumny bez `NOT NULL` są `Option<...>`.
- Zapytanie zmieniające stan gracza (pieniądze, karty, skrzynki): transakcja i `db::lock_me(&mut tx, uid)` na
  początku - inaczej podwójne kliknięcie wyda to samo dwa razy. Błąd (`bad("...")`) porzuca transakcję.

## Zapytania z przeglądarki i odpowiedzi

- Treść zapytania: `JsonBody<T>`, gdzie `T` to struktura `#[derive(Deserialize)]` obok handlera (pusta treść = `{}`,
  domyślne wartości przez `#[serde(default)]` / `#[serde(default = "...")]`). Zła treść = 400
  `{"error": "Nieprawidłowe żądanie"}`.
- Pola z formularzy panelu admina, w których liczby przychodzą jako tekst: `serde_with` (`lenient::Num`) albo
  `lenient::NumOrText`, gdy pusty tekst ma znaczyć "nie podano".
- Odpowiedź: struktura `#[derive(Serialize)]` z `rename_all = "camelCase"` (klucze takie, jakich oczekuje
  `static/js`), wspólne części przez `#[serde(flatten)]` (np. `CardJson`, `UserView`). `json!` tylko dla krótkich
  odpowiedzi.
- Błąd dla gracza: `return bad("...")` (400) albo `fail(StatusCode::FORBIDDEN, "...")`; funkcje pomocnicze zwracają
  `Res<T>` i błędy przechodzą przez `?`.

## Nowa kolumna / tabela

Dopisać w `server/schema.sql` (z `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` - wykonywany przy każdym starcie).
Dopóki działa wersja Python - także w `database.PG_SCHEMA` (i migracji SQLite w `app.py`).

## Ustawienia gry (ceny, szanse, warianty, karty, lista zmian)

Serwer czyta `server/data/game.json`. Dopóki źródłem jest `data.py`, po każdej jego zmianie:

```sh
python server/tools/dump_data.py      # data.py -> server/data/game.json
python server/tools/dump_derived.py   # wartości wyliczane -> test zgodności (server/tests/fixtures)
```

Wartości wyliczane (połączenia wariantów `flag+gold`, kolejność wariantów, szansa tajnej karty) liczy
`server/src/data.rs` tak samo jak `data.py` - pilnuje tego `cargo test`.

## Testy

```sh
cd server
cargo test                    # dane gry = data.py, hasła werkzeug, losowanie, katalog, Arena
cargo clippy --all-targets -- -D warnings
cargo fmt
```

Porównanie z wersją Python (obie na **pustych** bazach, ten sam scenariusz 2 graczy, porównanie kształtu
odpowiedzi):

```sh
# Python: DATABASE_URL=.../scambox_py  python -c "import app; app.app.run(port=5057)"
# Rust:   PORT=5056 DATABASE_URL=.../scambox_rs  cargo run
python server/tools/parity.py http://127.0.0.1:5057 http://127.0.0.1:5056
```

Pojedyncze różnice przy losowych wynikach (np. blackjack wygrany po jednej stronie) są normalne.
