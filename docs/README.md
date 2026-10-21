# Dokumentacja – serwer w Rust

Gra ma nowy serwer w Rust (`server/`): axum + tokio + sqlx (PostgreSQL). Przeglądarka (`static/`, `templates/`)
jest ta sama, API zwraca takie same odpowiedzi jak wersja Python (`app.py`).

| Plik | Co |
|---|---|
| [uruchamianie.md](uruchamianie.md) | gra na własnym komputerze: Linux/NixOS, Windows, Docker |
| [hosting.md](hosting.md) | serwer w internecie: obraz Docker, zmienne, HTTPS, metryki |
| [przejscie-z-pythona.md](przejscie-z-pythona.md) | jak przejść z wersji Python na Rust (test na kopii bazy, wdrożenie, powrót) |
| [rozwoj.md](rozwoj.md) | zmiany w kodzie: zapytania `sqlx::query!`, schemat, dane gry, testy |

Opis budowy kodu: [`server/README.md`](../server/README.md).
