// Propozycje nowego wyglądu wariantu Jokerowa (makiety /mockups, tylko admini) - runda 2: po 3 wersje dwóch wybranych
// pomysłów: Talia (A1-A3, klasyczna karta do gry) i Chaos (D1-D3, szalony Joker w kasynie). Nic nie zasłania zdjęcia:
// czapka błazna (symbol #jk-hat z templates/index.html) jest na marginesach albo w nagłówku karty.
// Karta to zwykła karta z cardHTML (wariant normal) z klasami jx jx-a|jx-d jx-<n> i ozdobami pomysłu: bg - tło pod
// napisami, head - przed imieniem, photo - zabarwienie zdjęcia, below - pasek pod zdjęciem, over - ozdoby nad kartą.
// Wygląd: static/css/joker-proposals.css. Po wyborze jednego: przenieść go do VARIANTS["joker"]["styles"], usunąć ten plik.

const jxHat = cls => hwUse("jk-hat", cls);
const jxLetters = word => word.split("").map(l => `<b>${l}</b>`).join("");
// indeksy w rogach jak na karcie do gry: czapka + pionowy napis JOKER (górny lewy i obrócony dolny prawy)
const jxIndex = () => ["tl", "br"].map(c => `<span class="jx-idx ${c}">${jxHat("jx-ihat")}${jxLetters("JOKER")}</span>`).join("");
// kolejność pól na kole ruletki (europejskiej) - pola na marginesach karty Talia Ruletka
const JX_WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const JX_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const jxPocket = n => `<i class="jx-pk ${n === 0 ? "g" : JX_RED.includes(n) ? "r" : "b"}"><b>${n}</b></i>`;
const jxChip = (color, label = "") => `<i class="jx-chip ${color}"><b>${label}</b></i>`;
// "zabarwienie" zdjęcia Chaosu: dwa kolory + linie jak na starym ekranie (zdjęcie co jakiś czas drga - CSS)
const jxDuo = () => '<i class="jx-duo"></i><i class="jx-scan"></i>';

const JOKER_PROPOSALS = [
  {
    code: "A1", family: "a", name: "Talia Dworska",
    desc: "Elegancka karta do gry: grawerowany wzór na marginesach, złote linie, indeksy z czapką błazna i kolumny kolorów kart po bokach.",
    over: () => `<i class="jx-rule"></i>${jxIndex()}${["l", "r"].map(s =>
      `<span class="jx-suits ${s}">${["♠", "♥", "♣", "♦", "♠", "♥", "♣", "♦"].map(x => `<i class="${"♥♦".includes(x) ? "red" : ""}">${x}</i>`).join("")}</span>`).join("")}`,
  },
  {
    code: "A2", family: "a", name: "Talia Ruletka",
    desc: "Klasyczna karta na zielonym suknie ruletki: na marginesach pola koła ruletki (czerwone, czarne i zielone zero), złote indeksy.",
    over: () => `${jxIndex()}<span class="jx-wheel l">${JX_WHEEL.slice(0, 13).map(jxPocket).join("")}</span>` +
      `<span class="jx-wheel r">${JX_WHEEL.slice(13, 26).map(jxPocket).join("")}</span>`,
  },
  {
    code: "A3", family: "a", name: "Talia Kasynowa",
    desc: "Karta ze stołu kasyna: zielone sukno z przeszyciem, złote indeksy i stosy żetonów na marginesach.",
    over: () => `<i class="jx-rule"></i>${jxIndex()}<span class="jx-chips l">${jxChip("red")}${jxChip("black")}${jxChip("blue")}</span>` +
      `<span class="jx-chips r">${jxChip("purple")}${jxChip("red")}${jxChip("black")}</span>`,
  },
  {
    code: "D1", family: "d", name: "Chaos Ruletka",
    desc: "Joker przy ruletce: ramka to obracające się koło ruletki, w tle powoli kręci się wielkie koło, zdjęcie w fiolecie i zieleni drga.",
    bg: () => '<i class="jx-bigwheel"></i>',
    head: () => jxHat("jx-hicon"),
    photo: jxDuo,
  },
  {
    code: "D2", family: "d", name: "Chaos Automat",
    desc: "Jednoręki bandyta: chromowana ramka z mrugającymi światłami, pod zdjęciem bębny automatu z czapką błazna, 7 i kolorami kart.",
    head: () => jxHat("jx-hicon"),
    photo: jxDuo,
    below: () => `<div class="jx-reels">${[0, 1, 2].map(k => `<i class="jx-reel r${k}"><span>${
      [jxHat("jx-rhat"), "<b>7</b>", '<b class="red">♦</b>', "<b>♠</b>", jxHat("jx-rhat")].map(s => `<em>${s}</em>`).join("")}</span></i>`).join("")}</div>`,
    over: () => {
      const light = (x, y, k) => `<i class="jx-light${k % 2 ? " odd" : ""}" style="left:${x.toFixed(1)}%;top:${y}%"></i>`;
      let out = "";
      for (let i = 0; i < 11; i++) { const x = 7 + i * 86 / 10; out += light(x, 2.4, i) + light(x, 97.6, i + 1); }
      return out;
    },
  },
  {
    code: "D3", family: "d", name: "Chaos Poker",
    desc: "Stół pokerowy: drewniana krawędź stołu, zielone sukno w fioletowym cieniu, rozdanie kart pod zdjęciem i żetony HA wystające z boków.",
    head: () => jxHat("jx-hicon"),
    photo: jxDuo,
    below: () => `<div class="jx-hand">${[["A", "♠"], ["K", "♥"], ["Q", "♦"], ["J", "♣"]].map(([r, s]) =>
      `<i class="jx-pc${"♥♦".includes(s) ? " red" : ""}"><b>${r}</b>${s}</i>`).join("")}<i class="jx-pc joker">${jxHat("jx-pchat")}</i></div>`,
    over: () => `${jxChip("green", "HA")}${jxChip("purple", "HA")}${jxChip("red", "HA")}`,
  },
];

// karta z propozycją n (1-6) - id: przykładowa karta, która jest w S.cfg.people na czas budowania HTML
function jxCardHTML(id, n) {
  const P = JOKER_PROPOSALS[n - 1], f = (k, d = "") => (P[k] ? P[k]() : d);
  return cardHTML(id, "normal")
    .replace('class="card ', `class="card jx jx-${P.family} jx-${n} `)
    .replace('<div class="card-inner">', `<div class="card-inner"><div class="jx-bg">${f("bg")}</div>`)
    .replace('<span class="card-name">', `${f("head")}<span class="card-name">`)
    .replace(/(<div class="card-photo"><img[^>]*>)/, `$1${P.photo ? `<i class="jx-photo">${P.photo()}</i>` : ""}`)
    .replace('<div class="card-sub">', `${f("below")}<div class="card-sub">`)
    .replace('<div class="shine">', `<div class="jx-over">${f("over")}</div><div class="shine">`);
}

// przykładowa karta specjalna (na czas budowania HTML), fn(id) - co z nią zrobić
function jxWithMock(base, crate, n, fn) {
  const id = `__jx_${n}`;
  S.cfg.people[id] = Object.assign({}, base, {
    id, rarity: "special", crate: crate.id, crates: [crate.id], number: n, style: 0, fixedVariant: "joker", source: "casino",
    imgAs: base.imgAs || base.id, attack2: base.attack2 || "Specjalny atak", dmg2: base.dmg2 || Math.round(base.dmg * 1.4) });
  try { return fn(id); } finally { delete S.cfg.people[id]; }
}

function jokerProposalsHTML(base, crate) {
  const fam = (f, title) => `<h4 class="jx-fam">${title}</h4><div class="mock-grid">${JOKER_PROPOSALS.map((P, i) => P.family !== f ? "" :
    jxWithMock(base, crate, i + 1, id => `<figure class="mock"><div class="mock-card jx-pick" data-jx="${i + 1}" title="Kliknij, żeby powiększyć">${jxCardHTML(id, i + 1)}</div>
      <figcaption><b>${P.code}. ${esc(P.name)}</b><span class="muted small">${esc(P.desc)}</span></figcaption></figure>`)).join("")}</div>`;
  return `<section class="panel mock-sec jx-sec"><h3>🃏 Propozycje nowego wyglądu Jokerowej <small class="muted">— runda 2: po 3 wersje Talii i Chaosu, kliknij kartę, żeby ją powiększyć</small></h3>
    ${fam("a", "♠ Talia — klasyczna karta do gry")}${fam("d", "🎰 Chaos — szalony Joker w kasynie")}</section>`;
}

// powiększenie propozycji w zwykłym podglądzie karty (openViewer) - ten sam układ co podgląd karty ze skrzynki
function openJokerProposal(base, crate, n) {
  jxWithMock(base, crate, n, id => {
    openViewer(id, "normal");
    const v = document.querySelector(".viewer");
    v.querySelector(".vf-front").innerHTML = jxCardHTML(id, n);
    v.querySelectorAll(".vi-variants, .vi-social").forEach(x => x.remove());   // przykładowa karta znika zaraz po zbudowaniu
    v.querySelector(".vi-rarity").innerHTML = `Propozycja ${JOKER_PROPOSALS[n - 1].code} · <span class="holo-txt">${esc(JOKER_PROPOSALS[n - 1].name)}</span>`;
  });
}
