# Hosting (serwer w internecie)

## Obraz

```sh
docker build -f server/Dockerfile -t scambox .     # z głównego folderu gry
```

Obraz zawiera serwer, `static/`, `templates/`, `catalog_export.json` i `custom_images/`. Zapytania do bazy są
sprawdzane przy budowaniu z `server/.sqlx/` - baza nie jest potrzebna do zbudowania.

## Zmienne środowiskowe

| Zmienna | Domyślnie w obrazie | Co |
|---|---|---|
| `DATABASE_URL` | - (wymagana) | `postgresql://użytkownik:hasło@serwer:5432/baza?sslmode=require` |
| `SECRET_KEY` | - | klucz ciasteczek logowania; stały, długi, losowy (bez niego: `DATA_DIR/secret_key.txt`) |
| `DATA_DIR` | folder gry | zdjęcia (`image_cache/`) i klucz - folder, który przetrwa restart |
| `DB_SCHEMA` | - | tabele gry w osobnym schemacie zamiast `public` (np. Supabase) |
| `DB_POOL_SIZE` | 10 | połączenia z bazą |
| `PORT`, `BIND` | 8000, 0.0.0.0 | adres serwera |
| `COOKIE_SECURE` | 1 | ciasteczko tylko po HTTPS |
| `TRUST_PROXY` | 1 | adres gracza z `X-Forwarded-For` (limit nieudanych logowań) - serwer za proxy z HTTPS |
| `METRICS_ADDR` | 127.0.0.1:9100 | metryki Prometheus (`/metrics`); pusty = wyłączone |
| `RUST_LOG` | scambox=info | poziom logów |

Te same `DATABASE_URL`, `SECRET_KEY` i `DATA_DIR` co w wersji Python (`wsgi.py`) - zmiana serwera nie wymaga
zmian w bazie.

## Ważne

- **Jeden proces.** Katalog kart i walki w Arenie są w pamięci procesu - nie uruchamiaj kilku kopii za load
  balancerem (jak 1 worker gunicorna w wersji Python).
- **HTTPS** zapewnia hosting/proxy przed serwerem; serwer sam mówi po HTTP.
- **Metryki** (`scambox_http_requests_total`, `scambox_crates_opened_total`, `scambox_casino_games_total`,
  `scambox_market_trades_total`, `scambox_forge_total`, `scambox_login_failures_total`...) są dostępne tylko
  wewnątrz serwera; żeby je zbierać, ustaw `METRICS_ADDR=0.0.0.0:9100` i nie wystawiaj tego portu publicznie.
- Pierwszy start na istniejącej bazie: schemat jest uzupełniany (`IF NOT EXISTS`), dane graczy zostają.
