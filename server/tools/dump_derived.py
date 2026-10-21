"""Wartości wyliczane w data.py (do testu zgodności src/data.rs): python server/tools/dump_derived.py"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
import data  # noqa: E402

out = {
    "variants": data.VARIANTS, "variantOrder": data.VARIANT_ORDER, "exclusiveVariants": data.EXCLUSIVE_VARIANTS,
    "crateVariants": data.CRATE_VARIANTS, "specialVariants": data.SPECIAL_VARIANTS, "casinoVariants": data.CASINO_VARIANTS,
    "rarities": data.RARITIES, "types": data.TYPES,
    "people": {p["id"]: p for c in data.CRATES.values() for p in c["people"]},
    "cardValues": {f"{p['id']}|{v}|{m}": data.card_value(dict(p, valueMult=m), v)
                   for c in data.CRATES.values() for p in c["people"] for v in data.VARIANTS for m in (1, 3.0, 5.0)},
}
path = os.path.join(ROOT, "server", "tests", "fixtures", "derived.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("->", path)
