import os
import random
import re
import sqlite3
import sys
import time
import unicodedata

from flask import Flask, Response, g, jsonify, render_template, request, send_file

import catalog
import images
from data import (CONTRACT_SIZE, CONTRACT_VARIANT_BONUS, CRATE_PRICE, MAX_DEPOSIT, MAX_OPEN, RARITIES,
                  RARITY_ORDER, STARTING_BALANCE, TYPES, UPGRADE_EDGE, UPGRADE_MAX, UPGRADE_MAX_ITEMS,
                  VARIANT_ORDER, VARIANTS, card_value)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEST_MODE = "--test" in sys.argv  # osobny zapis do testów: python app.py --test
DB_PATH = os.path.join(BASE_DIR, "test.db" if TEST_MODE else "game.db")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
rng = random.SystemRandom()


# ---------------------------------------------------------------- baza danych

def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id TEXT NOT NULL,
            holo INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS discovered (person_id TEXT PRIMARY KEY);
    """)
    # migracja: holo (0/1) -> variant
    cols = [r[1] for r in conn.execute("PRAGMA table_info(items)")]
    if "variant" not in cols:
        conn.execute("ALTER TABLE items ADD COLUMN variant TEXT NOT NULL DEFAULT 'normal'")
        conn.execute("UPDATE items SET variant = 'holo' WHERE holo = 1")
    catalog.init_tables(conn)
    for key, val in (("balance", STARTING_BALANCE), ("opened", 0), ("spent", 0), ("earned", 0),
                     ("deposited", 0), ("contracts", 0), ("upgrades_won", 0), ("upgrades_lost", 0)):
        conn.execute("INSERT OR IGNORE INTO state (key, value) VALUES (?, ?)", (key, val))
    conn.commit()
    catalog.rebuild(conn)
    conn.close()


def get_state():
    return {r["key"]: r["value"] for r in db().execute("SELECT key, value FROM state")}


def add_state(key, delta):
    db().execute("UPDATE state SET value = value + ? WHERE key = ?", (delta, key))


def discovered():
    return {r[0] for r in db().execute("SELECT person_id FROM discovered")}


def item_json(row):
    person = catalog.PEOPLE.get(row["person_id"])
    if person is None:  # karta usunięta z katalogu
        return None
    variant = row["variant"] if row["variant"] in VARIANTS else "normal"
    return {"id": row["id"], "person": person["id"], "variant": variant,
            "value": card_value(person, variant), "created": row["created_at"]}


def insert_item(person_id, variant):
    now = time.time()
    cur = db().execute("INSERT INTO items (person_id, holo, variant, created_at) VALUES (?, ?, ?, ?)",
                       (person_id, int(variant != "normal"), variant, now))
    return {"id": cur.lastrowid, "person": person_id, "variant": variant,
            "value": card_value(catalog.PEOPLE[person_id], variant), "created": now}


def note_discoveries(items):
    """Zapisuje odkryte tajne karty. Zwraca listę nowo odkrytych id."""
    new = []
    for it in items:
        if catalog.PEOPLE[it["person"]]["rarity"] == "secret":
            cur = db().execute("INSERT OR IGNORE INTO discovered (person_id) VALUES (?)", (it["person"],))
            if cur.rowcount:
                new.append(it["person"])
    return new


def img_version(pid):
    paths = [images.find(pid), images.find(pid, True)]
    return int(sum(os.path.getmtime(p) for p in paths if p)) % 100000


def public_person(p, found):
    """Karta dla klienta - tajne karty są zamaskowane, dopóki ich nie zdobędziesz."""
    if p["rarity"] == "secret" and p["id"] not in found:
        return {"id": p["id"], "rarity": "secret", "crate": p["crate"], "number": p["number"], "masked": True,
                "name": "???", "type": "tv", "hp": 0, "attack": "???", "dmg": 0, "imgv": 0}
    base = {k: p.get(k) for k in ("id", "name", "rarity", "type", "hp", "attack", "dmg", "crate", "number")}
    base["imgv"] = img_version(p["id"])
    return base


# ---------------------------------------------------------------- strony

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/admin")
def admin_page():
    return render_template("admin.html")


def svg_response(svg):
    return Response(svg, mimetype="image/svg+xml", headers={"Cache-Control": "no-store"})


MYSTERY_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">
  <defs><radialGradient id="g"><stop offset="0" stop-color="#5a4a1a"/><stop offset="1" stop-color="#0b0906"/></radialGradient></defs>
  <rect width="300" height="300" fill="url(#g)"/>
  <text x="150" y="190" font-family="Georgia, serif" font-size="150" fill="#f3e3b0" text-anchor="middle">★</text>
  <text x="150" y="268" font-family="Arial" font-weight="bold" font-size="34" fill="#f3e3b0" text-anchor="middle" letter-spacing="6">???</text>
</svg>"""


@app.route("/img/<person_id>")
@app.route("/img/<person_id>/<kind>")
def image(person_id, kind="main"):
    p = catalog.PEOPLE.get(person_id)
    if p is None:
        return "", 404
    # ?admin=1 - podgląd w panelu admina (po kliknięciu "Pokaż tajne karty")
    if p["rarity"] == "secret" and person_id not in discovered() and request.args.get("admin") != "1":
        return svg_response(MYSTERY_SVG)
    path = images.ensure(person_id, alt=(kind == "alt"))
    if path:
        return send_file(path, mimetype=images.mimetype(path), max_age=86400)
    initials = "".join(w[0] for w in p["name"].replace("„", "").split()[:2]).upper()
    color = RARITIES[p["rarity"]]["color"]
    return svg_response(f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
      <rect width="300" height="400" fill="#1d2233"/>
      <circle cx="150" cy="170" r="95" fill="{color}" opacity=".25"/>
      <text x="150" y="200" font-family="Arial" font-size="90" font-weight="bold"
            fill="{color}" text-anchor="middle">{initials}</text></svg>""")


# ---------------------------------------------------------------- API gry

def crate_json(c):
    return {k: c.get(k) for k in ("id", "name", "short", "code", "emoji", "color1", "color2", "price", "desc")} | \
           {"people": [p["id"] for p in c["people"]]}


@app.get("/api/config")
def config():
    found = discovered()
    return jsonify({
        "rarities": RARITIES,
        "rarityOrder": RARITY_ORDER,
        "variants": VARIANTS,
        "variantOrder": VARIANT_ORDER,
        "types": TYPES,
        "people": {pid: public_person(p, found) for pid, p in catalog.PEOPLE.items()},
        "crates": {cid: crate_json(c) for cid, c in catalog.CRATES.items()},
        "crateOrder": list(catalog.CRATES),
        "maxOpen": MAX_OPEN,
        "startingBalance": STARTING_BALANCE,
        "contractSize": CONTRACT_SIZE,
        "contractVariantBonus": CONTRACT_VARIANT_BONUS,
        "upgradeEdge": UPGRADE_EDGE,
        "upgradeMax": UPGRADE_MAX,
        "upgradeMaxItems": UPGRADE_MAX_ITEMS,
        "maxDeposit": MAX_DEPOSIT,
    })


@app.get("/api/state")
def state():
    rows = db().execute("SELECT * FROM items ORDER BY id DESC").fetchall()
    items = [i for i in (item_json(r) for r in rows) if i]
    return jsonify({"state": get_state(), "items": items})


def roll_variant(factor=1.0):
    specials = [v for v in reversed(VARIANT_ORDER) if v != "normal"]  # najrzadsze najpierw
    total = sum(VARIANTS[v]["chance"] for v in specials)
    factor = min(factor, 0.9 / total) if total else factor
    r, acc = rng.random(), 0.0
    for v in specials:
        acc += VARIANTS[v]["chance"] * factor
        if r < acc:
            return v
    return "normal"


def roll(crate):
    present = {p["rarity"] for p in crate["people"]}
    weights = [RARITIES[r]["weight"] if r in present else 0 for r in RARITY_ORDER]
    rarity = rng.choices(RARITY_ORDER, weights=weights)[0]
    person = rng.choice([p for p in crate["people"] if p["rarity"] == rarity])
    return person, roll_variant()


@app.post("/api/open")
def open_crates():
    body = request.get_json(force=True)
    crate = catalog.CRATES.get(body.get("crate"))
    count = int(body.get("count", 1))
    if crate is None or not 1 <= count <= MAX_OPEN:
        return jsonify({"error": "Nieprawidłowe żądanie"}), 400
    if not crate["people"]:
        return jsonify({"error": "Ta skrzynka jest pusta"}), 400
    cost = count * crate["price"]
    if get_state()["balance"] < cost:
        return jsonify({"error": "Za mało pieniędzy!"}), 400
    add_state("balance", -cost)
    add_state("spent", cost)
    add_state("opened", count)
    drops = []
    for _ in range(count):
        person, variant = roll(crate)
        drops.append(insert_item(person["id"], variant))
    new = note_discoveries(drops)
    db().commit()
    return jsonify({"drops": drops, "discovered": new, "state": get_state()})


def owned_rows(ids):
    """Zwraca wiersze kart o podanych id albo None, jeśli czegoś brakuje."""
    if not ids or len(set(ids)) != len(ids):
        return None
    marks = ",".join("?" * len(ids))
    rows = db().execute(f"SELECT * FROM items WHERE id IN ({marks})", ids).fetchall()
    if len(rows) != len(ids) or any(r["person_id"] not in catalog.PEOPLE for r in rows):
        return None
    return rows


def delete_items(ids):
    marks = ",".join("?" * len(ids))
    db().execute(f"DELETE FROM items WHERE id IN ({marks})", ids)


def row_value(r):
    return card_value(catalog.PEOPLE[r["person_id"]], r["variant"])


@app.post("/api/sell")
def sell():
    ids = [int(i) for i in request.get_json(force=True).get("ids", [])]
    if not ids:
        return jsonify({"error": "Nic nie wybrano"}), 400
    marks = ",".join("?" * len(ids))
    rows = db().execute(f"SELECT * FROM items WHERE id IN ({marks})", ids).fetchall()
    total = sum(row_value(r) for r in rows if r["person_id"] in catalog.PEOPLE)
    delete_items(ids)
    add_state("balance", total)
    add_state("earned", total)
    db().commit()
    return jsonify({"sold": [r["id"] for r in rows], "total": total, "state": get_state()})


@app.post("/api/deposit")
def deposit():
    try:
        amount = int(request.get_json(force=True).get("amount", 0))
    except (TypeError, ValueError):
        amount = 0
    if not 1 <= amount <= MAX_DEPOSIT:
        return jsonify({"error": f"Kwota musi być od 1 do {MAX_DEPOSIT:,} $".replace(",", " ")}), 400
    add_state("balance", amount)
    add_state("deposited", amount)
    db().commit()
    return jsonify({"state": get_state()})


@app.post("/api/contract")
def contract():
    ids = [int(i) for i in request.get_json(force=True).get("ids", [])]
    rows = owned_rows(ids)
    if rows is None:
        return jsonify({"error": "Nie masz tych kart"}), 400
    rarities = {catalog.PEOPLE[r["person_id"]]["rarity"] for r in rows}
    rarity = rarities.pop() if len(rarities) == 1 else None
    if rarity not in CONTRACT_SIZE:
        return jsonify({"error": "Wszystkie karty muszą mieć tę samą rzadkość"}), 400
    if len(rows) != CONTRACT_SIZE[rarity]:
        return jsonify({"error": f"Kontrakt wymaga {CONTRACT_SIZE[rarity]} kart"}), 400
    target = RARITY_ORDER[RARITY_ORDER.index(rarity) + 1]
    # skrzynka wyniku losowana proporcjonalnie do skrzynek kart wejściowych (tylko te, które mają wyższą rzadkość)
    pool = [catalog.PEOPLE[r["person_id"]]["crate"] for r in rows]
    pool = [c for c in pool if any(p["rarity"] == target for p in catalog.CRATES[c]["people"])]
    if not pool:
        return jsonify({"error": "W tych skrzynkach nie ma kart wyższej rzadkości"}), 400
    crate_id = rng.choice(pool)
    person = rng.choice([p for p in catalog.CRATES[crate_id]["people"] if p["rarity"] == target])
    specials = sum(r["variant"] != "normal" for r in rows)
    delete_items(ids)
    item = insert_item(person["id"], roll_variant(1 + CONTRACT_VARIANT_BONUS * specials))
    new = note_discoveries([item])
    add_state("contracts", 1)
    db().commit()
    return jsonify({"item": item, "crate": crate_id, "consumed": ids, "discovered": new, "state": get_state()})


@app.post("/api/upgrade")
def upgrade():
    body = request.get_json(force=True)
    ids = [int(i) for i in body.get("ids", [])]
    target = catalog.PEOPLE.get(body.get("target"))
    variant = body.get("variant", "normal")
    rows = owned_rows(ids)
    if rows is None or not 1 <= len(rows) <= UPGRADE_MAX_ITEMS or target is None or variant not in VARIANTS:
        return jsonify({"error": "Nieprawidłowy wybór kart"}), 400
    stake = sum(row_value(r) for r in rows)
    goal = card_value(target, variant)
    if goal <= stake:
        return jsonify({"error": "Cel musi być wart więcej niż twoje karty"}), 400
    chance = min(UPGRADE_MAX, stake / goal * UPGRADE_EDGE)
    roll_ = rng.random()
    win = roll_ < chance
    delete_items(ids)
    item = insert_item(target["id"], variant) if win else None
    new = note_discoveries([item]) if win else []
    add_state("upgrades_won" if win else "upgrades_lost", 1)
    db().commit()
    return jsonify({"win": win, "chance": chance, "roll": roll_, "item": item,
                    "consumed": ids, "discovered": new, "state": get_state()})


@app.post("/api/reset")
def reset():
    conn = db()
    conn.execute("DELETE FROM items")
    conn.execute("DELETE FROM state")
    conn.execute("DELETE FROM discovered")
    conn.commit()
    conn.close()
    g.pop("db", None)
    init_db()
    return jsonify({"state": get_state(), "items": []})


# ---------------------------------------------------------------- API admina

def slug(text):
    t = unicodedata.normalize("NFKD", text.replace("ł", "l").replace("Ł", "L"))
    t = re.sub(r"[^a-zA-Z0-9]+", "_", t.encode("ascii", "ignore").decode()).strip("_").lower()
    return t or "x"


def unique_id(base, taken):
    i, key = 2, base
    while key in taken:
        key, i = f"{base}_{i}", i + 1
    return key


def admin_card_json(p):
    return dict({k: p.get(k) for k in ("id", "name", "rarity", "type", "hp", "attack", "dmg", "crate",
                                       "number", "builtin", "modified")},
                wiki=list(p["wiki"]) if p.get("wiki") else None,
                hasImage=bool(images.find(p["id"])), hasAlt=bool(images.find(p["id"], True)),
                imgv=img_version(p["id"]))


def refresh_catalog():
    catalog.rebuild(db())


@app.get("/api/admin/catalog")
def admin_catalog():
    counts = {r[0]: r[1] for r in db().execute("SELECT person_id, COUNT(*) FROM items GROUP BY person_id")}
    crates = [dict(crate_json(c), builtin=c["builtin"], modified=c["modified"], hidden=False)
              for c in catalog.CRATES.values()]
    crates += [dict(crate_json(dict(c, people=[])), builtin=True, modified=False, hidden=True)
               for c in catalog.HIDDEN_CRATES.values()]
    cards = [dict(admin_card_json(p), owned=counts.get(p["id"], 0), hidden=False) for p in catalog.PEOPLE.values()]
    cards += [dict(admin_card_json(dict(p, number=0)), owned=counts.get(p["id"], 0), hidden=True)
              for p in catalog.HIDDEN_CARDS.values() if p.get("crate") in catalog.CRATES]
    return jsonify({"crates": crates, "cards": cards, "rarities": RARITIES, "rarityOrder": RARITY_ORDER,
                    "types": TYPES, "defaultPrice": CRATE_PRICE})


@app.post("/api/admin/crates")
def admin_save_crate():
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Podaj nazwę skrzynki"}), 400
    try:
        price = max(1, min(1_000_000, int(body.get("price") or CRATE_PRICE)))
    except (TypeError, ValueError):
        return jsonify({"error": "Nieprawidłowa cena"}), 400
    fields = {
        "name": name[:60],
        "short": (body.get("short") or name).strip()[:24],
        "code": (body.get("code") or name[:2]).strip().upper()[:4],
        "emoji": (body.get("emoji") or "📦").strip()[:8],
        "color1": body.get("color1") or "#888888",
        "color2": body.get("color2") or "#333333",
        "price": price,
        "desc": (body.get("desc") or "").strip()[:120],
    }
    cid = body.get("id")
    if not cid:
        cid = unique_id(slug(name), set(catalog.CRATES) | set(catalog.HIDDEN_CRATES))
    catalog.save_override(db(), "catalog_crates", cid, fields)
    db().commit()
    refresh_catalog()
    return jsonify({"ok": True, "id": cid})


@app.delete("/api/admin/crates/<cid>")
def admin_delete_crate(cid):
    conn = db()
    crate = catalog.CRATES.get(cid)
    if crate is None:
        return jsonify({"error": "Nie ma takiej skrzynki"}), 404
    if crate["builtin"]:
        catalog.mark_deleted(conn, "catalog_crates", cid)  # wbudowaną tylko ukrywamy
    else:
        catalog.remove_row(conn, "catalog_crates", cid)
        for p in crate["people"]:
            if not p["builtin"]:
                catalog.remove_row(conn, "catalog_cards", p["id"])
    conn.commit()
    refresh_catalog()
    return jsonify({"ok": True})


@app.post("/api/admin/crates/<cid>/restore")
def admin_restore_crate(cid):
    if catalog.builtin_crate(cid) is None:
        return jsonify({"error": "To nie jest wbudowana skrzynka"}), 400
    catalog.remove_row(db(), "catalog_crates", cid)
    db().commit()
    refresh_catalog()
    return jsonify({"ok": True})


@app.post("/api/admin/cards")
def admin_save_card():
    f = request.form
    name = (f.get("name") or "").strip()
    crate = f.get("crate")
    if not name:
        return jsonify({"error": "Podaj nazwę karty"}), 400
    if crate not in catalog.CRATES:
        return jsonify({"error": "Wybierz skrzynkę"}), 400
    if f.get("rarity") not in RARITIES or f.get("type") not in TYPES:
        return jsonify({"error": "Nieprawidłowa rzadkość lub typ"}), 400
    try:
        hp, dmg = int(f.get("hp") or 50), int(f.get("dmg") or 30)
    except ValueError:
        return jsonify({"error": "HP i obrażenia muszą być liczbami"}), 400
    wiki_title = (f.get("wiki_title") or "").strip()
    fields = {
        "name": name[:60], "crate": crate, "rarity": f["rarity"], "type": f["type"],
        "hp": max(0, min(9999, hp)), "dmg": max(0, min(9999, dmg)),
        "attack": (f.get("attack") or "Atak").strip()[:40],
        "wiki": [(f.get("wiki_lang") or "pl").strip()[:5], wiki_title] if wiki_title else None,
    }
    pid = f.get("id")
    old = catalog.PEOPLE.get(pid) if pid else None
    if not pid:
        prefix = {"world": "w"}.get(crate, crate)
        pid = unique_id(f"{prefix}_{slug(name)}", set(catalog.PEOPLE) | set(catalog.HIDDEN_CARDS))
    catalog.save_override(db(), "catalog_cards", pid, fields)
    db().commit()
    refresh_catalog()

    # zdjęcia: plik > URL > Wikipedia (gdy zmienił się artykuł albo brak zdjęcia)
    warnings = []
    for alt in (False, True):
        suffix = "_alt" if alt else ""
        try:
            upload = request.files.get("image" + suffix)
            url = (f.get("image_url" + suffix) or "").strip()
            if upload and upload.filename:
                images.save(pid, upload.read(), alt)
            elif url:
                images.save_url(pid, url, alt)
            elif f.get("remove" + suffix) == "1":
                images.delete(pid, alt)
            elif not alt and fields["wiki"] and (not images.find(pid) or
                                                 (old and tuple(old.get("wiki") or ()) != tuple(fields["wiki"]))):
                if not images.fetch([pid], force=True).get(pid):
                    warnings.append("Nie znaleziono zdjęcia w artykule Wikipedii")
        except Exception as e:
            warnings.append(f"Zdjęcie{' alt' if alt else ''}: {e}")
    return jsonify({"ok": True, "id": pid, "warnings": warnings})


@app.delete("/api/admin/cards/<pid>")
def admin_delete_card(pid):
    p = catalog.PEOPLE.get(pid)
    if p is None:
        return jsonify({"error": "Nie ma takiej karty"}), 404
    if p["builtin"]:
        catalog.mark_deleted(db(), "catalog_cards", pid)
    else:
        catalog.remove_row(db(), "catalog_cards", pid)
        images.delete(pid)
        images.delete(pid, True)
    db().commit()
    refresh_catalog()
    return jsonify({"ok": True})


@app.post("/api/admin/cards/<pid>/restore")
def admin_restore_card(pid):
    if catalog.builtin_card(pid) is None:
        return jsonify({"error": "To nie jest wbudowana karta"}), 400
    catalog.remove_row(db(), "catalog_cards", pid)
    db().commit()
    refresh_catalog()
    return jsonify({"ok": True})


@app.post("/api/admin/cards/<pid>/refetch")
def admin_refetch(pid):
    if pid not in catalog.PEOPLE:
        return jsonify({"error": "Nie ma takiej karty"}), 404
    main = images.fetch([pid], force=True).get(pid)
    alt = images.fetch_alt([pid], force=True)
    return jsonify({"ok": True, "main": bool(main), "alt": bool(alt)})


init_db()

if __name__ == "__main__":
    # w trybie debug Flask uruchamia proces dwa razy - pobieramy zdjęcia tylko w procesie roboczym
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        images.prefetch_all_async()
    app.run(host="127.0.0.1", port=5001 if TEST_MODE else 5000, debug=True)
