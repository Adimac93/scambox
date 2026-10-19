"""Eksport zmian z panelu admina (karty i skrzynki) do pliku w repozytorium.

    .venv\\Scripts\\python export_catalog.py

Zapisuje:
  - catalog_export.json  - skrzynki i karty dodane/zmienione/ukryte w panelu admina (BEZ danych graczy),
  - custom_images/       - zdjęcia wgrane w panelu admina (karty bez artykułu w Wikipedii albo z własnym plikiem).
Nowa instalacja gry (pusta baza) wczyta je automatycznie przy pierwszym uruchomieniu.
"""
import json
import os
import shutil

import data as game_data  # 'data' to też nazwa zmiennej w export()
import database
import images

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORT_FILE = os.path.join(BASE_DIR, "catalog_export.json")
IMAGES_DIR = os.path.join(BASE_DIR, "custom_images")


def export(db_path=os.path.join(BASE_DIR, "game.db")):
    conn = database.connect(db_path)  # z DATABASE_URL: baza PostgreSQL
    out = {"crates": [], "cards": []}
    for table, key in (("catalog_crates", "crates"), ("catalog_cards", "cards")):
        for cid, data, deleted in conn.execute(f"SELECT id, data, deleted FROM {table} ORDER BY id"):
            out[key].append({"id": cid, "data": json.loads(data or "{}"), "deleted": bool(deleted)})
    conn.close()
    with open(EXPORT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # własne zdjęcia: karty bez artykułu w Wikipedii albo z wgranym plikiem (nie-JPG z Wikipedii)
    if os.path.isdir(IMAGES_DIR):
        shutil.rmtree(IMAGES_DIR)
    os.makedirs(IMAGES_DIR)
    copied = 0
    for card in out["cards"]:
        if card["deleted"]:
            continue
        path = images.find(card["id"])
        if path and (not card["data"].get("wiki") or not path.lower().endswith(".jpg")):
            shutil.copy2(path, os.path.join(IMAGES_DIR, os.path.basename(path)))
            copied += 1
    # zdjęcia wariantów przypisanych do kart (np. Rzulty Jana Pawła II)
    # i własne zdjęcia wariantów z polem "photo" (np. Halloweenowa) - dowolnej karty
    all_ids = {p["id"] for c in game_data.CRATES.values() for p in c["people"]} | {c["id"] for c in out["cards"]}
    for v, info in game_data.VARIANTS.items():
        for pid in info.get("cards") or (sorted(all_ids) if info.get("photo") else []):
            path = images.find(pid, v)
            if path:
                shutil.copy2(path, os.path.join(IMAGES_DIR, os.path.basename(path)))
                copied += 1
    return len(out["crates"]), len(out["cards"]), copied


def import_if_empty(conn):
    """Wczytuje eksport do pustej bazy (nowa instalacja). Istniejących zmian nigdy nie nadpisuje."""
    if not os.path.exists(EXPORT_FILE):
        return False
    if conn.execute("SELECT (SELECT COUNT(*) FROM catalog_crates) + (SELECT COUNT(*) FROM catalog_cards)").fetchone()[0]:
        return False
    with open(EXPORT_FILE, encoding="utf-8") as f:
        data = json.load(f)
    for table, key in (("catalog_crates", "crates"), ("catalog_cards", "cards")):
        for row in data.get(key, []):
            conn.execute(f"INSERT INTO {table} (id, data, deleted) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                         (row["id"], json.dumps(row["data"], ensure_ascii=False), int(row["deleted"])))
    conn.commit()
    return True


def copy_custom_images():
    """Własne zdjęcia z repozytorium -> image_cache (tylko brakujące). Przy każdym starcie, bo na nowym
    serwerze baza bywa przeniesiona ze starego zapisu (nie jest pusta), a folder ze zdjęciami jest pusty."""
    if not os.path.isdir(IMAGES_DIR):
        return
    os.makedirs(images.CACHE_DIR, exist_ok=True)
    for name in os.listdir(IMAGES_DIR):
        target = os.path.join(images.CACHE_DIR, name)
        if not os.path.exists(target):
            shutil.copy2(os.path.join(IMAGES_DIR, name), target)


if __name__ == "__main__":
    crates, cards, imgs = export()
    print(f"Wyeksportowano: {crates} skrzynek, {cards} kart, {imgs} własnych zdjęć -> catalog_export.json, custom_images/")
