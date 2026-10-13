"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("pl-PL") + " $";

const COUNT_CHIPS = [1, 2, 3, 5, 10, 15, 20];
const INV_PAGE = 120;
const VARIANT_TAGS = { bw: "B&W", reverse: "REVERSE", silver: "SILVER", holo: "HOLO", gold: "GOLDEN", emerald: "💚 EMERALD", ruby: "❤️ RUBY", diamond: "💎 DIAMOND" };
const GEMS = ["emerald", "ruby", "diamond"];  // warianty z kamieniami szlachetnymi - wspólny wygląd, inne kolory

const S = {
  cfg: null,
  state: null,
  items: [],              // posortowane malejąco po id
  crate: null,
  count: 1,
  fast: false,
  binderCrate: null,
  spread: 0,
  inv: { crate: "all", rarities: new Set(), variant: "all", sort: "new", limit: INV_PAGE, selected: new Set() },
  opening: null,
  me: null,               // zalogowany gracz
  showcase: [],           // id kart w mojej gablocie
  chests: {},             // skrzynki w ekwipunku: { rodzaj: ilość }
};

// ================================================================ API / POMOCNICZE

async function api(path, body) {
  const opts = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) { location.href = "/login"; throw new Error("Zaloguj się"); }
  if (!res.ok) throw new Error(data.error || "Błąd serwera");
  return data;
}

async function refreshConfig() {
  S.cfg = await api("/api/config");
  if (!S.cfg.crates[S.crate]) S.crate = S.cfg.crateOrder[0];
  if (!S.cfg.crates[S.binderCrate]) S.binderCrate = S.cfg.crateOrder[0];
}

function rarityIdx(r) { return S.cfg.rarityOrder.indexOf(r); }
function varRank(v) { return S.cfg.variantOrder.indexOf(v || "normal"); }
function person(id) { return S.cfg.people[id]; }
function crateOf(id) { return S.cfg.crates[id]; }
function crateList() { return S.cfg.crateOrder.map(id => S.cfg.crates[id]); }
function isSpecial(v) { return !!v && v !== "normal"; }
function variantName(v) { return S.cfg.variants[v || "normal"].name; }
function cardValue(pid, v = "normal") {
  return Math.round(S.cfg.rarities[person(pid).rarity].value * S.cfg.variants[v || "normal"].mult);
}
function imgUrl(pid) {
  const p = person(pid);
  return `/img/${pid}?v=${p.imgv || 0}${p.imgq ? "&" + p.imgq : ""}`;
}
// ikona gracza: zdjęcie wybranej karty albo emoji
function avatarHTML(u, cls = "av") {
  if (u && u.avatarCard) {
    const rc = S.cfg?.rarities[u.avatarRarity]?.color || "#ffffff55";
    return `<span class="${cls} av-card avv-${u.avatarVariant || "normal"}${u.avatarRarity === "secret" ? " av-secret" : ""}" style="--rc:${rc}"><img src="/avatar/${encodeURIComponent(u.username)}?c=${encodeURIComponent(u.avatarCard)}" alt="" draggable="false"></span>`;
  }
  return `<span class="${cls}">${esc(u?.avatar || "😎")}</span>`;
}

function crateStyle(c) {
  return `--crate-bg: linear-gradient(180deg, ${c.color1} 0 50%, ${c.color2} 50%); --crate-lid: linear-gradient(180deg, ${c.color1}, ${c.color2}); --c1: ${c.color2}`;
}

// ================================================================ KARTA

function variantLayers(v) {
  let html = "";
  if (v === "holo") html += '<div class="holo-layer"></div>';
  if (v === "gold" || v === "silver") html += '<div class="gold-sheen"></div>';
  if (GEMS.includes(v)) html += '<div class="diamond-layer"></div><div class="diamond-glints"><i></i><i></i><i></i><i></i><i></i></div>';
  if (isSpecial(v)) html += `<div class="var-tag vt-${v}">${VARIANT_TAGS[v]}</div>`;
  return html;
}

function cardHTML(pid, variant = "normal") {
  const p = person(pid);
  if (p.masked) return mysteryCardHTML(p);
  if (p.rarity === "secret") return secretCardHTML(p, variant);
  const r = S.cfg.rarities[p.rarity];
  const type = S.cfg.types[p.type];
  const crate = crateOf(p.crate);
  const total = String(crate.people.length).padStart(3, "0");
  const cost = type.icon.repeat(Math.min(3, 1 + Math.floor(rarityIdx(p.rarity) / 2)));
  return `
  <div class="card r-${p.rarity} v-${variant}${p.attack2 ? " two-atk" : ""}" data-pid="${p.id}" data-variant="${variant}">
    <div class="card-inner">
      ${variant === "reverse" ? '<div class="rev-foil"></div>' : ""}
      <div class="card-head">
        <span class="card-name">${esc(p.name)}</span>
        <span class="card-hp"><small>HP</small>${p.hp}</span>
        <span class="card-type">${type.icon}</span>
      </div>
      <div class="card-photo"><img src="${imgUrl(p.id)}" alt="${esc(p.name)}" loading="lazy" draggable="false"></div>
      <div class="card-sub">${type.name} · ${esc(crate.short)}</div>
      <div class="card-attack">
        <span class="atk-cost">${cost}</span>
        <span class="atk-name">${esc(p.attack)}</span>
        <span class="atk-dmg">${p.dmg}</span>
      </div>
      ${p.attack2 ? `<div class="card-attack atk2">
        <span class="atk-cost">${cost}${type.icon}</span>
        <span class="atk-name">${esc(p.attack2)}</span>
        <span class="atk-dmg">${p.dmg2}</span>
      </div>` : ""}
      <div class="card-stats">
        <span>słabość<b>${S.cfg.types[type.weak].icon}×2</b></span>
        <span>odporność<b>${S.cfg.types[type.resist].icon}-20</b></span>
        <span>wycofanie<b>${"⚪".repeat(1 + rarityIdx(p.rarity) % 3)}</b></span>
      </div>
      <div class="card-foot">
        <span class="card-rarity"><span class="gem"></span>${r.name}</span>
        <span>${esc(crate.code)} ${String(p.number).padStart(3, "0")}/${total}</span>
        <span class="card-value">${fmt(cardValue(pid, variant))}</span>
      </div>
    </div>
    ${variantLayers(variant)}
    <div class="shine"></div>
  </div>`;
}

// TAJNA karta - zupełnie inny układ: pełnoekranowe zdjęcie, aureola, złota animowana ramka
function secretCardHTML(p, variant) {
  const type = S.cfg.types[p.type];
  const crate = crateOf(p.crate);
  return `
  <div class="card r-secret v-${variant}" data-pid="${p.id}" data-variant="${variant}">
    <div class="sc">
      <div class="sc-art"><img src="${imgUrl(p.id)}" alt="${esc(p.name)}" loading="lazy" draggable="false"></div>
      <div class="sc-halo"></div>
      <div class="sc-stars"></div>
      ${variant === "reverse" ? '<div class="rev-foil"></div>' : ""}
      <div class="sc-top">
        <span class="sc-seal">★</span>
        <span class="sc-name">${esc(p.name)}</span>
        <span class="sc-hp"><small>HP</small>${p.hp}</span>
      </div>
      <div class="sc-panel">
        <div class="sc-attack"><span>${type.icon}</span><span class="sc-atk">${esc(p.attack)}</span><b>${p.dmg}</b></div>
        ${p.attack2 ? `<div class="sc-attack"><span>${type.icon}${type.icon}</span><span class="sc-atk">${esc(p.attack2)}</span><b>${p.dmg2}</b></div>` : ""}
        <div class="sc-foot"><span>★ TAJNA ★</span><span>${esc(crate.code)} ★${String(p.number).padStart(3, "0")}</span><span class="sc-val">${fmt(cardValue(p.id, variant))}</span></div>
      </div>
      <div class="sc-frame"></div>
      <div class="sc-border"></div>
    </div>
    ${variantLayers(variant)}
    <div class="shine"></div>
  </div>`;
}

// tajna karta, której jeszcze nie zdobyłeś
function mysteryCardHTML(p) {
  const n = rarityShare(p.crate, "secret");
  return `
  <div class="card r-secret mystery" data-pid="${p.id}" data-variant="normal">
    <div class="sc">
      <div class="sc-stars"></div>
      <div class="my-star">★</div>
      <div class="my-q">???</div>
      <div class="my-label">TAJNA KARTA</div>
      <div class="my-sub">Zdobądź ją, aby odkryć, kto to jest.<br>Szansa: 1 na ${n ? Math.round(1 / n).toLocaleString("pl-PL") : "?"}</div>
      <div class="sc-border"></div>
    </div>
  </div>`;
}

// szansa na konkretną kartę danej rzadkości w danej skrzynce
function rarityShare(crateId, rarity) {
  const crate = crateOf(crateId);
  if (!crate) return 0;
  const present = new Set(crate.people.map(id => person(id).rarity));
  const total = S.cfg.rarityOrder.filter(r => present.has(r)).reduce((a, r) => a + crate.weights[r], 0);
  const inR = crate.people.filter(id => person(id).rarity === rarity).length;
  return present.has(rarity) && total ? crate.weights[rarity] / total / inR : 0;
}

// efekt przechylania kart za kursorem
let tiltCard = null;
function resetTilt(card) {
  if (!card) return;
  card.classList.remove("tilting");
  card.style.removeProperty("--rx"); card.style.removeProperty("--ry");
}
// Prostokąt karty BEZ przechylenia (środek z getBoundingClientRect + rozmiar z układu strony) -
// pozycja kursora liczona względem przechylonej karty "pływała" i karta się trzęsła.
function flatRect(el) {
  const b = el.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  return { left: b.left + (b.width - w) / 2, top: b.top + (b.height - h) / 2, width: w, height: h };
}
function inRect(e, b) {
  return e.clientX >= b.left && e.clientX <= b.left + b.width && e.clientY >= b.top && e.clientY <= b.top + b.height;
}
document.addEventListener("pointermove", e => {
  // podgląd karty i kieszonka w albumie: obszar, który się nie przechyla - przechylona karta "chowa się"
  // za swój pojemnik i przeglądarka przestaje widzieć nad nią kursor (karta skakała tam i z powrotem)
  const zone = e.target.closest?.(".viewer-stage, .pocket");
  let card = zone ? zone.querySelector(".card") : e.target.closest?.(".card");
  if (!card && tiltCard?.isConnected && inRect(e, flatRect(tiltCard))) card = tiltCard;  // kursor przy krawędzi
  if (card !== tiltCard) { resetTilt(tiltCard); tiltCard = card; }
  if (!card) return;
  const b = zone ? zone.getBoundingClientRect() : flatRect(card);
  const px = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
  const py = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
  const fancy = card.matches(".r-secret, .v-holo, .v-reverse, .v-gold, .v-silver, .v-diamond, .v-emerald, .v-ruby, .v-bw");
  const strength = card.closest(".viewer") ? 1.5 : fancy || card.closest(".modal") ? 1 : 0.6;
  card.classList.add("tilting");
  card.style.setProperty("--rx", ((0.5 - py) * 16 * strength).toFixed(2) + "deg");
  card.style.setProperty("--ry", ((px - 0.5) * 20 * strength).toFixed(2) + "deg");
  card.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
  card.style.setProperty("--my", (py * 100).toFixed(1) + "%");
});
// kursor wyjechał poza okno - karta wraca do pozycji prostej
document.documentElement.addEventListener("pointerleave", () => { resetTilt(tiltCard); tiltCard = null; });

// ================================================================ NAGŁÓWEK / WSPÓLNE

let shownBalance = null;
function renderHeader() {
  const el = $("#balance");
  const target = S.state.balance;
  if (shownBalance === null) shownBalance = target;
  const from = shownBalance, t0 = performance.now();
  shownBalance = target;
  if (from !== target) {
    el.classList.add("bump");
    setTimeout(() => el.classList.remove("bump"), 200);
  }
  const step = now => {
    const t = Math.min(1, (now - t0) / 450);
    el.textContent = fmt(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  const broke = target < Math.min(...crateList().map(c => c.price));
  el.classList.toggle("neg", broke);
  $("#bankBtn").hidden = !S.me?.isAdmin;
  $("#adminLink").hidden = !S.me?.isAdmin;
  $("#bankBtn").classList.toggle("pulse", broke);
  if (S.me) {
    $("#userAvatar").outerHTML = avatarHTML(S.me, "").replace('<span class="', '<span id="userAvatar" class="');
    $("#userName").textContent = S.me.username;
  }
  $("#invCount").textContent = S.items.length;
  $("#soundBtn").textContent = Sound.enabled ? "🔊" : "🔇";
}

function toast(msg, err = false) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .4s"; t.style.opacity = 0; }, 2600);
  setTimeout(() => t.remove(), 3100);
}

function applyState(state) {
  S.state = state;
  renderHeader();
}

function removeItems(ids) {
  const set = new Set(ids);
  S.items = S.items.filter(i => !set.has(i.id));
  ids.forEach(id => S.inv.selected.delete(id));
}

async function setFavorite(ids, fav) {
  await api("/api/favorite", { ids, fav });
  const set = new Set(ids);
  S.items.forEach(i => { if (set.has(i.id)) i.fav = fav; });
  S.opening?.drops.forEach(d => { if (set.has(d.id)) d.fav = fav; });
  Sound.click();
}

function favBtnHTML(id, fav, cls = "") {
  return `<button class="fav-btn${fav ? " on" : ""} ${cls}" data-fav="${id}" title="${fav ? "Ulubiona — nie da się jej sprzedać ani zużyć. Kliknij, aby odznaczyć" : "Dodaj do ulubionych (ochrona przed sprzedażą)"}">${fav ? "★" : "☆"}</button>`;
}

async function sellIds(ids) {
  if (!ids.length) return 0;
  const favs = new Set(S.items.filter(i => i.fav).map(i => i.id));
  ids = ids.filter(id => !favs.has(id));  // ulubionych nie sprzedajemy (serwer też je pomija)
  if (!ids.length) { toast("⭐ Ulubionych kart nie da się sprzedać"); return 0; }
  const res = await api("/api/sell", { ids });
  removeItems(res.sold);
  applyState(res.state);
  Sound.coin(Math.ceil(res.sold.length / 4));
  toast(`Sprzedano ${res.sold.length} ${plural(res.sold.length, "kartę", "karty", "kart")} za ${fmt(res.total)}`);
  return res.total;
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}

// ================================================================ ADRESY STRON
// każda zakładka ma swój adres (/inventory...), profil gracza: /player/<nazwa>; "/" = skrzynki
const VIEW_PATHS = { crates: "/crates", binder: "/binder", inventory: "/inventory", forge: "/forge", friends: "/friends", ranking: "/ranking" };

function viewPath(view) {
  return view === "profile" ? "/player/" + encodeURIComponent(PROF.username || S.me.username) : VIEW_PATHS[view] || "/";
}

function routeFromPath(path = location.pathname) {
  const m = path.match(/^\/player\/([^/]+)\/?$/);
  if (m) return { view: "profile", user: decodeURIComponent(m[1]) };
  const clean = path.replace(/\/+$/, "") || "/";
  return { view: Object.keys(VIEW_PATHS).find(v => VIEW_PATHS[v] === clean) || "crates" };
}

function showRoute(how = "none") {
  const r = routeFromPath();
  if (r.view === "profile") openProfile(r.user, how);
  else switchView(r.view, how);
}

// how: "push" - nowy wpis w historii (kliknięcie), "replace" - podmiana (start), "none" - bez zmian (wstecz/dalej)
function switchView(view, how = "push") {
  const path = viewPath(view);
  if (how !== "none" && location.pathname !== path) history[how === "replace" ? "replaceState" : "pushState"](null, "", path);
  const label = view === "profile" ? (PROF.username || S.me.username) : $(`.tab[data-view="${view}"]`)?.firstChild.textContent.trim();
  document.title = label ? `${label} — Skrzynki Sław` : "Skrzynki Sław";
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
  if (view === "binder") renderBinder();
  if (view === "inventory") renderInventory();
  if (view === "crates") renderCrates();
  if (view === "forge") renderForge();
  if (view === "friends") renderFriends();
  if (view === "ranking") renderRanking();
  if (view === "profile") renderProfile();
  updateSellbar();
}

function currentView() { return $(".view.active").id.replace("view-", ""); }

function rerenderCurrent() { switchView(currentView(), "none"); }

// ================================================================ SKRZYNKI

function shopCrates() {
  // skrzynki "dla wybranych" widzą tylko gracze z dostępem (posiadane z ekwipunku zawsze da się otworzyć)
  return crateList().filter(c => (c.shop && (!c.restricted || c.canBuy)) || (S.chests[c.id] || 0) > 0 || S.me?.isAdmin);
}

function crateArtHTML(c, cls = "") {
  return `<div class="crate-art ${cls}" style="${crateStyle(c)}">
    <div class="crate-box"><div class="crate-emblem">${esc(c.emoji)}</div></div><div class="crate-lid"></div><div class="crate-lock"></div></div>`;
}

function crateRarities(c) {
  const present = new Set(c.people.map(id => person(id).rarity));
  return S.cfg.rarityOrder.filter(r => present.has(r) && c.weights[r] > 0);
}

function oddsBarHTML(c) {
  const rs = crateRarities(c);
  const tot = rs.reduce((a, r) => a + c.weights[r], 0) || 1;
  // pasek w skali "pierwiastkowej", żeby rzadkie kolory były w ogóle widoczne
  return `<div class="odds-bar">${rs.map(r => `<i style="flex:${Math.sqrt(c.weights[r] / tot)}; --rc:${S.cfg.rarities[r].color}"
    title="${S.cfg.rarities[r].name}: ${(c.weights[r] / tot * 100).toLocaleString("pl-PL", { maximumFractionDigits: 3 })}%"></i>`).join("")}</div>`;
}

function renderCrates() {
  const visible = shopCrates();
  if (!visible.some(c => c.id === S.crate)) S.crate = (visible.find(c => c.canBuy) || visible[0])?.id;
  $("#cratePicker").innerHTML = visible.map(c => {
    const owned = S.chests[c.id] || 0;
    const locked = !c.canBuy;
    return `<div class="shop-tile${S.crate === c.id ? " selected" : ""}${locked ? " locked" : ""}" data-crate="${c.id}" style="${crateStyle(c)}">
      <div class="st-badges">
        ${owned ? `<span class="stb owned">📦 ×${owned}</span>` : ""}
        ${!c.shop ? '<span class="stb off">Poza sklepem</span>' : ""}
        ${c.restricted ? `<span class="stb vip">${locked ? "🔒" : "⭐"} Dla wybranych</span>` : ""}
      </div>
      ${crateArtHTML(c)}
      <div class="st-name">${esc(c.name)}</div>
      <div class="st-meta">${c.people.length} kart${c.desc ? " · " + esc(c.desc) : ""}</div>
      ${oddsBarHTML(c)}
      <div class="st-price">${fmt(c.price)}</div>
    </div>`;
  }).join("") || '<div class="empty">Sklep jest pusty — na razie nie ma żadnych skrzynek.</div>';

  const crate = crateOf(S.crate);
  $("#buyPanel").hidden = !crate;
  if (crate) {
    $("#bpArt").innerHTML = crateArtHTML(crate, "bp-crate");
    $("#buyPanel").style.cssText = crateStyle(crate);
    $("#bpTitle").textContent = crate.name;
    $("#bpDesc").textContent = crate.desc || "";
    $("#bpPrice").textContent = `${fmt(crate.price)} za sztukę · ${crate.people.length} kart`;
  }

  $("#countChips").innerHTML = COUNT_CHIPS.map(n =>
    `<button class="chip${S.count === n ? " active" : ""}" data-n="${n}">${n}</button>`).join("");
  $("#countRange").value = S.count;
  $("#countVal").textContent = S.count;
  $("#fastToggle").checked = S.fast;
  updateOpenBtn();

  const st = S.state;
  const profit = st.earned - st.spent;
  $("#stats").innerHTML = `
    <span>Otwarte skrzynki: <b>${st.opened}</b></span>
    <span>Wydano: <b>${fmt(st.spent)}</b></span>
    <span>Ze sprzedaży: <b>${fmt(st.earned)}</b></span>
    <span>Wartość ekwipunku: <b>${fmt(S.items.reduce((a, i) => a + i.value, 0))}</b></span>
    <span>Bilans sprzedaży: <b style="color:${profit >= 0 ? "var(--good)" : "var(--bad)"}">${profit >= 0 ? "+" : ""}${fmt(profit)}</b></span>
    <span>Z codziennych skrzynek: <b>${fmt(st.daily_total || 0)}</b></span>
    <span>Kontrakty: <b>${st.contracts || 0}</b></span>
    <span>Ulepszenia: <b style="color:var(--good)">${st.upgrades_won || 0}</b> / <b style="color:var(--bad)">${st.upgrades_lost || 0}</b></span>`;

  if (!crate) { $("#contentsGrid").innerHTML = ""; $("#odds").innerHTML = ""; return; }
  $("#contentsTitle").textContent = `Zawartość: ${crate.name}`;
  const rs = crateRarities(crate);
  const totalW = rs.reduce((a, r) => a + crate.weights[r], 0);
  const pctTxt = x => (x * 100).toLocaleString("pl-PL", { maximumFractionDigits: x < 0.001 ? 3 : 2 }) + "%";
  $("#odds").innerHTML = rs.map(r => {
    const R = S.cfg.rarities[r];
    const n = crate.people.filter(id => person(id).rarity === r).length;
    return `<span class="odd odd-${r}" style="--rc:${R.color}"><b>${R.name}</b> ${pctTxt(crate.weights[r] / totalW)} · ${n} ${plural(n, "karta", "karty", "kart")} · ${fmt(R.value)}</span>`;
  }).join("") + `<div class="odds-variants">${S.cfg.variantOrder.filter(isSpecial).map(v => {
    const V = S.cfg.variants[v];
    return `<span class="odd odd-v vt-${v}"><b>${V.name}</b> ${pctTxt(V.chance)} · wartość ×${String(V.mult).replace(".", ",")}</span>`;
  }).join("")}</div>`;
  $("#contentsGrid").innerHTML = crate.people.map(id => cardHTML(id)).join("");
}

function updateOpenBtn() {
  const crate = crateOf(S.crate);
  const btn = $("#openBtn"), buy = $("#buyBtn");
  if (!crate) { btn.disabled = buy.disabled = true; btn.textContent = "BRAK SKRZYNEK"; return; }
  const ownedAll = S.chests[crate.id] || 0;
  const owned = Math.min(ownedAll, S.count);
  const toBuy = S.count - owned;
  const cost = toBuy * crate.price;
  const blocked = toBuy > 0 && !crate.canBuy;
  btn.innerHTML = blocked
    ? `🔒 OTWÓRZ ${S.count}`
    : owned
      ? `OTWÓRZ ${S.count} <small class="ob-sub">📦 ${owned} z ekwipunku${cost ? ` + ${fmt(cost)}` : ""}</small>`
      : `OTWÓRZ ${S.count} × ${fmt(crate.price)} = ${fmt(cost)}`;
  btn.disabled = !!S.opening || !crate.people.length || blocked;
  buy.textContent = `🛒 Kup ${S.count} do ekwipunku · ${fmt(S.count * crate.price)}`;
  buy.disabled = !crate.canBuy;
  buy.hidden = !crate.canBuy;
  const after = S.state.balance - cost;
  const lock = $("#bpLock");
  lock.hidden = crate.canBuy;
  lock.innerHTML = crate.canBuy ? "" : `🔒 ${crate.shop ? "Tę skrzynkę mogą kupować tylko wybrani gracze." : "Tej skrzynki nie ma teraz w sklepie."}
    ${ownedAll ? `Masz <b>${ownedAll}</b> w ekwipunku — możesz je otworzyć (maks. ${ownedAll}).` : ""}`;
  $("#bpSummary").innerHTML = `
    <span>W ekwipunku: <b>${ownedAll}</b></span>
    <span>Z ekwipunku: <b>${owned}</b></span>
    <span>Do zapłaty: <b class="${after < 0 ? "neg-txt" : ""}">${fmt(cost)}</b></span>
    <span>Saldo po: <b class="${after < 0 ? "neg-txt" : ""}">${fmt(after)}</b></span>`;
}

function setCount(n) {
  S.count = Math.max(1, Math.min(S.cfg.maxOpen, n));
  $("#countRange").value = S.count;
  $("#countVal").textContent = S.count;
  $$("#countChips .chip").forEach(c => c.classList.toggle("active", +c.dataset.n === S.count));
  updateOpenBtn();
}

async function buyChests() {
  const crate = crateOf(S.crate);
  if (!crate || S.opening) return;
  try {
    const res = await api("/api/chests/buy", { crate: crate.id, count: S.count });
    S.chests = res.chests;
    applyState(res.state);
    Sound.coin(2);
    toast(`🛒 Kupiono ${S.count} × ${crate.name} — czekają w ekwipunku`);
    renderCrates();
  } catch (e) {
    Sound.error();
    if (S.state.balance < S.count * crate.price && S.dailyClaimable) { toast(e.message + " Odbierz codzienną skrzynkę!", true); openDaily(); }
    else toast(e.message, true);
  }
}


// ================================================================ OTWIERANIE

function weightedPerson(crateId) {
  // losowanie kosmetyczne do wypełnienia bębna (takie same szanse jak na serwerze)
  const crate = crateOf(crateId), ids = crate.people;
  const byR = {};
  ids.forEach(id => (byR[person(id).rarity] ||= []).push(id));
  const rs = Object.keys(byR);
  const total = rs.reduce((a, r) => a + crate.weights[r], 0);
  let x = Math.random() * total;
  for (const r of rs) {
    x -= crate.weights[r];
    if (x <= 0) return byR[r][Math.floor(Math.random() * byR[r].length)];
  }
  return ids[0];
}

function miniHTML(pid, win = false) {
  const p = person(pid);
  if (p.rarity === "secret") {
    // jak nóż w CS - w bębnie tajna karta to zawsze złota gwiazda
    return `<div class="mini r-secret mini-secret${win ? " win" : ""}" style="--rc:${S.cfg.rarities.secret.color}">
      <div class="ms-star">★</div><div class="mn">??? TAJNA</div></div>`;
  }
  return `<div class="mini r-${p.rarity}${win ? " win" : ""}" style="--rc:${S.cfg.rarities[p.rarity].color}">
    <img src="${imgUrl(p.id)}" alt="" draggable="false"><div class="mn">${esc(p.name)}</div></div>`;
}

// ================================================================ AUTOOTWIERANIE
// S.autoRun = { rounds, spent } - otwieramy raz za razem tę samą liczbę skrzynek, dopóki starcza pieniędzy

function stopAuto(msg) {
  if (!S.autoRun) return;
  const r = S.autoRun;
  S.autoRun = null;
  $("#autoToggle").checked = false;
  updateAutoBtn();
  if (msg) toast(`${msg} (rund: ${r.rounds}, wydano ${fmt(r.spent)})`);
}

function updateAutoBtn() {
  const b = $("#autoStopBtn");
  b.hidden = !S.autoRun;
  if (S.autoRun) b.textContent = `⏹ Zatrzymaj auto (runda ${S.autoRun.rounds})`;
}

function autoNext(o) {
  if (!S.autoRun) return;
  const crate = crateOf(o.crate);
  const owned = Math.min(S.chests[o.crate] || 0, o.count);
  const cost = (o.count - owned) * (crate?.price || 0);
  if (!crate || S.state.balance < cost) return stopAuto("🔁 Auto zatrzymane — skończyły się pieniądze");
  if (owned < o.count && !crate.canBuy) return stopAuto("🔁 Auto zatrzymane — tej skrzynki nie można już kupić");
  setTimeout(() => { if (S.autoRun && S.opening === o && !epicOpen()) openAgain(); }, o.fast ? 800 : 1500);
}

async function openCrates() {
  if (S.opening) return;
  const crate = crateOf(S.crate);
  if (!crate) return;
  const cost = (S.count - Math.min(S.chests[crate.id] || 0, S.count)) * crate.price;
  if (S.state.balance < cost) {
    Sound.error();
    const msg = `Brakuje ci ${fmt(cost - S.state.balance)}, żeby otworzyć ${S.count} ${plural(S.count, "skrzynkę", "skrzynki", "skrzynek")}.`;
    if (S.me?.isAdmin) openBank(msg);
    else if (S.dailyClaimable) { toast(msg + " Odbierz nagrodę dzienną!", true); openDaily(); }
    else toast(msg + " Sprzedaj kilka kart albo wróć jutro po nagrodę dzienną 🎁", true);
    return;
  }
  Sound.unlock();
  if (!S.autoRun && $("#autoToggle").checked) S.autoRun = { rounds: 0, spent: 0 };
  if (S.autoRun) { S.autoRun.rounds++; S.autoRun.spent += cost; }
  S.opening = { crate: S.crate, count: S.count, fast: S.fast };
  updateOpenBtn();

  const ownedBefore = new Set(S.items.map(i => i.person));
  let res;
  try {
    const crateEl = $("#buyPanel");
    crateEl?.classList.add("opening");
    Sound.open();
    [res] = await Promise.all([api("/api/open", { crate: S.crate, count: S.count }), sleep(S.fast ? 120 : 450)]);
    crateEl?.classList.remove("opening");
    if (res.discovered.length) await refreshConfig();
  } catch (e) {
    S.opening = null; updateOpenBtn();
    Sound.error(); toast(e.message, true);
    stopAuto();
    return;
  }
  S.items = [...res.drops.slice().reverse(), ...S.items];
  S.chests = res.chests || S.chests;
  applyState(res.state);
  S.opening.drops = res.drops;
  S.opening.ownedBefore = ownedBefore;
  runStage();
}

function runStage() {
  const o = S.opening;
  const n = o.drops.length;
  const stage = $("#stage");
  stage.hidden = false;
  document.body.style.overflow = "hidden";
  $("#stageTitle").textContent = `${crateOf(o.crate).name} × ${n}${o.fast ? "  ⚡" : ""}${S.autoRun ? `  🔁 ${S.autoRun.rounds}` : ""}`;
  updateAutoBtn();
  const reels = $("#reels"), results = $("#results");
  reels.hidden = false; results.hidden = true; results.innerHTML = "";
  $("#skipBtn").hidden = false;
  ["#sellAllBtn", "#againBtn", "#closeBtn"].forEach(s => $(s).hidden = true);
  $("#stageSum").textContent = "";

  const fitW = window.innerWidth - 40;
  const cols = Math.min(n <= 2 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5, Math.max(1, Math.floor(fitW / 230)));
  const rows = Math.ceil(n / cols);
  const gap = 12;
  reels.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  reels.style.maxWidth = n <= 2 ? "1100px" : "";
  reels.style.width = "100%";
  reels.style.margin = "0 auto";

  const W = Math.min(reels.clientWidth || window.innerWidth - 40, n <= 2 ? 1100 : 9999);
  const H = reels.clientHeight || window.innerHeight - 160;
  const cellW = (W - gap * (cols - 1)) / cols;
  const rowH = Math.min((H - gap * (rows - 1)) / rows, 280);
  const mw = Math.max(54, Math.min(150, cellW / 5, (rowH - 20) / 1.4));
  const mgap = Math.max(4, Math.round(mw * 0.06));
  const rh = Math.round(mw * 1.05 + (mw >= 70 ? 22 : 18) + 5 + 18);

  const STRIP = 54, WIN = 46;
  const rare = crateOf(o.crate).people.filter(id => rarityIdx(person(id).rarity) >= 4);
  reels.innerHTML = "";
  const now = performance.now();
  o.reels = o.drops.map((drop, i) => {
    const ids = Array.from({ length: STRIP }, () => weightedPerson(o.crate));
    ids[WIN] = drop.person;
    // czasem "prawie" - rzadka karta tuż obok wygranej
    if (rare.length && Math.random() < 0.28) ids[WIN + (Math.random() < 0.5 ? -1 : 1)] = rare[Math.floor(Math.random() * rare.length)];
    const el = document.createElement("div");
    el.className = "reel";
    el.style.setProperty("--rh", rh + "px");
    el.style.setProperty("--mw", mw + "px");
    el.style.setProperty("--gap", mgap + "px");
    el.innerHTML = `<div class="strip">${ids.map((id, k) => miniHTML(id, k === WIN)).join("")}</div><div class="reel-marker"></div>`;
    reels.appendChild(el);
    const strip = el.firstElementChild;
    const step = mw + mgap;
    const center = cellW / 2;
    const off = rand(-0.42, 0.42) * mw;
    const from = rand(0, step * 0.8);
    const to = -(WIN * step + mw / 2 + off) + center;
    strip.style.transform = `translate3d(${from}px, -50%, 0)`;
    const dur = o.fast ? 700 : rand(5200, 6200);
    const delay = o.fast ? i * 18 : i * 70;
    return { el, strip, drop, from, to, step, center, dur, start: now + delay, lastIdx: -1, done: false };
  });

  o.spinning = true;
  const easeSlow = t => 1 - Math.pow(1 - t, 4.2);
  const easeFast = t => 1 - Math.pow(1 - t, 3);
  const ease = o.fast ? easeFast : easeSlow;
  let lastLand = 0;
  const frame = ts => {
    if (S.opening !== o) return;
    let all = true;
    for (const r of o.reels) {
      if (r.done) continue;
      const t = Math.max(0, Math.min(1, (ts - r.start) / r.dur));
      const x = r.from + (r.to - r.from) * ease(t);
      r.strip.style.transform = `translate3d(${x.toFixed(1)}px, -50%, 0)`;
      const idx = Math.floor((r.center - x) / r.step);
      if (idx !== r.lastIdx) { if (r.lastIdx >= 0) Sound.tick(1 - t); r.lastIdx = idx; }
      if (t >= 1) {
        r.done = true;
        const rar = person(r.drop.person).rarity;
        r.el.classList.add("landed", "r-" + rar);
        if (rarityIdx(rar) >= 4) r.el.classList.add("jackpot");
        r.el.style.setProperty("--rc", S.cfg.rarities[rar].color);
        if (ts - lastLand > 60) { Sound.land(rar === "secret" ? "ultra" : rar); lastLand = ts; }
      } else all = false;
    }
    if (all) {
      o.spinning = false;
      $("#skipBtn").hidden = true;
      afterSpin(o);
    } else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function afterSpin(o) {
  await sleep(o.fast ? 250 : 700);
  if (S.opening !== o) return;
  // tajna karta przerywa autootwieranie - żeby jej nie przegapić
  if (S.autoRun && o.drops.some(d => person(d.person).rarity === "secret")) stopAuto("★ TAJNA KARTA! Auto zatrzymane");
  // legendarne, ultra i tajne dostają własne, wielkie odsłonięcie
  const epics = o.drops.filter(d => rarityIdx(person(d.person).rarity) >= 4)
    .sort((a, b) => rarityIdx(person(b.person).rarity) - rarityIdx(person(a.person).rarity) || varRank(b.variant) - varRank(a.variant));
  for (const d of epics) {
    await epicReveal(d, { fast: o.fast, auto: !!S.autoRun });
    if (S.opening !== o) return;
  }
  showResults(epics.length > 0);
}

function skipSpin() {
  const o = S.opening;
  if (!o || !o.spinning) return;
  const now = performance.now();
  o.reels.forEach(r => { r.start = Math.min(r.start, now - r.dur); });
}

function showResults(afterEpic = false) {
  const o = S.opening;
  o.spinning = false;
  o.showingResults = true;
  const n = o.drops.length;
  $("#reels").hidden = true;
  const results = $("#results");
  results.hidden = false;
  const avail = results.clientWidth || window.innerWidth - 40;
  const cols = Math.min(n <= 5 ? n : n <= 10 ? 5 : n <= 12 ? 6 : 7, Math.max(1, Math.floor(avail / 150)));
  const rcw = Math.min(n === 1 ? 320 : n <= 3 ? 260 : 220, (avail - 18 * (cols - 1) - 12) / cols);
  results.style.setProperty("--cols", cols);
  results.style.setProperty("--rcw", rcw + "px");

  const seenNew = new Set();
  results.innerHTML = o.drops.map((d, i) => {
    const p = person(d.person);
    const isNew = !o.ownedBefore.has(d.person) && !seenNew.has(d.person);
    if (isNew) seenNew.add(d.person);
    const big = rarityIdx(p.rarity) >= 4;
    return `<div class="result r-${p.rarity}${big ? " big" : ""}" data-id="${d.id}"
              style="--rc:${S.cfg.rarities[p.rarity].color}; animation-delay:${i * (o.fast ? 25 : 70)}ms">
      ${isNew ? '<span class="new-badge">NOWA!</span>' : ""}
      ${cardHTML(d.person, d.variant)}
      <div class="rbtns">${favBtnHTML(d.id, d.fav)}<button class="btn sell rsell" data-id="${d.id}" title="Sprzedaj" ${d.fav ? "disabled" : ""}>💰 ${fmt(d.value)}</button></div>
    </div>`;
  }).join("");

  // najlepszy drop -> efekty
  let best = o.drops[0];
  for (const d of o.drops) {
    const a = rarityIdx(person(d.person).rarity), b = rarityIdx(person(best.person).rarity);
    if (a > b || (a === b && varRank(d.variant) > varRank(best.variant))) best = d;
  }
  const bestR = person(best.person).rarity;
  if (afterEpic) {
    // wielkie odsłonięcie już było - tylko lekki akcent
    flash(`radial-gradient(circle, ${S.cfg.rarities[bestR].color}55, transparent 70%)`);
    Sound.reveal("purple");
  } else {
    Sound.reveal(bestR);
    if (bestR === "red") flash("radial-gradient(circle, #ff404066, transparent 70%)");
  }
  const specials = o.drops.filter(d => isSpecial(d.variant));
  if (specials.length && !afterEpic) {
    const top = specials.reduce((a, d) => varRank(d.variant) > varRank(a.variant) ? d : a);
    const colors = {
      diamond: ["#e8fbff", "#9ff6ff", "#c9b8ff", "#ffffff"], emerald: ["#00c853", "#6dffb0", "#c6ffe0", "#ffffff"],
      ruby: ["#ff1744", "#ff8a9c", "#ffd0d8", "#ffffff"], gold: ["#ffc531", "#fff3b0", "#fff"], holo: ["#9ff6ff", "#ff9ff3", "#fff"],
      silver: ["#e6ebf2", "#b8c2d0", "#ffffff"], reverse: ["#c9d6ff", "#ffffff", "#9ff6ff"], bw: ["#ffffff", "#111111", "#888888"],
    }[top.variant];
    setTimeout(() => confetti(colors, GEMS.includes(top.variant) ? 260 : top.variant === "gold" ? 140 : 60), 300);
    if (top.variant === "gold" || GEMS.includes(top.variant)) toast(`✨ ${variantName(top.variant).toUpperCase()}: ${person(top.person).name}!`);
  }

  updateStageBar();
  autoNext(o);
}

function updateStageBar() {
  const o = S.opening;
  const unsold = o.drops.filter(d => !d.sold);
  const sellable = unsold.filter(d => !d.fav);  // ulubione (⭐) zostają
  $("#stageSum").textContent = unsold.length ? `Wartość: ${fmt(unsold.reduce((a, d) => a + d.value, 0))}` : "Wszystko sprzedane";
  const sellAll = $("#sellAllBtn");
  sellAll.hidden = !sellable.length;
  sellAll.textContent = `💰 Sprzedaj ${sellable.length < unsold.length ? "resztę" : "wszystko"} (${fmt(sellable.reduce((a, d) => a + d.value, 0))})`;
  const again = $("#againBtn");
  const price = crateOf(o.crate).price;
  again.hidden = false;
  again.textContent = `🔁 Otwórz ponownie (${o.count} × ${fmt(price)})`;
  $("#closeBtn").hidden = false;
  $("#closeBtn").textContent = unsold.length ? "✔ Zatrzymaj i zamknij" : "✔ Zamknij";
}

async function sellResult(ids) {
  const o = S.opening;
  const rare = o.drops.filter(d => ids.includes(d.id) && rarityIdx(person(d.person).rarity) >= 4);
  if (rare.length && !confirm(`Na pewno sprzedać ${rare.length > 1 ? "legendarne karty" : person(rare[0].person).name}?`)) return;
  try {
    await sellIds(ids);
  } catch (e) { Sound.error(); toast(e.message, true); return; }
  ids.forEach(id => {
    const d = o.drops.find(d => d.id === id); if (d) d.sold = true;
    $(`.result[data-id="${id}"]`)?.classList.add("sold");
  });
  updateStageBar();
}

function closeStage() {
  stopAuto();
  $("#stage").hidden = true;
  document.body.style.overflow = "";
  $("#reels").innerHTML = ""; $("#results").innerHTML = "";
  S.opening = null;
  rerenderCurrent();
}

async function openAgain() {
  const o = S.opening;
  S.crate = o.crate; S.count = o.count; S.fast = $("#fastToggle").checked;
  S.opening = null;
  $("#stage").hidden = true;
  document.body.style.overflow = "";
  await openCrates();
  if (!S.opening) rerenderCurrent();
}

function flash(bg) {
  const f = $("#flash");
  f.style.background = bg;
  f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
}

// ================================================================ KONFETTI

const confettiState = { parts: [], running: false };
function confetti(colors, count) {
  const cv = $("#confetti");
  cv.width = innerWidth; cv.height = innerHeight;
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    confettiState.parts.push({
      x: fromLeft ? -10 : cv.width + 10, y: cv.height * rand(0.4, 0.8),
      vx: (fromLeft ? 1 : -1) * rand(4, 14), vy: rand(-18, -8),
      w: rand(6, 12), h: rand(8, 16), rot: rand(0, 6.28), vr: rand(-0.3, 0.3),
      c: colors[i % colors.length], life: 0,
    });
  }
  if (!confettiState.running) { confettiState.running = true; requestAnimationFrame(confettiFrame); }
}
function drawCoin(ctx, p) {
  p.vy -= 0.2; // monety spadają wolniej niż konfetti
  const sx = Math.abs(Math.cos(p.life / 7)) * 0.85 + 0.15, r = p.w / 2;
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(sx, 1);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
  g.addColorStop(0, "#fff6c2"); g.addColorStop(0.5, "#ffc531"); g.addColorStop(1, "#b37a00");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
  ctx.strokeStyle = "#8a5d00"; ctx.lineWidth = 2; ctx.stroke();
  if (sx > 0.5) { ctx.fillStyle = "#8a5d00"; ctx.font = `bold ${r}px Rubik, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", 0, 1); }
  ctx.restore();
}
function confettiFrame() {
  const cv = $("#confetti"), ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  confettiState.parts = confettiState.parts.filter(p => p.y < cv.height + 40 && p.life < 400);
  for (const p of confettiState.parts) {
    p.life++; p.vy += 0.35; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    if (p.shape === "coin") { drawCoin(ctx, p); continue; }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6)));
    ctx.restore();
  }
  if (confettiState.parts.length) requestAnimationFrame(confettiFrame);
  else { confettiState.running = false; ctx.clearRect(0, 0, cv.width, cv.height); }
}

// ================================================================ KLASER

function ownedMap() {
  const m = {};
  for (const it of S.items) {
    const e = (m[it.person] ||= { ids: [], byVar: {}, best: "normal" });
    e.ids.push(it.id);
    (e.byVar[it.variant] ||= []).push(it.id);
    if (varRank(it.variant) > varRank(e.best)) e.best = it.variant;
  }
  for (const e of Object.values(m)) if (!e.byVar[e.best]) e.best = Object.keys(e.byVar)[0];
  return m;
}

// owned: { personId: { best: wariant, count: liczba } }
function binderHTML(crate, owned, spread, { mine = true } = {}) {
  const ids = crate.people;
  const pages = [];
  for (let i = 0; i < ids.length; i += 9) pages.push(ids.slice(i, i + 9));
  if (!pages.length) pages.push([]);
  const spreads = Math.ceil(pages.length / 2);
  spread = Math.max(0, Math.min(spread, spreads - 1));
  const pageHTML = (page, side) => {
    const slots = (page || []).concat(Array(9 - (page || []).length).fill(null));
    return `<div class="bpage ${side}">${slots.map(id => {
      if (!id) return `<div class="pocket"></div>`;
      const p = person(id), o = owned[id];
      if (!o) {
        if (p.rarity === "secret") return `<div class="pocket secret-pocket"><div class="card-back secret-back"><div><div class="q">★</div><div class="n">TAJNA</div></div></div></div>`;
        return `<div class="pocket"><div class="card-back"><div><div class="q">?</div><div class="n">#${String(crate.people.indexOf(id) + 1).padStart(3, "0")}</div></div></div></div>`;
      }
      return `<div class="pocket owned${p.rarity === "secret" ? " secret-pocket" : ""}" data-pid="${id}" data-variant="${o.best}">${cardHTML(id, o.best)}${o.count > 1 ? `<span class="count">×${o.count}</span>` : ""}</div>`;
    }).join("")}</div>`;
  };
  const html = pageHTML(pages[spread * 2], "left") + pageHTML(pages[spread * 2 + 1], "right") +
    `<div class="binder-rings">${"<span></span>".repeat(4)}</div>`;
  const have = ids.filter(id => owned[id]).length;
  const special = ids.filter(id => owned[id] && isSpecial(owned[id].best)).length;
  const progress = `
    <span>${mine ? "Zebrano" : "Zebrane"} <b style="color:var(--text)">${have}/${ids.length}</b></span>
    <div class="pbar"><div style="width:${ids.length ? have / ids.length * 100 : 0}%"></div></div>
    ${S.cfg.rarityOrder.map(r => {
      const all = ids.filter(id => person(id).rarity === r);
      if (!all.length) return "";
      return `<span class="rar-count rc-${r}" style="--rc:${S.cfg.rarities[r].color}"><i></i>${all.filter(id => owned[id]).length}/${all.length}</span>`;
    }).join("")}
    <span>✨ warianty ${special}/${ids.length}</span>`;
  const a = spread * 2 + 1, b = Math.min(a + 1, pages.length);
  return { html, progress, spread, spreads, label: `Strony ${a}–${b} z ${pages.length}` };
}

function renderBinder() {
  $("#binderSeg").innerHTML = crateList().map(c =>
    `<button data-crate="${c.id}" class="${S.binderCrate === c.id ? "active" : ""}">${esc(c.emoji)} ${esc(c.short)}</button>`).join("");
  const crate = crateOf(S.binderCrate);
  if (!crate) { $("#binder").innerHTML = ""; return; }
  const owned = {};
  for (const [pid, o] of Object.entries(ownedMap())) owned[pid] = { best: o.best, count: o.ids.length };
  const b = binderHTML(crate, owned, S.spread);
  S.spread = b.spread;
  $("#binderProgress").innerHTML = b.progress;
  $("#binder").innerHTML = b.html;
  $("#pagePrev").disabled = S.spread === 0;
  $("#pageNext").disabled = S.spread >= b.spreads - 1;
  $("#pageIndicator").textContent = b.label;
}

function flipBinder(dir) {
  const before = S.spread;
  S.spread += dir;
  renderBinder();
  if (S.spread === before) return;
  Sound.page();
  const b = $("#binder");
  b.classList.remove("flip-next", "flip-prev"); void b.offsetWidth;
  b.classList.add(dir > 0 ? "flip-next" : "flip-prev");
}

// ================================================================ MODAL KARTY

function openModal(pid) {
  const o = ownedMap()[pid];
  if (!o) { closeModal(); return; }
  const p = person(pid);
  const R = S.cfg.rarities[p.rarity];
  const rows = S.cfg.variantOrder.slice().reverse().filter(v => o.byVar[v]).map(v => {
    const favs = new Set(S.items.filter(i => i.fav).map(i => i.id));
    const all = o.byVar[v], list = all.filter(id => !favs.has(id)), val = cardValue(pid, v);  // ulubionych nie sprzedajemy
    const nFav = all.length - list.length;
    return `<div class="copy-row">
      <span class="lbl"><span class="vdot vt-${v}"></span>${variantName(v)} ×${all.length}${nFav ? ` <span class="fav-note">★${nFav}</span>` : ""} <small>· ${fmt(val)}/szt.</small></span>
      <span>${list.length ? `<button class="btn" data-sell="${list[0]}">Sprzedaj 1</button>` : ""}
      ${list.length > 1 ? `<button class="btn sell" data-sell="${list.join(",")}">${nFav ? "Pozostałe" : "Wszystkie"} (${fmt(val * list.length)})</button>` : ""}</span>
    </div>`;
  }).join("");
  const dupes = dupesOf(o);
  $("#modalBox").innerHTML = `
    ${cardHTML(pid, o.best)}
    <div class="modal-side">
      <h3>${esc(p.name)}</h3>
      <div class="muted">${S.cfg.types[p.type].icon} ${S.cfg.types[p.type].name} · ${esc(crateOf(p.crate).name)} · <b style="color:${R.color}">${R.name}</b></div>
      <div>Posiadasz: <b>${o.ids.length}</b></div>
      ${rows}
      <div class="modal-actions">
        ${dupes.length ? `<button class="btn sell" data-sell="${dupes.join(",")}">Sprzedaj duplikaty (zostaw najlepszą)</button>` : ""}
        <button class="btn" id="modalClose">Zamknij</button>
      </div>
    </div>`;
  $("#modal").hidden = false;
  $("#modal").dataset.pid = pid;
}

function dupesOf(o) {
  // zostawiamy jedną kartę - w najlepszym wariancie (najlepiej ulubioną) - i wszystkie ulubione
  const favs = new Set(S.items.filter(i => i.fav).map(i => i.id));
  const keep = o.byVar[o.best].find(id => favs.has(id)) ?? o.byVar[o.best][0];
  return o.ids.filter(id => id !== keep && !favs.has(id));
}

function closeModal() { $("#modal").hidden = true; }

// ================================================================ EKWIPUNEK

function filteredItems() {
  const f = S.inv;
  const list = S.items.filter(i => {
    const p = person(i.person);
    return (f.crate === "all" || (p.crates || [p.crate]).includes(f.crate)) &&
           (!f.rarities.size || f.rarities.has(p.rarity)) &&
           (f.variant === "all" || (f.variant === "fav" ? i.fav : f.variant === "special" ? isSpecial(i.variant) : i.variant === f.variant));
  });
  const byName = (a, b) => person(a.person).name.localeCompare(person(b.person).name, "pl");
  const by = {
    new: (a, b) => b.id - a.id,
    value: (a, b) => b.value - a.value || b.id - a.id,
    rarity: (a, b) => rarityIdx(person(b.person).rarity) - rarityIdx(person(a.person).rarity) || varRank(b.variant) - varRank(a.variant) || byName(a, b),
    name: (a, b) => byName(a, b) || varRank(b.variant) - varRank(a.variant),
  }[f.sort];
  return list.sort(by);
}

function chestTileHTML(kind, n) {
  const money = kind.startsWith("money_") ? S.cfg.moneyChests[kind.slice(6)] : null;
  const c = money || crateOf(kind);
  if (!c) return "";
  const art = `<div class="crate-art chest-art" style="--crate-bg: linear-gradient(180deg, ${c.color1} 0 50%, ${c.color2} 50%); --crate-lid: linear-gradient(180deg, ${c.color1}, ${c.color2})">
      <div class="crate-box"><div class="crate-emblem">${esc(c.emoji)}</div></div><div class="crate-lid"></div><div class="crate-lock"></div></div>`;
  const k = n => n.toLocaleString("pl-PL");
  return `<div class="chest-tile${money ? " money" : ""}${kind === "money_mega" ? " mega" : ""}">
    ${art}
    <span class="chest-count">×${n}</span>
    <div class="chest-name">${esc(c.name)}</div>
    <div class="chest-sub">${money ? `${k(money.min)}–${k(money.max)} $` : `${c.people.length} kart`}</div>
    <div class="chest-btns">${money
      ? `<button class="btn primary" data-open-money="${kind.slice(6)}">Otwórz</button>`
      : `<button class="btn primary" data-open-crate="${kind}" data-n="1">Otwórz</button>${n > 1 ? `<button class="btn" data-open-crate="${kind}" data-n="${Math.min(n, S.cfg.maxOpen)}">×${Math.min(n, S.cfg.maxOpen)}</button>` : ""}`}</div>
  </div>`;
}

function renderChestShelf() {
  const kinds = Object.entries(S.chests).filter(([, n]) => n > 0)
    .sort(([a], [b]) => (b.startsWith("money_") - a.startsWith("money_")) || a.localeCompare(b));
  const shelf = $("#chestShelf");
  shelf.hidden = !kinds.length;
  shelf.innerHTML = kinds.length ? `<h3>📦 Twoje skrzynki</h3><div class="chest-grid">${kinds.map(([k, n]) => chestTileHTML(k, n)).join("")}</div>` : "";
}

function renderInventory() {
  renderChestShelf();
  const f = S.inv;
  const inCrate = id => S.items.filter(i => { const p = person(i.person); return (p.crates || [p.crate]).includes(id); }).length;
  $("#invCrateSeg").innerHTML = [["all", "Wszystkie", S.items.length], ...crateList().map(c => [c.id, `${c.emoji} ${c.short}`, inCrate(c.id)])]
    .map(([id, n, count]) => `<button data-crate="${id}" class="${f.crate === id ? "active" : ""}">${esc(n)} <small>${count}</small></button>`).join("");
  $("#invRarity").innerHTML = S.cfg.rarityOrder.map(r =>
    `<button class="rf rf-${r}${f.rarities.has(r) ? " active" : ""}" data-r="${r}" style="--rc:${S.cfg.rarities[r].color}"><i></i>${S.cfg.rarities[r].name}</button>`).join("");
  $("#invVariant").innerHTML = [["all", "Wszystkie warianty"], ["fav", "⭐ Tylko ulubione"], ["special", "✨ Tylko specjalne"],
    ...S.cfg.variantOrder.map(v => [v, variantName(v)])].map(([v, n]) =>
    `<option value="${v}"${f.variant === v ? " selected" : ""}>${n}</option>`).join("");
  $("#invSort").value = f.sort;

  const list = filteredItems();
  const total = list.reduce((a, i) => a + i.value, 0);
  $("#invSummary").innerHTML = `Kart: <b>${list.length}</b> · Wartość: <b>${fmt(total)}</b>` +
    (list.length !== S.items.length ? ` <span class="muted">(wszystkich: ${S.items.length})</span>` : "");
  const grid = $("#invGrid");
  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${S.items.length ? "Brak kart pasujących do filtrów." : "Ekwipunek jest pusty. Otwórz jakąś skrzynkę! 📦"}</div>`;
  } else {
    grid.innerHTML = list.slice(0, f.limit).map(i =>
      `<div class="inv-item${f.selected.has(i.id) ? " sel" : ""}${i.fav ? " fav" : ""}" data-id="${i.id}"><span class="tick">✓</span><button class="zoom-btn" title="Powiększ">🔍</button>${favBtnHTML(i.id, i.fav)}${cardHTML(i.person, i.variant)}</div>`).join("");
  }
  $("#invMore").parentElement.hidden = list.length <= f.limit;
  $("#invMore").textContent = `Pokaż więcej (${list.length - f.limit})`;
  updateSellbar();
}

function updateSellbar() {
  const sel = S.items.filter(i => S.inv.selected.has(i.id) && !i.fav);
  $("#selInfo").textContent = `Zaznaczono ${sel.length}` + (sel.length ? ` (${fmt(sel.reduce((a, i) => a + i.value, 0))})` : "");
  $("#sellSel").disabled = !sel.length;
  $("#selNone").disabled = !sel.length;
  $("#sellbar").hidden = currentView() !== "inventory" || !S.items.length;
}

async function sellSelected() {
  const sel = S.items.filter(i => S.inv.selected.has(i.id) && !i.fav);
  if (!sel.length) { toast("⭐ Zaznaczone karty są ulubione — nie da się ich sprzedać"); return; }
  const value = sel.reduce((a, i) => a + i.value, 0);
  const rare = sel.filter(i => rarityIdx(person(i.person).rarity) >= 4);
  if ((rare.length || value >= 1000) &&
      !confirm(`Sprzedać ${sel.length} ${plural(sel.length, "kartę", "karty", "kart")} za ${fmt(value)}?` +
               (rare.length ? `\nW tym ${rare.length} legendarnych lub lepszych!` : ""))) return;
  try { await sellIds(sel.map(i => i.id)); } catch (e) { Sound.error(); toast(e.message, true); }
  renderInventory();
}

async function sellAllDupes() {
  const owned = ownedMap();
  const ids = Object.values(owned).flatMap(dupesOf);
  if (!ids.length) { toast("Nie masz duplikatów."); return; }
  const value = S.items.filter(i => ids.includes(i.id)).reduce((a, i) => a + i.value, 0);
  if (!confirm(`Sprzedać ${ids.length} ${plural(ids.length, "duplikat", "duplikaty", "duplikatów")} za ${fmt(value)}?\n(Z każdej osoby zostanie 1 karta — w najlepszym wariancie.)`)) return;
  try { await sellIds(ids); } catch (e) { Sound.error(); toast(e.message, true); }
  renderInventory();
}

// ================================================================ ZDARZENIA

function bind() {
  $$(".tab").forEach(t => t.addEventListener("click", e => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;  // otwieranie w nowej karcie przeglądarki
    e.preventDefault(); Sound.click(); switchView(t.dataset.view);
  }));
  window.addEventListener("popstate", () => showRoute("none"));

  $("#cntMinus").addEventListener("click", () => { Sound.click(); setCount(S.count - 1); });
  $("#cntPlus").addEventListener("click", () => { Sound.click(); setCount(S.count + 1); });
  $("#cratePicker").addEventListener("click", e => {
    const c = e.target.closest(".shop-tile"); if (!c) return;
    if (S.crate !== c.dataset.crate) {
      S.crate = c.dataset.crate; Sound.click(); renderCrates();
      $("#buyPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
  $("#countChips").addEventListener("click", e => {
    const c = e.target.closest(".chip"); if (!c) return;
    Sound.click(); setCount(+c.dataset.n);
  });
  $("#countRange").addEventListener("input", e => setCount(+e.target.value));
  $("#fastToggle").addEventListener("change", e => { S.fast = e.target.checked; Sound.click(); try { localStorage.setItem("fast", S.fast ? "1" : "0"); } catch (_) {} });
  $("#openBtn").addEventListener("click", openCrates);
  $("#buyBtn").addEventListener("click", buyChests);
  $("#chestShelf").addEventListener("click", e => {
    const c = e.target.closest("[data-open-crate]"), m = e.target.closest("[data-open-money]");
    if (c) { S.crate = c.dataset.openCrate; S.count = +c.dataset.n; openCrates(); }
    if (m) openMoneyChest(m.dataset.openMoney);
  });

  $("#skipBtn").addEventListener("click", skipSpin);
  $("#autoStopBtn").addEventListener("click", () => { Sound.click(); stopAuto("⏹ Auto zatrzymane"); });
  $("#closeBtn").addEventListener("click", closeStage);
  $("#againBtn").addEventListener("click", openAgain);
  $("#sellAllBtn").addEventListener("click", () => sellResult(S.opening.drops.filter(d => !d.sold && !d.fav).map(d => d.id)));
  $("#results").addEventListener("click", async e => {
    const f = e.target.closest("[data-fav]");
    if (f) {
      const id = +f.dataset.fav, d = S.opening.drops.find(d => d.id === id);
      try { await setFavorite([id], !d.fav); } catch (err) { Sound.error(); toast(err.message, true); return; }
      f.outerHTML = favBtnHTML(id, d.fav);
      $(`.result[data-id="${id}"] .rsell`).disabled = d.fav;
      updateStageBar();
      return;
    }
    const b = e.target.closest(".rsell"); if (b) sellResult([+b.dataset.id]);
  });

  // klaser
  $("#binderSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    S.binderCrate = b.dataset.crate; S.spread = 0; Sound.click(); renderBinder();
  });
  $("#pagePrev").addEventListener("click", () => flipBinder(-1));
  $("#pageNext").addEventListener("click", () => flipBinder(1));
  $("#binder").addEventListener("click", e => {
    const p = e.target.closest(".pocket.owned"); if (p) { Sound.click(); openModal(p.dataset.pid); }
  });

  // modal
  $("#modal").addEventListener("click", async e => {
    if (e.target.id === "modal" || e.target.id === "modalClose") return closeModal();
    const b = e.target.closest("[data-sell]"); if (!b) return;
    const ids = b.dataset.sell.split(",").map(Number);
    const pid = $("#modal").dataset.pid;
    const r = person(pid).rarity;
    if (rarityIdx(r) >= 4 && !confirm(`Na pewno sprzedać ${person(pid).name} (${S.cfg.rarities[r].name})?`)) return;
    try { await sellIds(ids); } catch (err) { Sound.error(); toast(err.message, true); return; }
    openModal(pid);
    rerenderCurrent();
  });

  // ekwipunek
  $("#invCrateSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    S.inv.crate = b.dataset.crate; S.inv.limit = INV_PAGE; renderInventory();
  });
  $("#invRarity").addEventListener("click", e => {
    const b = e.target.closest(".rf"); if (!b) return;
    const r = b.dataset.r;
    S.inv.rarities.has(r) ? S.inv.rarities.delete(r) : S.inv.rarities.add(r);
    S.inv.limit = INV_PAGE; renderInventory();
  });
  $("#invVariant").addEventListener("change", e => { S.inv.variant = e.target.value; S.inv.limit = INV_PAGE; renderInventory(); });
  $("#invSort").addEventListener("change", e => { S.inv.sort = e.target.value; renderInventory(); });
  $("#invMore").addEventListener("click", () => { S.inv.limit += INV_PAGE; renderInventory(); });
  $("#invGrid").addEventListener("click", async e => {
    const it = e.target.closest(".inv-item"); if (!it) return;
    if (e.target.closest(".zoom-btn")) return;
    if (e.target.closest("[data-fav]")) {
      const item = S.items.find(i => i.id === +it.dataset.id);
      try { await setFavorite([item.id], !item.fav); } catch (err) { Sound.error(); toast(err.message, true); return; }
      it.classList.toggle("fav", item.fav);
      it.querySelector("[data-fav]").outerHTML = favBtnHTML(item.id, item.fav);
      updateSellbar();
      return;
    }
    const id = +it.dataset.id;
    S.inv.selected.has(id) ? S.inv.selected.delete(id) : S.inv.selected.add(id);
    it.classList.toggle("sel");
    Sound.click(); updateSellbar();
  });
  $("#selAll").addEventListener("click", () => { filteredItems().forEach(i => S.inv.selected.add(i.id)); renderInventory(); });
  $("#selNone").addEventListener("click", () => { S.inv.selected.clear(); renderInventory(); });
  $("#sellSel").addEventListener("click", sellSelected);
  $("#sellDupes").addEventListener("click", sellAllDupes);

  $("#invGrid").addEventListener("contextmenu", e => {
    const c = e.target.closest(".inv-item .card"); if (!c) return;
    e.preventDefault(); openViewer(c.dataset.pid, c.dataset.variant);
  });

  // powiększanie kart
  document.addEventListener("click", e => {
    const z = e.target.closest(".zoom-btn");
    const c = z ? z.parentElement.querySelector(".card")
                : e.target.closest("#contentsGrid .card, #results .card, #modalBox .card, .fa-result .card");
    if (c) { e.stopPropagation(); openViewer(c.dataset.pid, c.dataset.variant); }
  }, true);

  // bankomat
  $("#bankBtn").addEventListener("click", () => openBank());
  $("#bankClose").addEventListener("click", closeBank);
  $("#bank").addEventListener("click", e => {
    if (e.target.id === "bank") return closeBank();
    const b = e.target.closest(".bank-preset"); if (b) deposit(+b.dataset.v);
  });
  $("#bankForm").addEventListener("submit", e => { e.preventDefault(); deposit($("#bankAmount").value); });

  bindForge();
  bindSocial();

  // nagłówek
  $("#soundBtn").addEventListener("click", () => { Sound.toggle(); renderHeader(); });

  // klawiatura: Spacja/Enter = otwórz / pomiń, Esc = zamknij
  document.addEventListener("keydown", e => {
    if (e.target.matches("input[type=text], input[type=number], select, textarea")) return;
    if (epicOpen() || document.querySelector(".money-stage, .forge-anim")) return;
    if (dialogOpen()) { if (e.key === "Escape") closeDialogs(); return; }
    if (viewerOpen()) { if (e.key === "Escape" || e.key === " ") { e.preventDefault(); closeViewer(); } return; }
    if (!$("#bank").hidden) { if (e.key === "Escape") closeBank(); return; }
    if (e.key === "Escape") {
      if (!$("#modal").hidden) return closeModal();
      if (S.opening?.spinning) return skipSpin();
      if (S.opening?.showingResults) return closeStage();
    }
    if (e.key === " " || e.key === "Enter") {
      if (!$("#modal").hidden) return;
      if (S.opening?.spinning) { e.preventDefault(); return skipSpin(); }
      if (S.opening?.showingResults) { e.preventDefault(); openAgain(); return; }
      if (!S.opening && currentView() === "crates" && !e.target.closest("button, input")) { e.preventDefault(); openCrates(); }
    }
    if (currentView() === "binder" && $("#modal").hidden && !S.opening) {
      if (e.key === "ArrowLeft") flipBinder(-1);
      if (e.key === "ArrowRight") flipBinder(1);
    }
  });
  document.addEventListener("pointerdown", () => Sound.unlock(), { once: true });
}

// ================================================================ START

(async function init() {
  // serwer mógł się właśnie restartować - kilka prób zanim się poddamy
  let me, cfg, st;
  for (let attempt = 0; ; attempt++) {
    try { [me, cfg, st] = await Promise.all([api("/api/me"), api("/api/config"), api("/api/state")]); break; }
    catch (e) {
      if (attempt >= 5) { toast("Nie można połączyć się z serwerem — odśwież stronę", true); throw e; }
      await sleep(1000);
    }
  }
  S.me = me.user;
  S.cfg = cfg;
  S.state = st.state;
  S.items = st.items;
  S.showcase = st.showcase || [];
  S.chests = st.chests || {};
  S.crate = S.binderCrate = cfg.crateOrder[0];
  try { S.fast = localStorage.getItem("fast") === "1"; } catch (_) {}
  // podgrzej cache zdjęć, żeby bębny od razu miały obrazki
  Object.keys(cfg.people).forEach(id => { const im = new Image(); im.src = imgUrl(id); });
  bind();
  renderHeader();
  showRoute("replace");  // widok z adresu strony (/inventory, /player/nazwa...)
  updateSellbar();
  applyBadges(me);
  startPolling();
  if (me.dailyClaimable) setTimeout(openDaily, 600);
})();
