@echo off
rem Serwer gry w Rust (folder server\). Wymaga: Rust (rustup), baza PostgreSQL (server\docker-compose.yml) i server\.env z DATABASE_URL.
rem Dodatkowe opcje: --lan (siec lokalna), --test (osobna baza, port 5001)
cd /d "%~dp0server"
cargo run --release -- %*
pause
