"""Katalog kart i skrzynek.

Domyślne dane pochodzą z data.py. Zmiany z panelu admina są zapisane w bazie
(tabele catalog_crates / catalog_cards) i nakładane na dane domyślne:
  - wiersz z deleted=1 ukrywa skrzynkę/kartę,
  - wiersz z danymi nadpisuje pola wbudowanej skrzynki/karty albo dodaje nową.
"""
import json

import data

CRATE_FIELDS = ("name", "short", "code", "emoji", "color1", "color2", "price", "desc")
CARD_FIELDS = ("name", "wiki", "rarity", "type", "hp", "attack", "dmg", "crate")

CRATES = {}         # id -> skrzynka (z listą "people" w kolejności numerów)
PEOPLE = {}         # id -> karta
HIDDEN_CRATES = {}  # wbudowane, ukryte przez admina
HIDDEN_CARDS = {}


def init_tables(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS catalog_crates (id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', deleted INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS catalog_cards  (id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', deleted INTEGER NOT NULL DEFAULT 0);
    """)


def builtin_crate(cid):
    c = data.CRATES.get(cid)
    return {k: c[k] for k in CRATE_FIELDS if k in c} if c else None


def builtin_card(pid):
    for cid, c in data.CRATES.items():
        for p in c["people"]:
            if p["id"] == pid:
                return dict(p, crate=cid)
    return None


def rebuild(conn):
    global CRATES, PEOPLE, HIDDEN_CRATES, HIDDEN_CARDS
    crates, people, hidden_crates, hidden_cards = {}, {}, {}, {}

    for cid, c in data.CRATES.items():
        crates[cid] = dict(builtin_crate(cid), id=cid, builtin=True, modified=False)
        for p in c["people"]:
            people[p["id"]] = dict(p, crate=cid, builtin=True, modified=False)

    for row in conn.execute("SELECT id, data, deleted FROM catalog_crates"):
        cid, d = row[0], json.loads(row[1] or "{}")
        if row[2]:
            if cid in crates:
                hidden_crates[cid] = crates.pop(cid)
            continue
        if cid in crates:
            crates[cid].update(d)
            crates[cid]["modified"] = True
        else:
            base = {"name": cid, "short": cid, "code": cid[:2].upper(), "emoji": "📦",
                    "color1": "#888888", "color2": "#333333", "price": data.CRATE_PRICE, "desc": ""}
            crates[cid] = dict(base, **d, id=cid, builtin=False, modified=False)

    for row in conn.execute("SELECT id, data, deleted FROM catalog_cards"):
        pid, d = row[0], json.loads(row[1] or "{}")
        if row[2]:
            if pid in people:
                hidden_cards[pid] = people.pop(pid)
            continue
        if pid in people:
            people[pid].update(d)
            people[pid]["modified"] = True
        else:
            people[pid] = dict(d, id=pid, builtin=False, modified=False)

    for p in people.values():
        if isinstance(p.get("wiki"), list):
            p["wiki"] = tuple(p["wiki"])
        p["hp"], p["dmg"] = int(p.get("hp") or 0), int(p.get("dmg") or 0)
        if p.get("rarity") not in data.RARITIES:
            p["rarity"] = "green"
        if p.get("type") not in data.TYPES:
            p["type"] = "tv"

    order = data.RARITY_ORDER
    final_people = {}
    for cid, crate in crates.items():
        members = sorted((p for p in people.values() if p.get("crate") == cid),
                         key=lambda p: (-order.index(p["rarity"]), p["name"]))
        for n, p in enumerate(members, 1):
            p["number"] = n
            final_people[p["id"]] = p
        crate["people"] = members
        crate["price"] = max(1, int(crate.get("price") or data.CRATE_PRICE))

    CRATES, PEOPLE = crates, final_people
    HIDDEN_CRATES, HIDDEN_CARDS = hidden_crates, hidden_cards


def save_override(conn, table, key, fields):
    row = conn.execute(f"SELECT data FROM {table} WHERE id = ?", (key,)).fetchone()
    current = json.loads(row[0]) if row else {}
    current.update(fields)
    conn.execute(f"INSERT INTO {table} (id, data, deleted) VALUES (?, ?, 0) "
                 f"ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted = 0",
                 (key, json.dumps(current, ensure_ascii=False)))


def mark_deleted(conn, table, key):
    conn.execute(f"INSERT INTO {table} (id, data, deleted) VALUES (?, '{{}}', 1) "
                 f"ON CONFLICT(id) DO UPDATE SET deleted = 1", (key,))


def remove_row(conn, table, key):
    conn.execute(f"DELETE FROM {table} WHERE id = ?", (key,))
