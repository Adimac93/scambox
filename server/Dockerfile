# Obraz serwera gry. Budowanie z głównego folderu repozytorium (potrzebne static/, templates/, catalog_export.json):
#   docker build -f server/Dockerfile -t scambox .
# Uruchomienie: DATABASE_URL, SECRET_KEY, DATA_DIR (wolumen na zdjęcia), port 8000.
FROM rust:1-bookworm AS build
WORKDIR /src/server
COPY server/ .
# zapytania sqlx::query! sprawdzane z .sqlx/ (cargo sqlx prepare) - bez bazy przy budowaniu
ENV SQLX_OFFLINE=true
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/server/target/release/scambox /usr/local/bin/scambox
COPY static ./static
COPY templates ./templates
COPY custom_images ./custom_images
COPY catalog_export.json ./
ENV GAME_DIR=/app BIND=0.0.0.0 PORT=8000 COOKIE_SECURE=1 TRUST_PROXY=1 METRICS_ADDR=127.0.0.1:9100
EXPOSE 8000
CMD ["scambox"]
