import datetime
import functools
import json
import os
import random
import re
import secrets
import socket
import sqlite3
import sys
import time
import unicodedata

from flask import (Flask, Response, g, jsonify, redirect, render_template, request, send_file, session,
                   url_for)
from werkzeug.security import check_password_hash, generate_password_hash

import catalog
import images
from data import (CONTRACT_SIZE, CONTRACT_VARIANT_BONUS, CRATE_PRICE, JACKPOT_WEEKDAY, MAX_DEPOSIT,
                  MAX_OPEN, MONEY_CHESTS, RARITIES, RARITY_ORDER, SECRET_ODDS, SHOWCASE_SIZE,
                  STARTING_BALANCE, TYPES, UPGRADE_EDGE, UPGRADE_MAX, UPGRADE_MAX_ITEMS, VARIANT_ORDER,
                  VARIANTS, card_value)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEST_MODE = "--test" in sys.argv  # osobny zapis do testów: python app.py --test
LAN_MODE = "--lan" in sys.argv    # dostęp z innych komputerów w sieci: python app.py --lan
DEV_MODE = "--dev" in sys.argv    # tryb deweloperski (auto-przeładowanie, debugger) - NIGDY dla innych graczy
DB_PATH = os.path.join(BASE_DIR, "test.db" if TEST_MODE else "game.db")
KEY_PATH = os.path.join(BASE_DIR, "secret_key.txt")

STATE_KEYS = (("balance", STARTING_BALANCE), ("opened", 0), ("spent", 0), ("earned", 0), ("deposited", 0),
              ("contracts", 0), ("upgrades_won", 0), ("upgrades_lost", 0), ("feed_seen", 0), ("daily_total", 0))
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,20}$")
FEED_RARITY = 4  # od legendarnych w górę dropy trafiają automatycznie do aktywności znajomych


def load_secret_key():
    if not os.path.exists(KEY_PATH):
        with open(KEY_PATH, "w") as f:
            f.write(secrets.token_hex(32))
    with open(KEY_PATH) as f:
        return f.read().strip()


app = Flask(__name__)
app.config.update(
    MAX_CONTENT_LENGTH=20 * 1024 * 1024,
    SECRET_KEY=load_secret_key(),
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
    PERMANENT_SESSION_LIFETIME=datetime.timedelta(days=30),
)
rng = random.SystemRandom()


# ---------------------------------------------------------------- baza danych

def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
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
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            avatar TEXT NOT NULL DEFAULT '😎',
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_state (user_id INTEGER NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL,
                                               PRIMARY KEY (user_id, key));
        CREATE TABLE IF NOT EXISTS user_discovered (user_id INTEGER NOT NULL, person_id TEXT NOT NULL,
                                                    PRIMARY KEY (user_id, person_id));
        CREATE TABLE IF NOT EXISTS daily_claims (user_id INTEGER NOT NULL, day TEXT NOT NULL, amount INTEGER NOT NULL,
                                                 PRIMARY KEY (user_id, day));
        CREATE TABLE IF NOT EXISTS friendships (requester_id INTEGER NOT NULL, addressee_id INTEGER NOT NULL,
                                                status TEXT NOT NULL, created_at REAL NOT NULL,
                                                PRIMARY KEY (requester_id, addressee_id));
        CREATE TABLE IF NOT EXISTS showcase (user_id INTEGER NOT NULL, pos INTEGER NOT NULL, item_id INTEGER NOT NULL,
                                             PRIMARY KEY (user_id, pos));
        CREATE TABLE IF NOT EXISTS crate_access (user_id INTEGER NOT NULL, crate_id TEXT NOT NULL,
                                                 PRIMARY KEY (user_id, crate_id));
        CREATE TABLE IF NOT EXISTS user_chests (user_id INTEGER NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL,
                                                PRIMARY KEY (user_id, kind));
        CREATE TABLE IF NOT EXISTS feed (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author_id INTEGER NOT NULL,
            to_user_id INTEGER,
            kind TEXT NOT NULL,
            person_id TEXT NOT NULL,
            variant TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL
        );
    """)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(items)")]
    if "variant" not in cols:  # migracja: holo (0/1) -> variant
        conn.execute("ALTER TABLE items ADD COLUMN variant TEXT NOT NULL DEFAULT 'normal'")
        conn.execute("UPDATE items SET variant = 'holo' WHERE holo = 1")
    # migracja: wariant Alt Art został usunięty -> karty Alt Art zamieniamy na Holo (najbliższa wartość)
    conn.execute("UPDATE items SET variant = 'holo' WHERE variant = 'alt'")
    conn.execute("UPDATE feed SET variant = 'holo' WHERE variant = 'alt'")
    if "user_id" not in cols:  # migracja: karty należą do kont
        conn.execute("ALTER TABLE items ADD COLUMN user_id INTEGER")
    conn.execute("CREATE INDEX IF NOT EXISTS items_user ON items (user_id)")
    ucols = [r[1] for r in conn.execute("PRAGMA table_info(users)")]
    if "banned" not in ucols:  # migracja: blokowanie kont
        conn.execute("ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ''")
    catalog.init_tables(conn)
    conn.commit()
    catalog.rebuild(conn)
    conn.close()


def ensure_state(conn, uid):
    for key, val in STATE_KEYS:
        conn.execute("INSERT OR IGNORE INTO user_state (user_id, key, value) VALUES (?, ?, ?)", (uid, key, val))


def adopt_legacy_save(conn, uid):
    """Pierwsze konto przejmuje zapis gry sprzed wprowadzenia kont."""
    conn.execute("UPDATE items SET user_id = ? WHERE user_id IS NULL", (uid,))
    for key, value in conn.execute("SELECT key, value FROM state").fetchall():
        conn.execute("INSERT OR REPLACE INTO user_state (user_id, key, value) VALUES (?, ?, ?)", (uid, key, value))
    conn.execute("INSERT OR IGNORE INTO user_discovered (user_id, person_id) SELECT ?, person_id FROM discovered", (uid,))
    conn.execute("DELETE FROM state")
    conn.execute("DELETE FROM discovered")


# ---------------------------------------------------------------- konta

def current_user():
    if "user" not in g:
        uid = session.get("uid")
        g.user = db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
    return g.user


def uid():
    return current_user()["id"]


def login_required(fn):
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        u = current_user()
        if u is not None and u["banned"]:  # zablokowane konto - wylogowujemy
            session.clear()
            g.user = None
        if current_user() is None:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Zaloguj się", "login": True}), 401
            return redirect(url_for("login_page"))
        return fn(*a, **kw)
    return wrapper


def admin_required(fn):
    @functools.wraps(fn)
    @login_required
    def wrapper(*a, **kw):
        if not current_user()["is_admin"]:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Tylko dla admina"}), 403
            return redirect(url_for("index"))
        return fn(*a, **kw)
    return wrapper


def user_json(u):
    return {"id": u["id"], "username": u["username"], "avatar": u["avatar"], "isAdmin": bool(u["is_admin"])}


def find_user(name):
    return db().execute("SELECT * FROM users WHERE username = ?", ((name or "").strip(),)).fetchone()


@app.route("/login")
def login_page():
    if current_user():
        return redirect(url_for("index"))
    first = db().execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    return render_template("login.html", first=first)


@app.post("/api/register")
def register():
    body = request.get_json(force=True)
    name = (body.get("username") or "").strip()
    pw = body.get("password") or ""
    if not USERNAME_RE.match(name):
        return jsonify({"error": "Nazwa: 3–20 znaków (litery, cyfry, _ . -)"}), 400
    if len(pw) < 4:
        return jsonify({"error": "Hasło musi mieć co najmniej 4 znaki"}), 400
    conn = db()
    if find_user(name):
        return jsonify({"error": "Ta nazwa jest już zajęta"}), 400
    first = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    cur = conn.execute("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)",
                       (name, generate_password_hash(pw), int(first), time.time()))
    new_id = cur.lastrowid
    if first:
        adopt_legacy_save(conn, new_id)
    ensure_state(conn, new_id)
    conn.commit()
    session.clear()
    session.permanent = True
    session["uid"] = new_id
    return jsonify({"ok": True, "first": first})


@app.post("/api/login")
def login():
    body = request.get_json(force=True)
    u = find_user(body.get("username"))
    if u is None or not check_password_hash(u["password_hash"], body.get("password") or ""):
        time.sleep(0.4)
        return jsonify({"error": "Zła nazwa użytkownika lub hasło"}), 400
    if u["banned"]:
        reason = f" Powód: {u['ban_reason']}" if u["ban_reason"] else ""
        return jsonify({"error": f"To konto zostało zablokowane przez admina.{reason}"}), 403
    ensure_state(db(), u["id"])
    db().commit()
    session.clear()
    session.permanent = True
    session["uid"] = u["id"]
    return jsonify({"ok": True})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.post("/api/password")
@login_required
def change_password():
    body = request.get_json(force=True)
    if not check_password_hash(current_user()["password_hash"], body.get("old") or ""):
        return jsonify({"error": "Obecne hasło jest nieprawidłowe"}), 400
    if len(body.get("new") or "") < 4:
        return jsonify({"error": "Nowe hasło musi mieć co najmniej 4 znaki"}), 400
    db().execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(body["new"]), uid()))
    db().commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- stan gracza

def get_state(user_id=None):
    user_id = user_id or uid()
    st = dict(STATE_KEYS)
    st.update({r["key"]: r["value"] for r in db().execute("SELECT key, value FROM user_state WHERE user_id = ?", (user_id,))})
    return st


def add_state(key, delta, user_id=None):
    user_id = user_id or uid()
    ensure_state(db(), user_id)
    db().execute("UPDATE user_state SET value = value + ? WHERE user_id = ? AND key = ?", (delta, user_id, key))


def set_state(key, value):
    db().execute("INSERT OR REPLACE INTO user_state (user_id, key, value) VALUES (?, ?, ?)", (uid(), key, value))


def discovered(user_id=None):
    if user_id is None and current_user() is None:
        return set()
    return {r[0] for r in db().execute("SELECT person_id FROM user_discovered WHERE user_id = ?", (user_id or uid(),))}


def money_kind(kind):
    return kind[len("money_"):] if kind.startswith("money_") and kind[len("money_"):] in MONEY_CHESTS else None


def valid_chest_kind(kind):
    return kind in catalog.CRATES or money_kind(kind) is not None


def get_chests(user_id=None):
    rows = db().execute("SELECT kind, count FROM user_chests WHERE user_id = ? AND count > 0", (user_id or uid(),))
    return {r["kind"]: r["count"] for r in rows if valid_chest_kind(r["kind"])}


def add_chests(kind, delta, user_id=None):
    user_id = user_id or uid()
    db().execute("INSERT INTO user_chests (user_id, kind, count) VALUES (?, ?, 0) ON CONFLICT(user_id, kind) DO NOTHING",
                 (user_id, kind))
    db().execute("UPDATE user_chests SET count = MAX(0, count + ?) WHERE user_id = ? AND kind = ?", (delta, user_id, kind))


def has_access(crate_id, user_id=None):
    return db().execute("SELECT 1 FROM crate_access WHERE user_id = ? AND crate_id = ?",
                        (user_id or uid(), crate_id)).fetchone() is not None


def can_buy(crate):
    """Czy zalogowany gracz może KUPIĆ tę skrzynkę (otwieranie posiadanych skrzynek jest zawsze możliwe)."""
    u = current_user()
    if u is not None and u["is_admin"]:
        return True
    return crate["shop"] and (not crate["restricted"] or has_access(crate["id"]))


def roll_money(kind):
    c = MONEY_CHESTS[kind]
    amount = c["min"] + (c["max"] - c["min"]) * rng.random() ** c["curve"]
    return int(round(amount / 100.0)) * 100


def item_json(row):
    person = catalog.PEOPLE.get(row["person_id"])
    if person is None:  # karta usunięta z katalogu
        return None
    variant = row["variant"] if row["variant"] in VARIANTS else "normal"
    return {"id": row["id"], "person": person["id"], "variant": variant,
            "value": card_value(person, variant), "created": row["created_at"]}


def insert_item(person_id, variant):
    now = time.time()
    cur = db().execute("INSERT INTO items (person_id, holo, variant, created_at, user_id) VALUES (?, ?, ?, ?, ?)",
                       (person_id, int(variant != "normal"), variant, now, uid()))
    return {"id": cur.lastrowid, "person": person_id, "variant": variant,
            "value": card_value(catalog.PEOPLE[person_id], variant), "created": now}


def note_drops(items, kind="drop"):
    """Odkrywa tajne karty i wrzuca legendarne+ do aktywności znajomych. Zwraca nowo odkryte id."""
    new = []
    for it in items:
        rarity = catalog.PEOPLE[it["person"]]["rarity"]
        if rarity == "secret":
            cur = db().execute("INSERT OR IGNORE INTO user_discovered (user_id, person_id) VALUES (?, ?)",
                               (uid(), it["person"]))
            if cur.rowcount:
                new.append(it["person"])
        if RARITY_ORDER.index(rarity) >= FEED_RARITY:
            db().execute("INSERT INTO feed (author_id, to_user_id, kind, person_id, variant, created_at) "
                         "VALUES (?, NULL, ?, ?, ?, ?)", (uid(), kind, it["person"], it["variant"], time.time()))
    return new


def img_version(pid):
    paths = [images.find(pid), images.find(pid, True)]
    return int(sum(os.path.getmtime(p) for p in paths if p)) % 100000


def public_person(p, found):
    """Karta dla klienta - tajne karty są zamaskowane, dopóki ich nie zdobędziesz."""
    if p["rarity"] == "secret" and p["id"] not in found:
        return {"id": p["id"], "rarity": "secret", "crate": p["crate"], "crates": p["crates"], "number": p["number"], "masked": True,
                "name": "???", "type": "tv", "hp": 0, "attack": "???", "dmg": 0, "imgv": 0}
    base = {k: p.get(k) for k in ("id", "name", "rarity", "type", "hp", "attack", "dmg", "crate", "crates", "number")}
    base["imgv"] = img_version(p["id"])
    return base


# ---------------------------------------------------------------- strony

@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/admin")
@admin_required
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
    if p["rarity"] == "secret" and person_id not in discovered():
        # ?admin=1 - podgląd w panelu admina, ?feed=ID - tajna karta pokazana w aktywności znajomych
        u = current_user()
        allowed = (request.args.get("admin") == "1" and u and u["is_admin"]) or                   (u and feed_entry_visible(request.args.get("feed"), person_id)) or                   (u and friend_owns(request.args.get("owner"), person_id))
        if not allowed:
            return svg_response(MYSTERY_SVG)
    path = images.ensure(person_id, alt=(kind == "alt"))
    if path:
        resp = send_file(path, mimetype=images.mimetype(path), max_age=86400)
        if p["rarity"] == "secret":
            resp.headers["Cache-Control"] = "private, no-store"
        return resp
    initials = "".join(w[0] for w in p["name"].replace("„", "").split()[:2]).upper()
    color = RARITIES[p["rarity"]]["color"]
    return svg_response(f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
      <rect width="300" height="400" fill="#1d2233"/>
      <circle cx="150" cy="170" r="95" fill="{color}" opacity=".25"/>
      <text x="150" y="200" font-family="Arial" font-size="90" font-weight="bold"
            fill="{color}" text-anchor="middle">{initials}</text></svg>""")


# ---------------------------------------------------------------- API gry

def crate_json(c):
    return {k: c.get(k) for k in ("id", "name", "short", "code", "emoji", "color1", "color2", "price", "desc",
                                  "shop", "restricted")} | \
           {"people": [p["id"] for p in c["people"]],
            "weights": {r: catalog.crate_weight(c, r) for r in RARITY_ORDER}}


@app.get("/api/config")
@login_required
def config():
    found = discovered()
    return jsonify({
        "rarities": RARITIES,
        "rarityOrder": RARITY_ORDER,
        "variants": VARIANTS,
        "variantOrder": VARIANT_ORDER,
        "types": TYPES,
        "people": {pid: public_person(p, found) for pid, p in catalog.PEOPLE.items()},
        "crates": {cid: crate_json(c) | {"canBuy": can_buy(c)} for cid, c in catalog.CRATES.items()},
        "crateOrder": list(catalog.CRATES),
        "maxOpen": MAX_OPEN,
        "startingBalance": STARTING_BALANCE,
        "contractSize": CONTRACT_SIZE,
        "contractVariantBonus": CONTRACT_VARIANT_BONUS,
        "upgradeEdge": UPGRADE_EDGE,
        "upgradeMax": UPGRADE_MAX,
        "upgradeMaxItems": UPGRADE_MAX_ITEMS,
        "maxDeposit": MAX_DEPOSIT,
        "moneyChests": MONEY_CHESTS,
        "jackpotWeekday": JACKPOT_WEEKDAY,
        "secretOdds": SECRET_ODDS,
        "showcaseSize": SHOWCASE_SIZE,
    })


def my_items():
    rows = db().execute("SELECT * FROM items WHERE user_id = ? ORDER BY id DESC", (uid(),)).fetchall()
    return [i for i in (item_json(r) for r in rows) if i]


@app.get("/api/state")
@login_required
def state():
    return jsonify({"state": get_state(), "items": my_items(), "showcase": showcase_ids(uid()), "chests": get_chests()})


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
    weights = [catalog.crate_weight(crate, r) if r in present else 0 for r in RARITY_ORDER]
    rarity = rng.choices(RARITY_ORDER, weights=weights)[0]
    person = rng.choice([p for p in crate["people"] if p["rarity"] == rarity])
    return person, roll_variant()


@app.post("/api/open")
@login_required
def open_crates():
    body = request.get_json(force=True)
    crate = catalog.CRATES.get(body.get("crate"))
    count = int(body.get("count", 1))
    if crate is None or not 1 <= count <= MAX_OPEN:
        return jsonify({"error": "Nieprawidłowe żądanie"}), 400
    if not crate["people"]:
        return jsonify({"error": "Ta skrzynka jest pusta"}), 400
    owned = get_chests().get(crate["id"], 0) if body.get("useOwned", True) else 0
    from_inv = min(owned, count)
    if from_inv < count and not can_buy(crate):
        msg = "Ta skrzynka jest dostępna tylko dla wybranych graczy" if crate["shop"] else "Tej skrzynki nie ma teraz w sklepie"
        return jsonify({"error": msg + (f" — możesz otworzyć tylko te z ekwipunku ({owned})" if owned else "")}), 403
    cost = (count - from_inv) * crate["price"]
    if get_state()["balance"] < cost:
        return jsonify({"error": "Za mało pieniędzy!"}), 400
    if from_inv:
        add_chests(crate["id"], -from_inv)
    add_state("balance", -cost)
    add_state("spent", cost)
    add_state("opened", count)
    drops = []
    for _ in range(count):
        person, variant = roll(crate)
        drops.append(insert_item(person["id"], variant))
    new = note_drops(drops)
    db().commit()
    return jsonify({"drops": drops, "discovered": new, "state": get_state(), "fromInventory": from_inv,
                    "chests": get_chests()})


@app.post("/api/chests/buy")
@login_required
def buy_chests():
    body = request.get_json(force=True)
    crate = catalog.CRATES.get(body.get("crate"))
    count = int(body.get("count", 1))
    if crate is None or not 1 <= count <= 100:
        return jsonify({"error": "Nieprawidłowe żądanie"}), 400
    if not can_buy(crate):
        return jsonify({"error": "Nie możesz kupić tej skrzynki"}), 403
    cost = count * crate["price"]
    if get_state()["balance"] < cost:
        return jsonify({"error": "Za mało pieniędzy!"}), 400
    add_state("balance", -cost)
    add_state("spent", cost)
    add_chests(crate["id"], count)
    db().commit()
    return jsonify({"state": get_state(), "chests": get_chests()})


@app.post("/api/chests/money")
@login_required
def open_money_chest():
    kind = request.get_json(force=True).get("kind")
    if kind not in MONEY_CHESTS:
        return jsonify({"error": "Nieznana skrzynka"}), 400
    if get_chests().get("money_" + kind, 0) < 1:
        return jsonify({"error": "Nie masz takiej skrzynki"}), 400
    amount = roll_money(kind)
    add_chests("money_" + kind, -1)
    add_state("balance", amount)
    add_state("daily_total", amount)
    db().commit()
    return jsonify({"amount": amount, "kind": kind, "state": get_state(), "chests": get_chests()})


def owned_rows(ids):
    """Zwraca wiersze moich kart o podanych id albo None, jeśli czegoś brakuje."""
    if not ids or len(set(ids)) != len(ids):
        return None
    marks = ",".join("?" * len(ids))
    rows = db().execute(f"SELECT * FROM items WHERE user_id = ? AND id IN ({marks})", [uid(), *ids]).fetchall()
    if len(rows) != len(ids) or any(r["person_id"] not in catalog.PEOPLE for r in rows):
        return None
    return rows


def delete_items(ids):
    marks = ",".join("?" * len(ids))
    db().execute(f"DELETE FROM items WHERE user_id = ? AND id IN ({marks})", [uid(), *ids])
    db().execute(f"DELETE FROM showcase WHERE user_id = ? AND item_id IN ({marks})", [uid(), *ids])


def row_value(r):
    return card_value(catalog.PEOPLE[r["person_id"]], r["variant"])


@app.post("/api/sell")
@login_required
def sell():
    ids = [int(i) for i in request.get_json(force=True).get("ids", [])]
    if not ids:
        return jsonify({"error": "Nic nie wybrano"}), 400
    marks = ",".join("?" * len(ids))
    rows = db().execute(f"SELECT * FROM items WHERE user_id = ? AND id IN ({marks})", [uid(), *ids]).fetchall()
    total = sum(row_value(r) for r in rows if r["person_id"] in catalog.PEOPLE)
    delete_items([r["id"] for r in rows] or [-1])
    add_state("balance", total)
    add_state("earned", total)
    db().commit()
    return jsonify({"sold": [r["id"] for r in rows], "total": total, "state": get_state()})


@app.post("/api/deposit")
@admin_required
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
@login_required
def contract():
    ids = [int(i) for i in request.get_json(force=True).get("ids", [])]
    rows = owned_rows(ids)
    if rows is None:
        return jsonify({"error": "Nie masz tych kart"}), 400
    rarities = {catalog.PEOPLE[r["person_id"]]["rarity"] for r in rows}
    rarity = rarities.pop() if len(rarities) == 1 else None
    if rarity is not None and rarity not in CONTRACT_SIZE:
        return jsonify({"error": "Z tych kart nie da się nic wytworzyć — tajnych kart nie można zrobić w kuźni"}), 400
    if rarity not in CONTRACT_SIZE:
        return jsonify({"error": "Wszystkie karty muszą mieć tę samą rzadkość"}), 400
    if len(rows) != CONTRACT_SIZE[rarity]:
        return jsonify({"error": f"Kontrakt wymaga {CONTRACT_SIZE[rarity]} kart"}), 400
    target = RARITY_ORDER[RARITY_ORDER.index(rarity) + 1]
    pool = [catalog.PEOPLE[r["person_id"]]["crate"] for r in rows]
    pool = [c for c in pool if any(p["rarity"] == target for p in catalog.CRATES[c]["people"])]
    if not pool:
        return jsonify({"error": "W tych skrzynkach nie ma kart wyższej rzadkości"}), 400
    crate_id = rng.choice(pool)
    person = rng.choice([p for p in catalog.CRATES[crate_id]["people"] if p["rarity"] == target])
    specials = sum(r["variant"] != "normal" for r in rows)
    delete_items(ids)
    item = insert_item(person["id"], roll_variant(1 + CONTRACT_VARIANT_BONUS * specials))
    new = note_drops([item], "contract")
    add_state("contracts", 1)
    db().commit()
    return jsonify({"item": item, "crate": crate_id, "consumed": ids, "discovered": new, "state": get_state()})


@app.post("/api/upgrade")
@login_required
def upgrade():
    body = request.get_json(force=True)
    ids = [int(i) for i in body.get("ids", [])]
    target = catalog.PEOPLE.get(body.get("target"))
    variant = body.get("variant", "normal")
    rows = owned_rows(ids)
    if rows is None or not 1 <= len(rows) <= UPGRADE_MAX_ITEMS or target is None or variant not in VARIANTS:
        return jsonify({"error": "Nieprawidłowy wybór kart"}), 400
    if target["rarity"] == "secret":
        return jsonify({"error": "Tajnych kart nie da się wytworzyć w kuźni"}), 400
    stake = sum(row_value(r) for r in rows)
    goal = card_value(target, variant)
    if goal <= stake:
        return jsonify({"error": "Cel musi być wart więcej niż twoje karty"}), 400
    chance = min(UPGRADE_MAX, stake / goal * UPGRADE_EDGE)
    roll_ = rng.random()
    win = roll_ < chance
    delete_items(ids)
    item = insert_item(target["id"], variant) if win else None
    new = note_drops([item], "upgrade") if win else []
    add_state("upgrades_won" if win else "upgrades_lost", 1)
    db().commit()
    return jsonify({"win": win, "chance": chance, "roll": roll_, "item": item,
                    "consumed": ids, "discovered": new, "state": get_state()})


@app.post("/api/reset")
@login_required
def reset():
    conn = db()
    me = uid()
    conn.execute("DELETE FROM items WHERE user_id = ?", (me,))
    conn.execute("DELETE FROM user_state WHERE user_id = ?", (me,))
    conn.execute("DELETE FROM user_discovered WHERE user_id = ?", (me,))
    conn.execute("DELETE FROM showcase WHERE user_id = ?", (me,))
    conn.execute("DELETE FROM user_chests WHERE user_id = ?", (me,))
    ensure_state(conn, me)
    conn.commit()
    return jsonify({"state": get_state(), "items": []})


# ---------------------------------------------------------------- codzienna nagroda

def daily_kind(day):
    return "mega" if day.weekday() == JACKPOT_WEEKDAY else "daily"


def daily_info(user_id):
    today = datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    claimed = {r["day"] for r in db().execute(
        "SELECT day FROM daily_claims WHERE user_id = ? AND day >= ?", (user_id, monday.isoformat()))}
    week = []
    for i in range(7):
        d = monday + datetime.timedelta(days=i)
        week.append({"date": d.isoformat(), "weekday": d.weekday(), "kind": daily_kind(d),
                     "claimed": d.isoformat() in claimed, "today": d == today, "past": d < today})
    return {"today": today.isoformat(), "claimable": today.isoformat() not in claimed, "week": week,
            "todayKind": daily_kind(today), "daysToJackpot": (JACKPOT_WEEKDAY - today.weekday()) % 7}


@app.get("/api/daily")
@login_required
def daily():
    return jsonify(daily_info(uid()))


@app.post("/api/daily/claim")
@login_required
def daily_claim():
    today = datetime.date.today()
    kind = daily_kind(today)
    cur = db().execute("INSERT OR IGNORE INTO daily_claims (user_id, day, amount) VALUES (?, ?, 0)",
                       (uid(), today.isoformat()))
    if not cur.rowcount:
        return jsonify({"error": "Dzisiejsza skrzynka jest już odebrana"}), 400
    add_chests("money_" + kind, 1)
    db().commit()
    return jsonify({"kind": kind, "chests": get_chests(), "daily": daily_info(uid())})


# ---------------------------------------------------------------- znajomi

def friend_ids(user_id):
    rows = db().execute("""
        SELECT addressee_id FROM friendships WHERE requester_id = ? AND status = 'accepted'
        UNION SELECT requester_id FROM friendships WHERE addressee_id = ? AND status = 'accepted'""",
                        (user_id, user_id))
    return {r[0] for r in rows}


def relation(me, other):
    if me == other:
        return "me"
    r = db().execute("SELECT requester_id, status FROM friendships WHERE (requester_id = ? AND addressee_id = ?) "
                     "OR (requester_id = ? AND addressee_id = ?)", (me, other, other, me)).fetchone()
    if r is None:
        return "none"
    if r["status"] == "accepted":
        return "friend"
    return "outgoing" if r["requester_id"] == me else "incoming"


def collection_stats():
    """Wartość kolekcji i liczba unikalnych kart dla wszystkich graczy."""
    stats = {}
    for r in db().execute("SELECT user_id, person_id, variant FROM items WHERE user_id IS NOT NULL"):
        p = catalog.PEOPLE.get(r["person_id"])
        if p is None:
            continue
        s = stats.setdefault(r["user_id"], {"value": 0, "unique": set(), "total": 0})
        s["value"] += card_value(p, r["variant"])
        s["unique"].add(r["person_id"])
        s["total"] += 1
    return stats


def brief(u, stats=None):
    s = (stats or {}).get(u["id"], {"value": 0, "unique": set(), "total": 0})
    return dict(user_json(u), value=s["value"], unique=len(s["unique"]), total=s["total"])


@app.get("/api/friends")
@login_required
def friends():
    me = uid()
    stats = collection_stats()
    users = {u["id"]: u for u in db().execute("SELECT * FROM users")}
    rows = db().execute("SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ?", (me, me)).fetchall()
    out = {"friends": [], "incoming": [], "outgoing": []}
    for r in rows:
        other = r["addressee_id"] if r["requester_id"] == me else r["requester_id"]
        if other not in users:
            continue
        key = "friends" if r["status"] == "accepted" else ("outgoing" if r["requester_id"] == me else "incoming")
        out[key].append(brief(users[other], stats))
    for k in out:
        out[k].sort(key=lambda x: x["username"].lower())
    return jsonify(out)


@app.post("/api/friends/request")
@login_required
def friend_request():
    other = find_user(request.get_json(force=True).get("username"))
    me = uid()
    if other is None:
        return jsonify({"error": "Nie ma takiego gracza"}), 404
    rel = relation(me, other["id"])
    if rel == "me":
        return jsonify({"error": "Nie możesz zaprosić samego siebie 🙂"}), 400
    if rel == "friend":
        return jsonify({"error": "Już jesteście znajomymi"}), 400
    if rel == "outgoing":
        return jsonify({"error": "Zaproszenie już wysłane"}), 400
    if rel == "incoming":  # ta osoba już nas zaprosiła - od razu akceptujemy
        db().execute("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?",
                     (other["id"], me))
        db().commit()
        return jsonify({"ok": True, "status": "friend"})
    db().execute("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)",
                 (me, other["id"], time.time()))
    db().commit()
    return jsonify({"ok": True, "status": "outgoing"})


@app.post("/api/friends/respond")
@login_required
def friend_respond():
    body = request.get_json(force=True)
    other = find_user(body.get("username"))
    if other is None or relation(uid(), other["id"]) != "incoming":
        return jsonify({"error": "Brak takiego zaproszenia"}), 400
    if body.get("accept"):
        db().execute("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?",
                     (other["id"], uid()))
    else:
        db().execute("DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ?", (other["id"], uid()))
    db().commit()
    return jsonify({"ok": True})


@app.post("/api/friends/remove")
@login_required
def friend_remove():
    other = find_user(request.get_json(force=True).get("username"))
    if other is None:
        return jsonify({"error": "Nie ma takiego gracza"}), 404
    db().execute("DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)",
                 (uid(), other["id"], other["id"], uid()))
    db().commit()
    return jsonify({"ok": True})


@app.get("/api/users/search")
@login_required
def user_search():
    q = (request.args.get("q") or "").strip()
    if len(q) < 1:
        return jsonify({"users": []})
    rows = db().execute("SELECT * FROM users WHERE banned = 0 AND username LIKE ? ESCAPE '\\' ORDER BY username LIMIT 10",
                        ("%" + q.replace("%", "").replace("_", "\\_") + "%",)).fetchall()
    return jsonify({"users": [user_json(u) for u in rows]})


# ---------------------------------------------------------------- aktywność / pokazywanie kart

def visible_feed_sql():
    return """FROM feed f JOIN users u ON u.id = f.author_id
              WHERE (f.author_id = :me OR f.to_user_id = :me
                 OR (f.to_user_id IS NULL AND f.author_id IN (SELECT value FROM json_each(:friends))))"""


def friend_owns(owner_name, person_id):
    """Czy gracz o tej nazwie jest moim znajomym i ma tę kartę (wtedy widzę ją na jego profilu)."""
    owner = find_user(owner_name) if owner_name else None
    if owner is None or owner["id"] not in friend_ids(uid()):
        return False
    return db().execute("SELECT 1 FROM items WHERE user_id = ? AND person_id = ? LIMIT 1",
                        (owner["id"], person_id)).fetchone() is not None


def feed_entry_visible(feed_id, person_id):
    try:
        feed_id = int(feed_id)
    except (TypeError, ValueError):
        return False
    me = uid()
    row = db().execute(f"SELECT f.id {visible_feed_sql()} AND f.id = :fid AND f.person_id = :pid",
                       {"me": me, "friends": json.dumps(sorted(friend_ids(me))), "fid": feed_id, "pid": person_id}).fetchone()
    return row is not None


@app.get("/api/feed")
@login_required
def feed():
    me = uid()
    params = {"me": me, "friends": json.dumps(sorted(friend_ids(me)))}
    rows = db().execute(f"SELECT f.*, u.username, u.avatar, (SELECT username FROM users WHERE id = f.to_user_id) AS to_name "
                        f"{visible_feed_sql()} ORDER BY f.id DESC LIMIT 60", params).fetchall()
    out = []
    found = discovered()
    for r in rows:
        p = catalog.PEOPLE.get(r["person_id"])
        if p is None:
            continue
        # tajną kartę znajomego widać w aktywności, nawet jeśli samemu jej jeszcze nie odkryłeś
        reveal = public_person(p, {p["id"]}) if p["rarity"] == "secret" and p["id"] not in found else None
        out.append({"id": r["id"], "kind": r["kind"], "person": r["person_id"], "variant": r["variant"], "reveal": reveal,
                    "message": r["message"], "created": r["created_at"], "mine": r["author_id"] == me,
                    "author": {"username": r["username"], "avatar": r["avatar"]}, "to": r["to_name"],
                    "value": card_value(catalog.PEOPLE[r["person_id"]], r["variant"])})
    return jsonify({"feed": out, "seen": get_state()["feed_seen"]})


@app.post("/api/feed/seen")
@login_required
def feed_seen():
    last = db().execute("SELECT MAX(id) FROM feed").fetchone()[0] or 0
    set_state("feed_seen", last)
    db().commit()
    return jsonify({"ok": True})


@app.post("/api/show")
@login_required
def show_card():
    body = request.get_json(force=True)
    rows = owned_rows([int(body.get("item_id", 0))])
    if rows is None:
        return jsonify({"error": "Nie masz tej karty"}), 400
    to = body.get("to") or "all"
    to_id = None
    if to != "all":
        other = find_user(to)
        if other is None or other["id"] not in friend_ids(uid()):
            return jsonify({"error": "Możesz pokazywać karty tylko znajomym"}), 400
        to_id = other["id"]
    elif not friend_ids(uid()):
        return jsonify({"error": "Nie masz jeszcze znajomych 🙂"}), 400
    msg = (body.get("message") or "").strip()[:140]
    r = rows[0]
    db().execute("INSERT INTO feed (author_id, to_user_id, kind, person_id, variant, message, created_at) "
                 "VALUES (?, ?, 'show', ?, ?, ?, ?)", (uid(), to_id, r["person_id"], r["variant"], msg, time.time()))
    db().commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- profile, gablota, ranking

def showcase_ids(user_id):
    rows = db().execute("""SELECT s.item_id FROM showcase s JOIN items i ON i.id = s.item_id AND i.user_id = s.user_id
                           WHERE s.user_id = ? ORDER BY s.pos""", (user_id,))
    return [r[0] for r in rows]


@app.post("/api/showcase")
@login_required
def set_showcase():
    ids = [int(i) for i in request.get_json(force=True).get("ids", [])][:SHOWCASE_SIZE]
    if ids and owned_rows(ids) is None:
        return jsonify({"error": "Nie masz tych kart"}), 400
    db().execute("DELETE FROM showcase WHERE user_id = ?", (uid(),))
    for pos, item_id in enumerate(ids):
        db().execute("INSERT INTO showcase (user_id, pos, item_id) VALUES (?, ?, ?)", (uid(), pos, item_id))
    db().commit()
    return jsonify({"ok": True, "showcase": ids})


@app.post("/api/profile")
@login_required
def set_profile():
    avatar = (request.get_json(force=True).get("avatar") or "").strip()
    if not 1 <= len(avatar) <= 8:
        return jsonify({"error": "Nieprawidłowy awatar"}), 400
    db().execute("UPDATE users SET avatar = ? WHERE id = ?", (avatar, uid()))
    db().commit()
    return jsonify({"ok": True})


@app.get("/api/users/<name>")
@login_required
def profile(name):
    u = find_user(name)
    if u is None:
        return jsonify({"error": "Nie ma takiego gracza"}), 404
    st = get_state(u["id"])
    stats = collection_stats()
    collection = [{"person": r[0], "variant": r[1], "count": r[2]} for r in db().execute(
        "SELECT person_id, variant, COUNT(*) FROM items WHERE user_id = ? GROUP BY person_id, variant", (u["id"],))
        if r[0] in catalog.PEOPLE]
    show = []
    for item_id in showcase_ids(u["id"]):
        r = db().execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        it = item_json(r)
        if it:
            show.append(it)
    rel = relation(uid(), u["id"])
    # tajne karty znajomego widać na jego profilu, nawet jeśli samemu się ich jeszcze nie odkryło
    reveal = {}
    if rel == "friend":
        found = discovered()
        for c in collection:
            p = catalog.PEOPLE[c["person"]]
            if p["rarity"] == "secret" and p["id"] not in found:
                reveal[p["id"]] = public_person(p, {p["id"]})
    return jsonify({
        "user": brief(u, stats) | {"created": u["created_at"]},
        "relation": rel,
        "reveal": reveal,
        "stats": {"opened": st.get("opened", 0), "contracts": st.get("contracts", 0),
                  "upgradesWon": st.get("upgrades_won", 0), "upgradesLost": st.get("upgrades_lost", 0)},
        "collection": collection,
        "showcase": show,
    })


@app.get("/api/ranking")
@login_required
def ranking():
    stats = collection_stats()
    opened = {r[0]: r[1] for r in db().execute("SELECT user_id, value FROM user_state WHERE key = 'opened'")}
    friends_of_me = friend_ids(uid())
    players = []
    for u in db().execute("SELECT * FROM users WHERE banned = 0"):
        b = brief(u, stats)
        b["opened"] = opened.get(u["id"], 0)
        b["friend"] = u["id"] in friends_of_me
        b["me"] = u["id"] == uid()
        players.append(b)
    total_cards = len(catalog.PEOPLE)
    return jsonify({"players": players, "totalCards": total_cards})


@app.get("/api/me")
@login_required
def me():
    u = current_user()
    me_id = u["id"]
    incoming = db().execute("SELECT COUNT(*) FROM friendships WHERE addressee_id = ? AND status = 'pending'",
                            (me_id,)).fetchone()[0]
    params = {"me": me_id, "friends": json.dumps(sorted(friend_ids(me_id)))}
    unread = db().execute(f"SELECT COUNT(*) {visible_feed_sql()} AND f.author_id != :me AND f.id > :seen",
                          dict(params, seen=get_state()["feed_seen"])).fetchone()[0]
    return jsonify({"user": user_json(u), "dailyClaimable": daily_info(me_id)["claimable"],
                    "incoming": incoming, "unread": unread})


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
    return dict({k: p.get(k) for k in ("id", "name", "rarity", "type", "hp", "attack", "dmg", "crate", "crates",
                                       "number", "builtin", "modified")},
                wiki=list(p["wiki"]) if p.get("wiki") else None,
                hasImage=bool(images.find(p["id"])), hasAlt=bool(images.find(p["id"], True)),
                imgv=img_version(p["id"]))


def refresh_catalog():
    catalog.rebuild(db())


@app.get("/api/admin/catalog")
@admin_required
def admin_catalog():
    counts = {r[0]: r[1] for r in db().execute("SELECT person_id, COUNT(*) FROM items GROUP BY person_id")}
    access = {}
    for r in db().execute("SELECT user_id, crate_id FROM crate_access"):
        access.setdefault(r[1], []).append(r[0])
    crates = [dict(crate_json(c), builtin=c["builtin"], modified=c["modified"], hidden=False,
                   customWeights=c["weights"], allowed=access.get(c["id"], []))
              for c in catalog.CRATES.values()]
    crates += [dict(crate_json(dict(c, people=[])), builtin=True, modified=False, hidden=True,
                    customWeights=c.get("weights") or {}, allowed=access.get(c["id"], []))
               for c in catalog.HIDDEN_CRATES.values()]
    cards = [dict(admin_card_json(p), owned=counts.get(p["id"], 0), hidden=False) for p in catalog.PEOPLE.values()]
    cards += [dict(admin_card_json(dict(p, number=0)), owned=counts.get(p["id"], 0), hidden=True)
              for p in catalog.HIDDEN_CARDS.values() if p.get("crate") in catalog.CRATES]
    users = [{"id": u["id"], "username": u["username"], "avatar": u["avatar"]}
             for u in db().execute("SELECT * FROM users ORDER BY username COLLATE NOCASE")]
    return jsonify({"crates": crates, "cards": cards, "rarities": RARITIES, "rarityOrder": RARITY_ORDER,
                    "types": TYPES, "defaultPrice": CRATE_PRICE, "users": users})


@app.post("/api/admin/crates")
@admin_required
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
        "shop": bool(body.get("shop", True)),
        "restricted": bool(body.get("restricted", False)),
    }
    weights = {}
    for r, w in (body.get("weights") or {}).items():
        if r in RARITIES and w not in (None, ""):
            try:
                weights[r] = max(0.0, min(1000.0, float(w)))
            except (TypeError, ValueError):
                return jsonify({"error": "Szanse muszą być liczbami"}), 400
    fields["weights"] = weights
    cid = body.get("id")
    if not cid:
        cid = unique_id(slug(name), set(catalog.CRATES) | set(catalog.HIDDEN_CRATES))
    catalog.save_override(db(), "catalog_crates", cid, fields)
    if "allowed" in body:  # lista graczy z dostępem do skrzynki
        db().execute("DELETE FROM crate_access WHERE crate_id = ?", (cid,))
        for user_id in {int(x) for x in body.get("allowed") or []}:
            db().execute("INSERT OR IGNORE INTO crate_access (user_id, crate_id) VALUES (?, ?)", (user_id, cid))
    db().commit()
    refresh_catalog()
    return jsonify({"ok": True, "id": cid})


@app.delete("/api/admin/crates/<cid>")
@admin_required
def admin_delete_crate(cid):
    conn = db()
    crate = catalog.CRATES.get(cid)
    if crate is None:
        return jsonify({"error": "Nie ma takiej skrzynki"}), 404
    if crate["builtin"]:
        catalog.mark_deleted(conn, "catalog_crates", cid)  # wbudowaną tylko ukrywamy
    else:
        catalog.remove_row(conn, "catalog_crates", cid)
        conn.execute("DELETE FROM crate_access WHERE crate_id = ?", (cid,))
        for p in crate["people"]:
            if not p["builtin"] and p["crates"] == [cid]:  # karty tylko z tej skrzynki
                catalog.remove_row(conn, "catalog_cards", p["id"])
    conn.commit()
    refresh_catalog()
    return jsonify({"ok": True})


@app.post("/api/admin/crates/<cid>/restore")
@admin_required
def admin_restore_crate(cid):
    if catalog.builtin_crate(cid) is None:
        return jsonify({"error": "To nie jest wbudowana skrzynka"}), 400
    catalog.remove_row(db(), "catalog_crates", cid)
    db().commit()
    refresh_catalog()
    return jsonify({"ok": True})


@app.post("/api/admin/cards")
@admin_required
def admin_save_card():
    f = request.form
    name = (f.get("name") or "").strip()
    crates = [c for c in dict.fromkeys(f.getlist("crates") or [f.get("crate")]) if c in catalog.CRATES]
    crate = crates[0] if crates else None
    if not name:
        return jsonify({"error": "Podaj nazwę karty"}), 400
    if crate is None:
        return jsonify({"error": "Wybierz co najmniej jedną skrzynkę"}), 400
    if f.get("rarity") not in RARITIES or f.get("type") not in TYPES:
        return jsonify({"error": "Nieprawidłowa rzadkość lub typ"}), 400
    try:
        hp, dmg = int(f.get("hp") or 50), int(f.get("dmg") or 30)
    except ValueError:
        return jsonify({"error": "HP i obrażenia muszą być liczbami"}), 400
    wiki_title = (f.get("wiki_title") or "").strip()
    fields = {
        "name": name[:60], "crate": crate, "crates": crates, "rarity": f["rarity"], "type": f["type"],
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
@admin_required
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
@admin_required
def admin_restore_card(pid):
    if catalog.builtin_card(pid) is None:
        return jsonify({"error": "To nie jest wbudowana karta"}), 400
    catalog.remove_row(db(), "catalog_cards", pid)
    db().commit()
    refresh_catalog()
    return jsonify({"ok": True})


@app.post("/api/admin/cards/<pid>/refetch")
@admin_required
def admin_refetch(pid):
    if pid not in catalog.PEOPLE:
        return jsonify({"error": "Nie ma takiej karty"}), 404
    main = images.fetch([pid], force=True).get(pid)
    return jsonify({"ok": True, "main": bool(main)})


@app.get("/api/admin/users")
@admin_required
def admin_users():
    stats = collection_stats()
    bal = {r[0]: r[1] for r in db().execute("SELECT user_id, value FROM user_state WHERE key = 'balance'")}
    access = {}
    for r in db().execute("SELECT user_id, crate_id FROM crate_access"):
        access.setdefault(r[0], []).append(r[1])
    users = [dict(brief(u, stats), balance=bal.get(u["id"], 0), created=u["created_at"], chests=get_chests(u["id"]),
                  banned=bool(u["banned"]), banReason=u["ban_reason"], access=access.get(u["id"], []))
             for u in db().execute("SELECT * FROM users ORDER BY id")]
    restricted = [{"id": c["id"], "name": c["name"], "emoji": c["emoji"], "shop": c["shop"]}
                  for c in catalog.CRATES.values() if c["restricted"]]
    kinds = [{"kind": c["id"], "name": c["name"], "emoji": c["emoji"]} for c in catalog.CRATES.values()]
    kinds += [{"kind": "money_" + k, "name": m["name"], "emoji": m["emoji"]} for k, m in MONEY_CHESTS.items()]
    return jsonify({"users": users, "me": uid(), "chestKinds": kinds, "restrictedCrates": restricted})


@app.post("/api/admin/users/<int:user_id>/ban")
@admin_required
def admin_ban(user_id):
    if user_id == uid():
        return jsonify({"error": "Nie możesz zablokować samego siebie"}), 400
    body = request.get_json(force=True)
    ban = bool(body.get("ban", True))
    db().execute("UPDATE users SET banned = ?, ban_reason = ? WHERE id = ?",
                 (int(ban), (body.get("reason") or "").strip()[:200] if ban else "", user_id))
    db().commit()
    return jsonify({"ok": True})


@app.get("/api/admin/users/<int:user_id>/cards")
@admin_required
def admin_user_cards(user_id):
    rows = db().execute("SELECT person_id, variant, COUNT(*) AS n FROM items WHERE user_id = ? "
                        "GROUP BY person_id, variant", (user_id,)).fetchall()
    cards = []
    for r in rows:
        p = catalog.PEOPLE.get(r["person_id"])
        if p:
            cards.append({"person": p["id"], "name": p["name"], "rarity": p["rarity"], "variant": r["variant"],
                          "count": r["n"], "value": card_value(p, r["variant"])})
    order = RARITY_ORDER
    cards.sort(key=lambda c: (-order.index(c["rarity"]), c["name"], c["variant"]))
    return jsonify({"cards": cards, "variants": {k: v["name"] for k, v in VARIANTS.items()}})


@app.post("/api/admin/users/<int:user_id>/cards/delete")
@admin_required
def admin_delete_user_cards(user_id):
    body = request.get_json(force=True)
    conn = db()
    if body.get("all"):
        ids = [r[0] for r in conn.execute("SELECT id FROM items WHERE user_id = ?", (user_id,))]
    else:
        n = max(1, int(body.get("count") or 1))
        ids = [r[0] for r in conn.execute("SELECT id FROM items WHERE user_id = ? AND person_id = ? AND variant = ? "
                                          "ORDER BY id DESC LIMIT ?", (user_id, body.get("person"), body.get("variant"), n))]
    if ids:
        marks = ",".join("?" * len(ids))
        conn.execute(f"DELETE FROM items WHERE id IN ({marks})", ids)
        conn.execute(f"DELETE FROM showcase WHERE item_id IN ({marks})", ids)
    conn.commit()
    return jsonify({"ok": True, "deleted": len(ids)})


@app.post("/api/admin/users/<int:user_id>/access")
@admin_required
def admin_set_access(user_id):
    crates = [c for c in request.get_json(force=True).get("crates", []) if c in catalog.CRATES]
    db().execute("DELETE FROM crate_access WHERE user_id = ?", (user_id,))
    for cid in crates:
        db().execute("INSERT OR IGNORE INTO crate_access (user_id, crate_id) VALUES (?, ?)", (user_id, cid))
    db().commit()
    return jsonify({"ok": True})


@app.post("/api/admin/users/<int:user_id>/chests")
@admin_required
def admin_give_chests(user_id):
    body = request.get_json(force=True)
    kind = body.get("kind") or ""
    try:
        count = int(body.get("count", 0))
    except (TypeError, ValueError):
        count = 0
    if not valid_chest_kind(kind) or not -1000 <= count <= 1000 or count == 0:
        return jsonify({"error": "Nieprawidłowa skrzynka lub ilość"}), 400
    if db().execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
        return jsonify({"error": "Nie ma takiego gracza"}), 404
    add_chests(kind, count, user_id)
    db().commit()
    return jsonify({"ok": True, "chests": get_chests(user_id)})


@app.post("/api/admin/users/<int:user_id>/money")
@admin_required
def admin_money(user_id):
    try:
        amount = int(request.get_json(force=True).get("amount", 0))
    except (TypeError, ValueError):
        amount = 0
    if not -MAX_DEPOSIT <= amount <= MAX_DEPOSIT or amount == 0:
        return jsonify({"error": "Nieprawidłowa kwota"}), 400
    ensure_state(db(), user_id)
    add_state("balance", amount, user_id)
    if amount > 0:
        add_state("deposited", amount, user_id)
    db().commit()
    return jsonify({"ok": True})


@app.post("/api/admin/users/<int:user_id>/admin")
@admin_required
def admin_toggle(user_id):
    if user_id == uid():
        return jsonify({"error": "Nie możesz odebrać uprawnień samemu sobie"}), 400
    db().execute("UPDATE users SET is_admin = 1 - is_admin WHERE id = ?", (user_id,))
    db().commit()
    return jsonify({"ok": True})


@app.post("/api/admin/users/<int:user_id>/password")
@admin_required
def admin_password(user_id):
    pw = request.get_json(force=True).get("password") or ""
    if len(pw) < 4:
        return jsonify({"error": "Hasło musi mieć co najmniej 4 znaki"}), 400
    db().execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(pw), user_id))
    db().commit()
    return jsonify({"ok": True})


@app.delete("/api/admin/users/<int:user_id>")
@admin_required
def admin_delete_user(user_id):
    if user_id == uid():
        return jsonify({"error": "Nie możesz usunąć samego siebie"}), 400
    conn = db()
    for sql in ("DELETE FROM items WHERE user_id = ?", "DELETE FROM user_state WHERE user_id = ?",
                "DELETE FROM user_discovered WHERE user_id = ?", "DELETE FROM daily_claims WHERE user_id = ?",
                "DELETE FROM showcase WHERE user_id = ?", "DELETE FROM feed WHERE author_id = ? OR to_user_id = ?",
                "DELETE FROM user_chests WHERE user_id = ?", "DELETE FROM crate_access WHERE user_id = ?",
                "DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?", "DELETE FROM users WHERE id = ?"):
        conn.execute(sql, (user_id,) * sql.count("?"))
    conn.commit()
    return jsonify({"ok": True})


init_db()


def lan_address():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "?"


if __name__ == "__main__":
    port = 5001 if TEST_MODE else 5000
    # w trybie debug Flask uruchamia proces dwa razy - pobieramy zdjęcia tylko w procesie roboczym
    if not DEV_MODE or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        images.prefetch_all_async()
        if LAN_MODE:
            print(f"\n  Znajomi w tej samej sieci wchodzą na:  http://{lan_address()}:{port}\n")
    if not DEV_MODE or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        print(f"\n  Gra działa na:  http://127.0.0.1:{port}\n")
    app.run(host="0.0.0.0" if LAN_MODE else "127.0.0.1", port=port, debug=DEV_MODE and not LAN_MODE, threaded=True)
