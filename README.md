# ScamBox

A Flask app for opening crates with cards of famous people (Polish crate and World crate).

## Running it
Double-click `start.bat`, or:

    .venv\Scripts\python app.py

then open http://127.0.0.1:5000

### Playing with friends (same network / Wi-Fi)

    .venv\Scripts\python app.py --lan

The console will show an address like `http://192.168.1.23:5000`; your friends open it in their browser.
(Windows may ask to allow access through the firewall; choose "Allow".)

### Playing with friends on a local network (e.g. a dorm)
1. Once, in **PowerShell as administrator** (lets in only devices from your subnet, port 5000):

       New-NetFirewallRule -DisplayName "Skrzynki Slaw" -Direction Inbound -Protocol TCP -LocalPort 5000 -RemoteAddress LocalSubnet -Program "C:\Program Files\Python312\python.exe" -Action Allow -Profile Any

2. Double-click `start_lan.bat`; the console shows the address for your friends (`http://<your-IP>:5000`).
If a friend still can't connect, the network probably blocks traffic between devices (common in dorms) — use Tailscale.

### Playing with friends over Tailscale (recommended)
Double-click `start_tailscale.bat`. It runs `tailscale serve`, which makes the game available **only within your
Tailscale network**, over HTTPS, at `https://<computer-name>.<tailnet>.ts.net`.
Friends must be in your Tailscale network (invite) or have this computer shared with them.
To stop sharing: `tailscale serve --https=443 off`.

`python app.py --dev` = developer mode (auto-reload, debugger) — only for yourself, never for other players.

## Accounts
- Each player has their own account (username + password), balance, cards, binder and discovered secret cards.
- **The first account registered takes over the previous save and becomes admin.**
- Admin: ⚙️ admin panel — crates (shop, access, custom odds), cards (several crates per card), players (ban, browse/delete cards, crate access, money, chests, passwords, admin rights) and the 💸 bank.
- Odds, money chest ranges and the secret card odds (`SECRET_ODDS`) are at the top of `data.py`.

## What's in it
- 3 crates: Polska, Świat (50 people + 1 SECRET card each) and PRL (28 cards, 500 $, Gierek as ULTRA, the secret Jan Paweł II); cards can belong to several crates
- 🛒 Shop with a purchase panel; crates can be off sale or available only to selected players, rarities: green → blue → purple → red → gold (1%) → ULTRA (0.2%) → ★ SECRET (1 in 2137)
- 📦 Chests in your inventory: buy them for later ("🛒 Kup do ekwipunku"); opening uses owned chests first
- Secret cards stay hidden ("???") until you obtain them; they have their own card design and their own reveal
- Variants: Black & white, Reverse Holo, Silver, Holo, Golden, Diamond, each with its own odds and value multiplier
- ⚙️ Admin panel at /admin: add, edit and hide crates and cards (photos from Wikipedia, a URL or an uploaded file)
- Epic full-screen reveal for Legendary and ULTRA drops
- 🔍 Card viewer: click a card (in the Inventory use 🔍 or right-click) to enlarge, tilt and flip it
- 🎁 Daily chest with money: 1 000–20 000 $, on Sunday a 💎 MEGA chest: 5 000–50 000 $ (lands in your inventory)
- 👥 Friends: invitations, activity feed (shown cards + legendary drops), "📣 Pokaż znajomym" button on a card
- 👤 Profiles: showcase of 6 cards and the binder of every player; 🏆 ranking (collection value, cards, crates)
- 🎭 Player icon: an emoji or the photo of any card you own — in any variant you own (gold, diamond…), no uploads
- 🔄 Trading with friends: cards for cards (no money), accept/decline/cancel, history
- ⚔️ Legendary, ULTRA and secret cards have two abilities
- 💸 Bank: admin only
- ⚒️ Forge: **Kontrakt** (N cards of one rarity → 1 card of the next) and **Ulepszacz** (upgrade wheel, CS-site style); secret cards cannot be crafted

## Saving admin-panel changes to GitHub
Cards and crates added in the admin panel live in `game.db` (which is not on GitHub, because it also holds player accounts).
Before pushing, run:

    .venv\Scripts\python export_catalog.py

It writes `catalog_export.json` + `custom_images/` (cards and crates only, no player data).
A new installation (empty database) loads them automatically on first start.

## Files
- `data.py` – DEFAULT cards and crates, rarities, odds, variants, prices. The easiest way to change cards is the admin panel (/admin).
- `catalog.py` – combines `data.py` with changes from the admin panel (stored in the database).
- `images.py` – downloads photos from Wikipedia into `image_cache/` (alt photos come from other language versions of Wikipedia and from Wikidata).
  To fetch a card's photos again, use the "🔄 Pobierz zdjęcia ponownie" button in the admin panel.
- `game.db` – all accounts, their cards and friends, plus changes from the admin panel. Back it up!
- `database.py` – database connection. Without settings the game uses the SQLite file `game.db`;
  with the `DATABASE_URL` environment variable it uses PostgreSQL (for hosting, e.g. Azure).
- `migrate_to_postgres.py` – one-time copy of `game.db` into an empty PostgreSQL database
  (set `DATABASE_URL` first; `game.db` is only read).
- `wsgi.py` – entry point for a real server (Azure App Service, Linux):
  `gunicorn --workers 1 --threads 8 --timeout 120 --bind 0.0.0.0:8000 wsgi:app`.
  App settings: `DATABASE_URL` (PostgreSQL), `SECRET_KEY` (session key), `DATA_DIR` (e.g. `/home/data`, keeps photos across restarts),
  optional `DB_SCHEMA` (e.g. `famechests` – own schema in a shared database such as Supabase) and `DB_POOL_SIZE` (default 10).
- `secret_key.txt` – login session key (generated automatically, do not share it).
- `static/js/social.js` – daily reward, friends, activity feed, ranking, profiles.
- `static/js/sound.js` – sounds (generated in the browser, no audio files).
- `static/js/fx.js` – epic reveal, particles, card viewer, bank.
- `static/js/forge.js` – forge (contract and upgrader).
- Contract and upgrader settings (card counts, odds) are at the top of `data.py`.
- `python app.py --test` – runs a test copy on port 5001 with a separate save (`test.db`).

## Keyboard shortcuts
- Space / Enter – open crates; during spinning: skip; on the results screen: open again
- Esc – skip / close
- ← → – flip pages in the binder
