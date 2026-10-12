# Skrzynki Sław

A Flask app for opening crates with cards of famous people (Polish crate and World crate).

## Running it
Double-click `start.bat`, or:

    .venv\Scripts\python app.py

then open http://127.0.0.1:5000

## What's in it
- 2 crates × 50 people + 1 SECRET card per crate, rarities: green → blue → purple → red → gold → ULTRA → ★ SECRET
- Secret cards stay hidden ("???") until you obtain them; they have their own card design and their own reveal
- Variants: Reverse Holo, Holo, Alt Art (different photo), Golden, each with its own odds and value multiplier
- ⚙️ Admin panel at /admin: add, edit and hide crates and cards (photos from Wikipedia, a URL or an uploaded file)
- Epic full-screen reveal for Legendary and ULTRA drops
- 🔍 Card viewer: click a card (in the Inventory use 🔍 or right-click) to enlarge, tilt and flip it
- 💸 Bank: top up your balance whenever you want
- ⚒️ Forge: **Kontrakt** (N cards of one rarity → 1 card of the next) and **Ulepszacz** (upgrade wheel, CS-site style)

## Files
- `data.py` – DEFAULT cards and crates, rarities, odds, variants, prices. The easiest way to change cards is the admin panel (/admin).
- `catalog.py` – combines `data.py` with changes from the admin panel (stored in the database).
- `images.py` – downloads photos from Wikipedia into `image_cache/` (alt photos come from other language versions of Wikipedia and from Wikidata).
  To fetch a card's photos again, use the "🔄 Pobierz zdjęcia ponownie" button in the admin panel.
- `game.db` – your save (balance, cards, discovered secret cards) AND changes from the admin panel.
  The ♻️ button resets the game but keeps admin changes; deleting the file removes both.
- `static/js/sound.js` – sounds (generated in the browser, no audio files).
- `static/js/fx.js` – epic reveal, particles, card viewer, bank.
- `static/js/forge.js` – forge (contract and upgrader).
- Contract and upgrader settings (card counts, odds) are at the top of `data.py`.
- `python app.py --test` – runs a test copy on port 5001 with a separate save (`test.db`).

## Keyboard shortcuts
- Space / Enter – open crates; during spinning: skip; on the results screen: open again
- Esc – skip / close
- ← → – flip pages in the binder
