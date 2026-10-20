"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("pl-PL") + " gr";   // waluta gry: grosze

const COUNT_CHIPS = [1, 2, 3, 5, 10, 15, 20];
const INV_PAGE = 120;
const VARIANT_TAGS = { bw: "B&W", reverse: "REVERSE", silver: "SILVER", holo: "HOLO", gold: "GOLDEN", flag: "FLAG", halloween: "🎃 HALLOWEEN", lantern: "🏮 LAMPION", devil: "😈 DEVIL", joker: "🃏 JOKER", jeans: "👖 DŻINS", clear: "🫧 CLEAR", sketch: "✒️ SKETCH", emerald: "💚 EMERALD", amethyst: "💜 AMETHYST", ruby: "❤️ RUBY", royal: "👑 ROYAL", diamond: "💎 DIAMOND", galaxy: "🌌 GALAXY", negative: "◐ NEGATIVE", rzulty: "💛 RZULTY" };
const GEMS = ["emerald", "amethyst", "ruby", "diamond"];  // warianty z kamieniami szlachetnymi - wspólny wygląd, inne kolory

const S = {
  cfg: null,
  state: null,
  items: [],              // posortowane malejąco po id
  crate: null,
  count: 1,
  fast: false,
  binderCrate: null,
  spread: 0,
  inv: { crate: "all", rarities: new Set(), variant: "all", sort: "new", limit: INV_PAGE, selected: new Set(), q: "",
         mode: "cards" },        // mode: "cards" = moje karty, "hof" = Hall of Fame (/inventory/hall-of-fame)
  opening: null,
  me: null,               // zalogowany gracz
  showcase: [],           // id kart w mojej gablocie
  chests: {},             // skrzynki w ekwipunku: { rodzaj: ilość }
};

// ================================================================ API / POMOCNICZE

async function api(path, body) {
  const opts = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  // zmiany (POST) liczymy - syncInventory nie nadpisze ekwipunku w trakcie mojej własnej akcji
  if (body !== undefined) { S.inflight = (S.inflight || 0) + 1; S.mutations = (S.mutations || 0) + 1; }
  let res;
  try { res = await fetch(path, opts); }
  finally { if (body !== undefined) S.inflight--; }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && data?.login) { location.href = "/login"; throw new Error("Zaloguj się"); }
  if (!res.ok) throw new Error(data?.error || "Błąd serwera");
  // ucięta odpowiedź (zerwane połączenie) - błąd zamiast pustych danych (start gry spróbuje jeszcze raz)
  if (data === null) throw new Error("Błąd połączenia z serwerem — spróbuj jeszcze raz");
  return data;
}

async function refreshConfig() {
  S.cfg = await api("/api/config");
  if (!S.cfg.crates[S.crate]) S.crate = S.cfg.crateOrder[0];
  if (!S.cfg.crates[S.binderCrate]) S.binderCrate = S.cfg.crateOrder[0];
}

function rarityIdx(r) { return S.cfg.rarityOrder.indexOf(r); }
function varRank(v) { return S.cfg.variantOrder.indexOf(v || "normal"); }
// warianty wyjątkowe (Królewski, Flagowy...) wypadają tylko ze skrzynek, w których admin je włączył
function isExclusive(v) { return !!S.cfg.variants[v]?.exclusive; }
// warianty specjalne, które mogą wypaść z tej skrzynki: zwykłe zawsze, wyjątkowe tylko włączone w skrzynce
// (flagowy - tylko dla kart z ustawionym krajem)
// (warianty z polem "cards", np. Rzulty, należą do konkretnych kart - nie do skrzynki)
// (połączenia "flag+gold" nie wypadają osobno - patrz variantChance)
function crateVariants(crate, p = null) {
  return S.cfg.variantOrder.filter(v => {
    if (!isSpecial(v)) return false;
    const V = S.cfg.variants[v];
    if (V.combo) return false;
    if (!V.exclusive) return true;
    if (V.cards) return !!p && V.cards.includes(p.id);
    return (crate?.variants || []).includes(v) && (v !== "flag" || !p || p.country);
  });
}
// Warianty, w których ta karta może istnieć (jak catalog.possible_variants): zwykłe zawsze, wyjątkowe tylko z jej skrzynek,
// własne warianty karty (Rzulty - tylko Jan Paweł II) i połączenia flagi z każdym z nich
function possibleVariants(p) {
  if (isSpecialCard(p)) return [p.fixedVariant];   // karta specjalna istnieje tylko w jednym wariancie
  const extra = new Set();
  (p.crates || [p.crate]).forEach(c => { if (crateOf(c)) crateVariants(crateOf(c), p).forEach(v => extra.add(v)); });
  const V = S.cfg.variants;
  const base = S.cfg.variantOrder.filter(v => !V[v].combo && (!V[v].exclusive || extra.has(v)));
  const combos = new Set(base.filter(l => V[l].layer && !V[l].noCombo).flatMap(l => base.filter(b => b !== "normal" && !V[b].layer).map(b => `${l}+${b}`)));
  return S.cfg.variantOrder.filter(v => base.includes(v) || combos.has(v));
}
// Warstwy wariantu: flaga leży na osobnej warstwie, więc karta może być np. "flag+gold" (Flagowa + Złota)
function variantParts(v) { return S.cfg.variants[v || "normal"]?.layers || [v || "normal"]; }
function isCombo(v) { return !!S.cfg.variants[v]?.combo; }
// wariant z warstwy zwykłych wariantów (bez flagi) - od niego zależy zdjęcie i kolor plakietki
function baseVariant(v) { const parts = variantParts(v); return parts[parts.length - 1]; }
// klasy wyglądu: "v-flag v-gold v-combo" (prefix "avv-" dla ikon graczy)
function vClass(v, prefix = "v-") {
  const parts = variantParts(v);
  return parts.map(x => prefix + x).join(" ") + (parts.length > 1 ? ` ${prefix}combo` : "");
}
// klasa koloru (kropki, plakietki, przyciski): połączony wariant = kolor zwykłego wariantu z obwódką flagi
function vtClass(v) { return isCombo(v) ? `vt-${baseVariant(v)} vt-combo vt-l-${variantParts(v)[0]}` : `vt-${v || "normal"}`; }
// ikony warstw (przy połączonych wariantach)
const LAYER_ICONS = { flag: "🏳️", halloween: "🎃", lantern: "🏮", devil: "😈" };
// szansa na wariant przy wypadnięciu karty (avail = warianty możliwe w skrzynce, z crateVariants)
function variantChance(avail, v) {
  const V = S.cfg.variants;
  // warianty "always" (halloweenowe): w tej skrzynce każda karta ma jeden z nich (wg "weight"), zwykły losuje się normalnie
  const always = avail.filter(x => V[x].always);
  if (always.length) {
    const share = x => always.includes(x) ? (V[x].weight || 1) / always.reduce((a, y) => a + (V[y].weight || 1), 0) : 0;
    const bases = avail.filter(x => !V[x].layer), rest = 1 - bases.reduce((a, x) => a + V[x].chance, 0);
    // "noCombo" (Lampionowa, Diabelska): karta ma tylko ten wariant, bez zwykłego
    if (!isCombo(v)) return share(v) * (V[v]?.noCombo ? 1 : rest);
    const layer = variantParts(v)[0];
    return bases.includes(baseVariant(v)) && !V[layer].noCombo ? share(layer) * V[baseVariant(v)].chance : 0;
  }
  if (!isSpecial(v)) return 1 - avail.reduce((a, x) => a + V[x].chance, 0);
  if (isCombo(v)) {
    const [layer, base] = variantParts(v);
    const bases = avail.filter(x => !V[x].layer), tot = bases.reduce((a, x) => a + V[x].chance, 0);
    return avail.includes(layer) && bases.includes(base) && tot ? V[layer].chance * V[layer].extraChance * V[base].chance / tot : 0;
  }
  if (!avail.includes(v)) return 0;
  return V[v].chance * (1 - (V[v].extraChance || 0));
}
// rodzaje zdolności: ofensywna, defensywna, lecząca, ekonomiczna
const KIND_ICONS = { off: "⚔", def: "🛡", heal: "💚", eco: "🪙" };
const KIND_LABELS = { off: "Atak", def: "Obrona", heal: "Leczenie", eco: "Ekonomia" };
function kindIcon(k) { return KIND_ICONS[k] || KIND_ICONS.off; }

// Sortowanie kart w listach do wyboru (kuźnia, kasyno, rynek, wymiany, ikona gracza): elementy { person, variant, value, id? }
const CARD_SORTS = [["value", "💰 Najdroższe"], ["valueAsc", "💰 Najtańsze"], ["rarity", "💎 Rzadkość"],
                    ["variant", "✨ Wariant"], ["name", "🔤 Nazwa"], ["new", "🕒 Najnowsze"], ["dupes", "🔁 Duplikaty"]];
// listy bez sensu dla "Duplikaty" (karty do zdobycia, nie egzemplarze gracza): cele ulepszacza, szukane na rynku, ikona gracza
const UNIQUE_SORTS = CARD_SORTS.filter(([k]) => k !== "new" && k !== "dupes");
// ile egzemplarzy tej karty w tym wariancie ma gracz (osoba + wariant)
function dupKey(x) { return x.person + "|" + (x.variant || "normal"); }
function ownCounts() {
  const m = new Map();
  for (const i of S.items) m.set(dupKey(i), (m.get(dupKey(i)) || 0) + 1);
  return m;
}
function sortCards(list, mode = "value") {
  const name = x => { const p = person(x.person); return !p || p.masked ? "￿" : p.name; };
  const byName = (a, b) => name(a).localeCompare(name(b), "pl");
  const num = x => (typeof x.id === "number" ? x.id : 0);
  let dup = () => 0;
  if (mode === "dupes") {   // moje karty: ile mam ich łącznie (też ⭐), cudze (wymiany): ile jest ich na tej liście
    const own = ownCounts(), mine = new Set(S.items.map(i => i.id)), here = new Map();
    for (const x of list) here.set(dupKey(x), (here.get(dupKey(x)) || 0) + 1);
    dup = x => (mine.has(x.id) ? own : here).get(dupKey(x)) || 0;
  }
  const cmp = {
    // duplikaty na górze (najwięcej egzemplarzy najpierw), takie same karty obok siebie
    dupes: (a, b) => (dup(b) > 1) - (dup(a) > 1) || dup(b) - dup(a) || byName(a, b) || varRank(b.variant) - varRank(a.variant) || b.value - a.value,
    value: (a, b) => b.value - a.value || byName(a, b),
    valueAsc: (a, b) => a.value - b.value || byName(a, b),
    rarity: (a, b) => rarityIdx(person(b.person).rarity) - rarityIdx(person(a.person).rarity) || varRank(b.variant) - varRank(a.variant) || byName(a, b),
    variant: (a, b) => varRank(b.variant) - varRank(a.variant) || b.value - a.value || byName(a, b),
    name: (a, b) => byName(a, b) || varRank(b.variant) - varRank(a.variant),
    new: (a, b) => num(b) - num(a) || b.value - a.value,
  }[mode] || ((a, b) => b.value - a.value);
  return list.slice().sort(cmp);
}
// lista wyboru sortowania; attr - atrybut, po którym widok rozpozna zmianę (np. 'data-cssort="rl"')
function sortSelectHTML(mode, attr, options = CARD_SORTS) {
  return `<select class="sort-sel" ${attr} title="Sortowanie">${options.map(([v, n]) =>
    `<option value="${v}"${v === mode ? " selected" : ""}>${n}</option>`).join("")}</select>`;
}
// Wyszukiwanie kart w listach do wyboru (kuźnia, kasyno, rynek, wymiany, ikona gracza): po nazwie, wariancie i rzadkości,
// bez wielkich liter i polskich znaków ("zlota" znajdzie "Złota"); kilka słów = karta musi pasować do każdego
function searchNorm(s) { return String(s || "").toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function cardSearchText(pid, variant) {
  const p = person(pid);
  return p ? searchNorm(`${p.name} ${variantName(variant)} ${S.cfg.rarities[p.rarity].name}`) : "";
}
function searchMatch(text, q) { return searchNorm(q).split(/\s+/).filter(Boolean).every(w => text.includes(w)); }
function cardMatches(x, q) { return !q || !q.trim() || searchMatch(cardSearchText(x.person, x.variant), q); }
// Kliknięcie karty w kuźni / kasynie przerysowuje cały panel - listy kart z atrybutem data-keep nie wracają wtedy na górę.
// --pick-h: wysokość kafelka (style.css: kafelki poza ekranem mają tę wysokość, zanim się narysują - przewinięcie się zgadza)
function keepScroll(root, render) {
  const kept = {};
  root.querySelectorAll("[data-keep]").forEach(g => { kept[g.dataset.keep] = [g.scrollTop, g.querySelector(".pick")?.offsetHeight]; });
  render();
  root.querySelectorAll("[data-keep]").forEach(g => {
    const [top, h] = kept[g.dataset.keep] || [];
    if (h) g.style.setProperty("--pick-h", h + "px");
    if (top) g.scrollTop = top;
  });
}
// nowa zawartość listy (inna rzadkość, wyszukiwanie, sortowanie) - lista zaczyna się od góry
function resetKeep(key) { $$(`[data-keep="${key}"]`).forEach(g => { g.scrollTop = 0; }); }
function flagUrl(country) { return `/flag/${encodeURIComponent(country)}.svg`; }
function person(id) { return S.cfg.people[id]; }
// karta specjalna (rzadkość Specjalna): tylko z kasyna albo z linku, jeden wariant; nie da się jej sprzedać grze,
// postawić ani zużyć w kuźni (można ją wymienić albo sprzedać na rynku). p - karta albo jej id.
function isSpecialCard(p) { p = typeof p === "string" ? person(p) : p; return p?.rarity === "special"; }
function crateOf(id) { return S.cfg.crates[id]; }
function crateList() { return S.cfg.crateOrder.map(id => S.cfg.crates[id]); }
function isSpecial(v) { return !!v && v !== "normal"; }
function variantName(v) { return S.cfg.variants[v || "normal"].name; }
function cardValue(pid, v = "normal") {
  const p = person(pid);  // valueMult: karty tylko z droższych skrzynek są warte więcej (liczy serwer)
  return Math.round(S.cfg.rarities[p.rarity].value * (p.valueMult || 1) * S.cfg.variants[v || "normal"].mult);
}
// zdjęcie karty; wariant z własnym zdjęciem (np. Rzulty Jana Pawła II) -> /img/<id>/<wariant>
// (połączony wariant, np. halloween+gold: zdjęcie tej warstwy, która ma własne zdjęcie)
// small - mały kafelek (bęben, kuźnia, kasyno...): serwer wysyła lekką miniaturę zamiast pełnego zdjęcia
function imgUrl(pid, variant = null, small = false) {
  // część wariantu z własnym zdjęciem, a gdy brak - zdjęcie z "photoFallback" (Lampionowa -> Halloweenowa)
  const p = person(pid), has = x => x && p.variantPhotos?.[x] != null, parts = variant ? variantParts(variant) : [];
  const part = parts.find(has) || parts.map(x => S.cfg?.variants[x]?.photoFallback).find(has);
  const vv = part ? p.variantPhotos[part] : null;
  return `/img/${p.imgAs || pid}${vv != null ? "/" + part : ""}?v=${vv ?? (p.imgv || 0)}${small ? "&s=1" : ""}${p.imgq ? "&" + p.imgq : ""}`;
}
// ikona gracza: zdjęcie wybranej karty albo emoji
function avatarHTML(u, cls = "av") {
  if (u && u.avatarCard) {
    const rc = S.cfg?.rarities[u.avatarRarity]?.color || "#ffffff55";
    return `<span class="${cls} av-card ${S.cfg ? vClass(u.avatarVariant, "avv-") : "avv-" + (u.avatarVariant || "normal")}${u.avatarRarity === "secret" ? " av-secret" : ""}" style="--rc:${rc}"><img src="/avatar/${encodeURIComponent(u.username)}?c=${encodeURIComponent(u.avatarCard)}" alt="" draggable="false"></span>`;
  }
  return `<span class="${cls}">${esc(u?.avatar || "😎")}</span>`;
}

function crateStyle(c) {
  return `--crate-bg: linear-gradient(180deg, ${c.color1} 0 50%, ${c.color2} 50%); --crate-lid: linear-gradient(180deg, ${c.color1}, ${c.color2}); --c1: ${c.color2}`;
}

// ================================================================ KARTA

// efekty wariantu na karcie - połączony wariant (np. flag+gold) dostaje efekty obu warstw i dwie plakietki
function variantLayers(v, p = null) {
  const parts = variantParts(v).filter(isSpecial);
  let html = "";
  for (const x of parts) {
    if (x === "royal") html += '<div class="gold-sheen"></div><div class="royal-border"></div><div class="royal-crown"></div>';
    if (x === "flag") html += '<div class="flag-tint"></div><div class="flag-wave"></div>';
    if (x === "halloween") html += halloweenDeco();
    if (x === "lantern") html += lanternDeco();
    if (x === "devil") html += devilDeco();
    if (x === "holo") html += '<div class="holo-layer"></div>';
    if (x === "gold" || x === "silver") html += '<div class="gold-sheen"></div>';
    if (x === "clear") html += '<div class="clear-sheen"></div>';
    // nad kartą: migoczące gwiazdy i co jakiś czas spadająca gwiazda (każda karta w innym momencie i miejscu)
    if (x === "galaxy") html += `<div class="galaxy-stars"></div><div class="galaxy-shoot" style="--sd:-${rand(0, 11).toFixed(1)}s;--st:${Math.round(rand(4, 50))}%;--sl:${Math.round(rand(-30, 10))}%"><i></i></div>`;
    if (x === "negative") html += '<div class="neg-grain"></div>';
    if (x === "joker") html += jokerDeco();
    if (x === "jeans") html += jeansDeco();
    if (GEMS.includes(x)) html += '<div class="diamond-layer"></div><div class="diamond-glints"><i></i><i></i><i></i><i></i><i></i></div>';
  }
  parts.forEach((x, i) => {
    const cls = `var-tag vt-${x}${i ? " vt-second" : ""}`;
    html += x === "flag" && p?.country
      ? `<div class="${cls}"><img src="${flagUrl(p.country)}" alt="">${esc(p.country.toUpperCase())}</div>`
      : `<div class="${cls}">${VARIANT_TAGS[x]}</div>`;
  });
  return html;
}

// Galaktyczna: ruchome tło kosmosu w środku karty (pod napisami i zdjęciem) - trzy mgławice i dwie warstwy gwiazd
// Losowe gwiazdy (SVG, za każdym razem inne): pojedyncze w różnych miejscach, gromady wokół kilku punktów i kilka
// jaśniejszych "iskier" z promieniami; część gwiazd migocze (klasy tw1-tw3), w = szerokość, h = wysokość pola
function galaxyStars(w, h, solo, clumps, sparkles, size = 1) {
  const tint = () => ["#ffffff", "#ffffff", "#ffe3f6", "#dcecff"][Math.floor(Math.random() * 4)];
  const tw = () => (Math.random() < 0.4 ? ` class="tw${1 + Math.floor(Math.random() * 3)}"` : "");
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  let out = "";
  const star = (x, y, r, o) => { out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * size).toFixed(2)}" fill="${tint()}" opacity="${o.toFixed(2)}"${tw()}/>`; };
  for (let i = 0; i < solo; i++) star(rand(0, w), rand(0, h), rand(0.25, 0.75) ** 1.6 + 0.12, rand(0.35, 1));
  for (let c = 0; c < clumps; c++) {
    const cx = rand(0, w), cy = rand(0, h), spread = rand(3, 9), n = 7 + Math.floor(rand(0, 12));
    for (let i = 0; i < n; i++) star(cx + gauss() * spread, cy + gauss() * spread * rand(0.5, 1.2), rand(0.12, 0.4), rand(0.4, 0.95));
  }
  for (let i = 0; i < sparkles; i++) {
    const x = rand(5, w - 5), y = rand(5, h - 5), l = rand(1.8, 3.4) * size, t = 0.22 * size;
    out += `<g class="tw${1 + (i % 3)} gx-spark" opacity="0.95"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.55 * size).toFixed(2)}" fill="#fff"/>` +
      `<path d="M${x} ${y - l}L${x + t} ${y}L${x} ${y + l}L${x - t} ${y}Z M${x - l} ${y}L${x} ${y - t}L${x + l} ${y}L${x} ${y + t}Z" fill="#fff"/></g>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${out}</svg>`;
}

// Galaktyczna: ruchome tło kosmosu w środku karty (pod napisami i zdjęciem) - mgławice w różu, magencie i fiolecie
// z niebieską poświatą + dwie warstwy losowych gwiazd (dalsza wolniej, bliższa szybciej)
function galaxyBG(variant) {
  if (!variantParts(variant).includes("galaxy")) return "";
  return `<div class="galaxy-bg"><i class="gx-neb n1"></i><i class="gx-neb n2"></i><i class="gx-neb n3"></i><i class="gx-neb n4"></i>` +
    `<i class="gx-stars s1">${galaxyStars(100, 140, 55, 3, 0, 0.9)}</i><i class="gx-stars s2">${galaxyStars(100, 140, 14, 1, 3, 1.2)}</i></div>`;
}
// ...i ta sama galaktyka na zdjęciu: kosmiczne zabarwienie, mgławica i gwiazdy na postaci (jak skórka Galaxy)
function galaxyPhoto(variant) {
  if (!variantParts(variant).includes("galaxy")) return "";
  return `<i class="gx-photo"><i class="gx-neb n1"></i><i class="gx-neb n3"></i><i class="gx-stars s1">${galaxyStars(100, 100, 28, 2, 2, 1)}</i></i>`;
}

// Halloweenowa (symbole SVG #hw-* z templates/index.html): nietoperze przelatujące nad kartą...
const hwUse = (id, cls, style = "") => `<svg class="${cls}" style="${style}" aria-hidden="true"><use href="#${id}"/></svg>`;
function halloweenDeco() {
  const bat = (k, d) => `<i class="hw-bat b${k}" style="animation-delay:-${d.toFixed(1)}s">${hwUse("hw-bat", "hw-bat-svg")}</i>`;
  return `<div class="hw-deco">${bat(1, rand(0, 9))}${bat(2, rand(0, 12))}${bat(3, rand(0, 15))}</div>`;
}
// ...a na zdjęciu: księżyc w rogu, migoczące dynie-lampiony na dole i czaszka
function halloweenPhoto(variant) {
  if (!variantParts(variant).includes("halloween")) return "";
  return `<i class="hw-photo"><i class="hw-moon"></i><span class="hw-pumpkins">${hwUse("hw-pumpkin", "hw-p1")}${hwUse("hw-pumpkin", "hw-p2")}${
    hwUse("hw-pumpkin", "hw-p3")}</span>${hwUse("hw-skull", "hw-skull")}</i>`;
}
// Lampionowa: karta w blasku świecy - iskry unoszące się z dołu i dwie migoczące dynie w dolnych rogach
const embersHTML = (n, cls) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${rand(5, 90).toFixed(0)}%;animation-delay:-${rand(0, 5).toFixed(1)}s;animation-duration:${rand(3.5, 6.5).toFixed(1)}s"></i>`).join("");
function lanternDeco() {
  return `<div class="hw-deco lt-deco">${embersHTML(9, "lt-ember")}${hwUse("hw-pumpkin", "lt-cp l")}${hwUse("hw-pumpkin", "lt-cp r")}</div>`;
}
// Diabelska: płomienie od dołu karty (pod napisami) i rogi wystające nad kartę
function devilBG(variant) {
  if (!variantParts(variant).includes("devil")) return "";
  return `<div class="dv-bg">${[6, 20, 34, 48, 62, 76].map((x, k) =>
    `<i class="dv-flame" style="left:${x}%;animation-delay:-${(k * .37).toFixed(2)}s;animation-duration:${rand(.8, 1.4).toFixed(2)}s"></i>`).join("")}</div>`;
}
function devilDeco() { return `<div class="dv-out">${hwUse("dv-horn", "dv-horn l")}${hwUse("dv-horn", "dv-horn r")}</div>`; }

// Karty specjalne - wariant Jokerowa "Talia Kasynowa" (joker-talia.css): karta do gry na zielonym suknie - na szerokich
// marginesach indeksy JOKER z czapką błazna (symbol SVG #jk-hat w templates/index.html) i stosy żetonów; nic nie zasłania zdjęcia.
function jokerDeco() {
  const letters = "JOKER".split("").map(l => `<b>${l}</b>`).join("");
  const idx = c => `<span class="jt-idx ${c}">${hwUse("jk-hat", "jt-hat")}${letters}</span>`;
  const chips = (side, colors) => `<span class="jt-chips ${side}">${colors.map(c => `<i class="jt-chip ${c}"></i>`).join("")}</span>`;
  return `<div class="jt-deco"><i class="jt-stitch"></i>${idx("tl")}${idx("br")}${chips("l", ["red", "black", "blue"])}${chips("r", ["purple", "red", "black"])}</div>`;
}
// Karty specjalne - wariant Dżinsowa: dżins, pomarańczowe przeszycia, miedziane nity
function jeansDeco() {
  const rivets = ["tl", "tr", "bl", "br"].map(c => `<i class="dz-rivet ${c}"></i>`).join("");
  return `<div class="dz-deco"><i class="dz-stitch"></i>${rivets}</div>`;
}

// wszystkie zdolności karty po kolei: [{ name, kind: "off" | "def" | "heal" | "eco", value }]
function abilitiesOf(p) {
  const list = [{ name: p.attack, kind: p.kind1 || "off", value: p.dmg }];
  if (p.attack2) list.push({ name: p.attack2, kind: p.kind2 || "off", value: p.dmg2 });
  return list.concat(p.abilities || []);
}

// wariant flagowy (także połączony, np. flag+gold): flaga kraju karty jako tło ramki (zmienna CSS --flag)
function flagStyle(p, variant) { return variantParts(variant).includes("flag") && p.country ? ` style="--flag:url('${flagUrl(p.country)}')"` : ""; }

function cardHTML(pid, variant = "normal") {
  const p = person(pid);
  if (p.masked) return mysteryCardHTML(p);
  if (p.rarity === "secret") return secretCardHTML(p, variant);
  const r = S.cfg.rarities[p.rarity];
  const type = S.cfg.types[p.type];
  const crate = crateOf(p.crate);
  const total = String(crate.people.length).padStart(3, "0");
  const cost = type.icon.repeat(Math.min(3, 1 + Math.floor(rarityIdx(p.rarity) / 2)));
  const abils = abilitiesOf(p);
  return `
  <div class="card r-${p.rarity} ${vClass(variant)}${p.style ? " vs-" + p.style : ""}${abils.length > 1 ? " two-atk" : ""}${abils.length > 2 ? ` atk-${abils.length}` : ""}" data-pid="${p.id}" data-variant="${variant}"${flagStyle(p, variant)}>
    <div class="card-inner">
      ${baseVariant(variant) === "reverse" ? '<div class="rev-foil"></div>' : ""}
      ${galaxyBG(variant)}${devilBG(variant)}
      <div class="card-head">
        <span class="card-name">${esc(p.name)}</span>
        <span class="card-hp"><small>HP</small>${p.hp}</span>
        <span class="card-type">${type.icon}</span>
      </div>
      <div class="card-photo"><img src="${imgUrl(p.id, variant)}" alt="${esc(p.name)}" loading="lazy" draggable="false">${galaxyPhoto(variant)}${halloweenPhoto(variant)}</div>
      <div class="card-sub${p.subtitle ? " has-subtitle" : ""}">${p.subtitle ? esc(p.subtitle) : `${type.name} · ${esc(crate.short)}`}</div>
      ${abils.map((a, i) => `<div class="card-attack${i ? " atk2" : ""}${a.kind !== "off" ? " " + a.kind : ""}">
        <span class="atk-cost">${a.kind === "off" ? cost + (i ? type.icon : "") : S.cfg.abilityKinds[a.kind]?.icon || ""}</span>
        <span class="atk-name">${esc(a.name)}</span>
        <span class="atk-dmg">${a.value}</span>
      </div>`).join("")}
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
    ${variantLayers(variant, p)}
    <div class="shine"></div>
  </div>`;
}

// TAJNA karta - zupełnie inny układ: pełnoekranowe zdjęcie, aureola, złota animowana ramka
function secretCardHTML(p, variant) {
  const type = S.cfg.types[p.type];
  const crate = crateOf(p.crate);
  return `
  <div class="card r-secret ${vClass(variant)}" data-pid="${p.id}" data-variant="${variant}"${flagStyle(p, variant)}>
    <div class="sc">
      <div class="sc-art"><img src="${imgUrl(p.id, variant)}" alt="${esc(p.name)}" loading="lazy" draggable="false"></div>
      ${galaxyBG(variant)}${devilBG(variant)}${halloweenPhoto(variant)}
      <div class="sc-halo"></div>
      <div class="sc-stars"></div>
      ${baseVariant(variant) === "reverse" ? '<div class="rev-foil"></div>' : ""}
      <div class="sc-top">
        <span class="sc-seal">★</span>
        <span class="sc-name">${esc(p.name)}</span>
        <span class="sc-hp"><small>HP</small>${p.hp}</span>
      </div>
      <div class="sc-panel">
        ${p.subtitle ? `<div class="sc-sub">${esc(p.subtitle)}</div>` : ""}
        ${abilitiesOf(p).map((a, i) => `<div class="sc-attack${a.kind !== "off" ? " " + a.kind : ""}"><span>${a.kind === "off" ? type.icon.repeat(i ? 2 : 1) : S.cfg.abilityKinds[a.kind]?.icon || ""}</span><span class="sc-atk">${esc(a.name)}</span><b>${a.value}</b></div>`).join("")}
        <div class="sc-foot"><span>★ TAJNA ★</span><span>${esc(crate.code)} ★${String(p.number).padStart(3, "0")}</span><span class="sc-val">${fmt(cardValue(p.id, variant))}</span></div>
      </div>
      <div class="sc-frame"></div>
      <div class="sc-border"></div>
    </div>
    ${variantLayers(variant, p)}
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
// ruch myszy liczymy najwyżej raz na klatkę (myszki potrafią zgłaszać ruch 500-1000 razy na sekundę)
let tiltEvent = null;
document.addEventListener("pointermove", e => {
  if (!tiltEvent) requestAnimationFrame(() => { const ev = tiltEvent; tiltEvent = null; if (ev) tiltMove(ev); });
  tiltEvent = e;
}, { passive: true });
function tiltMove(e) {
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
  const fancy = card.matches(".r-secret, .v-holo, .v-reverse, .v-gold, .v-silver, .v-diamond, .v-emerald, .v-ruby, .v-amethyst, .v-bw, .v-clear, .v-negative, .v-sketch, .v-galaxy");
  const strength = card.closest(".viewer") ? 1.5 : fancy || card.closest(".modal") ? 1 : 0.6;
  card.classList.add("tilting");
  card.style.setProperty("--rx", ((0.5 - py) * 16 * strength).toFixed(2) + "deg");
  card.style.setProperty("--ry", ((px - 0.5) * 20 * strength).toFixed(2) + "deg");
  card.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
  card.style.setProperty("--my", (py * 100).toFixed(1) + "%");
}
// kursor wyjechał poza okno - karta wraca do pozycji prostej
document.documentElement.addEventListener("pointerleave", () => { tiltEvent = null; resetTilt(tiltCard); tiltCard = null; });

// Pełnoekranowa nakładka (otwieranie skrzynek, wielkie odsłonięcie, kuźnia, podgląd karty, skrzynka z pieniędzmi...)
// zasłania całą stronę - wtedy body.covered chowa stronę pod spodem (style.css: WYDAJNOŚĆ), żeby przeglądarka nie liczyła
// animacji setek niewidocznych kart. Wszystkie te nakładki są dodawane bezpośrednio do <body>.
const COVERS = ["body > #stage:not([hidden])", "body > .epic", "body > .sreveal", "body > .forge-anim", "body > .money-stage",
                "body > .jp-anim", "body > .viewer"].join(", ");
function updateCovered() { document.body.classList.toggle("covered", !!document.querySelector(COVERS)); }
function watchCovers() {
  const mo = new MutationObserver(updateCovered);
  mo.observe(document.body, { childList: true });
  mo.observe($("#stage"), { attributes: true, attributeFilter: ["hidden"] });
}

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
  $("#adminLink").hidden = !S.me?.isAdmin;
  // Arena (wersja testowa) - zakładka tylko dla adminów
  $(".tab[data-view=arena]").hidden = !S.cfg?.arena;
  $(".tabs").classList.toggle("no-arena", !S.cfg?.arena);
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

// Ekwipunek zmieniony bez udziału tej karty przeglądarki (wygrana w jackpocie, wygrana licytacja, sprzedaż na rynku,
// przyjęta wymiana): /api/me podaje "odcisk" ekwipunku (liczba kart, suma id) i saldo - gdy się różnią, pobieramy świeży stan.
// force = bez porównywania. Pomijamy w trakcie własnych akcji i animacji (one same aktualizują ekwipunek).
async function syncInventory(me = null, force = false) {
  if (!S.items || !S.state) return;
  if (!force) {
    if (!me?.inv) return;
    const sum = S.items.reduce((a, i) => a + i.id, 0);
    if (S.items.length === me.inv[0] && sum === me.inv[1] && S.state.balance === me.balance) return;
  }
  const busy = () => S.inflight > 0 || S.opening || FORGE.busy || CS.spinning;
  if (busy()) return;
  const m = S.mutations;
  let st;
  try { st = await api("/api/state"); } catch (_) { return; }
  if (m !== S.mutations || busy()) return;
  S.items = st.items;
  S.showcase = st.showcase || [];
  S.chests = st.chests || S.chests;
  noteCollected(S.items);
  if (S.items.some(i => !person(i.person) || person(i.person).masked)) await refreshConfig();   // nowe (tajne) karty
  applyState(st.state);
  if (["inventory", "binder"].includes(currentView()) && !dialogOpen() && !viewerOpen()) rerenderCurrent();
}

// klaser pamięta każdą kartę, którą gracz kiedykolwiek miał ("osoba|wariant")
function noteCollected(items) { items.forEach(i => S.collected.add(`${i.person}|${i.variant}`)); }

function removeItems(ids) {
  const set = new Set(ids);
  noteCollected(S.items.filter(i => set.has(i.id)));
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
  // ulubionych i kart specjalnych nie sprzedajemy (serwer też je pomija)
  const keep = new Set(S.items.filter(i => i.fav || isSpecialCard(i.person)).map(i => i.id));
  ids = ids.filter(id => !keep.has(id));
  if (!ids.length) { toast("⭐ Ulubionych i 🃏 specjalnych kart nie da się sprzedać"); return 0; }
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

// ================================================================ APLIKACJA NA TELEFON (PWA)
// Android / Chrome / Edge: przeglądarka sama proponuje instalację (beforeinstallprompt) - pokazujemy przycisk 📲.
// iPhone (Safari) nie ma takiego okna - przycisk otwiera instrukcję "Udostępnij -> Do ekranu początkowego".
let installPrompt = null;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function setupInstall() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  const btn = $("#installBtn");
  if (isStandalone()) return;  // już działa jako aplikacja
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; btn.hidden = false; });
  window.addEventListener("appinstalled", () => { installPrompt = null; btn.hidden = true; toast("📲 Gotowe! Gra jest na ekranie głównym."); });
  if (isIOS()) btn.hidden = false;
  btn.addEventListener("click", async () => {
    Sound.click();
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") { installPrompt = null; btn.hidden = true; }
      return;
    }
    openDialog(`<h3>📲 Gra jako aplikacja</h3>
      ${isIOS() ? `<ol class="install-steps">
          <li>Otwórz grę w <b>Safari</b>.</li>
          <li>Stuknij <b>Udostępnij</b> <span class="kbd">⎋⬆</span> na dole ekranu.</li>
          <li>Wybierz <b>„Do ekranu początkowego”</b> i stuknij <b>Dodaj</b>.</li>
        </ol>` : `<ol class="install-steps">
          <li>Otwórz menu przeglądarki <span class="kbd">⋮</span>.</li>
          <li>Wybierz <b>„Zainstaluj aplikację”</b> albo <b>„Dodaj do ekranu głównego”</b>.</li>
        </ol>`}
      <p class="muted">Gra pojawi się z ikoną na ekranie telefonu i otworzy się na pełnym ekranie, bez paska przeglądarki.</p>
      <div class="daily-actions"><button class="btn" data-close>Zamknij</button></div>`);
  });
}

// ================================================================ ADRESY STRON
// każda zakładka ma swój adres (/inventory...), profil gracza: /player/<nazwa>; "/" = skrzynki
const VIEW_PATHS = { crates: "/crates", binder: "/binder", inventory: "/inventory", forge: "/forge", market: "/market", casino: "/casino",
                     friends: "/friends", ranking: "/ranking", arena: "/arena", mockups: "/mockups" };

function viewPath(view) {
  if (view === "inventory" && S.inv.mode === "hof") return "/inventory/hall-of-fame";
  return view === "profile" ? "/player/" + encodeURIComponent(PROF.username || S.me.username) : VIEW_PATHS[view] || "/";
}

function routeFromPath(path = location.pathname) {
  const m = path.match(/^\/player\/([^/]+)\/?$/);
  if (m) return { view: "profile", user: decodeURIComponent(m[1]) };
  const link = path.match(/^\/link\/([^/]+)\/?$/);   // link od admina do karty specjalnej
  if (link) return { view: "inventory", link: decodeURIComponent(link[1]) };
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/inventory/hall-of-fame") return { view: "inventory", hof: true };
  return { view: Object.keys(VIEW_PATHS).find(v => VIEW_PATHS[v] === clean) || "crates" };
}

function showRoute(how = "none") {
  const r = routeFromPath();
  if (r.link) return claimLink(r.link);
  if (r.view === "inventory") S.inv.mode = r.hof ? "hof" : "cards";
  if (r.view === "profile") openProfile(r.user, how);
  else switchView(r.view, how);
}

// how: "push" - nowy wpis w historii (kliknięcie), "replace" - podmiana (start), "none" - bez zmian (wstecz/dalej)
function switchView(view, how = "push") {
  if (view === "arena" && !S.cfg.arena) view = "crates";  // Arena: na razie tylko dla adminów
  if (view === "mockups" && !S.me?.isAdmin) view = "crates";
  const path = viewPath(view);
  if (how !== "none" && location.pathname !== path) history[how === "replace" ? "replaceState" : "pushState"](null, "", path);
  const tab = $(`.tab[data-view="${view}"]`);
  const label = view === "profile" ? (PROF.username || S.me.username) : tab && `${tab.querySelector(".ti").textContent} ${tab.querySelector(".tl").textContent}`;
  document.title = label ? `${label} — ScamBox` : "ScamBox";
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
  if (view === "binder") renderBinder();
  if (view === "inventory") renderInventory();
  if (view === "crates") renderCrates();
  if (view === "forge") renderForge();
  if (view === "market") renderMarket();
  if (view === "casino") renderCasino();
  else stopJackpotPolling();
  if (view === "friends") renderFriends();
  if (view === "ranking") renderRanking();
  if (view === "profile") renderProfile();
  if (view === "arena") renderArena();
  if (view === "mockups") renderMockups();
  else document.body.classList.remove("hs-open");  // walka w Arenie zajmuje cały ekran tylko w jej zakładce
  updateSellbar();
}

function currentView() { return $(".view.active").id.replace("view-", ""); }

function rerenderCurrent() { switchView(currentView(), "none"); }

// ================================================================ SKRZYNKI

function shopCrates() {
  // skrzynki "dla wybranych" widzą tylko gracze z dostępem (posiadane z ekwipunku zawsze da się otworzyć);
  // skrzynki kart specjalnych nie ma w sklepie (karty specjalne są z kasyna i z linków)
  return crateList().filter(c => !c.special && ((c.shop && (!c.restricted || c.canBuy)) || (S.chests[c.id] || 0) > 0 || S.me?.isAdmin));
}

// ---------------------------------------------------------------- karuzela skrzynek ("rotacja sklepu")
// Środkowa skrzynka = wybrana. Karuzela sama przechodzi do następnej co SHOP_ROTATE_MS - tylko gdy jest na ekranie,
// kursor nie jest nad sklepem i gracz przez ostatnie SHOP_IDLE_MS nie klikał w sklepie (żeby nie zmienić skrzynki pod
// palcem tuż przed "OTWÓRZ").
const SHOP_ROTATE_MS = 5000, SHOP_IDLE_MS = 30000;
function carOffset(i, sel, n) {   // przesunięcie kafelka względem wybranego, "w kółko": -n/2 ... n/2
  const half = Math.floor(n / 2);
  return ((i - sel + n + half) % n) - half;
}
function placeCarousel(track, sel) {
  const tiles = [...track.children], n = tiles.length, side = innerWidth <= 700 ? 1 : 2;
  tiles.forEach((t, i) => {
    const off = carOffset(i, sel, n), abs = Math.abs(off);
    t.style.setProperty("--off", off);
    t.style.setProperty("--abs", abs);
    t.classList.toggle("far", abs > side);
    t.classList.toggle("selected", off === 0);
  });
}
function shopTouched() { S.shopIdleAt = Date.now(); }
function shopRotate(dir, manual = true) {
  const list = shopCrates();
  if (list.length < 2) return;
  if (manual) { shopTouched(); Sound.click(); }
  const i = list.findIndex(c => c.id === S.crate);
  S.crate = list[(i + dir + list.length) % list.length].id;
  renderCrates();
}
function shopAutoRotate() {
  const car = $("#shopCarousel"), r = car?.getBoundingClientRect();
  if (currentView() !== "crates" || !r || S.opening || S.shopHover || document.hidden || dialogOpen() || viewerOpen() || epicOpen() ||
      Date.now() - (S.shopIdleAt || 0) < SHOP_IDLE_MS || r.bottom < 80 || r.top > innerHeight - 120) return;
  shopRotate(1, false);
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
  const track = $("#cratePicker");
  track.innerHTML = visible.map(c => {
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
  // karuzela: kafelki startują z pozycji względem poprzednio wybranej skrzynki i przesuwają się (transition) na nowe miejsca
  const sel = visible.findIndex(c => c.id === S.crate), prev = visible.findIndex(c => c.id === S.shopPrev);
  if (sel >= 0) {
    placeCarousel(track, prev >= 0 ? prev : sel);
    if (prev >= 0 && prev !== sel) { void track.offsetWidth; placeCarousel(track, sel); }
  }
  S.shopPrev = S.crate;
  $("#shopCarousel").classList.toggle("single", visible.length < 2);
  $("#shopDots").innerHTML = visible.length > 1 ? visible.map(c =>
    `<button class="car-dot${c.id === S.crate ? " active" : ""}" data-crate="${c.id}" title="${esc(c.name)}" style="--c1:${c.color1}"></button>`).join("") : "";

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
  // warianty "always" (halloweenowe): każda karta ma jeden z nich - pokazujemy udział każdego
  const always = crateVariants(crate).filter(v => S.cfg.variants[v].always);
  const alwaysW = always.reduce((a, v) => a + (S.cfg.variants[v].weight || 1), 0);
  const comboTxt = v => S.cfg.variants[v].noCombo ? "nie łączy się z innymi wariantami" : "łączy się z innymi wariantami";
  const alwaysTxt = v => always.length > 1
    ? `${pctTxt((S.cfg.variants[v].weight || 1) / alwaysW)} kart (każda karta ma jeden z ${always.length} wariantów halloweenowych, ${comboTxt(v)})`
    : `100% — każda karta (${comboTxt(v)})`;
  $("#odds").innerHTML = rs.map(r => {
    const R = S.cfg.rarities[r];
    const n = crate.people.filter(id => person(id).rarity === r).length;
    return `<span class="odd odd-${r}" style="--rc:${R.color}"><b>${R.name}</b> ${pctTxt(crate.weights[r] / totalW)} · ${n} ${plural(n, "karta", "karty", "kart")} · ${fmt(R.value)}</span>`;
  }).join("") + `<div class="odds-variants">${crateVariants(crate).map(v => {
    const V = S.cfg.variants[v];
    const flags = v === "flag" ? crate.people.filter(id => person(id).country).length : null;
    return `<span class="odd odd-v vt-${v}"><b>${isExclusive(v) ? "✨ " : ""}${V.name}</b> ${V.always ? alwaysTxt(v) : pctTxt(V.chance)} · wartość ×${String(V.mult).replace(".", ",")}${
      flags !== null ? ` · ${flags} ${plural(flags, "karta", "karty", "kart")} z flagą` : ""}${
      V.extraChance ? ` · ${Math.round(V.extraChance * 100)}% z dodatkowym wariantem (wartości się mnożą)` : ""}${isExclusive(v) ? " · tylko w tej skrzynce" : ""}</span>`;
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
    <img src="${imgUrl(p.id, null, true)}" alt="" draggable="false"><div class="mn">${esc(p.name)}</div></div>`;
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
  shopTouched();
  const cost = (S.count - Math.min(S.chests[crate.id] || 0, S.count)) * crate.price;
  if (S.state.balance < cost) {
    Sound.error();
    const msg = `Brakuje ci ${fmt(cost - S.state.balance)}, żeby otworzyć ${S.count} ${plural(S.count, "skrzynkę", "skrzynki", "skrzynek")}.`;
    // bez darmowych pieniędzy po bankructwie - tylko nagroda dzienna (i sprzedaż kart)
    if (S.dailyClaimable) { toast(msg + " Odbierz nagrodę dzienną!", true); openDaily(); }
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
  const rare = crateOf(o.crate).people.filter(id => rarityIdx(person(id).rarity) >= rarityIdx("gold"));
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
        if (rarityIdx(rar) >= rarityIdx("gold")) r.el.classList.add("jackpot");
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
  const epics = o.drops.filter(d => rarityIdx(person(d.person).rarity) >= rarityIdx("gold"))
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
  announceFirsts(o.drops);
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
    const big = rarityIdx(p.rarity) >= rarityIdx("gold");
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
    const topBase = baseVariant(top.variant);
    const colors = {
      diamond: ["#e8fbff", "#9ff6ff", "#c9b8ff", "#ffffff"], emerald: ["#00c853", "#6dffb0", "#c6ffe0", "#ffffff"],
      ruby: ["#ff1744", "#ff8a9c", "#ffd0d8", "#ffffff"], amethyst: ["#9b3dff", "#c99bff", "#ecdcff", "#ffffff"], clear: ["#ffffff", "#e0f7ff", "#bfefff"],
      negative: ["#000000", "#ffffff", "#7a7a7a", "#00e5ff"], gold: ["#ffc531", "#fff3b0", "#fff"], holo: ["#9ff6ff", "#ff9ff3", "#fff"],
      silver: ["#e6ebf2", "#b8c2d0", "#ffffff"], reverse: ["#c9d6ff", "#ffffff", "#9ff6ff"], bw: ["#ffffff", "#111111", "#888888"],
      rzulty: ["#ffe600", "#fff6a0", "#ffffff"], flag: ["#ffffff", "#dc143c", "#ffcf3f"], halloween: ["#ff7a00", "#1a0a12", "#8a2be2", "#ffd84a"],
      lantern: ["#ffb347", "#ff7a00", "#fff1c1", "#3a1a06"], devil: ["#ff1a1a", "#b3001b", "#ffcf5a", "#120002"],
      sketch: ["#1b1712", "#f4ecd8", "#6b5d4a"], galaxy: ["#7b4dff", "#1fb6ff", "#ff4fd8", "#ffffff"],
    }[topBase] || GOLDS;
    const rare = varRank(top.variant) >= varRank("gold");
    setTimeout(() => confetti(colors, topBase === "negative" ? 360 : varRank(top.variant) > varRank("gold") ? 260 : rare ? 140 : 60), 300);
    if (rare) toast(`✨ ${variantName(top.variant).toUpperCase()}: ${person(top.person).name}!`);
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
  const rare = o.drops.filter(d => ids.includes(d.id) && rarityIdx(person(d.person).rarity) >= rarityIdx("gold"));
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
  if (sx > 0.5) { ctx.fillStyle = "#8a5d00"; ctx.font = `bold ${r * 0.8}px Rubik, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("gr", 0, 1); }
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

// karty, które gracz kiedyś miał, a teraz nie ma: { personId: { best: najlepszy wariant, count: 0 } }
function collectedOwned(pairs) {
  const out = {};
  for (const [pid, v] of pairs) {
    if (!S.cfg.people[pid]) continue;
    const o = (out[pid] ||= { best: v, count: 0 });
    if (varRank(v) > varRank(o.best)) o.best = v;
  }
  return out;
}

// owned: { personId: { best: wariant, count: liczba } } - count 0 = karta była, ale już jej nie ma (sprzedana / oddana)
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
      return `<div class="pocket owned${o.count ? "" : " gone"}${p.rarity === "secret" ? " secret-pocket" : ""}" data-pid="${id}" data-variant="${o.best}"${o.count ? "" : ' title="Ta karta jest w kolekcji, ale nie masz już żadnego egzemplarza"'}>${cardHTML(id, o.best)}${o.count > 1 ? `<span class="count">×${o.count}</span>` : o.count ? "" : '<span class="count">×0</span>'}</div>`;
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
  noteCollected(S.items);
  const owned = collectedOwned([...S.collected].map(k => k.split("|")));
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
  const special = isSpecialCard(p);
  const rows = S.cfg.variantOrder.slice().reverse().filter(v => o.byVar[v]).map(v => {
    const favs = new Set(S.items.filter(i => i.fav).map(i => i.id));
    // ulubionych nie sprzedajemy, karty specjalnej w ogóle (można ją wymienić albo wystawić na rynku)
    const all = o.byVar[v], list = special ? [] : all.filter(id => !favs.has(id)), val = cardValue(pid, v);
    const nFav = all.length - list.length;
    return `<div class="copy-row">
      <span class="lbl"><span class="vdot ${vtClass(v)}"></span>${variantName(v)} ×${all.length}${nFav ? ` <span class="fav-note">★${nFav}</span>` : ""} <small>· ${fmt(val)}/szt.</small></span>
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
      ${special ? `<div class="special-note">🃏 Karta specjalna — nie da się jej sprzedać grze, postawić w kasynie ani zużyć w kuźni. Możesz ją wymienić albo wystawić na 🏪 Rynku.</div>` : ""}
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
  // zostawiamy jedną kartę - w najlepszym wariancie (najlepiej ulubioną) - i wszystkie ulubione; karty specjalne zostają
  if (isSpecialCard(S.items.find(i => i.id === o.ids[0])?.person)) return [];
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
           (!f.rarities.size || f.rarities.has(p.rarity)) && cardMatches(i, f.q) &&
           (f.variant === "all" || (f.variant === "fav" ? i.fav : f.variant === "special" ? isSpecial(i.variant) : i.variant === f.variant));
  });
  const byName = (a, b) => person(a.person).name.localeCompare(person(b.person).name, "pl");
  const by = {
    new: (a, b) => b.id - a.id,
    value: (a, b) => b.value - a.value || b.id - a.id,
    rarity: (a, b) => rarityIdx(person(b.person).rarity) - rarityIdx(person(a.person).rarity) || varRank(b.variant) - varRank(a.variant) || byName(a, b),
    name: (a, b) => byName(a, b) || varRank(b.variant) - varRank(a.variant),
  }[f.sort];
  if (f.sort === "dupes") return sortCards(list, "dupes");
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
    <div class="chest-sub">${money ? `${k(money.min)}–${k(money.max)} gr` : `${c.people.length} kart`}</div>
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
  const hof = S.inv.mode === "hof";
  $$("#invMode [data-mode]").forEach(b => b.classList.toggle("active", b.dataset.mode === S.inv.mode));
  $("#invCards").hidden = hof;
  $("#hofBody").hidden = !hof;
  if (hof) return renderHallOfFame();
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
  const sel = S.items.filter(i => S.inv.selected.has(i.id) && !i.fav && !isSpecialCard(i.person));
  $("#selInfo").textContent = `Zaznaczono ${sel.length}` + (sel.length ? ` (${fmt(sel.reduce((a, i) => a + i.value, 0))})` : "");
  $("#sellSel").disabled = !sel.length;
  $("#selNone").disabled = !sel.length;
  $("#sellbar").hidden = currentView() !== "inventory" || S.inv.mode === "hof" || !S.items.length;
}

async function sellSelected() {
  const sel = S.items.filter(i => S.inv.selected.has(i.id) && !i.fav && !isSpecialCard(i.person));
  if (!sel.length) { toast("⭐ Zaznaczone karty są ulubione albo specjalne — nie da się ich sprzedać"); return; }
  const value = sel.reduce((a, i) => a + i.value, 0);
  const rare = sel.filter(i => rarityIdx(person(i.person).rarity) >= rarityIdx("gold"));
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

// ================================================================ KARTY SPECJALNE: LINKI I MAKIETY

// Link od admina do karty specjalnej (/link/<token>): odbieramy kartę (każdy gracz raz na link) i pokazujemy ją
async function claimLink(token) {
  history.replaceState(null, "", "/inventory");
  S.inv.mode = "cards";
  switchView("inventory", "none");
  let res;
  try { res = await api(`/api/links/${encodeURIComponent(token)}/claim`, {}); }
  catch (e) { Sound.error(); toast(e.message, true); return; }
  S.items = [res.item, ...S.items];
  noteCollected([res.item]);
  applyState(res.state);
  if (currentView() === "inventory") renderInventory();
  await epicReveal(res.item);
  announceFirsts([res.item]);
  toast(`🎁 ${person(res.item.person).name} — karta specjalna jest już w twoim ekwipunku!`);
}

// Makiety (/mockups, tylko admini): każdy wygląd każdego wariantu kart specjalnych na przykładowej karcie
// (Donald Tusk - pl_tusk) i wszystkie karty specjalne z gry.
// Admin wybiera wariant i wygląd karty specjalnej w panelu (edycja karty); przycisk "Podgląd" w panelu otwiera
// /mockups?card=<id>&variant=<wariant>&style=<wygląd> - podgląd karty jak w skrzynce, także z niezapisanym wyglądem.
function renderMockups() {
  const base = person("pl_tusk") || Object.values(S.cfg.people).find(p => !p.masked && p.rarity !== "secret");
  const crate = crateList().find(c => c.special) || crateOf(base.crate);
  const real = Object.values(S.cfg.people).filter(p => isSpecialCard(p) && !p.id.startsWith("__"))
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const realHTML = `<section class="panel mock-sec mock-real"><h3>🎴 Karty specjalne w grze <small class="muted">— ${real.length
    ? "kliknij kartę, żeby zobaczyć ją tak jak w skrzynce" : "brak, dodaj je w panelu admina (rzadkość „Specjalna”)"}</small></h3>
    <div class="mock-grid">${real.map(p => `<figure class="mock"><div class="mock-card" data-real="${esc(p.id)}">${cardHTML(p.id, p.fixedVariant)}</div>
      <figcaption><b>${esc(p.name)}</b><span class="muted small">${esc(variantName(p.fixedVariant))}${
        (S.cfg.variants[p.fixedVariant]?.styles || []).length > 1 ? ` · wygląd ${p.style || 1}. ${esc(S.cfg.variants[p.fixedVariant].styles[(p.style || 1) - 1] || "")}` : ""
      } · ${esc(S.cfg.specialSources[p.source] || "")}</span></figcaption></figure>`).join("")}</div></section>`;
  const sections = S.cfg.specialVariants.map(v => {
    const V = S.cfg.variants[v];
    const cards = (V.styles || ["—"]).map((name, i) => {
      const id = `__mock_${v}_${i + 1}`;   // przykładowa karta tylko na czas budowania HTML
      S.cfg.people[id] = Object.assign({}, base, {
        id, rarity: "special", crate: crate.id, crates: [crate.id], number: i + 1, style: i + 1, fixedVariant: v,
        source: v === "jeans" ? "link" : "casino", imgAs: base.id,
        attack2: base.attack2 || "Specjalny atak", dmg2: base.dmg2 || Math.round(base.dmg * 1.4) });
      const html = `<figure class="mock"><div class="mock-card">${cardHTML(id, v)}</div>
        <figcaption><b>${i + 1}. ${esc(name)}</b><span class="muted small">wygląd ${i + 1} · ${esc(V.name)}</span></figcaption></figure>`;
      delete S.cfg.people[id];
      return html;
    }).join("");
    return `<section class="panel mock-sec"><h3>${v === "joker" ? "🃏" : "👖"} ${esc(V.name)} <small class="muted">— ${esc(V.desc || "")}</small></h3>
      <div class="mock-grid">${cards}</div></section>`;
  }).join("");
  $("#mockupsBody").innerHTML = `<div class="mock-head">
      <h2>🎴 Makiety kart specjalnych</h2>
      <p class="muted">Rzadkość <b style="color:${S.cfg.rarities.special.color}">${esc(S.cfg.rarities.special.name)}</b> — między Legendarną a ULTRA.
        Na przykładzie: ${esc(base.name)}. Wariant i wygląd każdej karty specjalnej wybierasz w <a href="/admin">panelu admina</a>
        (rzadkość „Specjalna” w edycji karty).</p></div>${realHTML}${sections}`;
  $("#mockupsBody").onclick = e => {
    const card = e.target.closest("[data-real]");
    if (card) { Sound.click(); openViewer(card.dataset.real, person(card.dataset.real).fixedVariant); }
  };
  // podgląd z panelu admina: /mockups?card=<id>&variant=...&style=... (wariant i wygląd mogą być jeszcze niezapisane)
  const q = new URLSearchParams(location.search), pid = q.get("card");
  if (pid && person(pid)) {
    history.replaceState(null, "", location.pathname);
    const p = person(pid), saved = { fixedVariant: p.fixedVariant, style: p.style };
    if (S.cfg.variants[q.get("variant")]?.special) p.fixedVariant = q.get("variant");
    if (+q.get("style") > 0) p.style = +q.get("style");
    try { openViewer(pid, p.fixedVariant); } finally { Object.assign(p, saved); }
  }
}

// ================================================================ ZDARZENIA

function bind() {
  $$(".tab").forEach(t => t.addEventListener("click", e => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;  // otwieranie w nowej karcie przeglądarki
    e.preventDefault(); Sound.click();
    if (t.dataset.view === "inventory") S.inv.mode = "cards";  // zakładka = moje karty (Hall of Fame ma własny przycisk)
    switchView(t.dataset.view);
  }));
  window.addEventListener("popstate", () => showRoute("none"));

  $("#cntMinus").addEventListener("click", () => { Sound.click(); setCount(S.count - 1); });
  $("#cntPlus").addEventListener("click", () => { Sound.click(); setCount(S.count + 1); });
  const car = $("#shopCarousel");
  let swipeX = null, swiped = false;
  car.addEventListener("click", e => {
    if (swiped) { swiped = false; return; }   // to był ruch w bok, nie kliknięcie w kafelek
    const arrow = e.target.closest("[data-car]");
    if (arrow) return shopRotate(+arrow.dataset.car);
    const c = e.target.closest(".shop-tile, .car-dot"); if (!c) return;
    shopTouched();
    if (S.crate !== c.dataset.crate) { S.crate = c.dataset.crate; Sound.click(); renderCrates(); }
    else if (c.matches(".shop-tile")) $("#buyPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  // przesunięcie palcem / myszą w bok = następna / poprzednia skrzynka
  car.addEventListener("pointerdown", e => { swipeX = e.clientX; swiped = false; shopTouched(); });
  car.addEventListener("pointerup", e => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX; swipeX = null;
    if (Math.abs(dx) > 45) { swiped = true; shopRotate(dx < 0 ? 1 : -1); }
  });
  car.addEventListener("pointerenter", () => { S.shopHover = true; });
  car.addEventListener("pointerleave", () => { S.shopHover = false; swipeX = null; });
  $("#buyPanel").addEventListener("pointerdown", shopTouched);   // gracz coś ustawia przy zakupie - karuzela stoi
  setInterval(shopAutoRotate, SHOP_ROTATE_MS);
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
    const p = e.target.closest(".pocket.owned"); if (!p) return;
    Sound.click();
    if (p.classList.contains("gone")) openViewer(p.dataset.pid, p.dataset.variant);  // nie ma już egzemplarza - tylko podgląd
    else openModal(p.dataset.pid);
  });

  // modal
  $("#modal").addEventListener("click", async e => {
    if (e.target.id === "modal" || e.target.id === "modalClose") return closeModal();
    const b = e.target.closest("[data-sell]"); if (!b) return;
    const ids = b.dataset.sell.split(",").map(Number);
    const pid = $("#modal").dataset.pid;
    const r = person(pid).rarity;
    if (rarityIdx(r) >= rarityIdx("gold") && !confirm(`Na pewno sprzedać ${person(pid).name} (${S.cfg.rarities[r].name})?`)) return;
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
  // wyszukiwanie po nazwie (też po wariancie i rzadkości, bez polskich znaków - cardMatches)
  $("#invSearch").addEventListener("input", e => { S.inv.q = e.target.value; S.inv.limit = INV_PAGE; renderInventory(); });
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

  bindForge();
  bindMarket();
  bindCasino();
  bindSocial();
  bindArena();
  bindHallOfFame();

  // nagłówek
  $("#soundBtn").addEventListener("click", () => { Sound.toggle(); renderHeader(); });

  // klawiatura: Spacja/Enter = otwórz / pomiń, Esc = zamknij
  document.addEventListener("keydown", e => {
    if (e.target.matches("input[type=text], input[type=number], select, textarea")) return;
    if (epicOpen() || document.querySelector(".money-stage, .forge-anim")) return;
    if (dialogOpen()) { if (e.key === "Escape") closeDialogs(); return; }
    if (viewerOpen()) { if (e.key === "Escape" || e.key === " ") { e.preventDefault(); closeViewer(); } return; }
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
    if (currentView() === "crates" && $("#modal").hidden && !S.opening && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault(); shopRotate(e.key === "ArrowLeft" ? -1 : 1);
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
  S.collected = new Set((st.collected || []).map(([p, v]) => `${p}|${v}`));
  S.crate = S.binderCrate = cfg.crateOrder[0];
  try { S.fast = localStorage.getItem("fast") === "1"; } catch (_) {}
  // podgrzej cache miniatur, żeby bębny od razu miały obrazki
  Object.keys(cfg.people).forEach(id => { const im = new Image(); im.src = imgUrl(id, null, true); });
  bind();
  watchCovers();
  renderHeader();
  showRoute("replace");  // widok z adresu strony (/inventory, /player/nazwa...)
  setupInstall();
  updateSellbar();
  applyBadges(me);
  S.jpLobby = me.jackpotLobby;
  startPolling();
  const startDialogs = () => {
    if (me.patchNotes?.length) setTimeout(() => showPatchNotes(me.patchNotes), 500);  // nowa aktualizacja: co się zmieniło
    else if (me.jackpot) setTimeout(() => showJackpotResult(me.jackpot), 600);  // gra w jackpot skończyła się, gdy mnie nie było
    else if (me.dailyClaimable) setTimeout(openDaily, 600);
  };
  // najpierw wiadomości od adminów (zaplanowane w panelu), potem reszta
  if (me.messages?.length) setTimeout(() => { if (!showAdminMessages(me.messages, startDialogs)) startDialogs(); }, 500);
  else startDialogs();
})();
