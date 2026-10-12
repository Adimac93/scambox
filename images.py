"""Zdjęcia kart: Wikipedia (główne), Wikimedia Commons (alternatywne), upload i URL z panelu admina."""
import glob
import json
import os
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import catalog

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "image_cache")
ALT_MISSING_FILE = os.path.join(CACHE_DIR, "alt_missing.json")
USER_AGENT = "CelebCrates/1.0 (private hobby project; python-urllib)"
THUMB_SIZE = 500
MAX_UPLOAD = 8 * 1024 * 1024
EXTS = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
BAD_WORDS = ("signature", "podpis", "logo", "coat", "herb", "flag", "flaga", "map", "mapa", "autograph",
             "grave", "grób", "tomb", "stamp", "coin", "banknote", "plaque", "tablica", "poster", "plakat",
             "document", "dokument", "letter", "scan", "page", "strona", "certificate", "akt ", "book", "ksiega",
             "księga", "newspaper", "gazeta", "family", "rodzin", "house", "dom ", "church", "kości", "monument",
             "pomnik", "statue", "mural", "painting", "obraz", "car ", "plane", "samolot")

# Na niektórych Windowsach magazyn certyfikatów zawiera wygasły certyfikat główny i Python zgłasza
# "certificate has expired" - wtedy pomaga zestaw certyfikatów z pakietu certifi (Mozilla).
# Z kolei za firmowym proxy/antywirusem działa tylko magazyn Windows. Próbujemy obu (oba weryfikują certyfikat).
SSL_CONTEXTS = []
try:
    import certifi
    SSL_CONTEXTS.append(ssl.create_default_context(cafile=certifi.where()))
except ImportError:
    pass
SSL_CONTEXTS.append(ssl.create_default_context())

_lock = threading.Lock()
_failed = {}


def _open(req, timeout):
    for i, ctx in enumerate(SSL_CONTEXTS):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                if i:  # zapamiętaj działający zestaw certyfikatów
                    SSL_CONTEXTS.insert(0, SSL_CONTEXTS.pop(i))
                return resp.read()
        except urllib.error.URLError as e:
            if not isinstance(e.reason, ssl.SSLCertVerificationError) or i == len(SSL_CONTEXTS) - 1:
                raise


def _get(url, timeout=20, retries=4):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            return _open(req, timeout)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == retries - 1:
                raise
            time.sleep(3 * 2 ** attempt)  # Wikimedia ogranicza tempo pobierania


def _api(base, params):
    return json.loads(_get(base + "?" + urllib.parse.urlencode(dict(params, format="json"))))


# ---------------------------------------------------------------- pliki

def _stem(pid, alt=False):
    return os.path.join(CACHE_DIR, f"{pid}__alt" if alt else pid)


def find(pid, alt=False):
    """Ścieżka do zapisanego zdjęcia albo None."""
    for ext in EXTS:
        p = f"{_stem(pid, alt)}.{ext}"
        if os.path.exists(p):
            return p
    return None


def mimetype(path):
    return EXTS.get(path.rsplit(".", 1)[-1], "image/jpeg")


def sniff(blob):
    if blob[:3] == b"\xff\xd8\xff":
        return "jpg"
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "webp"
    if blob[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def save(pid, blob, alt=False):
    ext = sniff(blob)
    if not ext:
        raise ValueError("To nie jest obsługiwany obrazek (JPG, PNG, WEBP, GIF)")
    if len(blob) > MAX_UPLOAD:
        raise ValueError("Plik jest za duży (max 8 MB)")
    os.makedirs(CACHE_DIR, exist_ok=True)
    delete(pid, alt)
    with open(f"{_stem(pid, alt)}.{ext}", "wb") as f:
        f.write(blob)
    _failed.pop((pid, alt), None)


def save_url(pid, url, alt=False):
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("Adres musi zaczynać się od http:// lub https://")
    save(pid, _get(url), alt)


def delete(pid, alt=False):
    for p in glob.glob(glob.escape(_stem(pid, alt)) + ".*"):
        os.remove(p)


# ---------------------------------------------------------------- Wikipedia (główne zdjęcie)

def _query_pages(lang, titles, props):
    params = {"action": "query", "formatversion": "2", "redirects": "1", "titles": "|".join(titles), **props}
    q = _api(f"https://{lang}.wikipedia.org/w/api.php", params)["query"]
    alias = {t: t for t in titles}
    for key in ("normalized", "redirects"):
        for m in q.get(key, []):
            for orig, cur in list(alias.items()):
                if cur == m["from"]:
                    alias[orig] = m["to"]
    by_title = {p["title"]: p for p in q.get("pages", [])}
    return {orig: by_title.get(final, {}) for orig, final in alias.items()}


def _wiki(pid):
    w = catalog.PEOPLE.get(pid, {}).get("wiki")
    return tuple(w) if w and len(w) == 2 and w[1] else None


def fetch(person_ids, force=False):
    """Pobiera brakujące główne zdjęcia z Wikipedii. Zwraca {person_id: True/False}."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    results = {}
    by_lang = {}
    for pid in person_ids:
        if not force and find(pid):
            results[pid] = True
            continue
        w = _wiki(pid)
        if not w:
            results[pid] = False
            continue
        by_lang.setdefault(w[0], []).append((pid, w[1]))
    for lang, items in by_lang.items():
        for i in range(0, len(items), 50):
            chunk = items[i:i + 50]
            try:
                pages = _query_pages(lang, [t for _, t in chunk],
                                     {"prop": "pageimages", "piprop": "thumbnail", "pithumbsize": str(THUMB_SIZE)})
            except Exception as e:
                print(f"[zdjęcia] błąd API ({lang}): {e}")
                pages = {}
            for pid, title in chunk:
                src = pages.get(title, {}).get("thumbnail", {}).get("source")
                ok = False
                if src:
                    try:
                        save(pid, _get(src))
                        ok = True
                        time.sleep(0.3)
                    except Exception as e:
                        print(f"[zdjęcia] nie udało się pobrać {pid}: {e}")
                else:
                    print(f"[zdjęcia] brak zdjęcia w artykule: {lang}:{title}")
                results[pid] = ok
                if not ok:
                    _failed[(pid, False)] = time.time()
    return results


# ---------------------------------------------------------------- zdjęcie alternatywne
# Źródła (po kolei): dodatkowe zdjęcia z Wikidata (P18), potem zdjęcia główne artykułów
# o tej osobie w innych wersjach językowych Wikipedii - wszystkie to portrety tej osoby.

ALT_LANGS = ["en", "pl", "de", "fr", "es", "it", "ru", "uk", "cs", "nl", "pt", "sv", "fi", "hu"]


def _load_alt_missing():
    try:
        with open(ALT_MISSING_FILE, encoding="utf-8") as f:
            return set(json.load(f))
    except (OSError, ValueError):
        return set()


def _save_alt_missing(s):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(ALT_MISSING_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted(s), f)


def _norm(name):
    return name.replace("_", " ").replace("File:", "").replace("Plik:", "").strip().lower()


def _usable(fname):
    n = _norm(fname)
    return n.endswith((".jpg", ".jpeg", ".png", ".webp")) and not any(b in n for b in BAD_WORDS)


def _file_url(fname):
    return ("https://commons.wikimedia.org/wiki/Special:FilePath/" +
            urllib.parse.quote(fname.replace(" ", "_")) + f"?width={THUMB_SIZE}")


def fetch_alt(person_ids, force=False):
    """Szuka drugiego (innego niż główne) zdjęcia osoby."""
    missing = set() if force else _load_alt_missing()
    todo = [pid for pid in person_ids if _wiki(pid) and (force or (not find(pid, True) and pid not in missing))]
    if not todo:
        return 0
    lead, qid, failed = {}, {}, set()

    # 1. główne zdjęcie i identyfikator Wikidata
    by_lang = {}
    for pid in todo:
        lang, title = _wiki(pid)
        by_lang.setdefault(lang, []).append((pid, title))
    for lang, items in by_lang.items():
        for i in range(0, len(items), 50):
            chunk = items[i:i + 50]
            try:
                pages = _query_pages(lang, [t for _, t in chunk], {"prop": "pageprops|pageimages", "piprop": "name"})
            except Exception as e:
                print(f"[zdjęcia alt] błąd API ({lang}): {e}")
                failed.update(pid for pid, _ in chunk)
                continue
            for pid, title in chunk:
                pg = pages.get(title, {})
                lead[pid] = _norm(pg.get("pageimage", ""))
                if pg.get("pageprops", {}).get("wikibase_item"):
                    qid[pid] = pg["pageprops"]["wikibase_item"]

    # 2. Wikidata: zdjęcia (P18) i linki do innych wersji językowych
    cands = {pid: [] for pid in todo}
    sitelinks = {}
    ids = [q for q in qid.values()]
    for i in range(0, len(ids), 50):
        try:
            ents = _api("https://www.wikidata.org/w/api.php", {
                "action": "wbgetentities", "props": "claims|sitelinks", "ids": "|".join(ids[i:i + 50]),
                "sitefilter": "|".join(l + "wiki" for l in ALT_LANGS)}).get("entities", {})
        except Exception as e:
            print(f"[zdjęcia alt] błąd Wikidata: {e}")
            failed.update(pid for pid, q in qid.items() if q in ids[i:i + 50])
            continue
        for pid, q in qid.items():
            ent = ents.get(q)
            if not ent:
                continue
            for c in ent.get("claims", {}).get("P18", []):
                f = c.get("mainsnak", {}).get("datavalue", {}).get("value")
                if f:
                    cands[pid].append(f)
            sitelinks[pid] = {k[:-4]: v["title"] for k, v in ent.get("sitelinks", {}).items()}

    # 3. zdjęcia główne z innych Wikipedii
    for lang in ALT_LANGS:
        need = [(pid, sitelinks[pid][lang]) for pid in todo if lang in sitelinks.get(pid, {})]
        for i in range(0, len(need), 50):
            chunk = need[i:i + 50]
            try:
                pages = _query_pages(lang, [t for _, t in chunk], {"prop": "pageimages", "piprop": "name"})
            except Exception as e:
                print(f"[zdjęcia alt] błąd API ({lang}): {e}")
                failed.update(pid for pid, _ in chunk)
                time.sleep(5)
                continue
            for pid, title in chunk:
                f = pages.get(title, {}).get("pageimage")
                if f:
                    cands[pid].append(f)
            time.sleep(1.0)

    # 4. pierwszy kandydat inny niż zdjęcie główne
    found = 0
    for pid in todo:
        seen, pick = {lead.get(pid, "")}, None
        for f in cands[pid]:
            n = _norm(f)
            if n in seen or not _usable(f):
                seen.add(n)
                continue
            pick = f
            break
        if pick:
            try:
                save(pid, _get(_file_url(pick)), alt=True)
                found += 1
                missing.discard(pid)
                time.sleep(0.5)
            except Exception as e:
                print(f"[zdjęcia alt] {pid}: {e}")
        elif pid not in failed:
            if force:
                delete(pid, True)  # stare, nietrafione zdjęcie alt
            missing.add(pid)
    _save_alt_missing(missing)
    return found


# ---------------------------------------------------------------- użycie w aplikacji

def ensure(pid, alt=False):
    """Ścieżka do zdjęcia (alt wraca do głównego) albo None."""
    if alt:
        p = find(pid, True)
        if p:
            return p
    p = find(pid)
    if p:
        return p
    if time.time() - _failed.get((pid, False), 0) < 300:
        return None
    with _lock:
        if not find(pid):
            fetch([pid])
    return find(pid)


def prefetch_all_async():
    def run():
        with _lock:
            res = fetch(list(catalog.PEOPLE))
        print(f"[zdjęcia] główne: {sum(res.values())}/{len(res)}")
        with _lock:
            n = fetch_alt(list(catalog.PEOPLE))
        if n:
            print(f"[zdjęcia] nowe zdjęcia alternatywne: {n}")
    threading.Thread(target=run, daemon=True).start()


if __name__ == "__main__":
    import sys
    db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "game.db")
    conn = sqlite3.connect(db)
    catalog.init_tables(conn)
    catalog.rebuild(conn)
    force = "--force" in sys.argv
    res = fetch(list(catalog.PEOPLE), force=force)
    missing = [pid for pid, ok in res.items() if not ok]
    print(f"Główne: {len(res) - len(missing)}/{len(res)}" + (f" | brak: {', '.join(missing)}" if missing else ""))
    n = fetch_alt(list(catalog.PEOPLE), force=force)
    have = sum(1 for pid in catalog.PEOPLE if find(pid, True))
    print(f"Alternatywne: {have}/{len(catalog.PEOPLE)} (nowe: {n})")
