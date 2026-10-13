# FameChests (Skrzynki)

Gra webowa w otwieranie skrzynek (jak w CS) z kartami znanych osób. UI po polsku, bez monetyzacji.
Flask + SQLite + vanilla JS. Repo: https://github.com/CebularzPawel/FameChests

## Struktura
- `app.py` – serwer: tabele w `init_db`, wszystkie endpointy `/api/...`, `login_required` / `admin_required`.
- `data.py` – ustawienia gry (ceny, rzadkości, warianty, SECRET_ODDS=2137, skrzynki daily/mega) i wbudowane karty (PEOPLE_PL, PEOPLE_WORLD, PEOPLE_PRL, CRATES, SECOND_ATTACKS).
- `catalog.py` – łączy `data.py` ze zmianami z panelu admina (tabele `catalog_crates` / `catalog_cards`); karta może być w kilku skrzynkach (`crates`), szansa na tajną liczona automatycznie.
- `database.py` – SQLite (`game.db`/`test.db`) albo PostgreSQL, gdy ustawiony `DATABASE_URL`. Zapytania piszemy raz w stylu SQLite (`?`, `:nazwa`) i muszą działać w obu bazach: `ON CONFLICT ... DO NOTHING/DO UPDATE` (nie `INSERT OR IGNORE/REPLACE`), `RETURNING id` (nie `lastrowid`), `CASE` (nie `MAX(a,b)`), `LOWER(username)` (nie `COLLATE NOCASE`). Nowa kolumna/tabela: dodać w `init_sqlite` (z migracją) ORAZ w `database.PG_SCHEMA`.
- Endpointy, które sprawdzają stan gracza i go zmieniają (pieniądze, karty, skrzynki), zaczynają się od `lock_me()` – inaczej podwójne kliknięcie wydaje to samo dwa razy.
- `wsgi.py` – start na serwerze (gunicorn, 1 worker + wątki, bo katalog jest w pamięci procesu); zmienne: `DATABASE_URL`, `SECRET_KEY`, `DATA_DIR` (zdjęcia i klucz poza folderem gry).
- `migrate_to_postgres.py` – jednorazowe przeniesienie `game.db` do pustej bazy PostgreSQL.
- `images.py` – zdjęcia z Wikipedii w `image_cache/` (certifi + Windows SSL fallback).
- `export_catalog.py` – eksport zmian z panelu admina do `catalog_export.json` + `custom_images/` (bez danych graczy); nowa pusta baza wczytuje je sama.
- Adresy stron: `/crates` `/binder` `/inventory` `/forge` `/friends` `/ranking` `/player/<nazwa>` – ta sama strona `index.html`, widok wybiera JS (`VIEW_PATHS`, `switchView`, historia przeglądarki).
- `templates/` (index, login, admin), `static/js/` (app, fx, forge, social, sound, admin), `static/css/`.
- Pliki statyczne wersjonowane przez `asset()`; HTML/API z `Cache-Control: no-store`.

## Uruchamianie
- `start_tailscale.bat` (hosting dla znajomych), `start_lan.bat` (sieć lokalna), `start.bat`.
- `.venv\Scripts\python app.py [--dev] [--lan] [--test]`; `--test` = `test.db` na porcie 5001. Druga kopia na zajętym porcie się nie uruchomi.
- Po każdej zmianie kodu użytkownik musi zrestartować grę (Ctrl+C i ponownie .bat).

## Zasady
- `game.db` to prawdziwy zapis graczy – nie modyfikować bezpośrednio, testować na kopii `test.db` (skopiować przed startem serwera testowego).
- Nigdy nie commitować `*.db`, `secret_key.txt`, `image_cache/`.
- Przed pushem: `.venv\Scripts\python export_catalog.py`, potem `git -c http.sslBackend=schannel push origin main`.
