"use strict";
// Kasyno: ruletka (stawką są karty, wygrana też w kartach) i jackpot - lobby dla dwóch graczy (zwycięzca bierze wszystkie karty).
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
  sorts: { rl: "value", jp: "value" },   // sortowanie moich kart w ruletce / jackpocie
  // jackpot: lobby, w którym siedzę (data.current), nowe lobby (publiczne / prywatne + zaproszenia), obejrzane wyniki
  jp: { data: null, q: "", poll: null, sig: "", lastLobby: null, busy: false, newPublic: true, newInvites: "", shown: new Set() },
};
const CS_PICK_LIMIT = 240;

function csItems() { return S.items.filter(i => !i.fav); }
function csStake(set) { return S.items.filter(i => set.has(i.id)).reduce((a, i) => a + i.value, 0); }
function csPct(x) { return (x * 100).toLocaleString("pl-PL", { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + "%"; }

// siatka moich kart do wyboru (ruletka / jackpot)
function csPickerHTML(set, q, max, zone) {
  const sorted = sortCards(csItems().filter(i => cardMatches(i, q)), CS.sorts[zone]);
  const list = [...sorted.filter(i => set.has(i.id)), ...sorted.filter(i => !set.has(i.id))];   // wybrane na początku
  return `<div class="cs-pick-head"><input type="text" data-csq="${zone}" placeholder="🔍 Szukaj: nazwa, wariant, rzadkość…" value="${esc(q)}">
      ${sortSelectHTML(CS.sorts[zone], `data-cssort="${zone}"`)}
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
        <div class="muted small">Wygrana: twoje karty zostają, a dostajesz karty o wartości stawki × wypłata (losowe karty ze skrzynek w sklepie; końcówka w groszach). Przegrana: postawione karty przepadają.</div>
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

// ================================================================ JACKPOT (lobby dla 2 graczy)
// Lobby: publiczne albo prywatne (tylko zaproszeni po nicku), założyciel może to zmienić i zapraszać kolejnych graczy.
// Obaj gracze wybierają i zmieniają karty w lobby (każda zmiana cofa akceptację obu), gdy obaj zaakceptują - serwer losuje.
// Karty nie są blokowane - serwer sprawdza przy losowaniu, czy gracze nadal je mają.

function stopJackpotPolling() { clearTimeout(CS.jp.poll); CS.jp.poll = null; }

async function renderJackpot(quiet = false) {
  const jp = CS.jp;
  let data;
  try { data = await api("/api/casino/jackpot"); }
  catch (e) { if (!quiet) toast(e.message, true); return jpSchedule(); }
  if (currentView() !== "casino" || CS.tab !== "jackpot") return;
  // lobby, w którym byłem, już się skończyło: wynik gry albo zamknięte / wyproszony
  const prev = jp.lastLobby, cur = data.current;
  if (prev && cur?.id !== prev) {
    const old = data.mine.find(t => t.id === prev);
    if (old?.status === "done") showJackpotResult(old);
    else if (old?.status === "cancelled") toast("Założyciel zamknął lobby");
    else if (old?.status === "expired") toast("Lobby zamknęło się po długim czasie bez ruchu");
    else if (!old) toast("Założyciel wyprosił cię z lobby");
  }
  jp.lastLobby = cur?.id || null;
  S.jpLobby = jp.lastLobby;
  jp.data = data;
  // przerysowanie tylko, gdy coś się zmieniło (i nie w trakcie pisania) - inaczej wybór kart by "migał"
  const sig = JSON.stringify([data.current, data.lobbies.map(l => [l.id, l.joiner?.id, l.valueA, l.public]), data.recent.map(t => t.id)]);
  const typing = document.querySelector("#casinoBody input:focus");
  if (!quiet || (sig !== jp.sig && !typing)) { jp.sig = sig; drawJackpot(); }
  jpSchedule();
}

// w lobby odświeżamy co 2 s (akceptacje, karty rywala, wynik), poza lobby lista co 8 s
function jpSchedule() {
  stopJackpotPolling();
  if (currentView() !== "casino" || CS.tab !== "jackpot") return;
  CS.jp.poll = setTimeout(() => {
    if (currentView() !== "casino" || CS.tab !== "jackpot") return;
    if (document.hidden || document.querySelector(".jp-anim") || CS.jp.busy) return jpSchedule();
    renderJackpot(true);
  }, CS.jp.lastLobby ? 2000 : 8000);
}

// wynik gry - pokazywany gdziekolwiek gracz jest (także gdy wyszedł z zakładki albo z gry), raz na grę
async function showJackpotResult(t) {
  const jp = CS.jp;
  if (!t || !t.side || jp.shown.has(t.id)) return;
  if (S.opening || epicOpen() || dialogOpen() || document.querySelector(".jp-anim")) return;   // spróbujemy przy następnym odświeżeniu
  jp.shown.add(t.id);
  api(`/api/casino/jackpot/${t.id}/seen`, {}).catch(() => {});
  await syncInventory(null, true);
  await jackpotAnim(t);
  if (currentView() === "casino" && CS.tab === "jackpot") renderJackpot();
}

function jpCardsHTML(t, side, max = 10, own = false) {
  const cards = t[side];
  if (!cards.length) return '<div class="muted small jp-nocards">jeszcze bez kart</div>';
  return `<div class="jp-cards">${cards.slice(0, max).map(c => withRevealMap(c.reveal ? { [c.person]: c.reveal } : {}, `jackpot=${t.id}`,
    () => `<div class="jp-c"${own ? ` data-jrm="${c.id}" title="Kliknij, aby zdjąć kartę"` : ""}>${pickHTML({ id: c.id, person: c.person, variant: c.variant, value: c.value })}</div>`)).join("")}${
    cards.length > max ? `<span class="jp-more">+${cards.length - max}</span>` : ""}</div>`;
}

function jpOddsBar(a, b, nameA, nameB) {
  const pa = a + b ? a / (a + b) : 0.5;
  return `<div class="jp-odds"><div class="jp-bar"><i class="jp-a" style="width:${pa * 100}%"></i><i class="jp-b" style="width:${(1 - pa) * 100}%"></i></div>
    <div class="jp-odds-txt"><span>${esc(nameA)} <b>${a + b ? csPct(pa) : "—"}</b></span><span><b>${a + b ? csPct(1 - pa) : "—"}</b> ${esc(nameB)}</span></div></div>`;
}

// ---------------------------------------------------------------- lobby, w którym siedzę
function jpRoomHTML(L) {
  const me = L.side, opp = me === "a" ? "b" : "a", creator = me === "a";
  const ready = { a: L.readyA, b: L.readyB }, value = { a: L.valueA, b: L.valueB };
  const seat = side => {
    const u = side === "a" ? L.creator : L.joiner;
    if (!u) return `<div class="jp-seat empty"><div class="jp-seat-wait">⏳ Czekamy na drugiego gracza…</div>
      <div class="muted small">${L.public ? "Lobby jest publiczne — każdy może dołączyć." : "Lobby jest prywatne — dołączyć mogą tylko zaproszeni."}</div></div>`;
    return `<div class="jp-seat jp-s${side}${side === me ? " me" : ""}${ready[side] ? " ready" : ""}">
      <div class="jp-seat-head">${avatarHTML(u)}<b>${esc(u.username)}${side === me ? " (ty)" : ""}</b>
        <span class="jp-ready-tag">${ready[side] ? "✅ Akceptuje" : "⏳ Wybiera karty"}</span>
        ${creator && side === "b" ? '<button class="btn tiny" data-jkick>🚪 Wyproś</button>' : ""}</div>
      <div class="jp-seat-val">${mkPrice(value[side])} · ${L[side].length} ${plural(L[side].length, "karta", "karty", "kart")}</div>
      ${jpCardsHTML(L, side, 40, side === me)}
    </div>`;
  };
  const canReady = L.joiner && L[me].length;
  const hint = !L.joiner ? "Poczekaj, aż ktoś dołączy." : !L[me].length ? "Wybierz swoje karty poniżej."
    : ready[opp] && !ready[me] ? "Rywal już zaakceptował — gdy ty zaakceptujesz, od razu losujemy!"
    : ready[me] && !ready[opp] ? "Czekamy, aż rywal zaakceptuje." : "Gdy obaj zaakceptujecie, od razu losujemy zwycięzcę.";
  return `<div class="jp-room">
    <div class="panel jp-room-head">
      <div class="jp-room-title"><h3>💰 Lobby #${L.id}</h3>
        <span class="mk-tag">${L.public ? "🌍 Publiczne" : "🔒 Prywatne"}</span>
        ${creator ? `<button class="btn tiny" data-jpublic="${L.public ? 0 : 1}">${L.public ? "🔒 Zmień na prywatne" : "🌍 Zmień na publiczne"}</button>` : ""}
        <button class="btn tiny jp-leave" data-jleave>${creator ? "✖ Zamknij lobby" : "↩️ Opuść lobby"}</button></div>
      <div class="jp-invites">✉️ Zaproszeni: ${L.invites.map(u => `<span class="jp-inv">${esc(u.username)}${creator ? `<button data-juninv="${u.id}" title="Usuń zaproszenie">×</button>` : ""}</span>`).join("")
        || '<span class="muted small">nikt</span>'}
        ${creator ? `<span class="jp-inv-add"><input type="text" data-jinv placeholder="nick gracza"><button class="btn tiny" data-jinvgo>✉️ Zaproś</button></span>` : ""}</div>
    </div>
    <div class="jp-seats">${seat("a")}<div class="jp-vs-big">⚔</div>${seat("b")}</div>
    ${jpOddsBar(L.valueA, L.valueB, L.creator?.username || "?", L.joiner?.username || "?")}
    <div class="cs-btns"><button class="big-btn jp-accept${ready[me] ? " on" : ""}" data-jready="${ready[me] ? 0 : 1}"${!ready[me] && !canReady ? " disabled" : ""}>
      ${ready[me] ? "↩️ COFNIJ AKCEPTACJĘ" : "✅ AKCEPTUJĘ — GRAMY"}</button></div>
    <p class="muted small jp-hint">${hint} Zmiana kart (twoich albo rywala) cofa akceptację obu graczy. Zwycięzca bierze wszystkie karty z lobby — swoje z powrotem i karty rywala.</p>
    <div class="panel cs-pick"><h3>Twoje karty <small class="muted">(kliknij, aby dodać do lobby albo zdjąć)</small></h3>
      ${csPickerHTML(new Set(L[me].map(c => c.id)), CS.jp.q, S.cfg.jackpot.maxCards, "jp")}</div>
  </div>`;
}

// ---------------------------------------------------------------- lista lobby + nowe lobby
function jpLobbyHTML(t) {
  return `<div class="jp-table${t.invited ? " invite" : ""}">
    <div class="jp-head">${t.creator ? userLink(t.creator) : "?"}
      <span class="mk-tag">${t.public ? "🌍 publiczne" : "🔒 prywatne"}</span>
      ${t.invited ? '<span class="mk-tag lead">✉️ zaproszenie dla ciebie</span>' : ""}
      <span class="muted small">${t.joiner ? "👥 2/2" : "👤 1/2"}</span>
      <span class="fi-time">${timeAgo(t.created)}</span></div>
    ${t.a.length ? `<div class="small">stawia ${mkPrice(t.valueA)}</div>${jpCardsHTML(t, "a", 8)}` : '<div class="muted small">jeszcze nie wybrał kart</div>'}
    <div class="mk-actions">${t.joiner ? '<span class="muted small">Lobby pełne</span>' : `<button class="btn primary" data-jjoin="${t.id}">🎲 Dołącz</button>`}</div>
  </div>`;
}

function jpRecentHTML(t) {
  const pa = t.valueA / ((t.valueA + t.valueB) || 1);
  const win = t.winner === "a" ? t.creator : t.joiner;
  return `<div class="jp-recent${t.side ? " mine" : ""}">
    <span>${t.creator ? userLink(t.creator) : "?"} <small class="muted">${fmt(t.valueA)} · ${csPct(pa)}</small></span>
    <span class="jp-vs">⚔</span>
    <span>${t.joiner ? userLink(t.joiner) : "?"} <small class="muted">${fmt(t.valueB)} · ${csPct(1 - pa)}</small></span>
    <span class="jp-win">🏆 ${esc(win?.username || "?")} · ${fmt(t.valueA + t.valueB)}</span>
    <span class="fi-time">${timeAgo(t.finished)}</span></div>`;
}

function drawJackpot() {
  const jp = CS.jp, d = jp.data;
  if (!d) return;
  if (d.current) {
    $("#casinoBody").innerHTML = jpRoomHTML(d.current);
    return;
  }
  const lobbies = d.lobbies.slice().sort((a, b) => (b.invited - a.invited) || (!!a.joiner - !!b.joiner) || b.id - a.id);
  $("#casinoBody").innerHTML = `<div class="jp-cols">
    <div class="panel jp-left">
      <h3>💰 Nowe lobby</h3>
      <p class="muted small">Załóż lobby i zaproś graczy. W lobby obaj wybieracie karty (można je zmieniać), a gdy obaj zaakceptujecie —
        losujemy zwycięzcę. Szansa = wartość twoich kart / wartość wszystkich kart. Zwycięzca bierze <b>wszystkie</b> karty: swoje z powrotem i karty rywala.</p>
      <div class="seg jp-vis"><button data-jnewpub="1" class="${jp.newPublic ? "active" : ""}">🌍 Publiczne</button><button data-jnewpub="0" class="${jp.newPublic ? "" : "active"}">🔒 Prywatne</button></div>
      <div class="muted small">${jp.newPublic ? "Każdy może dołączyć." : "Dołączyć mogą tylko zaproszeni."} Możesz to zmienić później w lobby.</div>
      <label class="jp-invite">✉️ Zaproś graczy (nicki, oddzielone przecinkami)<input type="text" data-jnewinv placeholder="np. ala, bartek" value="${esc(jp.newInvites)}"></label>
      <div class="cs-btns"><button class="big-btn" data-jcreate>💰 UTWÓRZ LOBBY</button></div>
    </div>
    <div class="jp-right">
      <div class="panel"><h3>🎲 Lobby (${lobbies.length})</h3>${lobbies.map(jpLobbyHTML).join("") || '<p class="muted">Nie ma otwartych lobby. Załóż własne!</p>'}</div>
      <div class="panel"><h3>📜 Ostatnie gry</h3>${d.recent.map(jpRecentHTML).join("") || '<p class="muted">Jeszcze nikt nie grał.</p>'}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- akcje
async function jpCall(path, body = {}, okMsg = null) {
  const jp = CS.jp;
  jp.busy = true;
  try {
    const res = await api(path, body);
    if (res.jackpot && res.jackpot.status === "open" && jp.data) { jp.data.current = res.jackpot; jp.lastLobby = res.jackpot.id; S.jpLobby = jp.lastLobby; }
    if (okMsg) toast(okMsg);
    return res;
  } catch (e) { Sound.error(); toast(e.message, true); return null; }
  finally { jp.busy = false; }
}

async function jpCreate() {
  const jp = CS.jp;
  const res = await jpCall("/api/casino/jackpot", { public: jp.newPublic, invites: $("[data-jnewinv]")?.value || "" });
  if (res) { jp.newInvites = ""; Sound.click(); toast("💰 Lobby gotowe — wybierz karty"); }
  renderJackpot();
}

async function jpSetCards(ids) {
  const L = CS.jp.data?.current;
  if (!L || CS.jp.busy) return;
  const res = await jpCall(`/api/casino/jackpot/${L.id}/cards`, { ids });
  if (res) Sound.click();
  drawJackpot();
}

async function jpReady(on) {
  const L = CS.jp.data?.current;
  if (!L || CS.jp.busy) return;
  CS.jp.busy = true;
  S.inflight = (S.inflight || 0) + 1; S.mutations = (S.mutations || 0) + 1;
  let res;
  try {   // własne zapytanie: przy 409 (karty zniknęły) serwer zwraca też poprawione lobby
    res = await fetch(`/api/casino/jackpot/${L.id}/ready`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ready: on }) })
      .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  } catch (_) { res = { status: 0, body: { error: "Błąd połączenia" } }; }
  finally { S.inflight--; CS.jp.busy = false; }
  const b = res.body;
  if (res.status === 409 && b.jackpot) { CS.jp.data.current = b.jackpot; Sound.error(); toast(b.error, true); return drawJackpot(); }
  if (res.status !== 200) { Sound.error(); toast(b.error || "Błąd serwera", true); return renderJackpot(); }
  if (b.jackpot.status === "done") {   // to ja zaakceptowałem jako drugi - losowanie już się odbyło
    CS.jp.lastLobby = null; S.jpLobby = null;
    if (b.items) { S.items = b.items; noteCollected(S.items); }
    if (b.state) applyState(b.state);
    await showJackpotResult(b.jackpot);
    return renderJackpot();
  }
  CS.jp.data.current = b.jackpot;
  Sound.click();
  drawJackpot();
}

// animacja losowania: pasek podzielony według szans, wskaźnik biega w tę i z powrotem i zatrzymuje się na wyniku
function jackpotAnim(t) {
  return new Promise(resolve => {
    const pa = t.valueA / (t.valueA + t.valueB);
    const iWon = t.winner === t.side;
    const winner = t.winner === "a" ? t.creator : t.joiner;
    const mine = t.side === "a" ? t.valueA : t.valueB, theirs = t.side === "a" ? t.valueB : t.valueA;
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
      <div class="jp-track"><i class="jp-a" style="width:${pa * 100}%"></i><i class="jp-b" style="width:${(1 - pa) * 100}%"></i><div class="jp-marker"></div></div>
      <div class="jp-anim-res" hidden></div>
      <div class="pick-grid jp-anim-cards" hidden></div>
      <div class="daily-actions"><button class="btn primary" data-jclose hidden>✔ OK</button></div>
    </div>`;
    document.body.appendChild(el);
    Sound.unlock();
    const marker = el.querySelector(".jp-marker");
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
      res.innerHTML = iWon
        ? `<b class="pos-txt">🏆 WYGRYWASZ ${fmt(mine + theirs)}!</b><div class="muted">Twoje karty wracają do ciebie, a do tego karty rywala za ${fmt(theirs)}. Wszystko jest w ekwipunku.</div>`
        : `<b class="neg-txt">Wygrywa ${esc(winner?.username || "?")}</b><div class="muted">Twoje karty (${fmt(mine)}) przechodzą do zwycięzcy.</div>`;
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
    const L = CS.jp.data?.current;
    // ruletka
    const won = t.closest(".rl-won .pick");
    if (won) { const it = CS.last?.items?.find(i => i.id === +won.dataset.id); if (it) openViewer(it.person, it.variant); return; }
    const pick = t.closest(".cs-grid .pick");
    if (pick) {
      const zone = pick.closest(".cs-grid").dataset.zone, id = +pick.dataset.id;
      if (zone === "jp") {   // karta do lobby albo z lobby
        if (!L) return;
        const ids = L[L.side].map(c => c.id);
        if (ids.includes(id)) return jpSetCards(ids.filter(x => x !== id));
        if (ids.length >= S.cfg.jackpot.maxCards) { Sound.error(); return toast(`Najwyżej ${S.cfg.jackpot.maxCards} kart`, true); }
        return jpSetCards([...ids, id]);
      }
      if (CS.sel.has(id)) CS.sel.delete(id);
      else if (CS.sel.size >= S.cfg.roulette.maxCards) { Sound.error(); return toast(`Najwyżej ${S.cfg.roulette.maxCards} kart`, true); }
      else CS.sel.add(id);
      Sound.click();
      return drawRoulette();
    }
    const clear = t.closest("[data-csclear]");
    if (clear) {
      if (clear.dataset.csclear === "jp") return jpSetCards([]);
      CS.sel.clear(); return drawRoulette();
    }
    const bet = t.closest("[data-rbet]");
    if (bet) { CS.bet = bet.dataset.rbet; Sound.click(); return drawRoulette(); }
    if (t.closest("#rlSpin")) return spinRoulette();
    // jackpot
    const rm = t.closest("[data-jrm]");
    if (rm && L) return jpSetCards(L[L.side].map(c => c.id).filter(x => x !== +rm.dataset.jrm));
    const pub = t.closest("[data-jnewpub]");
    if (pub) { CS.jp.newPublic = pub.dataset.jnewpub === "1"; CS.jp.newInvites = $("[data-jnewinv]")?.value || ""; Sound.click(); return drawJackpot(); }
    if (t.closest("[data-jcreate]")) return jpCreate();
    const join = t.closest("[data-jjoin]");
    if (join) return jpCall(`/api/casino/jackpot/${join.dataset.jjoin}/join`, {}, "🎲 Dołączyłeś do lobby — wybierz karty").then(() => renderJackpot());
    if (!L) return;
    const ready = t.closest("[data-jready]");
    if (ready) return jpReady(ready.dataset.jready === "1");
    const vis = t.closest("[data-jpublic]");
    if (vis) return jpCall(`/api/casino/jackpot/${L.id}/settings`, { public: vis.dataset.jpublic === "1" },
      vis.dataset.jpublic === "1" ? "🌍 Lobby jest teraz publiczne" : "🔒 Lobby jest teraz prywatne").then(drawJackpot);
    if (t.closest("[data-jinvgo]")) {
      const name = $("[data-jinv]")?.value.trim();
      if (!name) return;
      return jpCall(`/api/casino/jackpot/${L.id}/settings`, { invite: name }, `✉️ Zaproszono: ${name}`).then(drawJackpot);
    }
    const unInv = t.closest("[data-juninv]");
    if (unInv) return jpCall(`/api/casino/jackpot/${L.id}/settings`, { uninvite: +unInv.dataset.juninv }).then(drawJackpot);
    if (t.closest("[data-jkick]")) {
      if (!confirm("Wyprosić drugiego gracza z lobby?")) return;
      return jpCall(`/api/casino/jackpot/${L.id}/kick`, {}, "🚪 Gracz wyproszony").then(drawJackpot);
    }
    if (t.closest("[data-jleave]")) {
      if (!confirm(L.side === "a" ? "Zamknąć lobby?" : "Opuścić lobby?")) return;
      CS.jp.lastLobby = null; S.jpLobby = null;   // sam wychodzę - bez komunikatu "wyproszono cię"
      return jpCall(`/api/casino/jackpot/${L.id}/leave`, {}).then(() => { CS.jp.data.current = null; renderJackpot(); });
    }
  });
  body.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.csq) {
      const pos = t.selectionStart, zone = t.dataset.csq;
      if (zone === "rl") { CS.q = t.value; drawRoulette(); } else { CS.jp.q = t.value; drawJackpot(); }
      const again = $(`[data-csq=${zone}]`); again.focus(); again.setSelectionRange(pos, pos);
    }
    if (t.matches("[data-jnewinv]")) CS.jp.newInvites = t.value;
  });
  body.addEventListener("change", e => {
    const zone = e.target.dataset.cssort;
    if (zone) { CS.sorts[zone] = e.target.value; return zone === "rl" ? drawRoulette() : drawJackpot(); }
  });
  body.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("[data-jinv]")) { e.preventDefault(); $("[data-jinvgo]")?.click(); }
  });
}
