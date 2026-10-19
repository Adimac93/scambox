# ScamBox (repo: FameChests, folder: Skrzynki)

ScamBox – gra webowa w otwieranie skrzynek (jak w CS) z kartami znanych osób. UI po polsku, bez monetyzacji.
Flask + SQLite + vanilla JS. Repo: https://github.com/CebularzPawel/FameChests

## Struktura
- `app.py` – serwer: tabele w `init_db`, wszystkie endpointy `/api/...`, `login_required` / `admin_required`.
- `data.py` – ustawienia gry (ceny, rzadkości, warianty, SECRET_ODDS=2137, skrzynki daily/mega) i wbudowane karty (PEOPLE_PL, PEOPLE_WORLD, PEOPLE_PRL, CRATES, SECOND_ATTACKS).
- `catalog.py` – łączy `data.py` ze zmianami z panelu admina (tabele `catalog_crates` / `catalog_cards`); karta może być w kilku skrzynkach (`crates`), szansa na tajną liczona automatycznie.
- `database.py` – SQLite (`game.db`/`test.db`) albo PostgreSQL, gdy ustawiony `DATABASE_URL`. Zapytania piszemy raz w stylu SQLite (`?`, `:nazwa`) i muszą działać w obu bazach: `ON CONFLICT ... DO NOTHING/DO UPDATE` (nie `INSERT OR IGNORE/REPLACE`), `RETURNING id` (nie `lastrowid`), `CASE` (nie `MAX(a,b)`), `LOWER(username)` (nie `COLLATE NOCASE`). Nowa kolumna/tabela: dodać w `init_sqlite` (z migracją) ORAZ w `database.PG_SCHEMA`.
- Endpointy, które sprawdzają stan gracza i go zmieniają (pieniądze, karty, skrzynki), zaczynają się od `lock_me()` – inaczej podwójne kliknięcie wydaje to samo dwa razy.
- `wsgi.py` – start na serwerze (gunicorn, 1 worker + wątki, bo katalog jest w pamięci procesu); zmienne: `DATABASE_URL`, `SECRET_KEY`, `DATA_DIR` (zdjęcia i klucz poza folderem gry).
- `migrate_to_postgres.py` – jednorazowe przeniesienie `game.db` do pustej bazy PostgreSQL.
- `images.py` – zdjęcia z Wikipedii w `image_cache/` (certifi + Windows SSL fallback); flagi krajów (wariant Flagowy) z flagcdn.com w `image_cache/flags/`, adres `/flag/<kod>.svg`.
- `arena.py` – Arena (wersja testowa, **tylko dla adminów**: `/api/arena/*` z `admin_required`, zakładka i klucz `arena` w `/api/config` tylko dla adminów). Walkę liczy serwer (zasady, komputer, pojedynki, czas tury), walki i wyzwania w pamięci procesu; przeglądarka (`static/js/arena.js`) odtwarza kroki. Nagrody: tabela `arena_daily`.
- Warianty wyjątkowe (`"exclusive"` w `VARIANTS`, np. `royal`, `flag`) wypadają tylko ze skrzynek, w których są włączone (pole skrzynki `variants`, panel admina; domyślne w `DEFAULT_CRATE_VARIANTS`), nigdy z kontraktu/ulepszacza. Flagowy wymaga kraju karty (`country`, np. `pl`). Wariant z polem `"cards"` (np. `rzulty` - tylko Jan Paweł II `pl_secret`) należy do konkretnych kart (`card_variants`), nie do skrzynek; może mieć własne zdjęcie (`image_cache/<id>__<wariant>.*`, panel admina, `/img/<id>/<wariant>`, eksport do `custom_images/`).
- Warstwy wariantów: Flagowy ma `"layer"` - 40% flagowych dropów (`extraChance`) dostaje drugi wariant wylosowany ze zwykłymi szansami; zapis `"flag+gold"` (wpisy `"combo"` w `VARIANTS` generowane w `data.py`, mnożnik = iloczyn, nie losują się osobno). W JS: `variantParts`, `baseVariant`, `vClass` (klasy `v-flag v-gold v-combo`), `vtClass` - nie składać klas z surowego klucza wariantu.
- Halloweenowe (Halloweenowa / Lampionowa / Diabelska: `halloween`, `lantern`, `devil`): warianty warstwowe z `"always"` - w skrzynce, która je ma (`halloween`, domyślnie w `DEFAULT_CRATE_VARIANTS`), KAŻDA karta dostaje jeden z nich (losowany wg `"weight"` 85/12/3) + zwykły wariant losuje się normalnie (`devil+gold`). `"photo"`: karta z tej skrzynki może mieć własne zdjęcie w każdym z nich (`catalog.photo_variants`, panel admina, `/img/<id>/<wariant>`, eksport); `"photoFallback"` - brak zdjęcia Lampionowej/Diabelskiej = zdjęcie Halloweenowej. Ozdoby: symbole SVG `#hw-*` / `#dv-horn` i filtry `#hwLantern` / `#dvRed` w `index.html`, `halloweenDeco()` / `halloweenPhoto()` / `lanternDeco()` / `devilBG()` / `devilDeco()` w `app.js`. Nowe wbudowane skrzynki dopisać do `CRATES_ADDED_LATER` - inaczej ich karty "shared" nie trafią do kart już edytowanych w panelu (`crates_seen`).
- Lista wariantów dla konkretnej karty (formularze, podgląd): zawsze `catalog.possible_variants(p)` / `possibleVariants(p)` w JS - nie całe `VARIANT_ORDER` (inaczej np. Rzulty pojawia się przy innych kartach niż JP2). Wariant Rysunkowy używa filtra SVG `#inkSketch` z `templates/index.html`, Galaktyczny - tła `galaxyBG()` w `app.js`.
- Rzadkości: kolejność w `RARITIES` (Zwykła, Niepospolita, Rzadka...) - nie porównywać indeksów liczbami (`rarityIdx(r) >= rarityIdx("gold")`); wynik kontraktu = `next_rarity()` (pomija rzadkości bez kart, `contractNext` w configu).
- Waluta gry: grosze ("gr") - `fmt()` w JS, `fmt_money()` w Pythonie. Listy kart do wyboru sortuje `sortCards()` + `sortSelectHTML()` (app.js).
- Hall of Fame nie pokazuje graczy poza rankingiem (`hidden_from_ranking`): zamiast nich pierwszy widoczny gracz z `user_collected` (`at`, `source` - kiedy i skąd gracz pierwszy raz zdobył kartę, `hof_first`).
- Kuźnia i wygrane w kasynie dają tylko karty z `p["forge"]` (karta w co najmniej jednej skrzynce z `shop`), liczone w `catalog.rebuild`.
- Rodzaje zdolności `ABILITY_KINDS`: off / def / heal / eco (lecząca = HP, ekonomiczna = monety w Arenie); kategorie kart zmienia admin, nie kod.
- Rynek (`/market`, `static/js/market.js`, `/api/market/*`) i Kasyno (`/casino`, `static/js/casino.js`, `/api/casino/*`: ruletka, jackpot) w `app.py`. Karta wystawiona na rynek należy do `ESCROW` (`items.user_id = 0`) do końca transakcji; pieniądze z ofert, licytacji i zleceń "Szukam" są od razu zabierane i zwracane, gdy oferta przepada. Koniec licytacji i porzucone lobby rozlicza `settle_market()` przy zapytaniach (m.in. `/api/me`). Ustawienia: `MARKET`, `ROULETTE*`, `JACKPOT` w `data.py`.
- Jackpot = lobby dla 2 graczy (`jackpots`: `is_public`, `ready_a/b`; `jackpot_invites`; karty w `jackpot_items`): publiczne/prywatne z zaproszeniami po nicku, karty wybierane i zmieniane w lobby (zmiana cofa obie akceptacje), losowanie w `jackpot_play`, gdy obaj zaakceptują. Karty w lobby NIE są blokowane - przy losowaniu sprawdzamy, czy gracze nadal je mają. Gracz siedzi najwyżej w jednym otwartym lobby.
- `/api/me` (odpytywane co 30 s, w lobby co 5 s) zwraca też odcisk ekwipunku (`inv`) i saldo - `syncInventory()` w `app.js` pobiera świeży stan, gdy coś zmienił inny gracz; oraz nieobejrzany wynik jackpota (`jackpot`, `jackpot_seen` w `user_state`), który `showJackpotResult()` pokazuje w dowolnej zakładce.
- Hall of Fame (`/inventory/hall-of-fame`, `static/js/hof.js`, `/api/halloffame`): tabela `hall_of_fame` (osoba + wariant: pierwszy gracz, kiedy, skąd, ile wypadło) - aktualizowana w `insert_item`; przy pustej tabeli `backfill_hall_of_fame` uzupełnia ją z kart graczy i aktywności. Wiele kontraktów naraz: `/api/contracts` (`contract_check` / `contract_exec`).
- `PATCH_NOTES` w `data.py` – lista zmian pokazywana graczowi raz po aktualizacji (`patch_seen` w `user_state`). Przy aktualizacji dla graczy dopisać nowy wpis NA GÓRZE z większym `v`.
- `export_catalog.py` – eksport zmian z panelu admina do `catalog_export.json` + `custom_images/` (bez danych graczy); nowa pusta baza wczytuje je sama.
- Adresy stron: `/crates` `/binder` `/inventory` `/forge` `/market` `/casino` `/friends` `/ranking` `/arena` (admini) `/player/<nazwa>` – ta sama strona `index.html`, widok wybiera JS (`VIEW_PATHS`, `switchView`, historia przeglądarki).
- `templates/` (index, login, admin), `static/js/` (app, fx, forge, market, casino, social, sound, admin, arena, hof), `static/css/`.
- Pliki statyczne wersjonowane przez `asset()`; HTML/API z `Cache-Control: no-store`.

## Uruchamianie
- `start_tailscale.bat` (hosting dla znajomych), `start_lan.bat` (sieć lokalna), `start.bat`.
- `.venv\Scripts\python app.py [--dev] [--lan] [--test]`; `--test` = `test.db` na porcie 5001. Druga kopia na zajętym porcie się nie uruchomi.
- Po każdej zmianie kodu użytkownik musi zrestartować grę (Ctrl+C i ponownie .bat).

## Zasady
- `game.db` to prawdziwy zapis graczy – nie modyfikować bezpośrednio, testować na kopii `test.db` (skopiować przed startem serwera testowego).
- Nigdy nie commitować `*.db`, `secret_key.txt`, `image_cache/`.
- Przed pushem: `.venv\Scripts\python export_catalog.py`, potem `git -c http.sslBackend=schannel push origin main`.
