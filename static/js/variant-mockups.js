"use strict";
// Propozycje nowych wariantów (strona /variants, zakładka „Propozycje”) - makiety do wyboru, jeszcze NIE w grze.
// Każda makieta = zwykła karta + klasy vm-<wariant> vm-<wariant>-<nr> (static/css/variant-mockups.css) i ozdoby:
// bg (tło w środku karty, pod napisami), photo (na zdjęciu), deco (nad całą kartą), top (w środku karty nad nazwą),
// sub (tekst zamiast "typ · skrzynka") - vrProposalCard w variants.js. cls - klasy pożyczone z istniejącego wariantu.
// Po wyborze wygląd przechodzi do cards2.css / app.js jako prawdziwy wariant, a jego makiety stąd znikają.

const vmN = (a, b, d = 0) => rand(a, b).toFixed(d);
const vmPick = arr => arr[Math.floor(Math.random() * arr.length)];
const vmSvg = (body, vb = "0 0 63 88", cls = "", par = "none") =>
  `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="${par}" aria-hidden="true">${body}</svg>`;
// unoszące się bąbelki / iskry: losowe miejsce, wielkość i opóźnienie
const vmFloat = (n, cls, x = [4, 92]) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${vmN(...x)}%;--s:${vmN(0.5, 1.6, 2)};animation-delay:-${vmN(0, 9, 1)}s;animation-duration:${vmN(5, 11, 1)}s"></i>`).join("");
// unikalne id gradientów SVG - ta sama makieta jest w siatce i w powiększeniu, a ukryta siatka "zabiera" gradient
let vmUid = 0;
const vmId = name => `${name}${++vmUid}`;
const vmGlints = n => `<span class="vm-glints">${Array.from({ length: n }, () =>
  `<i style="left:${vmN(6, 90)}%;top:${vmN(6, 88)}%;animation-delay:-${vmN(0, 4, 1)}s"></i>`).join("")}</span>`;

// filtry SVG wspólne dla makiet - w <body>, poza <main> (nakładka powiększenia chowa <main>):
// vmGoo - zlewające się krople (metaballe), vmWobble - falujące krawędzie, vmPixel - piksele / mozaika
document.body.insertAdjacentHTML("beforeend", `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="vmGoo"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/>
    <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter>
  <filter id="vmWobble"><feTurbulence type="fractalNoise" baseFrequency=".025" numOctaves="2" seed="3">
    <animate attributeName="baseFrequency" dur="9s" values=".025;.034;.025" repeatCount="indefinite"/></feTurbulence>
    <feDisplacementMap in="SourceGraphic" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter>
  <filter id="vmPixel" x="0" y="0" width="100%" height="100%"><feFlood x="2" y="2" height="1" width="1"/><feComposite width="5" height="5"/>
    <feTile result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/><feMorphology operator="dilate" radius="2"/></filter>
</svg>`);

// ---------------------------------------------------------------- kształty SVG
// kapiący płyn z górnej krawędzi (losowe sople) - kształt w jednostkach karty 63 x 88
function vmDrips(color = "#7dff3a", hi = "#d4ffb0", long = [7, 18]) {
  let d = "M0 0 H63 V3 ", x = 63;
  while (x > 0) {
    const w = +vmN(3, 7, 1), len = Math.random() < 0.45 ? +vmN(...long, 1) : +vmN(3.5, 6, 1), nx = Math.max(0, x - w);
    const mid = (x + nx) / 2, r = Math.min(w / 2, 2.2);
    d += `L${x.toFixed(1)} 3 C${(x - w * .15).toFixed(1)} 3.5 ${(mid + r).toFixed(1)} ${(len - r * 2).toFixed(1)} ${(mid + r).toFixed(1)} ${(len - r).toFixed(1)} ` +
      `A${r} ${r} 0 0 1 ${(mid - r).toFixed(1)} ${(len - r).toFixed(1)} C${(mid - r).toFixed(1)} ${(len - r * 2).toFixed(1)} ${(nx + w * .15).toFixed(1)} 3.5 ${nx.toFixed(1)} 3 `;
    x = nx - +vmN(1, 4, 1);
  }
  d += "L0 3 Z";
  return `<path d="${d}" fill="${color}"/><path d="${d}" fill="none" stroke="${hi}" stroke-width=".35" opacity=".7" transform="translate(-.4 -.5)"/>`;
}
// fala płynu (powierzchnia) na wysokości y, od lewej do prawej krawędzi, zamknięta do dołu karty
const vmWave = (y, amp = 1.6) => `M-1 ${y} Q7 ${y - amp} 15 ${y} T31 ${y} T47 ${y} T63 ${y} L64 ${y} V90 H-1 Z`;
// koło z numerem startowym (numer karty w skrzynce)
const vmRoundel = (p, cls) => `<div class="vm-roundel ${cls}"><b>${p?.number || 7}</b></div>`;
// schodkowy kryształ bizmutu: zagnieżdżone kwadraty (lejkowaty wzrost), w kolorach tlenku
const BI_COLS = ["#ff4fb5", "#ffd23f", "#3fe0ff", "#7a5cff", "#4dff9a", "#ff8a3f", "#c34dff", "#3f8cff"];
function vmHopper(g, cx, cy, size, steps, rot = 0) {
  let out = `<g transform="rotate(${rot} ${cx} ${cy})">`;
  const off = Math.floor(rand(0, BI_COLS.length));
  for (let k = 0; k < steps; k++) {   // każdy schodek: kolor tlenku + gradient (jasna krawędź u góry, ciemna u dołu)
    const s = size * (1 - k / steps), c = BI_COLS[(k + off) % BI_COLS.length], x = cx - s / 2, y = cy - s / 2, w = s.toFixed(2);
    out += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${w}" fill="${c}"/>` +
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${w}" fill="url(#${g})"/>` +
      `<path d="M${x.toFixed(2)} ${(y + s).toFixed(2)} V${y.toFixed(2)} H${(x + s).toFixed(2)}" fill="none" stroke="#ffffffcc" stroke-width=".35"/>` +
      `<path d="M${(x + s).toFixed(2)} ${y.toFixed(2)} V${(y + s).toFixed(2)} H${x.toFixed(2)}" fill="none" stroke="#0007" stroke-width=".45"/>`;
  }
  return out + "</g>";
}
const vmStepGrad = g => `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/>
  <stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>`;
// kryształy bizmutu na całym tle: siatka zachodzących na siebie kryształów (bez pustych miejsc), z lekkim obrotem
function vmHopperField(g, cell, jitter, rot) {
  let out = vmStepGrad(g);
  for (let y = -cell / 2; y < 88 + cell; y += cell * .8)
    for (let x = -cell / 2; x < 63 + cell; x += cell * .8)
      out += vmHopper(g, x + rand(-jitter, jitter), y + rand(-jitter, jitter), cell * rand(1, 1.35), 6 + Math.floor(rand(0, 3)), rand(-rot, rot));
  return out;
}
// tęcza: łuki od czerwieni do fioletu
function vmRainbow(cx, cy, r, w = 2.2, op = .75) {
  return ["#ff3b3b", "#ff9a1f", "#ffe13b", "#4fd12a", "#2fa8ff", "#5a4dff", "#b04dff"].map((c, k) => {
    const rr = r - k * w;
    return `<path d="M${cx - rr} ${cy} A${rr} ${rr} 0 0 1 ${cx + rr} ${cy}" fill="none" stroke="${c}" stroke-width="${w + .1}" opacity="${op}"/>`;
  }).join("");
}
// ryba płynąca w prawo (viewBox 0 0 40 24): ogon, płetwa, połysk, oko; stripes - białe paski jak u błazenka
function vmFish(c1, c2, stripes = false) {
  return `<svg viewBox="0 0 40 24" aria-hidden="true"><path d="M10 12 L1 3 L4 12 L1 21 Z" fill="${c2}"/><path d="M17 5 Q23 -2 30 5 Z" fill="${c2}"/>
    <ellipse cx="22" cy="12" rx="14" ry="8.5" fill="${c1}"/>${stripes ? `<ellipse cx="18" cy="12" rx="1.7" ry="8" fill="#fff"/><ellipse cx="27" cy="12" rx="1.5" ry="7.3" fill="#fff"/>` : ""}
    <ellipse cx="22" cy="8" rx="10" ry="3" fill="#fff" opacity=".35"/><circle cx="31" cy="10" r="1.8" fill="#fff"/><circle cx="31.5" cy="10" r=".9" fill="#111"/></svg>`;
}
// delfin wyskakujący z wody (viewBox 0 0 100 50, płynie w prawo)
function vmDolphin(c = "#2f8fd8", belly = "#bfe6ff") {
  return `<svg viewBox="0 0 100 50" aria-hidden="true"><path d="M50 11 C52 4 56 1 62 0 C60 4 59 8 60 12 Z" fill="${c}"/>
    <path d="M4 34 C14 18 36 8 60 10 C70 11 78 14 84 18 L96 16 C94 20 90 22 86 23 C84 27 79 30 72 31 L74 38 L66 32 C54 34 40 34 28 36 C24 38 20 42 14 46 C15 41 16 38 17 36 C12 37 7 37 4 34 Z" fill="${c}"/>
    <path d="M30 33 C46 30 62 30 80 25 C74 30 60 33 30 35 Z" fill="${belly}" opacity=".85"/><path d="M24 22 C40 12 60 11 78 16" fill="none" stroke="#fff" stroke-width="2" opacity=".45" stroke-linecap="round"/>
    <circle cx="80" cy="19" r="1.2" fill="#0b2a44"/></svg>`;
}
// panorama miasta nocą (cyberpunk): budynki z losowymi neonowymi oknami, od dołu karty
function vmSkyline(base = 88, colors = ["#ff2bd6", "#00e5ff", "#fcee0a"]) {
  let out = "", x = -1;
  while (x < 64) {
    const w = rand(4, 9), h = rand(12, 38);
    out += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#0b0618"/>`;
    for (let yy = base - h + 1.5; yy < base - 1; yy += 2.4)
      for (let xx = x + 1; xx < x + w - 1; xx += 1.8)
        if (Math.random() < 0.28) out += `<rect x="${xx.toFixed(1)}" y="${yy.toFixed(1)}" width=".9" height="1.1" fill="${vmPick(colors)}" opacity="${vmN(.5, 1, 2)}"/>`;
    if (Math.random() < 0.3) out += `<rect x="${(x + w / 2 - .15).toFixed(1)}" y="${(base - h - 5).toFixed(1)}" width=".3" height="5" fill="#0b0618"/><circle cx="${(x + w / 2).toFixed(1)}" cy="${(base - h - 5).toFixed(1)}" r=".5" fill="#ff003c"/>`;
    x += w + rand(-.5, 1);
  }
  return out;
}
// deszcz znaków jak w "Matrixie": kolumny znaków lecące z góry na dół (najjaśniejszy znak na dole kolumny)
const VM_KATA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789Z:.=*+-<>¦";
function vmRain(n, chars = VM_KATA) {
  return Array.from({ length: n }, (_, k) => {
    const txt = Array.from({ length: 10 + Math.floor(rand(0, 14)) }, () => esc(vmPick(chars))).join("<br>");
    return `<i class="dg-col" style="left:${(k / n * 100 + rand(-1, 1)).toFixed(1)}%;animation-duration:${vmN(4, 9, 1)}s;animation-delay:-${vmN(0, 9, 1)}s;font-size:${vmN(2.6, 3.8, 1)}cqw">${txt}</i>`;
  }).join("");
}
const vmBinary = n => Array.from({ length: n }, () => (Math.random() < .5 ? 0 : 1)).join("");
// sylwetki (sztuka afrykańska): kobieta niosąca dzban na głowie, akacja, żyrafa, słoń, bębniarz - w jednostkach własnego viewBox
const AF_WOMAN = `<ellipse cx="5" cy="2.6" rx="2.6" ry="1.5"/><path d="M3.6 3.9 H6.4 L6 4.6 H4 Z"/><circle cx="5" cy="6.2" r="1.5"/><path d="M4.4 7.6 H5.6 L5.8 8.6 H4.2 Z"/>
  <path d="M3.4 8.6 C2.2 13 1.6 19 .4 26 L9.6 26 C8.4 19 7.8 13 6.6 8.6 Z"/><path d="M6.4 9 L8 6.6 L7.4 4.6" fill="none" stroke-width=".9" stroke-linecap="round"/>`;
const AF_ACACIA = `<path d="M19 30 L20 17 L13 10.5 M20 17 L27.5 9.5 M20 19 L23 12" fill="none" stroke-width="1.3" stroke-linecap="round"/>
  <path d="M1 9.5 C7 3 33 2 39 8.5 C31 11.5 9 11.5 1 9.5 Z"/>`;
const AF_GIRAFFE = `<path d="M7 25 C7 21 19 20 21 23 L21 26 C17 27 11 27 7 26 Z"/><path d="M19 22.5 L23.4 5 L25.4 5.2 L22.2 23.5 Z"/>
  <path d="M23 4.6 C24.5 3.4 27.5 4 29.6 5.6 L29 7.2 C27 7 25 6.8 23.6 6.6 Z"/><path d="M24 4.4 L23.6 2.2 M25.4 4.2 L25.4 2" fill="none" stroke-width=".6"/>
  <path d="M8 25 L7.2 38 M10.5 26 L10.8 38 M18 26 L17.6 38 M20.5 25.5 L21.4 38" fill="none" stroke-width="1.3" stroke-linecap="round"/><path d="M7.2 24 C5 25 4.5 28 4 30" fill="none" stroke-width=".6"/>`;
const AF_ELEPHANT = `<path d="M6 10 C8 3 26 2 30 9 C32 13 31 17 29 19 L29 27 L25.5 27 L25 20 L13 20 L12.5 27 L9 27 L9 19 C6.5 17 5.4 13.5 6 10 Z"/>
  <path d="M28 7 C33 5 37 8 36.5 13 C36 18 35 22 37 25.5 L35 26 C32.6 22 33 17 32 14 Z"/><path d="M27 8 C24 9 23.5 15 27 17 C29 15 29.5 10 27 8 Z" opacity=".75"/>
  <path d="M35.5 15.5 L39.5 16.5" fill="none" stroke-width=".8" stroke-linecap="round"/>`;
const AF_DRUMMER = `<circle cx="9" cy="3" r="2"/><path d="M7.2 5.2 C5.5 9 5 13 5.5 17 L10.5 17 C11 13 10.8 9 10.4 5.2 Z"/>
  <path d="M10 7 L14.6 10.5 M7.4 7 L4.4 10.8" fill="none" stroke-width="1.1" stroke-linecap="round"/><path d="M5.5 17 L4 26 M10.2 17 L12 26" fill="none" stroke-width="1.3" stroke-linecap="round"/>
  <path d="M13 11 H19 L18 24 H14 Z"/><ellipse cx="16" cy="11" rx="3" ry=".9" fill="#f5b04a"/>`;
// chiński smok: wijące się ciało (złote łuski), grzbiet, głowa z rogami i wąsami - w jednostkach karty
function vmDragon(g) {
  const body = "M57 84 C66 66 46 68 38 60 C26 48 62 50 58 32 C55 18 30 26 22 22 C14 18 12 12 9 9";
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset=".5" stop-color="#e2b13c"/><stop offset="1" stop-color="#9a6a10"/></linearGradient></defs>
    <path d="${body}" fill="none" stroke="#7a0a0a" stroke-width="6.2" stroke-linecap="round"/>
    <path d="${body}" fill="none" stroke="url(#${g})" stroke-width="5" stroke-linecap="round"/>
    <path d="${body}" fill="none" stroke="#9a6a10" stroke-width="3.6" stroke-dasharray=".7 1.1" stroke-linecap="round" opacity=".8"/>
    <path d="${body}" fill="none" stroke="#fff2b0" stroke-width="7.4" stroke-dasharray=".4 2.6" opacity=".9" transform="translate(-.6 -1.2)"/>
    <g transform="translate(9 9) rotate(-35)"><path d="M-6 -2.2 C-2 -4.6 3 -3.8 5 -1.4 C6 0 5.6 2 4 2.6 C1 3.6 -3 3 -6 1.6 Z" fill="url(#${g})" stroke="#7a0a0a" stroke-width=".4"/>
      <path d="M2 -3.4 L4.6 -8 M0 -3.6 L1 -7.4" stroke="#e2b13c" stroke-width=".8" stroke-linecap="round"/><circle cx="2.4" cy="-1" r=".8" fill="#7a0a0a"/>
      <path d="M-5.6 1.4 C-9 3 -11 1 -13 3.6 M-5.6 0 C-9.4 -1 -11 -3.6 -13.6 -2.4" fill="none" stroke="#fff2b0" stroke-width=".45" stroke-linecap="round"/></g>`;
}
// chiński lampion na sznurku (x, długość sznurka) - w jednostkach karty
function vmLantern(x, len, s = 1) {
  const y = len + 5 * s;
  return `<path d="M${x} -1 V${len}" stroke="#e2b13c" stroke-width=".3"/><rect x="${x - 2 * s}" y="${len}" width="${4 * s}" height="${1.1 * s}" fill="#e2b13c"/>
    <ellipse cx="${x}" cy="${y + .6 * s}" rx="${4.6 * s}" ry="${5 * s}" fill="#d81e1e"/><ellipse cx="${x}" cy="${y + .6 * s}" rx="${2.4 * s}" ry="${5 * s}" fill="none" stroke="#a30d0d" stroke-width=".35"/>
    <ellipse cx="${x - 1.6 * s}" cy="${y - 1 * s}" rx="${1.2 * s}" ry="${2.4 * s}" fill="#ff8a6a" opacity=".5"/>
    <rect x="${x - 2 * s}" y="${y + 5.2 * s}" width="${4 * s}" height="${1.1 * s}" fill="#e2b13c"/><path d="M${x - 1 * s} ${y + 6.3 * s} V${y + 10 * s} M${x} ${y + 6.3 * s} V${y + 10.8 * s} M${x + 1 * s} ${y + 6.3 * s} V${y + 10 * s}" stroke="#e2b13c" stroke-width=".35"/>`;
}
// chmurki xiangyun (złote zawijasy) w jednostkach karty
const vmCloud = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 4 C0 1 3 0 4.4 1.6 C5 -.4 9 -.6 9.6 1.8 C11.6 1 13.6 2.6 12.8 4.6 Z M3 3.4 a1.2 1.2 0 1 1 2 .2 M8 2.8 a1.1 1.1 0 1 1 1.8 .4" fill="none" stroke="#e2b13c" stroke-width=".55" stroke-linecap="round"/>`;
// pęknięcia złotem (kintsugi): poszarpana linia od krawędzi do krawędzi z odgałęzieniem
function vmCrack(x1, y1, x2, y2) {
  let d = `M${x1} ${y1}`, br = "";
  for (let k = 1; k <= 9; k++) {
    const t = k / 9, x = x1 + (x2 - x1) * t + rand(-3, 3), y = y1 + (y2 - y1) * t + rand(-3, 3);
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    if (k === 4 || k === 7) br += `M${x.toFixed(1)} ${y.toFixed(1)} l${vmN(-7, 7, 1)} ${vmN(-6, 6, 1)} l${vmN(-4, 4, 1)} ${vmN(-4, 4, 1)}`;
  }
  return `<path d="${d} ${br}" fill="none" stroke="#f5d06b" stroke-width=".55" stroke-linejoin="round"/>`;
}
// dziury w serze (w %): różne wielkości, rozrzucone po całym tle
const vmHoles = (n, big = [6, 16]) => Array.from({ length: n }, () =>
  `<i class="ch-hole" style="left:${vmN(-4, 92)}%;top:${vmN(-3, 95)}%;width:${vmN(...big, 1)}%"></i>`).join("");

// ---------------------------------------------------------------- PROPOZYCJE

const VARIANT_PROPOSALS = [
  {
    key: "slime", name: "Szlamowa", icon: "🟢", tag: "🟢 SLIME",
    about: "poprawiona: jak „Kapiący szlam”, zdjęcie lekko zielone, cała karta bardziej jak płyn (płynąca faktura, krople, połysk)",
    looks: [
      { name: "Spływający szlam", desc: "Szlam kapie z góry i powoli spływa po całej karcie, zdjęcie lekko zielone w miękkiej, falującej ramce z glutu.",
        bg: () => `<div class="vm-bg"><i class="sl-flow"></i></div>`, photo: () => `<i class="vm-photo sl-tint"></i>`,
        deco: () => `<div class="vm-deco sl-drip">${vmSvg(vmDrips())}${Array.from({ length: 3 }, () =>
          `<i class="sl-drop" style="left:${vmN(10, 85)}%;animation-delay:-${vmN(0, 4, 1)}s"></i>`).join("")}</div>` },
      { name: "Lampa z glutem", desc: "W środku karty duże krople szlamu wolno unoszą się i zlewają ze sobą jak w lampie lava; z góry kapie glut.",
        bg: () => `<div class="vm-bg"><span class="sl-goo">${Array.from({ length: 11 }, () =>
          `<i style="left:${vmN(-5, 80)}%;width:${vmN(20, 38)}%;animation-delay:-${vmN(0, 14, 1)}s;animation-duration:${vmN(10, 16, 1)}s"></i>`).join("")}</span></div>`,
        photo: () => `<i class="vm-photo sl-tint"></i>`, deco: () => `<div class="vm-deco sl-drip">${vmSvg(vmDrips("#7dff3a", "#d4ffb0", [5, 10]))}</div>` },
      { name: "Zalana karta", desc: "Dolna część karty pływa w półprzezroczystym szlamie z falującą powierzchnią i bąbelkami, zdjęcie zanurza się od dołu.",
        photo: () => `<i class="vm-photo sl-tint sub"></i>`,
        deco: () => `<div class="vm-deco sl-flood">${vmSvg(`<path d="${vmWave(60)}" fill="#8cf04a44"/><path d="${vmWave(61.5, 1.2)}" fill="#3fbf1a40"/>`, "0 0 63 88", "sl-wave")}
          ${vmFloat(9, "sl-bub low", [6, 90])}</div>
          <div class="vm-deco sl-drip">${vmSvg(vmDrips("#7dff3a", "#d4ffb0", [5, 9]))}</div>` },
      { name: "Glutowa ramka", desc: "Cała ramka to falujący, błyszczący glut, który kapie także spod karty; środek jak jasnozielona galareta.",
        bg: () => `<div class="vm-bg"><i class="sl-flow light"></i></div>`, photo: () => `<i class="vm-photo sl-tint"></i>`,
        deco: () => `<div class="vm-deco sl-gooframe">${vmSvg(`<rect x="1.3" y="1.3" width="60.4" height="85.4" rx="3.5" fill="none" stroke="#5dd61c" stroke-width="3.2"/>` +
          vmDrips("#5dd61c", "#d4ffb0", [6, 12]))}${vmSvg(vmDrips("#5dd61c", "#d4ffb0", [5, 9]), "0 0 63 88", "sl-bottom")}</div>` },
    ],
  },
  {
    key: "matte", name: "Matowa czerń", icon: "🖤", tag: "MATTE",
    about: "poprawiona: jak „Mat + połysk” - błysk przesuwający się po nazwie - z wyraźniejszą fakturą",
    looks: [
      { name: "Mat + lakier", desc: "Aksamitna czerń z wyraźnym ziarnem soft-touch, lakierowane ukośne pasy i błysk przesuwający się po nazwie i ramce zdjęcia.",
        bg: () => `<div class="vm-bg"><i class="mb-gloss-pat"></i></div>` },
      { name: "Karbon", desc: "Matowe włókno węglowe (splot karbonu), po którym przesuwa się błysk; nazwa z tym samym błyskiem.",
        bg: () => `<div class="vm-bg"><i class="mb-carbon"></i><i class="mb-sweep"></i></div>` },
      { name: "Czarna skóra", desc: "Ziarnista czarna skóra z przeszyciem wzdłuż brzegu i wytłoczonym zdjęciem; błysk na nazwie.",
        bg: () => `<div class="vm-bg"><i class="mb-leather"></i></div>`, deco: () => `<div class="vm-deco"><i class="mb-stitch"></i></div>` },
      { name: "Tłoczony wzór", desc: "Czerń z wytłoczonym wzorem plastra miodu - widać go tylko, gdy przesuwa się po nim światło (jak po nazwie).",
        bg: () => `<div class="vm-bg"><i class="mb-hex"></i><i class="mb-hex lit"></i></div>` },
    ],
  },
  {
    key: "aero", name: "Frutiger Aero", icon: "🫧", tag: "🫧 AERO",
    about: "poprawiona: jak „Niebo i trawa” + ryby, delfiny, tęcze, bańki i szkło",
    looks: [
      { name: "Tęcza nad doliną", desc: "Błękitne niebo z tęczą i chmurami, zielone wzgórze, błysk słońca i bańki mydlane lecące nad kartą.",
        bg: () => `<div class="vm-bg ae-sky">${vmSvg(vmRainbow(31.5, 62, 34, 2.4, .55), "0 0 63 88", "ae-rainbow")}<i class="ae-cloud c1"></i><i class="ae-cloud c2"></i><i class="ae-hill"></i><i class="ae-flare"></i></div>`,
        deco: () => `<div class="vm-deco">${vmFloat(7, "ae-bubble")}</div>`, photo: () => `<i class="vm-photo ae-glass"></i>` },
      { name: "Delfiny", desc: "Niebo nad morzem, a na dole delfiny wyskakujące z wody w błyszczących kroplach, z małą tęczą w bryzie.",
        bg: () => `<div class="vm-bg ae-sea">${vmSvg(vmRainbow(48, 70, 14, 1.2, .6), "0 0 63 88", "ae-rainbow")}<i class="ae-cloud c1"></i><i class="ae-water"></i></div>`,
        deco: () => `<div class="vm-deco"><i class="ae-dolphin d1">${vmDolphin()}</i><i class="ae-dolphin d2">${vmDolphin("#1f7cc4")}</i>${vmFloat(5, "ae-bubble small")}</div>`,
        photo: () => `<i class="vm-photo ae-glass"></i>` },
      { name: "Rybki w akwarium", desc: "Podwodny świat: kolorowe rybki przepływają przez kartę, promienie światła, wodorosty i bąbelki.",
        bg: () => `<div class="vm-bg ae-under"><i class="ae-rays"></i><i class="ae-weed w1"></i><i class="ae-weed w2"></i>${vmFloat(10, "ae-bubble small")}</div>`,
        deco: () => `<div class="vm-deco">${[["#ff7a1f", "#ff9a3f", true], ["#2f6bff", "#ffd23f"], ["#ffd23f", "#2fa8ff"], ["#ff4fa0", "#7a5cff"]].map(([a, b, s], k) =>
          `<i class="ae-fish f${k + 1}" style="animation-delay:-${vmN(0, 12, 1)}s">${vmFish(a, b, s)}</i>`).join("")}</div>`,
        photo: () => `<i class="vm-photo ae-glass"></i>` },
      { name: "Ryby w chmurach", desc: "Surrealistycznie jak tapety z 2008: rybki pływają po niebie między chmurami i bańkami, w tle tęcza.",
        bg: () => `<div class="vm-bg ae-sky">${vmSvg(vmRainbow(10, 40, 26, 1.8, .45), "0 0 63 88", "ae-rainbow")}<i class="ae-cloud c1"></i><i class="ae-cloud c2"></i><i class="ae-cloud c3"></i></div>`,
        deco: () => `<div class="vm-deco">${[["#ff7a1f", "#ffb03f", true], ["#ffd23f", "#2fa8ff"], ["#3fe0c0", "#2f6bff"]].map(([a, b, s], k) =>
          `<i class="ae-fish f${k + 1} sky" style="animation-delay:-${vmN(0, 12, 1)}s">${vmFish(a, b, s)}</i>`).join("")}${vmFloat(6, "ae-bubble")}</div>`,
        photo: () => `<i class="vm-photo ae-glass"></i>` },
    ],
  },
  {
    key: "racing", name: "Wyścigowa retro", icon: "🏁", tag: "🏁 RETRO",
    about: "poprawiona: szachownica w retro czerwieni i bieli, klimat Grand Prix Monako i czerwonych bolidów z lat 50., białe koło z numerem",
    looks: [
      { name: "Rosso corsa", desc: "Karoseria w spranej wyścigowej czerwieni, kremowe koło z numerem jak na drzwiach i szachownica przez róg karty.",
        bg: () => `<div class="vm-bg"><i class="rc-grain"></i><i class="rc-check corner"></i><i class="rc-pin"></i></div>`, deco: p => `<div class="vm-deco">${vmRoundel(p, "big")}</div>` },
      { name: "Grand Prix Monte-Carlo", desc: "Plakat wyścigu z lat 50.: kremowy papier, pasy czerwony-biały-czerwony, powiewająca flaga w szachownicę i napis Grand Prix.",
        top: () => `<div class="rc-poster-top">GRAND PRIX · MONTE-CARLO</div>`, sub: () => "XV GRAND PRIX AUTOMOBILE · 1957",
        bg: () => `<div class="vm-bg"><i class="rc-tri"></i><i class="rc-grain"></i></div>`,
        deco: p => `<div class="vm-deco"><i class="rc-flag"></i>${vmRoundel(p, "")}</div>` },
      { name: "Szachownica", desc: "Ramka w czerwono-kremową szachownicę, przez środek pas czerwony-biały-czerwony i duże białe koło z numerem.",
        bg: () => `<div class="vm-bg"><i class="rc-band"></i><i class="rc-grain"></i></div>`, deco: p => `<div class="vm-deco">${vmRoundel(p, "")}</div>` },
      { name: "Czerwony bolid", desc: "Jak czerwony sportowy bolid z lat 50.: opływowe błotniki, chromowana listwa, białe koło z numerem na boku i szachownica na dole.",
        bg: () => `<div class="vm-bg">${vmSvg(`<path d="M-2 70 C10 58 22 58 30 66 C38 58 52 58 65 70 V90 H-2 Z" fill="#a50d14"/><path d="M-2 70 C10 58 22 58 30 66 C38 58 52 58 65 70" fill="none" stroke="#e8e2d8" stroke-width=".6"/>`)}<i class="rc-check rc-strip"></i><i class="rc-grain"></i></div>`,
        deco: p => `<div class="vm-deco">${vmRoundel(p, "side")}<span class="rc-badge">V12 · 3.0</span></div>` },
    ],
  },
  {
    key: "bismuth", name: "Bizmutowa", icon: "🌈", tag: "🌈 BISMUTH",
    about: "poprawiona: jak „Kryształ schodkowy”, ale kryształy wypełniają całe tło",
    looks: [
      { name: "Pole kryształów", desc: "Całe tło pokryte schodkowymi kryształami bizmutu w kolorach tlenku, zachodzącymi na siebie, z obracającą się tęczową ramką.",
        bg: () => { const g = vmId("biStep"); return `<div class="vm-bg bi-full">${vmSvg(vmHopperField(g, 15, 2.5, 18))}</div>`; },
        photo: () => `<i class="vm-photo bi-oxide"></i>` },
      { name: "Kryształowa siatka", desc: "Równa siatka schodkowych kryształów jak powierzchnia kryształu widziana z góry; kolory tlenku powoli się zmieniają.",
        bg: () => { const g = vmId("biStep"); let s = vmStepGrad(g);
          for (let y = 0; y < 96; y += 12.6) for (let x = 0; x < 70; x += 12.6) s += vmHopper(g, x + 6.3, y + 6.3, 12.6, 6);
          return `<div class="vm-bg bi-full bi-shift">${vmSvg(s)}</div>`; },
        photo: () => `<i class="vm-photo bi-oxide flow"></i>` },
      { name: "Schodki 3D", desc: "Trójwymiarowe schodki kryształu (izometryczne sześciany) na całym tle, mieniące się tęczowo.",
        bg: () => `<div class="vm-bg"><i class="bi-iso"></i><i class="bi-iso-tint"></i></div>`, photo: () => `<i class="vm-photo bi-oxide"></i>` },
      { name: "Jeden wielki kryształ", desc: "Cała karta to jeden ogromny schodkowy kryształ - kwadraty od środka aż po brzegi, zdjęcie w samym środku.",
        bg: () => { const g = vmId("biStep"); return `<div class="vm-bg bi-full">${vmSvg(vmStepGrad(g) + vmHopper(g, 31.5, 33, 150, 26, 9))}</div>`; },
        photo: () => `<i class="vm-photo bi-oxide"></i>` },
    ],
  },
  {
    key: "digital", name: "Cyfrowa", icon: "💻", tag: "💻 DIGITAL",
    about: "zielone znaki lecące przez ekran jak w Matrixie i filmowi hakerzy",
    looks: [
      { name: "Deszcz kodu", desc: "Kolumny zielonych znaków lecą przez całą kartę, także przez zdjęcie w zielonym monitorze z liniami ekranu.",
        bg: () => `<div class="vm-bg dg-screen">${vmRain(14)}</div>`, photo: () => `<i class="vm-photo dg-crt"></i>`,
        deco: () => `<div class="vm-deco dg-front">${vmRain(9)}</div>` },
      { name: "Terminal hakera", desc: "Karta jak okno terminala: pasek tytułu, komendy, migający kursor i zdjęcie z pikseli w zielonym monitorze.",
        top: () => `<div class="dg-bar"><i></i><i></i><i></i><span>root@scambox: ~/hack</span></div>`, sub: () => `$ ./access --target <b>ACCESS GRANTED</b>`,
        photo: () => `<i class="vm-photo dg-crt"></i>` },
      { name: "Binarny", desc: "Tło z zer i jedynek, zdjęcie rozbite na zielone piksele, a przez kartę przechodzi linia skanowania.",
        bg: () => `<div class="vm-bg"><i class="dg-bin">${vmBinary(900)}</i></div>`, photo: () => `<i class="vm-photo dg-crt"></i><i class="vm-photo dg-scan"></i>`,
        deco: () => `<div class="vm-deco"><i class="dg-scanline"></i></div>` },
      { name: "Włamanie", desc: "Czerwone ostrzeżenie SYSTEM BREACH, zdjęcie rwie się jak zakłócony obraz, w tle słaby deszcz kodu.",
        bg: () => `<div class="vm-bg dg-screen dim">${vmRain(10)}</div>`, sub: () => "⚠ SYSTEM BREACH ⚠",
        photo: p => `<img class="vm-photo dg-slice s1" src="${imgUrl(p.id)}" alt=""><img class="vm-photo dg-slice s2" src="${imgUrl(p.id)}" alt=""><i class="vm-photo dg-crt red"></i>` },
    ],
  },
  {
    key: "cyber", name: "Cyberpunk", icon: "🌃", tag: "🌃 CYBER",
    about: "neony, nocne miasto, żółto-czarne interfejsy, zakłócenia i hologramy",
    looks: [
      { name: "Neonowe miasto", desc: "Nocne miasto z neonowymi oknami, deszcz w świetle różu i błękitu, zdjęcie w dwóch neonowych kolorach.",
        bg: () => `<div class="vm-bg cp-sky">${vmSvg(vmSkyline())}<i class="cp-rain"></i></div>`, photo: () => `<i class="vm-photo cp-duo"></i>` },
      { name: "Żółty interfejs", desc: "Krzykliwa żółć i czerń, ścięte rogi, czerwone akcenty i ramki celownika jak w interfejsie z gry.",
        top: () => `<div class="cp-hud-top"><span>// NETRUNNER</span><span>ID-${Math.floor(rand(1000, 9999))}</span></div>`,
        deco: () => `<div class="vm-deco"><i class="cp-corner tl"></i><i class="cp-corner tr"></i><i class="cp-corner bl"></i><i class="cp-corner br"></i><i class="cp-barcode"></i></div>` },
      { name: "Zakłócenia", desc: "Zdjęcie rozjeżdża się na czerwony i błękitny kanał, przeskakują pasy zakłóceń, a ekran ma linie jak stary monitor.",
        photo: p => `<img class="vm-photo cp-ch r" src="${imgUrl(p.id)}" alt=""><img class="vm-photo cp-ch c" src="${imgUrl(p.id)}" alt=""><i class="vm-photo cp-lines"></i>`,
        deco: () => `<div class="vm-deco"><i class="cp-glitchbar"></i></div>` },
      { name: "Hologram", desc: "Ciemny fiolet z pionowymi neonowymi szyldami, a postać jak migoczący błękitny hologram.",
        bg: () => `<div class="vm-bg cp-dark"><i class="cp-sign s1">サイバー</i><i class="cp-sign s2">ネオン</i></div>`,
        photo: () => `<i class="vm-photo cp-holo"></i>` },
    ],
  },
  {
    key: "fade", name: "Gradient", icon: "🎨", tag: "🎨 FADE",
    about: "płynne przejście kolorów jak popularny skin „Fade”",
    looks: [
      { name: "Fade", desc: "Klasyczny fade: żółty, pomarańczowy, różowy, fiolet i błękit płynnie przechodzą przez całą metaliczną kartę.",
        photo: () => `<i class="vm-photo fd-tint"></i>` },
      { name: "Marmurkowy fade", desc: "Ogień i lód: czerwień, błękit i żółć zawirowane jak marmurek.",
        photo: () => `<i class="vm-photo fd-tint"></i>` },
      { name: "Bursztynowy fade", desc: "Ciepłe przejście od złocistej żółci przez bursztyn do oliwkowej zieleni.",
        photo: () => `<i class="vm-photo fd-tint"></i>` },
      { name: "Kwasowy fade", desc: "Pastelowe, kwasowe przejście: limonka, mięta, błękit i blady żółty.",
        photo: () => `<i class="vm-photo fd-tint"></i>` },
    ],
  },
  {
    key: "wanted", name: "Wanted", icon: "🤠", tag: "🤠 WANTED",
    about: "list gończy z Dzikiego Zachodu: WANTED, DEAD OR ALIVE, nagroda",
    looks: [
      { name: "List gończy", desc: "Pożółkły papier z rogami wyrwanymi przy pinezkach, wielki napis WANTED, zdjęcie w sepii i DEAD OR ALIVE.",
        top: () => `<div class="ww-title">WANTED</div>`, sub: () => "DEAD OR ALIVE", deco: () => `<div class="vm-deco"><i class="ww-pin a"></i><i class="ww-pin b"></i></div>` },
      { name: "Przestrzelony", desc: "Ten sam list gończy, ale przypalony na brzegach i z dziurami po kulach.",
        top: () => `<div class="ww-title">WANTED</div>`, sub: () => "DEAD OR ALIVE",
        deco: () => `<div class="vm-deco"><i class="ww-hole" style="left:72%;top:20%"></i><i class="ww-hole" style="left:16%;top:58%"></i><i class="ww-hole small" style="left:80%;top:66%"></i></div>` },
      { name: "Na deskach", desc: "List gończy przybity gwoździami do drewnianych desek saloonu.",
        top: () => `<div class="ww-title">WANTED</div>`, sub: () => "DEAD OR ALIVE", deco: () => `<div class="vm-deco"><i class="ww-nail a"></i><i class="ww-nail b"></i><i class="ww-nail c"></i><i class="ww-nail d"></i></div>` },
      { name: "Gwiazda szeryfa", desc: "Skórzana karta przewiązana sznurem, złota gwiazda szeryfa i napis WANTED na wstędze.",
        top: () => `<div class="ww-title ribbon">WANTED</div>`, sub: () => "REWARD · DEAD OR ALIVE",
        deco: () => `<div class="vm-deco"><i class="ww-star">${vmSvg(`<path d="M10 0 L12.4 5.8 L18.7 5 L14.8 10 L18.7 15 L12.4 14.2 L10 20 L7.6 14.2 L1.3 15 L5.2 10 L1.3 5 L7.6 5.8 Z" fill="#e2b13c" stroke="#7a5310" stroke-width=".5"/>` +
          [[10, 0], [18.7, 5], [18.7, 15], [10, 20], [1.3, 15], [1.3, 5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.3" fill="#f3d27a" stroke="#7a5310" stroke-width=".4"/>`).join("") +
          `<circle cx="10" cy="10" r="3.4" fill="none" stroke="#7a5310" stroke-width=".5"/>`, "-1.5 -1.5 23 23", "", "xMidYMid meet")}</i></div>` },
    ],
  },
  {
    key: "blackgold", name: "Black & Gold", icon: "🥂", tag: "BLACK & GOLD",
    about: "luksusowa czerń ze złotem",
    looks: [
      { name: "Art déco", desc: "Czerń ze złotymi wachlarzami art déco, podwójnymi złotymi liniami i nazwą jak ze złotej folii.",
        bg: () => `<div class="vm-bg"><i class="bg-deco"></i></div>`, deco: () => `<div class="vm-deco"><i class="bg-lines"></i></div>` },
      { name: "Płatki złota", desc: "Głęboka czerń posypana płatkami złota, które migoczą, gdy pada na nie światło.",
        bg: () => `<div class="vm-bg">${Array.from({ length: 26 }, () => `<i class="bg-flake" style="left:${vmN(0, 96)}%;top:${vmN(0, 96)}%;width:${vmN(1.5, 5, 1)}%;--r:${vmN(0, 90)}deg;animation-delay:-${vmN(0, 4, 1)}s"></i>`).join("")}</div>` },
      { name: "Monogram", desc: "Czarny lakier z ledwo widocznym wzorem monogramu, złote obramowania i złote wykończenia jak w luksusowym pudełku.",
        bg: () => `<div class="vm-bg"><i class="bg-mono"></i></div>`, deco: () => `<div class="vm-deco"><i class="bg-lines"></i></div>` },
      { name: "Kintsugi", desc: "Matowa czerń pęknięta i sklejona złotem jak japońska ceramika - złote żyłki lekko się żarzą.",
        bg: () => `<div class="vm-bg">${vmSvg(vmCrack(-2, 10, 65, 30) + vmCrack(-2, 70, 65, 52) + vmCrack(20, -2, 44, 90), "0 0 63 88", "bg-kintsugi")}</div>` },
    ],
  },
  {
    key: "greek", name: "Grecka", icon: "🏺", tag: "🏺 GREEK",
    about: "starożytna Grecja: wazy czarno- i czerwonofigurowe, mozaiki, freski",
    looks: [
      { name: "Waza czarnofigurowa", desc: "Terakota z czarnymi pasami meandra, a zdjęcie w kształcie amfory jak czarna postać namalowana na wazie.",
        bg: () => `<div class="vm-bg"><i class="gr-band t"></i><i class="gr-band b"></i></div>`, photo: () => `<i class="vm-photo gr-figure"></i>` },
      { name: "Waza czerwonofigurowa", desc: "Czarna waza z terakotowymi pasami i palmetami, postać w kolorze wypalonej gliny.",
        bg: () => `<div class="vm-bg"><i class="gr-band t"></i><i class="gr-band b"></i></div>`, photo: () => `<i class="vm-photo gr-figure"></i>` },
      { name: "Mozaika", desc: "Zdjęcie ułożone z kamyczków mozaiki, a wokół rzymsko-greckie fale z kostek.",
        bg: () => `<div class="vm-bg"><i class="gr-tess"></i></div>`, photo: () => `<i class="vm-photo gr-grout"></i>` },
      { name: "Fresk", desc: "Tynkowy fresk w ochrze, błękicie i czerwieni z delfinami i spiralnym fryzem, jak w pałacu na Krecie.",
        bg: () => `<div class="vm-bg gr-plaster"><i class="gr-dolphin d1">${vmDolphin("#2f7fc0", "#ffd23f")}</i><i class="gr-dolphin d2">${vmDolphin("#2f7fc0", "#ffd23f")}</i><i class="gr-spiral"></i></div>`,
        photo: () => `<i class="vm-photo gr-fresco"></i>` },
    ],
  },
  {
    key: "african", name: "Afrykańska", icon: "🌅", tag: "🌅 AFRICA",
    about: "jak afrykańskie obrazy etniczne: ciepłe barwy, zachód słońca, czarne uproszczone sylwetki",
    looks: [
      { name: "Zachód słońca", desc: "Ogromne słońce nad sawanną, akacja i sylwetki kobiet niosących dzbany na głowach na tle pomarańczowego nieba.",
        bg: () => `<div class="vm-bg af-sunset"><i class="af-sun"></i><i class="af-ground"></i>
          <i class="af-sil acacia">${vmSvg(AF_ACACIA, "0 0 40 31", "", "xMidYMax meet")}</i>
          ${[8, 20, 74, 86].map((x, k) => `<i class="af-sil woman" style="left:${x}%;height:${k % 2 ? 21 : 24}%">${vmSvg(AF_WOMAN, "0 0 10 26", "", "xMidYMax meet")}</i>`).join("")}</div>`,
        photo: () => `<i class="vm-photo af-warm"></i>` },
      { name: "Wzory tkaniny", desc: "Ramka z kolorowej tkanej tkaniny w pasy, w środku brązowe płótno z białymi symbolami i sylwetki u dołu.",
        bg: () => `<div class="vm-bg af-cloth">${[10, 26, 70, 86].map((x, k) => `<i class="af-sil woman light" style="left:${x}%;height:${k % 2 ? 19 : 22}%">${vmSvg(AF_WOMAN, "0 0 10 26", "", "xMidYMax meet")}</i>`).join("")}</div>`,
        photo: () => `<i class="vm-photo af-warm"></i>` },
      { name: "Taniec i bębny", desc: "Wydłużone tańczące postacie i bębniarz na ochrowym tle w kropki, w stylu malowanych obrazów.",
        bg: () => `<div class="vm-bg af-ochre">${[[6, 0], [24, 1], [72, 0], [88, 1]].map(([x, f]) =>
          `<i class="af-sil dancer" style="left:${x}%;${f ? "transform:scaleX(-1)" : ""}">${vmSvg(f ? AF_DRUMMER : AF_WOMAN, f ? "0 0 20 26" : "0 0 10 26", "", "xMidYMax meet")}</i>`).join("")}</div>`,
        photo: () => `<i class="vm-photo af-warm"></i>` },
      { name: "Sawanna o zmierzchu", desc: "Czerwono-fioletowe niebo, wielkie słońce, sylwetki żyrafy, słonia i akacji.",
        bg: () => `<div class="vm-bg af-dusk"><i class="af-sun big"></i><i class="af-ground"></i>
          <i class="af-sil giraffe">${vmSvg(AF_GIRAFFE, "0 0 30 39", "", "xMidYMax meet")}</i><i class="af-sil elephant">${vmSvg(AF_ELEPHANT, "0 0 40 28", "", "xMidYMax meet")}</i>
          <i class="af-sil acacia small">${vmSvg(AF_ACACIA, "0 0 40 31", "", "xMidYMax meet")}</i></div>`,
        photo: () => `<i class="vm-photo af-warm"></i>` },
    ],
  },
  {
    key: "cheese", name: "Serowa", icon: "🧀", tag: "🧀 CHEESE",
    about: "tło z sera: dziury, roztopiony ser, pleśń, czerwony wosk",
    looks: [
      { name: "Ser z dziurami", desc: "Cała karta z żółtego sera z dziurami różnej wielkości, ramka jak skórka sera.",
        bg: () => `<div class="vm-bg ch-cheese">${vmHoles(16)}</div>` },
      { name: "Roztopiony ser", desc: "Gorący, roztopiony ser spływa z góry karty i ciągnie się nitkami.",
        bg: () => `<div class="vm-bg ch-cheese warm">${vmHoles(9)}</div>`,
        deco: () => `<div class="vm-deco ch-melt">${vmSvg(vmDrips("#ffc23a", "#fff1a8", [8, 20]))}<i class="ch-string s1"></i><i class="ch-string s2"></i></div>` },
      { name: "Ser pleśniowy", desc: "Kremowy ser z niebiesko-zielonymi żyłkami pleśni i drobinkami.",
        bg: () => `<div class="vm-bg ch-blue"></div>` },
      { name: "Czerwony wosk", desc: "Ser w czerwonym, błyszczącym wosku: wosk na ramce i na brzegu, w środku żółty ser z dziurami.",
        bg: () => `<div class="vm-bg ch-cheese">${vmHoles(12)}</div>` },
    ],
  },
  {
    key: "chinese", name: "Chińska", icon: "🐉", tag: "🐉 CHINA",
    about: "klasyczny chiński styl: czerwień ze złotem, smoki, złote znaki, lampiony",
    looks: [
      { name: "Złoty smok", desc: "Czerwona karta, po której wije się złoty smok, złote chmurki i złota ramka z narożnikami.",
        bg: () => { const g = vmId("cnGold"); return `<div class="vm-bg cn-red">${vmSvg(vmDragon(g) + vmCloud(40, 6, .9) + vmCloud(4, 64, .8) + vmCloud(44, 76, 1))}</div>`; },
        deco: () => `<div class="vm-deco"><i class="cn-corner tl"></i><i class="cn-corner tr"></i><i class="cn-corner bl"></i><i class="cn-corner br"></i></div>` },
      { name: "Znaki szczęścia", desc: "Złote znaki 福 (szczęście) w czerwonych rombach, złote monety i napis 吉祥 (pomyślność).",
        bg: () => `<div class="vm-bg cn-red cn-pattern"></div>`, sub: () => "吉祥如意 · 恭喜发财",
        deco: () => `<div class="vm-deco"><i class="cn-fu">福</i><i class="cn-coin c1"></i><i class="cn-coin c2"></i></div>` },
      { name: "Lampiony", desc: "Czerwone lampiony ze złotymi frędzlami zwisają z góry karty, w tle złote chmurki.",
        bg: () => `<div class="vm-bg cn-red">${vmSvg(vmCloud(6, 40, 1) + vmCloud(42, 60, .9) + vmCloud(10, 78, .8))}</div>`,
        deco: () => `<div class="vm-deco cn-lanterns">${vmSvg(vmLantern(6, 3, .95) + vmLantern(57, 8, 1.1) + vmLantern(48, 1, .7))}</div>` },
      { name: "Czerwona laka", desc: "Czerwony lakier ze złotym ornamentem, kratowa złota ramka i czerwona pieczęć z napisem 龍 (smok).",
        bg: () => `<div class="vm-bg cn-red cn-lacquer"></div>`, deco: () => `<div class="vm-deco"><i class="cn-seal">龍</i></div>` },
    ],
  },
];
