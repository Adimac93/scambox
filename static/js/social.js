"use strict";
// Konta i funkcje społecznościowe: nagroda dzienna, znajomi, aktywność, ranking, profile, gablota.

const DAY_NAMES = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
const AVATARS = ["😎", "🤠", "🥷", "🧙", "🦸", "🧛", "🤖", "👽", "👻", "🎃", "🐸", "🐼", "🦊", "🐯", "🦁", "🐺",
                 "🐉", "🦄", "🐙", "🦈", "🦅", "🐝", "🍕", "🌶️", "🍀", "🔥", "⚡", "💎", "👑", "🎩", "🎮", "🎲",
                 "🏆", "⚽", "🏀", "🎸", "🚀", "🛸", "🌈", "💀"];
const PROF = { username: null, data: null, crate: null, spread: 0, rankBy: "value", rankScope: "all" };

// ================================================================ WSPÓLNE

function timeAgo(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "przed chwilą";
  if (s < 3600) return `${Math.floor(s / 60)} min temu`;
  if (s < 86400) return `${Math.floor(s / 3600)} godz. temu`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "wczoraj" : `${d} dni temu`;
}

function openDialog(html, cls = "") {
  closeDialogs();
  const el = document.createElement("div");
  el.className = "sdialog";
  el.innerHTML = `<div class="sdialog-box ${cls}">${html}</div>`;
  el.addEventListener("click", e => { if (e.target === el || e.target.closest("[data-close]")) closeDialogs(); });
  document.body.appendChild(el);
  return el;
}
function closeDialogs() { $$(".sdialog").forEach(d => d.remove()); }
function dialogOpen() { return !!document.querySelector(".sdialog"); }

function userLink(u) {
  return `<button class="ulink" data-user="${esc(u.username)}"><span class="av">${esc(u.avatar)}</span>${esc(u.username)}</button>`;
}

// ================================================================ ZNACZKI / ODŚWIEŻANIE

function applyBadges(me) {
  S.dailyClaimable = me.dailyClaimable;
  $("#dailyBtn").classList.toggle("ready", me.dailyClaimable);
  const n = me.incoming + me.unread;
  const b = $("#friendsBadge");
  b.textContent = n;
  b.hidden = !n;
  if (me.user) S.me = me.user;
}

function startPolling() {
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const me = await api("/api/me");
      const hadNew = me.unread > 0 || me.incoming > 0;
      applyBadges(me);
      if (hadNew && currentView() === "friends" && !S.opening) renderFriends();
    } catch (_) { /* serwer chwilowo niedostępny */ }
  }, 30000);
}

// ================================================================ CODZIENNA SKRZYNKA

async function openDaily() {
  if (S.opening || dialogOpen() || epicOpen()) return;
  let d;
  try { d = await api("/api/daily"); } catch (e) { return toast(e.message, true); }
  renderDaily(d, openDialog("", "daily-box"));
}

function kRange(m) { return `${(m.min / 1000).toLocaleString("pl-PL")}k–${(m.max / 1000).toLocaleString("pl-PL")}k $`; }

function moneyChestArt(kind, extra = "") {
  const m = S.cfg.moneyChests[kind];
  return `<div class="crate-art chest-art ${extra}" style="--crate-bg: linear-gradient(180deg, ${m.color1} 0 50%, ${m.color2} 50%); --crate-lid: linear-gradient(180deg, ${m.color1}, ${m.color2})">
    <div class="crate-box"><div class="crate-emblem">${m.emoji}</div></div><div class="crate-lid"></div><div class="crate-lock"></div></div>`;
}

function renderDaily(d, dlg, justClaimed = null) {
  const box = dlg.querySelector(".sdialog-box");
  const D = S.cfg.moneyChests.daily, M = S.cfg.moneyChests.mega;
  const todayKind = d.todayKind;
  const owned = S.chests["money_" + todayKind] || 0;
  box.innerHTML = `
    <div class="daily-head">🎁 <span>Codzienna skrzynka</span></div>
    <p class="muted">Każdego dnia odbierz <b>${D.emoji} ${D.name}</b> z kasą: <b class="gold-txt">${kRange(D)}</b>.
      W każdą <b class="gold-txt">niedzielę</b> — <b class="gold-txt">${M.emoji} ${M.name}</b>: <b class="gold-txt">${kRange(M)}</b>!</p>
    <div class="daily-week">${d.week.map(w => {
      const m = S.cfg.moneyChests[w.kind];
      return `<div class="dday${w.kind === "mega" ? " jackpot" : ""}${w.claimed ? " claimed" : ""}${w.today ? " today" : ""}${w.past && !w.claimed ? " missed" : ""}">
        <div class="dname">${w.kind === "mega" ? "⭐ " : ""}${DAY_NAMES[w.weekday]}</div>
        <div class="dicon">${w.claimed ? "✔" : w.past ? "—" : m.emoji}</div>
        <div class="damount">${w.kind === "mega" ? "MEGA<br>" : ""}${kRange(m)}</div>
      </div>`;
    }).join("")}</div>
    ${justClaimed ? `
      <div class="claimed-panel">
        ${moneyChestArt(justClaimed, "bounce")}
        <div><b>${S.cfg.moneyChests[justClaimed].name}</b> trafiła do ekwipunku!<br><span class="muted small">Możesz ją otworzyć teraz albo później w zakładce 🎒 Ekwipunek.</span></div>
      </div>` : `
      <div class="daily-info">${d.claimable
        ? (todayKind === "mega" ? "💎 <b class='gold-txt'>Dziś MEGA skrzynka!</b>" : `Do MEGA skrzynki: <b>${d.daysToJackpot} ${plural(d.daysToJackpot, "dzień", "dni", "dni")}</b>`)
        : `Dzisiejsza skrzynka odebrana ✔ · ${d.daysToJackpot === 0 ? "kolejna MEGA za tydzień" : `MEGA za <b>${d.daysToJackpot} ${plural(d.daysToJackpot, "dzień", "dni", "dni")}</b>`}`}</div>`}
    <div class="daily-actions">
      ${d.claimable ? `<button class="big-btn${todayKind === "mega" ? " jackpot-btn" : ""}" id="claimBtn">ODBIERZ ${todayKind === "mega" ? "MEGA SKRZYNKĘ 💎" : "SKRZYNKĘ 🎁"}</button>` : ""}
      ${!d.claimable && owned ? `<button class="big-btn${todayKind === "mega" ? " jackpot-btn" : ""}" id="openNowBtn" data-kind="${todayKind}">OTWÓRZ TERAZ${owned > 1 ? ` (${owned})` : ""}</button>` : ""}
      ${!d.claimable && !owned && (S.chests.money_daily || S.chests.money_mega) ? `<button class="btn primary" id="openNowBtn" data-kind="${S.chests.money_mega ? "mega" : "daily"}">Otwórz skrzynkę z ekwipunku</button>` : ""}
      <button class="btn" data-close>${justClaimed ? "Później" : "Zamknij"}</button>
    </div>`;
  box.querySelector("#claimBtn")?.addEventListener("click", e => claimDaily(dlg, e.target));
  box.querySelector("#openNowBtn")?.addEventListener("click", e => { closeDialogs(); openMoneyChest(e.target.dataset.kind); });
}

async function claimDaily(dlg, btn) {
  btn.disabled = true;
  Sound.unlock();
  let res;
  try { res = await api("/api/daily/claim", {}); } catch (e) { toast(e.message, true); btn.disabled = false; return; }
  S.chests = res.chests;
  applyBadges({ dailyClaimable: false, incoming: 0, unread: 0 });
  refreshBadgesSoon();
  const tile = dlg.querySelector(".dday.today");
  tile?.classList.add("flip");
  if (res.kind === "mega") { Sound.gold(); setTimeout(() => confetti(GOLDS, 120), 200); }
  else Sound.win();
  setTimeout(() => { if (document.body.contains(dlg)) renderDaily(res.daily, dlg, res.kind); }, 650);
  if (currentView() === "inventory") renderInventory();
}

// ================================================================ OTWIERANIE SKRZYNKI Z PIENIĘDZMI

const MONEY_TIERS = [[0.15, "#4fc34f"], [0.35, "#4b8bff"], [0.6, "#a35bff"], [0.85, "#ff4040"], [1.01, "#ffc531"]];
function moneyTier(kind, v) {
  const m = S.cfg.moneyChests[kind];
  const f = (v - m.min) / (m.max - m.min);
  return MONEY_TIERS.find(([lim]) => f < lim)[1];
}
function cosmeticMoney(kind) {
  const m = S.cfg.moneyChests[kind];
  return Math.round((m.min + (m.max - m.min) * Math.random() ** m.curve) / 100) * 100;
}
function moneyTileHTML(kind, v, win = false) {
  const short = v >= 10000 ? `${Math.round(v / 1000)}k` : `${(v / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}k`;
  return `<div class="mini money-tile${win ? " win" : ""}" style="--rc:${moneyTier(kind, v)}">
    <div class="mt-val">💵<b>${short}</b></div><div class="mn">${fmt(v)}</div></div>`;
}

async function openMoneyChest(kind) {
  if (S.opening || epicOpen() || document.querySelector(".money-stage")) return;
  const M = S.cfg.moneyChests[kind];
  Sound.unlock();
  let res;
  try { res = await api("/api/chests/money", { kind }); } catch (e) { Sound.error(); return toast(e.message, true); }
  S.chests = res.chests;
  const fast = S.fast;
  const el = document.createElement("div");
  el.className = `money-stage mk-${kind}`;
  el.style.setProperty("--m1", M.color1);
  el.innerHTML = `
    <div class="ms-bg"></div>
    <canvas class="ms-canvas"></canvas>
    <div class="ms-title">${M.emoji} ${esc(M.name)}</div>
    <div class="ms-chest-wrap">${moneyChestArt(kind, "ms-chest")}</div>
    <div class="fa-reel reel ms-reel" hidden><div class="strip"></div><div class="reel-marker"></div></div>
    <div class="ms-result" hidden></div>
    <div class="flash fa-flash"></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = "hidden";
  const P = makeParticles(el.querySelector(".ms-canvas"));
  const chest = el.querySelector(".ms-chest");
  const cx = () => innerWidth / 2, cy = () => innerHeight / 2;

  // 1. skrzynka trzęsie się i otwiera
  chest.classList.add("shaking");
  Sound.charge(fast ? 0.5 : 1.1, kind === "mega");
  await sleep(fast ? 500 : 1100);
  chest.classList.remove("shaking");
  chest.classList.add("popping");
  Sound.open();
  P.burst(cx(), cy(), kind === "mega" ? 160 : 90, [M.color1, "#ffe58a", "#fff"], { speed: 13 });
  await sleep(fast ? 250 : 450);
  el.querySelector(".ms-chest-wrap").remove();

  // 2. bęben z kwotami
  const reel = el.querySelector(".ms-reel");
  reel.hidden = false;
  const strip = reel.querySelector(".strip");
  const MW = Math.min(130, innerWidth / 6), GAP = 8, N = 46, WIN = 38;
  reel.style.setProperty("--mw", MW + "px");
  reel.style.setProperty("--gap", GAP + "px");
  reel.style.setProperty("--rh", Math.round(MW * 1.05 + 45) + "px");
  const vals = Array.from({ length: N }, () => cosmeticMoney(kind));
  vals[WIN] = res.amount;
  if (Math.random() < 0.35) vals[WIN + (Math.random() < 0.5 ? -1 : 1)] = Math.round((M.max - Math.random() * (M.max - M.min) * 0.1) / 100) * 100;
  strip.innerHTML = vals.map((v, i) => moneyTileHTML(kind, v, i === WIN)).join("");
  await sleep(50);
  const step = MW + GAP, center = reel.clientWidth / 2;
  const to = -(WIN * step + MW / 2 + rand(-0.4, 0.4) * MW) + center;
  const D = fast ? 1000 : 4300;
  const t0 = performance.now();
  let lastIdx = -1;
  await new Promise(done => {
    const frame = now => {
      const t = Math.min(1, (now - t0) / D);
      const x = to * (1 - Math.pow(1 - t, 4.2));
      strip.style.transform = `translate3d(${x}px, -50%, 0)`;
      const idx = Math.floor((center - x) / step);
      if (idx !== lastIdx) { if (lastIdx >= 0) Sound.tick(1 - t); lastIdx = idx; }
      if (t < 1) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });
  const color = moneyTier(kind, res.amount);
  reel.classList.add("landed");
  reel.style.setProperty("--rc", color);
  await sleep(fast ? 250 : 600);

  // 3. wynik - licznik kwoty, deszcz monet, im więcej tym większe efekty
  const f = (res.amount - M.min) / (M.max - M.min);
  reel.hidden = true;
  const box = el.querySelector(".ms-result");
  box.hidden = false;
  const more = S.chests["money_" + kind] || 0;
  box.innerHTML = `
    <div class="ms-label">${f >= 0.85 ? "🤑 MEGA WYGRANA!" : f >= 0.6 ? "💰 Świetnie!" : f >= 0.35 ? "Nieźle!" : "Wygrywasz"}</div>
    <div class="ms-amount" style="--rc:${color}">+<span id="msCount">0</span> $</div>
    <div class="fa-result-btns">
      ${more ? `<button class="btn primary" data-act="again">🔁 Otwórz kolejną (${more})</button>` : ""}
      <button class="btn sell" data-act="ok">✔ Odbierz</button>
    </div>`;
  applyState(res.state);
  Sound.cash();
  coinRain(Math.min(180, 30 + Math.round(f * 150)));
  if (f >= 0.6 || kind === "mega") {
    const fl = el.querySelector(".fa-flash");
    fl.style.background = `radial-gradient(circle, #fff, ${color}88 40%, transparent 75%)`;
    fl.classList.add("go");
    P.burst(cx(), cy(), 200 + Math.round(f * 250), [color, "#ffe58a", "#fff", M.color1], { speed: 18, stars: 0.35 });
    f >= 0.85 ? (Sound.boom(false), Sound.gold()) : Sound.win();
    if (f >= 0.85) { el.classList.add("shake"); setTimeout(() => confetti(GOLDS, 200), 300); }
  }
  const counter = box.querySelector("#msCount"), c0 = performance.now(), CD = fast ? 500 : 1300;
  const count = now => {
    const t = Math.min(1, (now - c0) / CD);
    counter.textContent = Math.round(res.amount * (1 - Math.pow(1 - t, 3))).toLocaleString("pl-PL");
    if (t < 1 && document.body.contains(counter)) requestAnimationFrame(count);
  };
  requestAnimationFrame(count);

  box.addEventListener("click", e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    P.stop(); el.remove(); document.body.style.overflow = "";
    if (act === "again") openMoneyChest(kind);
    else if (currentView() === "inventory") renderInventory();
    else if (currentView() === "crates") renderCrates();
  });
}

async function refreshBadgesSoon() {
  try { applyBadges(await api("/api/me")); } catch (_) {}
}

// ================================================================ ZNAJOMI + AKTYWNOŚĆ

function feedText(f) {
  if (f.kind === "show") {
    if (f.mine) return f.to ? `pokazujesz kartę: <b>${esc(f.to)}</b>` : "pokazujesz kartę znajomym";
    return f.to ? "pokazuje ci kartę" : "chwali się kartą";
  }
  const verb = { drop: "trafia ze skrzynki", contract: "wytwarza w kontrakcie", upgrade: "wygrywa w ulepszaczu" }[f.kind] || "zdobywa";
  return `${verb}!`;
}

async function renderFriends() {
  let fr, fd;
  try { [fr, fd] = await Promise.all([api("/api/friends"), api("/api/feed")]); } catch (e) { return toast(e.message, true); }
  const person_ = (u, actions) => `
    <div class="friend">
      ${userLink(u)}
      <span class="fstats">${fmt(u.value)} · ${u.unique} kart</span>
      <span class="factions">${actions}</span>
    </div>`;
  $("#friendsBody").innerHTML = `
    <div class="social-cols">
      <div class="panel friends-panel">
        <h3>👥 Znajomi</h3>
        <form class="add-friend" id="addFriend" autocomplete="off">
          <input type="text" id="friendName" placeholder="Nazwa gracza…" list="userSuggest" maxlength="20">
          <datalist id="userSuggest"></datalist>
          <button class="btn primary" type="submit">➕ Zaproś</button>
        </form>
        ${fr.incoming.length ? `<div class="fsection"><h4>📨 Zaproszenia (${fr.incoming.length})</h4>${fr.incoming.map(u => person_(u,
          `<button class="btn sell tiny" data-accept="${esc(u.username)}">✔ Przyjmij</button><button class="btn tiny" data-decline="${esc(u.username)}">✖</button>`)).join("")}</div>` : ""}
        <div class="fsection"><h4>Twoi znajomi (${fr.friends.length})</h4>
          ${fr.friends.length ? fr.friends.map(u => person_(u,
            `<button class="btn tiny" data-user="${esc(u.username)}">📖 Klaser</button><button class="btn tiny" data-remove="${esc(u.username)}" title="Usuń ze znajomych">🗑</button>`)).join("")
            : '<div class="muted small">Nie masz jeszcze znajomych. Zaproś kogoś po nazwie albo z rankingu!</div>'}
        </div>
        ${fr.outgoing.length ? `<div class="fsection"><h4>⏳ Wysłane</h4>${fr.outgoing.map(u => person_(u,
          `<button class="btn tiny" data-remove="${esc(u.username)}">Anuluj</button>`)).join("")}</div>` : ""}
      </div>
      <div class="panel feed-panel">
        <h3>📣 Aktywność</h3>
        <p class="muted small">Karty, które pokazują ci znajomi, i ich legendarne dropy. Swoją kartę pokażesz przyciskiem <b>📣</b> w podglądzie karty.</p>
        <div class="feed">${fd.feed.length ? fd.feed.map(f => `
          <div class="feed-item${!f.mine && f.id > fd.seen ? " unread" : ""}${f.kind !== "show" ? " fi-auto" : ""}">
            <div class="fi-head">${f.mine ? '<span class="ulink me"><span class="av">' + esc(S.me.avatar) + "</span>Ty</span>" : userLink(f.author)}
              <span class="muted">${feedText(f)}</span><span class="fi-time">${timeAgo(f.created)}</span></div>
            <div class="fi-body">
              <div class="fi-card">${cardHTML(f.person, f.variant)}</div>
              <div class="fi-side">
                ${f.message ? `<div class="fi-msg">„${esc(f.message)}”</div>` : ""}
                <div class="fi-name">${esc(person(f.person).name)}</div>
                <div class="fi-meta"><span style="color:${S.cfg.rarities[person(f.person).rarity].color}">${S.cfg.rarities[person(f.person).rarity].name}</span>${isSpecial(f.variant) ? ` · <span class="holo-txt">${variantName(f.variant)}</span>` : ""}</div>
                <div class="fi-val">${fmt(f.value)}</div>
              </div>
            </div>
          </div>`).join("") : '<div class="empty">Na razie cisza. Gdy znajomi coś pokażą albo trafią legendę — zobaczysz to tutaj.</div>'}
        </div>
      </div>
    </div>`;
  if (fd.feed.some(f => !f.mine && f.id > fd.seen)) {
    api("/api/feed/seen", {}).then(refreshBadgesSoon).catch(() => {});
  }
}

async function friendAction(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); Sound.click(); } catch (e) { Sound.error(); toast(e.message, true); }
  refreshBadgesSoon();
  if (currentView() === "friends") renderFriends();
  if (currentView() === "profile") renderProfile();
}

// ================================================================ POKAZYWANIE KART

function myItemFor(pid, variant) {
  return S.items.find(i => i.person === pid && i.variant === variant);
}

async function openShowDialog(pid, variant) {
  const item = myItemFor(pid, variant);
  if (!item) return toast("Nie masz tej karty", true);
  let fr;
  try { fr = await api("/api/friends"); } catch (e) { return toast(e.message, true); }
  if (!fr.friends.length) return toast("Najpierw dodaj znajomych w zakładce 👥 Znajomi", true);
  const dlg = openDialog(`
    <h3>📣 Pokaż kartę znajomym</h3>
    <div class="show-row">
      <div class="show-card">${cardHTML(pid, variant)}</div>
      <form class="show-form" id="showForm">
        <label>Komu?
          <select name="to"><option value="all">👥 Wszystkim znajomym</option>
            ${fr.friends.map(u => `<option value="${esc(u.username)}">${esc(u.avatar)} ${esc(u.username)}</option>`).join("")}</select>
        </label>
        <label>Wiadomość (opcjonalnie)<input type="text" name="message" maxlength="140" placeholder="np. Patrz co trafiłem! 😎"></label>
        <div class="daily-actions"><button class="btn primary" type="submit">📣 Pokaż</button><button class="btn" type="button" data-close>Anuluj</button></div>
      </form>
    </div>`, "show-box");
  dlg.querySelector("#showForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api("/api/show", { item_id: item.id, to: f.to, message: f.message });
      closeDialogs();
      Sound.win();
      toast(f.to === "all" ? "Pokazano kartę znajomym 📣" : `Pokazano kartę: ${f.to} 📣`);
    } catch (err) { toast(err.message, true); }
  });
}

// ================================================================ GABLOTA

function showcaseHas(pid, variant) {
  return S.showcase.some(id => { const it = S.items.find(i => i.id === id); return it && it.person === pid && it.variant === variant; });
}

async function toggleShowcase(pid, variant) {
  let ids = S.showcase.filter(id => S.items.some(i => i.id === id));
  const inside = ids.find(id => { const it = S.items.find(i => i.id === id); return it.person === pid && it.variant === variant; });
  if (inside) ids = ids.filter(id => id !== inside);
  else {
    if (ids.length >= S.cfg.showcaseSize) return toast(`Gablota mieści ${S.cfg.showcaseSize} kart — najpierw coś z niej zdejmij`, true);
    ids.push(myItemFor(pid, variant).id);
  }
  try {
    const res = await api("/api/showcase", { ids });
    S.showcase = res.showcase;
    Sound.click();
    toast(inside ? "Zdjęto z gabloty" : "📌 Dodano do gabloty na twoim profilu");
  } catch (e) { toast(e.message, true); }
}

// ================================================================ RANKING

async function renderRanking() {
  let r;
  try { r = await api("/api/ranking"); } catch (e) { return toast(e.message, true); }
  const by = PROF.rankBy;
  const key = { value: "value", cards: "unique", opened: "opened" }[by];
  const list = r.players.filter(p => PROF.rankScope === "all" || p.friend || p.me)
    .sort((a, b) => b[key] - a[key] || a.username.localeCompare(b.username, "pl"));
  const medal = i => ["🥇", "🥈", "🥉"][i] || `#${i + 1}`;
  const val = p => by === "value" ? fmt(p.value)
    : by === "cards" ? `${p.unique} / ${r.totalCards} <span class="muted">(${Math.round(p.unique / Math.max(1, r.totalCards) * 100)}%)</span>`
    : `${p.opened.toLocaleString("pl-PL")} 📦`;
  $("#rankingBody").innerHTML = `
    <div class="rank-toolbar">
      <div class="seg" id="rankBy">${[["value", "💰 Wartość kolekcji"], ["cards", "📖 Zebrane karty"], ["opened", "📦 Otwarte skrzynki"]]
        .map(([k, n]) => `<button data-by="${k}" class="${by === k ? "active" : ""}">${n}</button>`).join("")}</div>
      <div class="seg" id="rankScope">${[["all", "🌍 Wszyscy"], ["friends", "👥 Znajomi"]]
        .map(([k, n]) => `<button data-scope="${k}" class="${PROF.rankScope === k ? "active" : ""}">${n}</button>`).join("")}</div>
    </div>
    <div class="panel rank-list">${list.map((p, i) => `
      <div class="rank-row${p.me ? " me" : ""}${i < 3 ? " top" + (i + 1) : ""}">
        <span class="rpos">${medal(i)}</span>
        ${userLink(p)}
        ${p.friend ? '<span class="rfriend" title="Znajomy">👥</span>' : ""}
        ${p.isAdmin ? '<span class="rfriend" title="Admin">👑</span>' : ""}
        <span class="rval">${val(p)}</span>
        ${by === "cards" ? `<div class="rbar"><div style="width:${p.unique / Math.max(1, r.totalCards) * 100}%"></div></div>` : ""}
      </div>`).join("") || '<div class="empty">Brak graczy.</div>'}</div>`;
}

// ================================================================ PROFIL

function openProfile(username) {
  if (PROF.username !== username) { PROF.crate = null; PROF.spread = 0; }
  PROF.username = username;
  closeViewer(); closeModal(); closeDialogs();
  switchView("profile");
  window.scrollTo(0, 0);
}

async function renderProfile() {
  let d;
  try { d = await api(`/api/users/${encodeURIComponent(PROF.username || S.me.username)}`); } catch (e) { return toast(e.message, true); }
  PROF.data = d;
  const u = d.user, mine = d.relation === "me";
  if (!PROF.crate || !crateOf(PROF.crate)) PROF.crate = S.cfg.crateOrder[0];
  const rel = {
    me: `<button class="btn" data-act="avatar">🎭 Zmień awatar</button><button class="btn" data-act="password">🔑 Zmień hasło</button><button class="btn danger" data-act="logout">🚪 Wyloguj</button>`,
    none: `<button class="btn primary" data-act="invite">➕ Zaproś do znajomych</button>`,
    outgoing: `<button class="btn" disabled>⏳ Zaproszenie wysłane</button><button class="btn tiny" data-act="cancel">Anuluj</button>`,
    incoming: `<button class="btn sell" data-act="accept">✔ Przyjmij zaproszenie</button>`,
    friend: `<span class="friend-tag">👥 Znajomi</span><button class="btn tiny" data-act="cancel">Usuń ze znajomych</button>`,
  }[d.relation];
  const slots = Array.from({ length: S.cfg.showcaseSize }, (_, i) => d.showcase[i]);
  $("#profileBody").innerHTML = `
    <div class="panel profile-head">
      <div class="pf-avatar${mine ? " editable" : ""}" ${mine ? 'data-act="avatar" title="Zmień awatar"' : ""}>${esc(u.avatar)}</div>
      <div class="pf-info">
        <h2>${esc(u.username)} ${u.isAdmin ? '<span title="Admin">👑</span>' : ""}</h2>
        <div class="muted small">gracz od ${new Date(u.created * 1000).toLocaleDateString("pl-PL")}</div>
        <div class="pf-stats">
          <span><b>${fmt(u.value)}</b>wartość kolekcji</span>
          <span><b>${u.unique}/${Object.keys(S.cfg.people).length}</b>unikalne karty</span>
          <span><b>${u.total}</b>wszystkie karty</span>
          <span><b>${d.stats.opened}</b>otwarte skrzynki</span>
          <span><b>${d.stats.contracts}</b>kontrakty</span>
          <span><b>${d.stats.upgradesWon}/${d.stats.upgradesLost}</b>ulepszenia W/P</span>
        </div>
      </div>
      <div class="pf-actions">${rel}</div>
    </div>

    <div class="panel">
      <h3>🏆 Gablota</h3>
      ${mine ? '<p class="muted small">Twoje najlepsze karty na pokaz. Dodasz je przyciskiem <b>📌 Do gabloty</b> w podglądzie karty (🔍).</p>' : ""}
      <div class="showcase-grid">${slots.map(it => it
        ? `<div class="sc-slot">${cardHTML(it.person, it.variant)}</div>`
        : `<div class="sc-slot empty"><span>${mine ? "📌" : "—"}</span></div>`).join("")}</div>
    </div>

    <div class="panel">
      <div class="binder-toolbar">
        <h3 style="margin:0">📖 Klaser${mine ? "" : ` gracza ${esc(u.username)}`}</h3>
        <div class="seg" id="pfSeg">${crateList().map(c => `<button data-crate="${c.id}" class="${PROF.crate === c.id ? "active" : ""}">${esc(c.emoji)} ${esc(c.short)}</button>`).join("")}</div>
      </div>
      <div class="binder-progress" id="pfProgress"></div>
      <div class="binder-wrap">
        <button class="page-arrow" id="pfPrev">‹</button>
        <div class="binder" id="pfBinder"></div>
        <button class="page-arrow" id="pfNext">›</button>
      </div>
      <div class="page-indicator" id="pfPage"></div>
    </div>`;
  renderProfileBinder();
}

function renderProfileBinder(flip = 0) {
  const d = PROF.data;
  const owned = {};
  for (const c of d.collection) {
    const o = (owned[c.person] ||= { best: c.variant, count: 0 });
    o.count += c.count;
    if (varRank(c.variant) > varRank(o.best)) o.best = c.variant;
  }
  const b = binderHTML(crateOf(PROF.crate), owned, PROF.spread, { mine: d.relation === "me" });
  PROF.spread = b.spread;
  $("#pfProgress").innerHTML = b.progress;
  $("#pfBinder").innerHTML = b.html;
  $("#pfPrev").disabled = PROF.spread === 0;
  $("#pfNext").disabled = PROF.spread >= b.spreads - 1;
  $("#pfPage").textContent = b.label;
  if (flip) {
    Sound.page();
    const el = $("#pfBinder");
    el.classList.remove("flip-next", "flip-prev"); void el.offsetWidth;
    el.classList.add(flip > 0 ? "flip-next" : "flip-prev");
  }
}

function openAvatarPicker() {
  const dlg = openDialog(`
    <h3>🎭 Wybierz awatar</h3>
    <div class="avatar-grid">${AVATARS.map(a => `<button class="av-opt${a === S.me.avatar ? " active" : ""}" data-av="${a}">${a}</button>`).join("")}</div>
    <div class="daily-actions"><button class="btn" data-close>Zamknij</button></div>`);
  dlg.addEventListener("click", async e => {
    const b = e.target.closest("[data-av]"); if (!b) return;
    try {
      await api("/api/profile", { avatar: b.dataset.av });
      S.me.avatar = b.dataset.av;
      renderHeader(); closeDialogs(); Sound.click();
      if (currentView() === "profile") renderProfile();
    } catch (err) { toast(err.message, true); }
  });
}

function openPasswordDialog() {
  const dlg = openDialog(`
    <h3>🔑 Zmień hasło</h3>
    <form class="show-form" id="pwForm">
      <label>Obecne hasło<input type="password" name="old" required autocomplete="current-password"></label>
      <label>Nowe hasło<input type="password" name="new" required minlength="4" autocomplete="new-password"></label>
      <label>Powtórz nowe hasło<input type="password" name="new2" required minlength="4" autocomplete="new-password"></label>
      <div class="daily-actions"><button class="btn primary" type="submit">Zapisz</button><button class="btn" type="button" data-close>Anuluj</button></div>
    </form>`);
  dlg.querySelector("#pwForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.new !== f.new2) return toast("Nowe hasła nie są takie same", true);
    try { await api("/api/password", { old: f.old, new: f.new }); closeDialogs(); toast("Hasło zmienione 🔑"); }
    catch (err) { toast(err.message, true); }
  });
}

async function logout() {
  try { await api("/api/logout", {}); } catch (_) {}
  location.href = "/login";
}

// ================================================================ ZDARZENIA

function bindSocial() {
  $("#dailyBtn").addEventListener("click", openDaily);
  $("#userChip").addEventListener("click", () => openProfile(S.me.username));

  // klik w nazwę gracza gdziekolwiek -> profil
  document.addEventListener("click", e => {
    const u = e.target.closest("[data-user]");
    if (u && !e.target.closest(".sdialog")) { e.preventDefault(); openProfile(u.dataset.user); }
  });

  // znajomi
  $("#friendsBody").addEventListener("submit", e => {
    if (e.target.id !== "addFriend") return;
    e.preventDefault();
    const name = $("#friendName").value.trim();
    if (!name) return;
    friendAction(async () => {
      const r = await api("/api/friends/request", { username: name });
      if (r.status === "friend") toast(`Jesteście teraz znajomymi z ${name} 🎉`); else toast(`Wysłano zaproszenie do ${name} 📨`);
    });
  });
  let searchTimer = null;
  $("#friendsBody").addEventListener("input", e => {
    if (e.target.id !== "friendName") return;
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(async () => {
      if (!q) return;
      try {
        const r = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        const dl = $("#userSuggest");
        if (dl) dl.innerHTML = r.users.filter(u => u.username !== S.me.username).map(u => `<option value="${esc(u.username)}">`).join("");
      } catch (_) {}
    }, 250);
  });
  $("#friendsBody").addEventListener("click", e => {
    const t = e.target;
    const acc = t.closest("[data-accept]"), dec = t.closest("[data-decline]"), rem = t.closest("[data-remove]");
    if (acc) return friendAction(() => api("/api/friends/respond", { username: acc.dataset.accept, accept: true }), "Nowy znajomy! 🎉");
    if (dec) return friendAction(() => api("/api/friends/respond", { username: dec.dataset.decline, accept: false }));
    if (rem) {
      if (!confirm(`Usunąć ${rem.dataset.remove} ze znajomych / anulować zaproszenie?`)) return;
      return friendAction(() => api("/api/friends/remove", { username: rem.dataset.remove }));
    }
    const c = t.closest(".fi-card .card");
    if (c) openViewer(c.dataset.pid, c.dataset.variant);
  });

  // ranking
  $("#rankingBody").addEventListener("click", e => {
    const by = e.target.closest("[data-by]"), sc = e.target.closest("[data-scope]");
    if (by) { PROF.rankBy = by.dataset.by; Sound.click(); renderRanking(); }
    if (sc) { PROF.rankScope = sc.dataset.scope; Sound.click(); renderRanking(); }
  });

  // profil
  $("#profileBody").addEventListener("click", e => {
    const t = e.target;
    const act = t.closest("[data-act]")?.dataset.act;
    const name = PROF.data?.user.username;
    if (act === "avatar") return openAvatarPicker();
    if (act === "password") return openPasswordDialog();
    if (act === "logout") return logout();
    if (act === "invite") return friendAction(() => api("/api/friends/request", { username: name }), "Wysłano zaproszenie 📨");
    if (act === "accept") return friendAction(() => api("/api/friends/respond", { username: name, accept: true }), "Nowy znajomy! 🎉");
    if (act === "cancel") {
      if (!confirm(`Usunąć ${name} ze znajomych / anulować zaproszenie?`)) return;
      return friendAction(() => api("/api/friends/remove", { username: name }));
    }
    const seg = t.closest("#pfSeg [data-crate]");
    if (seg) { PROF.crate = seg.dataset.crate; PROF.spread = 0; Sound.click(); return renderProfileBinder(); }
    if (t.closest("#pfPrev")) { PROF.spread--; return renderProfileBinder(-1); }
    if (t.closest("#pfNext")) { PROF.spread++; return renderProfileBinder(1); }
    const c = t.closest(".pocket.owned .card, .sc-slot .card");
    if (c) openViewer(c.dataset.pid, c.dataset.variant);
  });
}
