// Propozycje nowego wyglądu wariantu Jokerowa (makiety /mockups, tylko admini) - 6 osobnych pomysłów do wyboru.
// Karta to zwykła karta z cardHTML (wariant normal) z klasą jx jx-<n> i ozdobami pomysłu: bg - tło pod napisami,
// photo - nakładka na zdjęcie, over - ozdoby nad całą kartą. Wygląd: static/css/joker-proposals.css.
// Czapka i kołnierz błazna to symbole #jk-hat / #jk-collar z templates/index.html (kolory ze zmiennych CSS).
// Po wybraniu jednego pomysłu: przenieść go do wyglądów wariantu (VARIANTS["joker"]["styles"]) i usunąć ten plik.

const jxHat = () => hwUse("jk-hat", "jx-hat");
const jxCollar = () => hwUse("jk-collar", "jx-collar");
const jxLetters = word => word.split("").map(l => `<b>${l}</b>`).join("");

const JOKER_PROPOSALS = [
  {
    name: "Talia", desc: "Prawdziwa karta do gry: kremowy karton, czerwono-czarne indeksy JOKER w rogach, kolory kart pod zdjęciem.",
    bg: () => "",
    photo: () => `${jxHat()}${jxCollar()}`,
    over: () => `<span class="jx-idx tl">${jxLetters("JOKER")}<i>★</i></span><span class="jx-idx br">${jxLetters("JOKER")}<i>★</i></span>`,
  },
  {
    name: "Arlekin", desc: "Pop-art jak z komiksu: ramka w czterech kolorach, wzór w romby, grube czarne kontury i wybuch JOKER!.",
    bg: () => '<i class="jx-diamonds"></i>',
    photo: () => `<i class="jx-halftone"></i>${jxHat()}${jxCollar()}`,
    over: () => '<span class="jx-burst"><b>JOKER!</b></span>',
  },
  {
    name: "Kasyno Noir", desc: "Art déco: czarny aksamit, mieniąca się złota ramka, promienie za zdjęciem, czarno-białe zdjęcie i złota czapka.",
    bg: () => '<i class="jx-rays"></i>',
    photo: () => `${jxHat()}${jxCollar()}${["♠", "♥", "♦", "♣"].map((s, i) => `<i class="jx-suit s${i + 1}">${s}</i>`).join("")}`,
    over: () => "",
  },
  {
    name: "Chaos", desc: "Szalony złoczyńca: neonowa fioletowo-zielona ramka, śmiech HA HA HA w tle, drgające zdjęcie w dwóch kolorach.",
    bg: () => `<i class="jx-ha">${Array.from({ length: 9 }, (_, i) => `<span${i % 2 ? ' class="o"' : ""}>HA HA HA HA HA HA</span>`).join("")}</i>`,
    photo: () => `<i class="jx-duo"></i><i class="jx-scan"></i>${jxHat()}<b class="jx-spray">HA HA HA</b>`,
    over: () => "",
  },
  {
    name: "Cyrk", desc: "Plakat cyrkowy: ramka w pasy namiotu, mrugające żarówki dookoła, stary papier i zdjęcie w łuku z gwiazdami.",
    bg: () => "",
    photo: () => `${jxHat()}${jxCollar()}<i class="jx-star a">★</i><i class="jx-star b">★</i><i class="jx-star c">★</i>`,
    // żarówki dookoła ramki: 8 na górze i dole, 11 po bokach (co druga mruga w innym momencie)
    over: () => {
      const bulb = (x, y, k) => `<i class="jx-bulb${k % 2 ? " odd" : ""}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%"></i>`;
      let out = "", k = 0;
      for (let i = 0; i < 8; i++) { const x = 6 + i * 88 / 7; out += bulb(x, 1.9, k++) + bulb(x, 98.1, k++); }
      for (let i = 1; i < 12; i++) { const y = 1.9 + i * 96.2 / 12; out += bulb(2.7, y, k++) + bulb(97.3, y, k++); }
      return `<span class="jx-bulbs">${out}</span>`;
    },
  },
  {
    name: "Tarot", desc: "Karta tarota „0 · Błazen”: granat i złoto, gwiazdy w tle, zdjęcie w łuku, rzymska cyfra i wstęga z podpisem.",
    bg: () => '<i class="jx-stars"></i>',
    photo: () => `${jxHat()}<b class="jx-num">0</b><i class="jx-moon"></i><b class="jx-ribbon">BŁAZEN</b>`,
    over: () => "",
  },
];

// karta z propozycją n (1-6) - id: przykładowa karta, która jest w S.cfg.people na czas budowania HTML
function jxCardHTML(id, n) {
  const P = JOKER_PROPOSALS[n - 1];
  return cardHTML(id, "normal")
    .replace('class="card ', `class="card jx jx-${n} `)
    .replace('<div class="card-inner">', `<div class="card-inner"><div class="jx-bg">${P.bg()}</div>`)
    .replace(/(<div class="card-photo"><img[^>]*>)/, `$1<i class="jx-photo">${P.photo()}</i>`)
    .replace('<div class="shine">', `<div class="jx-over">${P.over()}</div><div class="var-tag jx-vt">🃏 JOKER</div><div class="shine">`);
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
  const cards = JOKER_PROPOSALS.map((P, i) => jxWithMock(base, crate, i + 1, id =>
    `<figure class="mock"><div class="mock-card jx-pick" data-jx="${i + 1}" title="Kliknij, żeby powiększyć">${jxCardHTML(id, i + 1)}</div>
      <figcaption><b>${String.fromCharCode(65 + i)}. ${esc(P.name)}</b><span class="muted small">${esc(P.desc)}</span></figcaption></figure>`)).join("");
  return `<section class="panel mock-sec jx-sec"><h3>🃏 Propozycje nowego wyglądu Jokerowej <small class="muted">— 6 pomysłów do wyboru (A–F), kliknij kartę, żeby ją powiększyć</small></h3>
    <div class="mock-grid">${cards}</div></section>`;
}

// powiększenie propozycji w zwykłym podglądzie karty (openViewer) - ten sam układ co podgląd karty ze skrzynki
function openJokerProposal(base, crate, n) {
  jxWithMock(base, crate, n, id => {
    openViewer(id, "normal");
    const v = document.querySelector(".viewer");
    v.querySelector(".vf-front").innerHTML = jxCardHTML(id, n);
    v.querySelectorAll(".vi-variants, .vi-social").forEach(x => x.remove());   // przykładowa karta znika zaraz po zbudowaniu
    v.querySelector(".vi-rarity").innerHTML = `Propozycja ${String.fromCharCode(64 + n)} · <span class="holo-txt">${esc(JOKER_PROPOSALS[n - 1].name)}</span>`;
  });
}
