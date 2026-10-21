# Przejście z wersji Python na Rust

Obie wersje używają **tej samej bazy PostgreSQL** (ten sam schemat) i **tych samych hashy haseł** (format werkzeug).
Można przełączać się w obie strony bez migracji danych.

## Co się zmienia dla graczy

- Trzeba **zalogować się jeszcze raz** (nowe ciasteczko logowania). Hasła działają jak dotąd.
- Poza tym nic - przeglądarka i odpowiedzi API są takie same.

## Kroki

### 1. Test w przeglądarce

Gra lokalnie ([uruchamianie.md](uruchamianie.md)), dwa konta w dwóch przeglądarkach: skrzynki, klaser, ekwipunek,
kuźnia, rynek, kasyno (ruletka, blackjack, jackpot), znajomi i wymiany, ranking, Hall of Fame, panel admina, Arena.

### 2. Test na kopii prawdziwej bazy

```sh
pg_dump "$PROD_DATABASE_URL" > prod.sql
docker exec <kontener-bazy> psql -U postgres -c "CREATE DATABASE scambox_prod"
docker exec -i <kontener-bazy> psql -U postgres -d scambox_prod < prod.sql
```

Gra z `DATABASE_URL=.../scambox_prod` (i `DB_SCHEMA`, jeśli produkcja go używa). Sprawdź prawdziwe konto: saldo,
karty, gablota, oferty na rynku, lobby jackpota, panel admina.

Zapis tylko w `game.db` (SQLite)? Najpierw przenieś go do pustej bazy PostgreSQL:
`python migrate_to_postgres.py` (wersja Python).

### 3. Wdrożenie

Nowy obraz na hostingu ([hosting.md](hosting.md)) z tymi samymi `DATABASE_URL`, `SECRET_KEY`, `DATA_DIR`.
Wcześniej `cargo run --release -- export-catalog` (albo `export_catalog.py`), jeśli w panelu admina coś się zmieniło.

### 4. Powrót (jeśli coś nie działa)

Uruchom z powrotem wersję Python na tej samej bazie. Konta założone i hasła zmienione w wersji Rust działają
także w Pythonie.

### 5. Usunięcie wersji Python (gdy wersja Rust działa stabilnie)

Do usunięcia: `app.py`, `catalog.py`, `database.py`, `arena.py`, `images.py`, `wsgi.py`, `export_catalog.py`,
`requirements.txt`, stare `start*.bat` (zostaje `start_rust.bat`). Ustawienia gry zostają tylko w
`server/data/game.json` (zamiast `data.py`). Do tego czasu każdą zmianę w grze trzeba zrobić w obu wersjach
([rozwoj.md](rozwoj.md)).
