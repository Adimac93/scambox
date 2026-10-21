"""Katalog kart i skrzynek.

Domyślne dane pochodzą z data.py. Zmiany z panelu admina są zapisane w bazie
(tabele catalog_crates / catalog_cards) i nakładane na dane domyślne:
  - wiersz z deleted=1 ukrywa skrzynkę/kartę,
  - wiersz z danymi nadpisuje pola wbudowanej skrzynki/karty albo dodaje nową.

Karta może należeć do kilku skrzynek: pole "crates" (lista), "crate" to skrzynka główna
(jej kod i numer są nadrukowane na karcie).
"""
import json
import re

import data

CRATE_FIELDS = ("name", "short", "code", "emoji", "color1", "color2", "price", "desc", "shop", "restricted", "weights",
                "variants")
CARD_FIELDS = ("name", "wiki", "rarity", "type", "hp", "attack", "dmg", "attack2", "dmg2", "kind1", "kind2", "abilities",
               "arena", "crate", "crates", "country", "source", "fixedVariant", "style", "subtitle", "desc")
SUBTITLE_MAX, DESC_MAX = 40, 1000   # podtytuł (krótki tekst na karcie) i opis (obok karty w podglądzie) - z panelu admina
COUNTRY_RE = re.compile(r"^[a-z]{2}(-[a-z0-9]{1,3})?$")   # kod kraju ISO 3166 (np. pl, de, gb-eng) - do wariantu flagowego
STICKER_ID_RE = re.compile(r"^[a-f0-9]{8}$")


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


def clean_country(raw):
    """Kod kraju karty (do wariantu flagowego): "PL" -> "pl"; nieprawidłowy -> ""."""
    code = str(raw or "").strip().lower().replace("_", "-")
    return code if COUNTRY_RE.match(code) else ""


def crate_variants(crate, person=None):
    """Warianty wyjątkowe, które mogą wypaść z tej skrzynki (dla tej karty: flagowy tylko z ustawionym krajem,
    plus warianty przypisane do samej karty, np. Rzulty)."""
    out = [v for v in crate.get("variants") or [] if v != "flag" or person is None or person.get("country")]
    return out + (data.card_variants(person["id"]) if person is not None else [])


def photo_variants(pid):
    """Warianty, dla których ta karta może mieć własne zdjęcie: przypisane do karty (np. Rzulty JP2) i wyjątkowe warianty
    z polem "photo" (np. Halloweenowa), jeśli są włączone w którejś skrzynce karty."""
    out = data.card_variants(pid)
    person = PEOPLE.get(pid)
    if person:
        for c in person.get("crates") or []:
            if c in CRATES:
                out += [v for v in CRATES[c].get("variants") or [] if data.VARIANTS[v].get("photo") and v not in out]
    return out


def is_special(person):
    """Karta specjalna (rzadkość Specjalna): tylko z kasyna albo z linku, zawsze w jednym wariancie, nie znika z gry."""
    return person is not None and person.get("rarity") == "special"


def possible_variants(person):
    """Warianty, w których ta karta może istnieć: zwykłe zawsze, wyjątkowe tylko z jej skrzynek (flagowy - z krajem),
    własne warianty karty (np. Rzulty tylko dla Jana Pawła II) i połączenia flagi z każdym z nich ("flag+gold")
    (Lampionowa / Diabelska - "noCombo" - bez połączeń). Karta specjalna - tylko jej jeden wariant."""
    if is_special(person):
        return [person["fixedVariant"]]
    extra = set(data.card_variants(person["id"]))
    for c in person.get("crates") or []:
        if c in CRATES:
            extra |= set(crate_variants(CRATES[c], person))
    base = [v for v in data.VARIANT_ORDER if not data.VARIANTS[v].get("combo")
            and (not data.VARIANTS[v].get("exclusive") or v in extra)]
    combos = {data.combine_variant(layer, b) for layer in base
              if data.VARIANTS[layer].get("layer") and not data.VARIANTS[layer].get("noCombo")
              for b in base if b != "normal" and not data.VARIANTS[b].get("layer")}
    return [v for v in data.VARIANT_ORDER if v in base or v in combos]


def _int(v, lo, hi, default=None):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _num(v, lo, hi, default):
    try:
        return round(max(lo, min(hi, float(v))), 2)
    except (TypeError, ValueError):
        return default


def sticker_file_id(variant):
    """Nazwa, pod którą images.save/find trzymają wgrane naklejki wariantu: image_cache/__stk_mlg__<id>.png"""
    return f"__stk_{variant}"


def clean_stickers(raw):
    """Naklejki wariantu (strona /stickers), w kolejności od spodu: [{"id", "src": "upload" (plik wgrany przez admina) albo
    nazwa z data.STICKER_LIBRARY, "x", "y" - środek naklejki w % szerokości / wysokości karty (może wystawać poza kartę),
    "w" - szerokość w % szerokości karty, "rot" - obrót w stopniach, "flip" - odbicie w poziomie, "anim", "v" - wersja pliku}]"""
    out, seen = [], set()
    for s in raw if isinstance(raw, list) else []:
        if not isinstance(s, dict) or not STICKER_ID_RE.match(str(s.get("id") or "")) or s["id"] in seen:
            continue
        if s.get("src") != "upload" and s.get("src") not in data.STICKER_LIBRARY:
            continue
        seen.add(s["id"])
        out.append({"id": s["id"], "src": s["src"], **_placement(s), "v": _int(s.get("v"), 0, 10 ** 9, 0)})
    return out[:data.STICKER_MAX]


def _placement(s):
    """Położenie i wygląd naklejki (bez id, pliku i wersji) - wspólne dla naklejek i zmian na jednej karcie."""
    return {"x": _num(s.get("x"), -25, 125, 50), "y": _num(s.get("y"), -25, 125, 50), "w": _num(s.get("w"), 2, 160, 30),
            "rot": _num(s.get("rot"), -180, 180, 0), "flip": bool(s.get("flip")),
            "anim": s.get("anim") if s.get("anim") in data.STICKER_ANIMS else "none"}


def clean_card_stickers(raw):
    """Naklejki jednej karty ponad standardowe naklejki wariantu: "edits" - zmiany standardowych naklejek na tej karcie
    ({id: położenie jak w _placement} albo {id: {"hidden": True}} - ukryta), "extra" - naklejki tylko tej karty (jak
    w clean_stickers; leżą nad standardowymi). None = karta ma same standardowe naklejki."""
    raw = raw if isinstance(raw, dict) else {}
    edits = {sid: {"hidden": True} if e.get("hidden") else _placement(e)
             for sid, e in (raw.get("edits") if isinstance(raw.get("edits"), dict) else {}).items()
             if STICKER_ID_RE.match(str(sid)) and isinstance(e, dict)}
    extra = clean_stickers(raw.get("extra"))
    return {"edits": edits, "extra": extra} if edits or extra else None


def card_stickers(variant, pid):
    """Naklejki karty w tym wariancie: standardowe (ze zmianami tej karty, bez ukrytych) i nad nimi naklejki tylko tej karty."""
    base = STICKERS.get(variant, [])
    own = STICKER_CARDS.get(variant, {}).get(pid)
    if not own:
        return base
    out = []
    for s in base:
        e = own["edits"].get(s["id"])
        if not (e and e.get("hidden")):
            out.append(dict(s, **e) if e else s)
    return out + own["extra"]


def sticker_uploads(variant):
    """Id wgranych plików, których używają naklejki wariantu (standardowe i na pojedynczych kartach)."""
    lists = [STICKERS.get(variant, [])] + [own["extra"] for own in STICKER_CARDS.get(variant, {}).values()]
    return {s["id"] for lst in lists for s in lst if s["src"] == "upload"}


def clean_arena(raw):
    """Ustawienia zdolności w Arenie - po jednym na zdolność (1., 2., dodatkowe), w tej samej kolejności:
    {"visual", "cost": None = automatycznie z wartości, "target", "effects": [{"id", "value", "turns", "target"}]}"""
    out = []
    for cfg in (raw if isinstance(raw, list) else [])[:2 + data.MAX_EXTRA_ABILITIES]:
        cfg = cfg if isinstance(cfg, dict) else {}
        effects = []
        for e in (cfg.get("effects") if isinstance(cfg.get("effects"), list) else [])[:data.MAX_ABILITY_EFFECTS]:
            if not isinstance(e, dict) or e.get("id") not in data.ARENA_EFFECTS:
                continue
            effects.append({"id": e["id"], "value": _int(e.get("value"), 0, 9999, 0), "turns": _int(e.get("turns"), 1, 9, 1),
                            "target": e.get("target") if e.get("target") in data.ARENA_EFFECT_TARGETS else "target"})
        out.append({"visual": cfg.get("visual") if cfg.get("visual") in data.ARENA_VISUALS else "hit",
                    "cost": _int(cfg.get("cost"), 0, 10) if cfg.get("cost") not in (None, "", "auto") else None,
                    "target": cfg.get("target") if cfg.get("target") in data.ARENA_TARGETS else None,
                    "effects": effects})
    return out

CRATES = {}         # id -> skrzynka (z listą "people" w kolejności numerów)
PEOPLE = {}         # id -> karta
HIDDEN_CRATES = {}  # wbudowane, ukryte przez admina
HIDDEN_CARDS = {}
STICKERS = {}       # wariant -> naklejki od admina (clean_stickers), tylko warianty z "stickers" w data.VARIANTS
STICKER_CARDS = {}  # wariant -> {karta: zmiany naklejek na tej karcie (clean_card_stickers)}


def init_tables(conn):
    # catalog_variants: zmiany wariantów z panelu admina - na razie naklejki (id = klucz wariantu):
    # {"stickers": [standardowe naklejki], "cards": {karta: {"edits": {...}, "extra": [...]}}}
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS catalog_crates (id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', deleted INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS catalog_cards  (id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', deleted INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS catalog_variants (id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', deleted INTEGER NOT NULL DEFAULT 0);
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
    global CRATES, PEOPLE, HIDDEN_CRATES, HIDDEN_CARDS, STICKERS, STICKER_CARDS
    crates, people, hidden_crates, hidden_cards = {}, {}, {}, {}
    STICKERS, STICKER_CARDS = {}, {}
    for row in conn.execute("SELECT id, data FROM catalog_variants WHERE deleted = 0"):
        if row[0] in data.STICKER_VARIANTS:
            d = json.loads(row[1] or "{}")
            STICKERS[row[0]] = clean_stickers(d.get("stickers"))
            cards = {pid: clean_card_stickers(own) for pid, own in (d.get("cards") or {}).items()}
            STICKER_CARDS[row[0]] = {pid: own for pid, own in cards.items() if own}

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
            elif "crates" in d:
                # skrzynki dodane w kodzie PO zapisaniu karty w panelu (np. Skrzynia Halloween z kartą próbną) dopisujemy;
                # skrzynki, które już istniały i admin je odznaczył ("crates_seen"), zostają odznaczone
                seen = set(d.get("crates_seen") or (set(data.CRATES) - data.CRATES_ADDED_LATER))
                people[pid]["crates"] = list(d["crates"]) + [c for c in old_crates if c not in seen and c not in d["crates"]]
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
        p["arena"] = clean_arena(p.get("arena"))
        p["country"] = clean_country(p.get("country"))
        p["subtitle"] = str(p.get("subtitle") or "").strip()[:SUBTITLE_MAX]
        p["desc"] = str(p.get("desc") or "").strip()[:DESC_MAX]
        if p.get("rarity") not in data.RARITIES:
            p["rarity"] = "green"
        if p.get("type") not in data.TYPES:
            p["type"] = "tv"
        p["crates"] = [c for c in dict.fromkeys(p.get("crates") or []) if c in crates]
        p["crate"] = p["crates"][0] if p["crates"] else None
        if p["rarity"] == "special":   # karta specjalna: skąd (kasyno / link), jedyny wariant i wygląd (1-6, makiety)
            p["source"] = p.get("source") if p.get("source") in data.SPECIAL_SOURCES else "casino"
            p["fixedVariant"] = (p.get("fixedVariant") if p.get("fixedVariant") in data.SPECIAL_VARIANTS
                                 else "jeans" if p["source"] == "link" else "joker")
            p["style"] = _int(p.get("style"), 1, len(data.VARIANTS[p["fixedVariant"]].get("styles") or [1]), 1)
        else:
            p["source"] = p["fixedVariant"] = p["style"] = None

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
        # skrzynka kart specjalnych: nigdy w sklepie, nie da się jej kupić ani otworzyć
        crate["special"] = bool(data.CRATES.get(cid, {}).get("special"))
        crate["shop"] = bool(crate.get("shop", True)) and not crate["special"]
        crate["restricted"] = bool(crate.get("restricted", False))
        # warianty wyjątkowe (np. Królewski, Flagowy) - tylko te, które admin włączył (albo domyślne z data.py)
        chosen = crate["variants"] if "variants" in crate else data.DEFAULT_CRATE_VARIANTS.get(cid, [])
        crate["variants"] = [v for v in data.CRATE_VARIANTS if v in (chosen or [])]
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
        # kuźnia (kontrakt, ulepszacz) i wygrane w kasynie: tylko karty ze skrzynek, które są teraz w sklepie
        p["forge"] = any(crates[c]["shop"] for c in p["crates"])

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
