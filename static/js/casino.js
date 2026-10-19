"use strict";
// Kasyno: ruletka (stawką są karty, wygrana też w kartach) i jackpot dla dwóch graczy (zwycięzca bierze wszystkie karty).
// Losuje zawsze serwer - przeglądarka tylko pokazuje animację z gotowym wynikiem.

const CS = {
  tab: "roulette",
  sel: new Set(),        // moje karty postawione w ruletce
  bet: "red",
  q: "",
  spinning: false,
  angle: 0,              // obrót koła ruletki (stopnie)
  history: [],           // ostatnie wylosowane liczby
  last: null,            // ostatni wynik (do pokazania pod kołem)
  jp: { data: null, sel: new Set(), invite: "", q: "", mode: "create", join: null, poll: null, waiting: null, shown: new Set() },
};
const CS_PICK_LIMIT = 240;

function csItems() { return S.items.filter(i => !i.fav); }
function csStake(set) { return S.items.filter(i => set.has(i.id)).reduce((a, i) => a + i.value, 0); }
function csPct(x) { return (x * 100).toLocaleString("pl-PL", { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + "%"; }

// siatka moich kart do wyboru (ruletka / jackpot)
function csPickerHTML(set, q, max, zone) {
  const ql = q.trim().toLowerCase();
  const list = csItems().filter(i => !ql || person(i.person).name.toLowerCase().includes(ql))
    .sort((a, b) => (set.has(b.id) - set.has(a.id)) || b.value - a.value || b.id - a.id);
  return `<div class="cs-pick-head"><input type="text" data-csq="${zone}" placeholder="Szukaj w swoich kartach…" value="${esc(q)}">
      <span class="muted small">${set.size}/${max} kart · ${fmt(csStake(set))}</span>
      ${set.size ? `<button class="btn tiny" data-csclear="${zone}">Wyczyść</button>` : ""}</div>
    <div class="pick-grid cs-grid" data-zone="${zone}">${list.slice(0, CS_PICK_LIMIT).map(i => pickHTML(i, { sel: set.has(i.id) })).join("")
      || '<div class="empty">Nie masz kart (ulubionych ⭐ nie można postawić).</div>'}</div>`;
}

function renderCasino() {
  $("#casinoSeg").innerHTML = [["roulette", "🎡 Ruletka"], ["jackpot", "💰 Jackpot (2 graczy)"]].map(([t, n]) =>
    `<button data-cstab="${t}" class="${CS.tab === t ? "active" : ""}">${n}</button>`).join("");
  const own = new Set(S.items.map(i => i.id));
  [...CS.sel].forEach(id => { if (!own.has(id)) CS.sel.delete(id); });
  [...CS.jp.sel].forEach(id => { if (!own.has(id)) CS.jp.sel.delete(id); });
  if (CS.tab === "roulette") { stopJackpotPolling(); drawRoulette(); }
  else renderJackpot();
}

// ================================================================ RULETKA

function rlColor(n) { return n === 0 ? "green" : S.cfg.roulette.red.includes(n) ? "red" : "black"; }

function wheelSVG() {
  const W = S.cfg.roulette.wheel, step = 360 / W.length, rad = a => a * Math.PI / 180;
  const pt = (r, a) => `${(150 + r * Math.sin(rad(a))).toFixed(2)} ${(150 - r * Math.cos(rad(a))).toFixed(2)}`;
  const fills = { green: "#0f9d58", red: "#c62828", black: "#16181d" };
  const segs = W.map((n, i) => {
    const a0 = (i - 0.5) * step, a1 = (i + 0.5) * step;
    return `<path d="M ${pt(96, a0)} L ${pt(142, a0)} A 142 142 0 0 1 ${pt(142, a1)} L ${pt(96, a1)} A 96 96 0 0 0 ${pt(96, a0)} Z" fill="${fills[rlColor(n)]}" stroke="#c9a24a" stroke-width=".8"/>
      <text x="150" y="${150 - 126}" transform="rotate(${i * step} 150 150)" text-anchor="middle" dominant-baseline="middle" class="rl-num">${n}</text>`;
  }).join("");
  return `<svg viewBox="0 0 300 300" class="rl-svg">
    <circle cx="150" cy="150" r="148" fill="#5a3a12" stroke="#c9a24a" stroke-width="3"/>
    ${segs}
    <circle cx="150" cy="150" r="96" fill="#2b1b08" stroke="#c9a24a" stroke-width="2"/>
    <circle cx="150" cy="150" r="70" fill="url(#rlHub)"/>
    <defs><radialGradient id="rlHub"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".55" stop-color="#b8862b"/><stop offset="1" stop-color="#4a3000"/></radialGradient></defs>
    ${[0, 45, 90, 135].map(a => `<rect x="146" y="88" width="8" height="124" rx="4" fill="#d9b25a" transform="rotate(${a} 150 150)"/>`).join("")}
    <circle cx="150" cy="150" r="14" fill="#fff1c1" stroke="#7a5200" stroke-width="2"/>
  </svg>`;
}

function rlBoardHTML() {
  const bets = S.cfg.roulette.bets, sel = CS.bet, hit = CS.last?.number;
  const cell = (key, label, cls = "", style = "") => {
    const nums = bets[key].numbers;
    return `<button class="rl-cell ${cls}${sel === key ? " sel" : ""}${hit != null && nums.length === 1 && nums[0] === hit ? " hit" : ""}" data-rbet="${key}" style="${style}"
      title="${esc(bets[key].name)} · wypłata ${bets[key].pays}:1">${label}</button>`;
  };
  let html = cell("green", "0", "c-green", "grid-row: 1 / 4; grid-column: 1");
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 3; row++) {
      const n = col * 3 + (3 - row);
      html += cell(`n${n}`, n, `c-${rlColor(n)}`, `grid-row: ${row + 1}; grid-column: ${col + 2}`);
    }
  }
  html += cell("col3", "2:1", "c-out", "grid-row: 1; grid-column: 14") + cell("col2", "2:1", "c-out", "grid-row: 2; grid-column: 14")
    + cell("col1", "2:1", "c-out", "grid-row: 3; grid-column: 14");
  html += cell("dozen1", "1–12", "c-out", "grid-row: 4; grid-column: 2 / 6") + cell("dozen2", "13–24", "c-out", "grid-row: 4; grid-column: 6 / 10")
    + cell("dozen3", "25–36", "c-out", "grid-row: 4; grid-column: 10 / 14");
  [["low", "1–18"], ["even", "Parz."], ["red", "◆"], ["black", "◆"], ["odd", "Nieparz."], ["high", "19–36"]].forEach(([k, l], i) => {
    html += cell(k, l, `c-out${k === "red" ? " c-redbet" : k === "black" ? " c-blackbet" : ""}`, `grid-row: 5; grid-column: ${2 + i * 2} / ${4 + i * 2}`);
  });
  return `<div class="rl-board">${html}</div>`;
}

function drawRoulette() {
  const bet = S.cfg.roulette.bets[CS.bet];
  const stake = csStake(CS.sel);
  const chance = bet.numbers.length / 37;
  const last = CS.last;
  $("#casinoBody").innerHTML = `
  <div class="rl-cols">
    <div class="panel rl-left">
      <div class="rl-wheel-wrap">
        <div class="rl-rot" id="rlRot" style="transform: rotate(${CS.angle}deg)">${wheelSVG()}</div>
        <div class="rl-ball-rot" id="rlBall" style="transform: rotate(0deg)"><i></i></div>
        <div class="rl-pointer"></div>
      </div>
      <div class="rl-result" id="rlResult">${last ? rlResultHTML(last) : '<span class="muted">Postaw karty, wybierz pole na stole i zakręć!</span>'}</div>
      <div class="rl-history">${CS.history.map(n => `<span class="rl-h c-${rlColor(n)}">${n}</span>`).join("") || '<span class="muted small">Tu pojawią się ostatnie wyniki</span>'}</div>
    </div>
    <div class="rl-right">
      <div class="panel">
        ${rlBoardHTML()}
        <div class="rl-bet-info">
          <span>Zakład: <b>${esc(bet.name)}</b></span>
          <span>Wypłata: <b>${bet.pays}:1</b> (karty wracają + ${fmt(stake * bet.pays)} w kartach)</span>
          <span>Szansa: <b>${csPct(chance)}</b></span>
        </div>
        <button class="big-btn rl-spin" id="rlSpin"${CS.sel.size && !CS.spinning ? "" : " disabled"}>🎡 ZAKRĘĆ${stake ? ` · stawka ${fmt(stake)}` : ""}</button>
        <div class="muted small">Wygrana: twoje karty zostają, a dostajesz karty o wartości stawki × wypłata (losowe karty ze skrzynek w sklepie; końcówka w $). Przegrana: postawione karty przepadają.</div>
      </div>
      <div class="panel cs-pick">${csPickerHTML(CS.sel, CS.q, S.cfg.roulette.maxCards, "rl")}</div>
    </div>
  </div>`;
}

function rlResultHTML(r) {
  return `<div class="rl-res ${r.win ? "win" : "lose"}">
    <span class="rl-big c-${rlColor(r.number)}">${r.number}</span>
    <div>${r.win ? `<b class="pos-txt">WYGRANA! +${fmt(r.payout)}</b><div class="muted small">${r.items.length} ${plural(r.items.length, "karta", "karty", "kart")}${r.money ? ` + ${fmt(r.money)}` : ""} · kliknij kartę, aby obejrzeć</div>`
      : `<b class="neg-txt">PRZEGRANA −${fmt(r.stake)}</b>`}</div>
  </div>
  ${r.win && r.items.length ? `<div class="pick-grid rl-won">${r.items.map(i => pickHTML(i)).join("")}</div>` : ""}`;
}

async function spinRoulette() {
  if (CS.spinning || !CS.sel.size) return;
  const ids = [...CS.sel], stake = csStake(CS.sel);
  const bet = S.cfg.roulette.bets[CS.bet];
  if (stake >= 5000 && !confirm(`Postawić ${ids.length} ${plural(ids.length, "kartę", "karty", "kart")} o wartości ${fmt(stake)} na „${bet.name}”?`)) return;
  CS.spinning = true;
  Sound.unlock();
  let res;
  try { res = await api("/api/casino/roulette", { ids, bet: CS.bet }); }
  catch (e) { CS.spinning = false; Sound.error(); toast(e.message, true); return drawRoulette(); }
  $("#rlSpin").disabled = true;
  $$("#casinoBody button, #casinoBody input").forEach(b => { b.disabled = true; });

  // koło kręci się w prawo, kulka w lewo; obie zatrzymują się tak, że wylosowane pole jest pod wskaźnikiem u góry
  const W = S.cfg.roulette.wheel, step = 360 / W.length, idx = W.indexOf(res.number);
  const fast = S.fast, D = fast ? 1800 : 5200, turns = fast ? 3 : 6;
  const start = CS.angle, target = -idx * step + rand(-0.3, 0.3) * step;
  const end = start + turns * 360 + ((((target - start) % 360) + 360) % 360);
  const rot = $("#rlRot"), ball = $("#rlBall");
  const t0 = performance.now();
  let lastPocket = null;
  await new Promise(done => {
    const frame = now => {
      const t = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - t, 3.6);
      const a = start + (end - start) * e;
      rot.style.transform = `rotate(${a}deg)`;
      ball.style.transform = `rotate(${-(1 - e) * 360 * (turns + 2)}deg)`;
      const pocket = Math.round(((-a % 360) + 360) % 360 / step);   // pole pod wskaźnikiem - "tyk" przy każdym
      if (pocket !== lastPocket) { if (lastPocket != null) Sound.tick(1 - t); lastPocket = pocket; }
      if (t < 1) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });
  CS.angle = end % 360;
  CS.history = [res.number, ...CS.history].slice(0, 14);
  CS.last = res;
  if (res.win) {
    S.items = [...res.items.slice().reverse(), ...S.items];
    noteCollected(res.items);
    Sound.win();
    confetti(["#0f9d58", "#ffcf3f", "#c62828", "#fff"], res.payout >= stake * 2 ? 220 : 110);
  } else {
    removeItems(res.consumed);
    CS.sel.clear();
    Sound.fail();
  }
  applyState(res.state);
  CS.spinning = false;
  if (currentView() === "casino" && CS.tab === "roulette") drawRoulette();
}

// ================================================================ JACKPOT

function stopJackpotPolling() { clearInterval(CS.jp.poll); CS.jp.poll = null; }

async function renderJackpot(quiet = false) {
  let data;
  try { data = await api("/api/casino/jackpot"); }
  catch (e) { if (!quiet) toast(e.message, true); return; }
  if (currentView() !== "casino" || CS.tab !== "jackpot") return;
  const jp = CS.jp;
  jp.data = data;
  // mój stół zniknął z listy otwartych - ktoś dołączył (albo stół wygasł)
  const myOpen = data.tables.find(t => t.creator?.id === S.me.id);
  if (jp.waiting && !myOpen) {
    const done = data.mine.find(t => t.id === jp.waiting);
    jp.waiting = null;
    if (done && done.status === "done" && !jp.shown.has(done.id)) {
      jp.shown.add(done.id);
      await csRefreshInventory();
      jackpotAnim(done);
    } else if (done) {
      await csRefreshInventory();
      toast(done.status === "expired" ? "⌛ Nikt nie dołączył do twojego stołu — karty wróciły" : "Stół zamknięty — karty wróciły");
    }
  }
  if (myOpen) jp.waiting = myOpen.id;
  if (jp.join && !data.tables.some(t => t.id === jp.join)) { jp.join = null; toast("Ktoś był szybszy — ten stół jest już nieaktualny", true); }
  if (!(quiet && document.querySelector("#casinoBody input:focus"))) drawJackpot();
  // czekam na rywala - sprawdzam co 3 s; inaczej lista stołów odświeża się co 10 s
  stopJackpotPolling();
  jp.poll = setInterval(() => {
    if (currentView() !== "casino" || CS.tab !== "jackpot") return stopJackpotPolling();
    if (!document.hidden && !document.querySelector(".jp-anim")) renderJackpot(true);
  }, myOpen ? 3000 : 10000);
}

async function csRefreshInventory() {
  try {
    const st = await api("/api/state");
    S.items = st.items; S.showcase = st.showcase || [];
    noteCollected(S.items);
    applyState(st.state);
    if (S.items.some(i => person(i.person)?.masked)) await refreshConfig();   // wygrana tajna karta jest teraz odkryta
  } catch (_) {}
}

function jpCardsHTML(t, side, max = 10) {
  const cards = t[side];
  return `<div class="jp-cards">${cards.slice(0, max).map(c => withRevealMap(c.reveal ? { [c.person]: c.reveal } : {}, `jackpot=${t.id}`,
    () => pickHTML({ id: 0, person: c.person, variant: c.variant, value: c.value }))).join("")}${cards.length > max ? `<span class="jp-more">+${cards.length - max}</span>` : ""}</div>`;
}

function jpTableHTML(t) {
  const mine = t.creator?.id === S.me.id;
  return `<div class="jp-table${mine ? " mine" : ""}${t.invite ? " invite" : ""}">
    <div class="jp-head">${t.creator ? userLink(t.creator) : "?"} stawia ${mkPrice(t.valueA)}
      ${t.invite ? `<span class="mk-tag">✉️ ${t.invite.id === S.me.id ? "zaproszenie dla ciebie" : "dla: " + esc(t.invite.username)}</span>` : ""}
      <span class="fi-time">${timeAgo(t.created)}</span></div>
    ${jpCardsHTML(t, "a")}
    <div class="mk-actions">${mine ? `<span class="mk-tag mine">⏳ Twój stół — czekasz na rywala</span><button class="btn tiny" data-jcancel="${t.id}">↩️ Zamknij stół</button>`
      : `<button class="btn primary" data-jjoin="${t.id}">🎲 Dołącz</button>`}</div>
  </div>`;
}

function jpOddsBar(a, b, nameA, nameB) {
  const pa = a + b ? a / (a + b) : 0.5;
  return `<div class="jp-odds"><div class="jp-bar"><i class="jp-a" style="width:${pa * 100}%"></i><i class="jp-b" style="width:${(1 - pa) * 100}%"></i></div>
    <div class="jp-odds-txt"><span>${esc(nameA)} <b>${csPct(pa)}</b></span><span><b>${csPct(1 - pa)}</b> ${esc(nameB)}</span></div></div>`;
}

function drawJackpot() {
  const jp = CS.jp, d = jp.data;
  if (!d) return;
  const myOpen = d.tables.find(t => t.creator?.id === S.me.id);
  const others = d.tables.filter(t => t !== myOpen);
  const joinT = jp.join && d.tables.find(t => t.id === jp.join);
  const stake = csStake(jp.sel);
  let left;
  if (joinT) {
    left = `<h3>🎲 Dołączasz do stołu: ${esc(joinT.creator?.username || "?")}</h3>
      ${jpCardsHTML(joinT, "a", 12)}
      ${jpOddsBar(joinT.valueA, stake, joinT.creator?.username || "?", "Ty")}
      <p class="muted small">Twoja szansa = wartość twoich kart / wartość wszystkich kart na stole. Po dołączeniu od razu losujemy zwycięzcę — bierze wszystkie karty.</p>
      <div class="cs-btns"><button class="big-btn" data-jgo${jp.sel.size ? "" : " disabled"}>🎲 DOŁĄCZ I LOSUJ · ${fmt(stake)}</button>
        <button class="btn" data-jback>Anuluj</button></div>
      ${csPickerHTML(jp.sel, jp.q, S.cfg.jackpot.maxCards, "jp")}`;
  } else if (myOpen) {
    left = `<h3>⏳ Twój stół czeka na rywala</h3>${jpTableHTML(myOpen)}
      <p class="muted small">Gdy ktoś dołączy, od razu zobaczysz losowanie. Stół zamyka się sam po ${S.cfg.jackpot.expireHours} godz. (karty wracają).</p>`;
  } else {
    left = `<h3>💰 Nowy stół</h3>
      <p class="muted small">Postaw swoje karty. Drugi gracz dokłada swoje — im więcej warte twoje karty, tym większa szansa na wygraną (razem 100%). Zwycięzca bierze <b>wszystkie</b> karty ze stołu.</p>
      <label class="jp-invite">✉️ Zaproś gracza (opcjonalnie — puste = każdy może dołączyć)<input type="text" data-jinvite placeholder="nazwa gracza" value="${esc(jp.invite)}"></label>
      <div class="cs-btns"><button class="big-btn" data-jcreate${jp.sel.size ? "" : " disabled"}>💰 OTWÓRZ STÓŁ${stake ? ` · ${fmt(stake)}` : ""}</button></div>
      ${csPickerHTML(jp.sel, jp.q, S.cfg.jackpot.maxCards, "jp")}`;
  }
  const recentHTML = t => {
    const pa = t.valueA / ((t.valueA + t.valueB) || 1);
    const win = t.winner === "a" ? t.creator : t.joiner;
    return `<div class="jp-recent${t.mine ? " mine" : ""}">
      <span>${t.creator ? userLink(t.creator) : "?"} <small class="muted">${fmt(t.valueA)} · ${csPct(pa)}</small></span>
      <span class="jp-vs">⚔</span>
      <span>${t.joiner ? userLink(t.joiner) : "?"} <small class="muted">${fmt(t.valueB)} · ${csPct(1 - pa)}</small></span>
      <span class="jp-win">🏆 ${esc(win?.username || "?")} · ${fmt(t.valueA + t.valueB)}</span>
      <span class="fi-time">${timeAgo(t.finished)}</span></div>`;
  };
  $("#casinoBody").innerHTML = `<div class="jp-cols">
    <div class="panel jp-left">${left}</div>
    <div class="jp-right">
      <div class="panel"><h3>🎲 Stoły czekające na rywala (${others.length})</h3>
        ${others.map(jpTableHTML).join("") || '<p class="muted">Nikt teraz nie czeka. Otwórz własny stół!</p>'}</div>
      <div class="panel"><h3>📜 Ostatnie gry</h3>${d.recent.map(recentHTML).join("") || '<p class="muted">Jeszcze nikt nie grał.</p>'}</div>
    </div>
  </div>`;
}

async function jpCreate() {
  const jp = CS.jp;
  if (!jp.sel.size) return;
  const ids = [...jp.sel];
  try {
    const res = await api("/api/casino/jackpot", { ids, invite: $("[data-jinvite]")?.value || "" });
    removeItems(res.consumed);
    jp.sel.clear(); jp.invite = "";
    jp.waiting = res.id;
    Sound.coin(2);
    toast("💰 Stół otwarty — czekasz na rywala");
    renderHeader();
  } catch (e) { Sound.error(); toast(e.message, true); }
  renderJackpot();
}

async function jpJoin() {
  const jp = CS.jp, t = jp.data?.tables.find(x => x.id === jp.join);
  if (!t || !jp.sel.size) return;
  const stake = csStake(jp.sel);
  if (!confirm(`Dołączyć do stołu ${t.creator?.username || ""}? Stawiasz ${fmt(stake)}, szansa ${csPct(stake / (stake + t.valueA))}. Zwycięzca bierze wszystko.`)) return;
  let res;
  try { res = await api(`/api/casino/jackpot/${t.id}/join`, { ids: [...jp.sel] }); }
  catch (e) { Sound.error(); toast(e.message, true); jp.join = null; return renderJackpot(); }
  jp.sel.clear(); jp.join = null;
  jp.shown.add(res.jackpot.id);
  S.items = res.items;
  noteCollected(S.items);
  applyState(res.state);
  if (S.items.some(i => person(i.person)?.masked)) await refreshConfig();
  await jackpotAnim(res.jackpot);
  renderJackpot();
}

// animacja losowania: pasek podzielony według szans, wskaźnik biega w tę i z powrotem i zatrzymuje się na wyniku
function jackpotAnim(t) {
  return new Promise(resolve => {
    const pa = t.valueA / (t.valueA + t.valueB);
    const meA = t.creator?.id === S.me.id, iWon = (t.winner === "a") === meA;
    const winner = t.winner === "a" ? t.creator : t.joiner;
    const cards = [...t.a, ...t.b];
    const el = document.createElement("div");
    el.className = "jp-anim";
    el.innerHTML = `<div class="jp-anim-box">
      <h2>💰 JACKPOT</h2>
      <div class="jp-anim-players">
        <div class="jp-p jp-pa">${avatarHTML(t.creator || {})}<b>${esc(t.creator?.username || "?")}</b><span>${fmt(t.valueA)} · ${csPct(pa)}</span></div>
        <div class="jp-vs">⚔</div>
        <div class="jp-p jp-pb">${avatarHTML(t.joiner || {})}<b>${esc(t.joiner?.username || "?")}</b><span>${fmt(t.valueB)} · ${csPct(1 - pa)}</span></div>
      </div>
      <div class="jp-track"><i class="jp-a" style="width:${pa * 100}%"></i><i class="jp-b" style="width:${(1 - pa) * 100}%"></i><div class="jp-marker" id="jpMarker"></div></div>
      <div class="jp-anim-res" hidden></div>
      <div class="pick-grid jp-anim-cards" hidden></div>
      <div class="daily-actions"><button class="btn primary" data-jclose hidden>✔ OK</button></div>
    </div>`;
    document.body.appendChild(el);
    Sound.unlock();
    const marker = el.querySelector("#jpMarker");
    const fast = S.fast, D = fast ? 2200 : 5200, passes = fast ? 3 : 6;
    const t0 = performance.now();
    let lastSide = null;
    const frame = now => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      const p = e * (2 * passes + t.roll), m = p % 2, x = m <= 1 ? m : 2 - m;
      marker.style.left = (x * 100) + "%";
      const side = x < pa ? "a" : "b";
      if (side !== lastSide) { if (lastSide) Sound.tick(1 - k); lastSide = side; }
      if (k < 1) return requestAnimationFrame(frame);
      marker.style.left = (t.roll * 100) + "%";
      el.querySelector(`.jp-p${t.winner}`).classList.add("won");
      const res = el.querySelector(".jp-anim-res");
      res.hidden = false;
      res.innerHTML = iWon ? `<b class="pos-txt">🏆 WYGRYWASZ! +${fmt(t.valueA + t.valueB)}</b><div class="muted">Wszystkie karty ze stołu są w twoim ekwipunku.</div>`
        : `<b class="neg-txt">Wygrywa ${esc(winner?.username || "?")}</b><div class="muted">Twoje karty przepadły.</div>`;
      const grid = el.querySelector(".jp-anim-cards");
      grid.hidden = false;
      grid.innerHTML = cards.map(c => withRevealMap(c.reveal ? { [c.person]: c.reveal } : {}, `jackpot=${t.id}`,
        () => pickHTML({ id: 0, person: c.person, variant: c.variant, value: c.value }))).join("");
      el.querySelector("[data-jclose]").hidden = false;
      if (iWon) { Sound.win(); confetti(GOLDS.concat(RAINBOW), 240); } else Sound.fail();
    };
    requestAnimationFrame(frame);
    el.addEventListener("click", e => {
      if (!e.target.closest("[data-jclose]")) return;
      el.remove();
      resolve();
    });
  });
}

// ================================================================ ZDARZENIA

function bindCasino() {
  $("#casinoSeg").addEventListener("click", e => {
    const b = e.target.closest("[data-cstab]"); if (!b || CS.spinning) return;
    CS.tab = b.dataset.cstab; Sound.click(); renderCasino();
  });
  const body = $("#casinoBody");
  body.addEventListener("click", e => {
    const t = e.target;
    if (CS.spinning) return;
    const won = t.closest(".rl-won .pick");
    if (won) { const it = CS.last?.items?.find(i => i.id === +won.dataset.id); if (it) openViewer(it.person, it.variant); return; }
    const pick = t.closest(".cs-grid .pick");
    if (pick) {
      const zone = pick.closest(".cs-grid").dataset.zone, id = +pick.dataset.id;
      const set = zone === "rl" ? CS.sel : CS.jp.sel, max = zone === "rl" ? S.cfg.roulette.maxCards : S.cfg.jackpot.maxCards;
      if (set.has(id)) set.delete(id);
      else if (set.size >= max) { Sound.error(); return toast(`Najwyżej ${max} kart`, true); }
      else set.add(id);
      Sound.click();
      return zone === "rl" ? drawRoulette() : drawJackpot();
    }
    const clear = t.closest("[data-csclear]");
    if (clear) { (clear.dataset.csclear === "rl" ? CS.sel : CS.jp.sel).clear(); return clear.dataset.csclear === "rl" ? drawRoulette() : drawJackpot(); }
    const bet = t.closest("[data-rbet]");
    if (bet) { CS.bet = bet.dataset.rbet; Sound.click(); return drawRoulette(); }
    if (t.closest("#rlSpin")) return spinRoulette();
    if (t.closest("[data-jcreate]")) return jpCreate();
    if (t.closest("[data-jgo]")) return jpJoin();
    if (t.closest("[data-jback]")) { CS.jp.join = null; CS.jp.sel.clear(); return drawJackpot(); }
    const join = t.closest("[data-jjoin]");
    if (join) { CS.jp.join = +join.dataset.jjoin; CS.jp.sel.clear(); Sound.click(); return drawJackpot(); }
    const cancel = t.closest("[data-jcancel]");
    if (cancel) {
      if (!confirm("Zamknąć stół? Twoje karty wrócą do ekwipunku.")) return;
      return api(`/api/casino/jackpot/${cancel.dataset.jcancel}/cancel`, {}).then(res => {
        S.items = res.items; CS.jp.waiting = null; renderHeader(); toast("↩️ Stół zamknięty — karty wróciły");
      }).catch(err => toast(err.message, true)).finally(() => renderJackpot());
    }
  });
  body.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.csq) {
      const pos = t.selectionStart, zone = t.dataset.csq;
      if (zone === "rl") { CS.q = t.value; drawRoulette(); } else { CS.jp.q = t.value; drawJackpot(); }
      const again = $(`[data-csq=${zone}]`); again.focus(); again.setSelectionRange(pos, pos);
    }
    if (t.matches("[data-jinvite]")) CS.jp.invite = t.value;
  });
}
