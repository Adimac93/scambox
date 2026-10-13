"""Katalog kart i skrzynek.

Domyślne dane pochodzą z data.py. Zmiany z panelu admina są zapisane w bazie
(tabele catalog_crates / catalog_cards) i nakładane na dane domyślne:
  - wiersz z deleted=1 ukrywa skrzynkę/kartę,
  - wiersz z danymi nadpisuje pola wbudowanej skrzynki/karty albo dodaje nową.

Karta może należeć do kilku skrzynek: pole "crates" (lista), "crate" to skrzynka główna
(jej kod i numer są nadrukowane na karcie).
"""
import json

import data

CRATE_FIELDS = ("name", "short", "code", "emoji", "color1", "color2", "price", "desc", "shop", "restricted", "weights")
CARD_FIELDS = ("name", "wiki", "rarity", "type", "hp", "attack", "dmg", "attack2", "dmg2", "kind1", "kind2", "abilities",
               "crate", "crates")


def clean_abilities(raw):
    """Dodatkowe zdolności karty: [{"name", "kind": off/def, "value"}], najwyżej data.MAX_EXTRA_ABILITIES."""
    out = []
    for a in raw if isinstance(raw, list) else []:
        name = str((a or {}).get("name") or "").strip()[:40]
        if not name:
            continue
        try:
            value = max(0, min(9999, int(a.get("value") or 0)))
        except (TypeError, ValueError):
            value = 0
        out.append({"name": name, "kind": a.get("kind") if a.get("kind") in data.ABILITY_KINDS else "off", "value": value})
    return out[:data.MAX_EXTRA_ABILITIES]

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
                crates = [cid] + [x for x, cc in data.CRATES.items() if pid in cc.get("shared", []) and x != cid]
                return dict(p, crate=cid, crates=crates)
    return None


def crate_weight(crate, rarity):
    """Szansa (waga) rzadkości w danej skrzynce - własna albo domyślna."""
    w = (crate.get("weights") or {}).get(rarity)
    return float(w) if w is not None else data.RARITIES[rarity]["weight"]


def rebuild(conn):
    global CRATES, PEOPLE, HIDDEN_CRATES, HIDDEN_CARDS
    crates, people, hidden_crates, hidden_cards = {}, {}, {}, {}

    for cid, c in data.CRATES.items():
        crates[cid] = dict({"shop": True, "restricted": False, "weights": {}}, **builtin_crate(cid),
                           id=cid, builtin=True, modified=False)
        for p in c["people"]:
            people[p["id"]] = dict(p, crate=cid, crates=[cid], builtin=True, modified=False)
    for cid, c in data.CRATES.items():
        for pid in c.get("shared", []):
            if pid in people and cid not in people[pid]["crates"]:
                people[pid]["crates"].append(cid)

    for row in conn.execute("SELECT id, data, deleted FROM catalog_crates"):
        cid, d = row[0], json.loads(row[1] or "{}")
        if row[2]:
            if cid in crates:
                hidden_crates[cid] = crates.pop(cid)
            continue
        if cid in crates:
            merged = dict(crates[cid].get("weights") or {}, **(d.get("weights") or {}))  # szanse: zmiany admina + domyślne
            crates[cid].update(d)
            crates[cid]["weights"] = merged
            crates[cid]["modified"] = True
        else:
            base = {"name": cid, "short": cid, "code": cid[:2].upper(), "emoji": "📦", "color1": "#888888",
                    "color2": "#333333", "price": data.CRATE_PRICE, "desc": "", "shop": True, "restricted": False,
                    "weights": {}}
            crates[cid] = dict(base, **d, id=cid, builtin=False, modified=False)

    for row in conn.execute("SELECT id, data, deleted FROM catalog_cards"):
        pid, d = row[0], json.loads(row[1] or "{}")
        if row[2]:
            if pid in people:
                hidden_cards[pid] = people.pop(pid)
            continue
        if pid in people:
            old_crates = people[pid]["crates"]
            people[pid].update(d)
            people[pid]["modified"] = True
            if "crates" not in d and "crate" in d:  # starszy zapis z jedną skrzynką - zachowaj pozostałe
                people[pid]["crates"] = [d["crate"]] + [c for c in old_crates if c != d["crate"]]
        else:
            people[pid] = dict(d, id=pid, builtin=False, modified=False)
            people[pid].setdefault("crates", [d.get("crate")])

    for p in people.values():
        if isinstance(p.get("wiki"), list):
            p["wiki"] = tuple(p["wiki"])
        p["hp"], p["dmg"] = int(p.get("hp") or 0), int(p.get("dmg") or 0)
        p["attack2"] = (p.get("attack2") or "").strip() or None
        p["dmg2"] = int(p.get("dmg2") or 0) if p["attack2"] else 0
        # rodzaj zdolności: istniejące karty nie mają tych pól - zostają ofensywne
        p["kind1"] = p.get("kind1") if p.get("kind1") in data.ABILITY_KINDS else "off"
        p["kind2"] = p.get("kind2") if p["attack2"] and p.get("kind2") in data.ABILITY_KINDS else "off"
        p["abilities"] = clean_abilities(p.get("abilities"))
        if p.get("rarity") not in data.RARITIES:
            p["rarity"] = "green"
        if p.get("type") not in data.TYPES:
            p["type"] = "tv"
        p["crates"] = [c for c in dict.fromkeys(p.get("crates") or []) if c in crates]
        p["crate"] = p["crates"][0] if p["crates"] else None

    order = data.RARITY_ORDER
    final_people = {}
    for cid, crate in crates.items():
        members = sorted((p for p in people.values() if cid in p["crates"]),
                         key=lambda p: (-order.index(p["rarity"]), p["name"]))
        for n, p in enumerate(members, 1):
            if p["crate"] == cid:
                p["number"] = n
            final_people[p["id"]] = p
        crate["people"] = members
        crate["price"] = max(1, int(crate.get("price") or data.CRATE_PRICE))
        crate["shop"] = bool(crate.get("shop", True))
        crate["restricted"] = bool(crate.get("restricted", False))
        crate["weights"] = {r: float(w) for r, w in (crate.get("weights") or {}).items() if r in data.RARITIES}
        # tajna karta: zawsze 1 na SECRET_ODDS otwartych skrzynek (chyba że admin ustawi inaczej)
        crate["autoSecret"] = "secret" not in crate["weights"]
        if crate["autoSecret"]:
            present = {p["rarity"] for p in members}
            others = sum(crate_weight(crate, r) for r in present if r != "secret")
            crate["weights"]["secret"] = others / (data.SECRET_ODDS - 1) if others else 0.0

    # wartość karty rośnie z ceną NAJTAŃSZEJ skrzynki, w której można ją zdobyć: karta tylko ze skrzynek po 500 $
    # jest warta x5 (skrzynka po 500 $ zwraca się tak samo jak po 100 $), karta, która jest też w skrzynce po 100 $ - x1
    for p in final_people.values():
        cheapest = min((crates[c]["price"] for c in p["crates"]), default=data.CRATE_PRICE)
        p["valueMult"] = max(1.0, cheapest / data.CRATE_PRICE)

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
