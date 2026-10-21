# ScamBox – serwer w Rust

Nowa wersja serwera gry (axum + tokio + sqlx/PostgreSQL). Przeglądarka (`static/`, `templates/`) jest ta sama –
API zwraca takie same odpowiedzi jak wersja Python (`app.py`), sprawdzone narzędziem `tools/parity.py`.

## Uruchomienie

```sh
cd server
docker compose up -d            # baza PostgreSQL (albo własna)
cp .env.example .env            # DATABASE_URL itd.
cargo run --release             # http://127.0.0.1:5000
cargo run --release -- --lan    # dostęp z sieci lokalnej
cargo run --release -- --test   # osobna baza (TEST_DATABASE_URL albo <baza>_test), port 5001
```

Windows: `start_rust.bat` w głównym folderze. Hosting: `docker build -f server/Dockerfile -t scambox .`
(z głównego folderu repozytorium), zmienne `DATABASE_URL`, `SECRET_KEY`, `DATA_DIR`.

Komendy: `cargo run --release -- export-catalog` (zamiast `export_catalog.py`),
`cargo run --release -- fetch-images [--force]` (zdjęcia główne i alternatywne).

Przeniesienie zapisu z `game.db` (SQLite): `migrate_to_postgres.py` z wersji Python. Schemat bazy jest taki sam
jak w wersji Python (`schema.sql` = `database.PG_SCHEMA`), więc istniejąca baza PostgreSQL działa od razu.
Zalogowani gracze muszą zalogować się raz ponownie (nowe ciasteczko); hasła zostają (format werkzeug).

## Budowa

| Plik | Co |
|---|---|
| `src/main.rs` | start: schemat, uzupełnienia danych (`init_db`), katalog, router, gzip, metryki, komendy |
| `src/config.rs` | flagi `--test --lan --dev`, zmienne środowiskowe |
| `src/data.rs` + `data/game.json` | ustawienia gry i wbudowane karty (z `data.py`) + wartości wyliczane |
| `src/catalog.rs` | katalog = dane wbudowane + zmiany z panelu admina (`catalog_crates` / `catalog_cards`), w pamięci (`ArcSwap`) |
| `src/auth.rs` | konta, hasła (werkzeug scrypt/pbkdf2), sesja w podpisanym ciasteczku, `Me` / `Admin`, limit logowań |
| `src/game/` | wspólna logika: stan gracza, karty, Hall of Fame, losowanie, rynek (`settle_market`) |
| `src/routes/` | adresy: strony, konta, sklep/kuźnia, social, rynek, kasyno, arena, admin |
| `src/arena/` | silnik Areny (walki w pamięci procesu) |
| `src/images.rs` | zdjęcia z Wikipedii, miniatury WebP, flagi |
| `schema.sql` | schemat PostgreSQL (wykonywany przy starcie, `IF NOT EXISTS`) |

## Zasady

- Zapytania przez `sqlx::query!` / `query_as!` / `query_scalar!` (sprawdzane przy kompilacji). Po zmianie zapytań:
  `SQLX_OFFLINE=false` w `.env`, baza z aktualnym schematem, `cargo sqlx prepare`, commit `.sqlx/`.
- Nowa kolumna / tabela: `schema.sql` (i `database.PG_SCHEMA`, dopóki działa wersja Python).
- Zapytania zmieniające stan gracza: transakcja + `db::lock_me` na początku (podwójne kliknięcie).
- Jeden proces serwera (katalog i Arena w pamięci).
- `data/game.json` powstaje z `data.py`: `python server/tools/dump_data.py` (+ `dump_derived.py` dla testów).
- Metryki Prometheus: `METRICS_ADDR` (domyślnie `127.0.0.1:9100/metrics`).

## Testy

```sh
cargo test                       # dane gry = data.py, hasła werkzeug, losowanie, katalog, Arena
cargo clippy --all-targets
python tools/parity.py http://127.0.0.1:5057 http://127.0.0.1:5056   # Python vs Rust na dwóch pustych bazach
```
