"""Jednorazowe przeniesienie zapisu gry z SQLite (game.db) do PostgreSQL.

    set DATABASE_URL=postgresql://uzytkownik:haslo@serwer:5432/famechests?sslmode=require
    .venv\\Scripts\\python migrate_to_postgres.py [plik.db]

Plik SQLite jest tylko czytany (nic w nim się nie zmienia). Baza PostgreSQL musi być pusta - jeśli gra
była już na niej uruchomiona, wystarczy, że nikt się nie zarejestrował (katalog kart zostanie nadpisany).
"""
import os
import sqlite3
import sys

import catalog
import database

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TABLES = ("users", "user_state", "user_discovered", "items", "daily_claims", "friendships", "showcase", "trades",
          "trade_lines", "crate_access", "user_chests", "feed", "state", "discovered",
          "catalog_crates", "catalog_cards", "market_listings", "market_offers", "market_bids", "market_wanted",
          "jackpots", "jackpot_items", "jackpot_invites", "card_links", "card_link_claims",
          "admin_messages", "admin_message_seen")
IDENTITY_TABLES = ("users", "items", "trades", "feed", "market_listings", "market_offers", "market_bids",
                   "market_wanted", "jackpots", "card_links", "admin_messages")


def main():
    if not database.USE_POSTGRES:
        sys.exit("Ustaw najpierw DATABASE_URL (adres bazy PostgreSQL).")
    src_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE_DIR, "game.db")
    if not os.path.exists(src_path):
        sys.exit(f"Nie ma pliku {src_path}")
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)

    dst = database.connect(None)
    dst.executescript(database.PG_SCHEMA)
    catalog.init_tables(dst)
    for table in ("users", "items"):
        if dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]:
            sys.exit(f"Baza PostgreSQL ma już dane w tabeli {table} - przenoszę tylko do pustej bazy.")

    print(f"Z: {src_path}\nDo: {database.describe(None)}\n")
    for table in TABLES:
        dst.execute(f"DELETE FROM {table}")
        src_cols = [r[1] for r in src.execute(f"PRAGMA table_info({table})")]
        if not src_cols:
            print(f"  {table:16} brak w starym zapisie - pomijam")
            continue
        dst_cols = [r[0] for r in dst.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = ? AND table_schema = current_schema() "
            "ORDER BY ordinal_position",
            (table,))]
        cols = [c for c in dst_cols if c in src_cols]
        rows = src.execute(f"SELECT {', '.join(cols)} FROM {table}").fetchall()
        if rows:
            marks = ", ".join(["%s"] * len(cols))
            with dst.raw.cursor() as cur:
                cur.executemany(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({marks})", rows)
        print(f"  {table:16} {len(rows):>7} wierszy")

    # kolejne nowe id zaczynają się za największym przeniesionym
    for table in IDENTITY_TABLES:
        dst.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE(MAX(id), 0) + 1, false) "
                    f"FROM {table}")

    for table in TABLES:  # kontrola: tyle samo wierszy po obu stronach
        if src.execute("SELECT COUNT(*) FROM sqlite_master WHERE name = ?", (table,)).fetchone()[0]:
            a = src.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            b = dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            if a != b:
                dst.rollback()
                sys.exit(f"Różna liczba wierszy w {table}: {a} vs {b} - nic nie zapisano.")
    dst.commit()
    dst.close()
    src.close()
    print("\nGotowe - zapis gry jest w PostgreSQL.")


if __name__ == "__main__":
    main()
