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
// rzeczy rozrzucone po karcie (kropki, iskry, gwiazdki): losowe miejsce i opóźnienie animacji
const vmScatter = (n, cls, extra = () => "", y = [2, 96]) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${vmN(2, 96)}%;top:${vmN(...y)}%;animation-delay:-${vmN(0, 6, 1)}s;${extra()}"></i>`).join("");

// ---------------------------------------------------------------- HOLLYWOOD '69
// palma (sylwetka) w jednostkach karty
const hyPalm = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${c}"><path d="M4.4 30 C5 22 5.6 14 6.6 6 L7.6 6.2 C6.8 14 6.2 22 5.8 30 Z"/>
  <path d="M7 6 C3 2 -1 4 -3 7 C0 5 3 5 6.6 6.6 Z M7 6 C4 1 0 1 -2 2 C1 2 4 4 6.6 6.2 Z M7 6 C10 2 14 2 16 4 C13 3.6 10 4.6 7.6 6.6 Z M7 6 C11 4 15 6 16 9 C13 7 10 6.6 7.6 7 Z M7 6 C7 2 9 0 11 -1 C9.4 1.4 8.4 3.6 7.6 6.2 Z"/></g>`;
// auto z lat 60. widziane z tyłu (kino samochodowe) - viewBox 0 0 30 12
const HY_CAR = `<svg viewBox="0 0 30 12" aria-hidden="true"><path d="M2 8 C2 6 3 5.4 6 5 L9 1.6 C9.6 1 10.6 .8 12 .8 H18 C19.4 .8 20.4 1 21 1.6 L24 5 C27 5.4 28 6 28 8 V10.4 H2 Z" fill="#0c0a14"/>
  <rect x="3.2" y="7" width="3.4" height="1.4" rx=".5" fill="#ff3b2b"/><rect x="23.4" y="7" width="3.4" height="1.4" rx=".5" fill="#ff3b2b"/><path d="M10 2 H20 L22.4 4.8 H7.6 Z" fill="#3a3450" opacity=".7"/></svg>`;
// pasmo wzgórz (na dole zdjęcia, jak na pocztówce) - viewBox 0 0 100 40
const hyHills = () => `<path d="M0 30 C10 18 22 14 34 19 C46 12 60 11 74 17 C84 13 94 15 100 18 V40 H0 Z" fill="#7a4a2a"/>
  <path d="M0 34 C14 27 30 28 44 31 C58 26 76 27 100 30 V40 H0 Z" fill="#5a321c"/>`;

// ---------------------------------------------------------------- PROPOZYCJE

const VARIANT_PROPOSALS = [
  {
    key: "hollywood", name: "Hollywood '69", icon: "🎬", tag: "🎬 1969",
    about: "nowa (nazwa robocza) na bazie „Napisu na wzgórzach”, w klimacie „Pewnego razu… w Hollywood”: Los Angeles 1969, wyblakłe od słońca ciepłe kolory, ziarno kliszy, szyldy kin, retro napisy. Zdjęcie nie jest już przycinane.",
    looks: [
      { name: "Pocztówka ze wzgórz", desc: "Jak pocztówka z 1969: ciepłe niebo o zachodzie, zdjęcie w kolorach starej kliszy, a na dole zdjęcia wzgórza z wielkimi białymi literami SCAMBOX i palmy. Retro napis z cieniem.",
        sub: () => "POZDROWIENIA Z LOS ANGELES · 1969",
        bg: () => `<div class="vm-bg hy-dusk"></div>`,
        photo: () => `<i class="vm-photo hy-koda"></i><i class="vm-photo hy-scene">${vmSvg(hyHills(), "0 0 100 40")}<b class="hy-sign">SCAMBOX</b>${vmSvg(hyPalm(4, 6, .9, "#2a140a") + hyPalm(84, 4, 1, "#2a140a"), "0 0 100 40")}</i>`,
        deco: () => `<div class="vm-deco hy-clip"><i class="hy-grain"></i></div>` },
      { name: "Neon kina", desc: "Przed kinem o zmierzchu: u góry markiza z biegnącymi żarówkami i czarnymi literami TERAZ GRAMY, zdjęcie jak plakat w gablocie obwiedzionej żarówkami, ściana w pasy art déco.",
        top: () => `<div class="hy-marquee"><b>TERAZ GRAMY</b></div>`, sub: () => "SEANSE 19:00 · 21:30",
        bg: () => `<div class="vm-bg hy-theater"></div>`,
        photo: () => `<i class="vm-photo hy-koda"></i>`,
        deco: () => `<div class="vm-deco hy-clip"><i class="hy-grain"></i></div>` },
      { name: "Plakat filmowy", desc: "Wyblakły od słońca plakat z 1969: rastrowe kropki druku, zdjęcie w dwóch ciepłych kolorach, wielki tytuł z grubym cieniem, obsada zamiast „typ · skrzynka”, ślady zagięć i przetarte brzegi.",
        sub: () => "W ROLI GŁÓWNEJ · REŻ. SCAMBOX · 1969",
        bg: () => `<div class="vm-bg hy-poster"><i class="hy-halftone"></i></div>`,
        photo: () => `<i class="vm-photo hy-duo"></i><i class="vm-photo hy-halftone ph"></i>`,
        deco: () => `<div class="vm-deco hy-clip"><i class="hy-fold v"></i><i class="hy-fold h"></i><i class="hy-worn"></i></div>` },
      { name: "Kino samochodowe", desc: "Seans pod gwiazdami: zdjęcie jest wielkim ekranem na słupach, z dołu pada na nie migoczący promień projektora, przed ekranem stoją auta z lat 60.",
        sub: () => "DRIVE-IN · DZIŚ PODWÓJNY SEANS",
        bg: () => `<div class="vm-bg hy-drivein">${vmScatter(22, "hy-star", () => "", [2, 40])}<i class="hy-post l"></i><i class="hy-post r"></i><i class="hy-beam"></i>${[0, 1, 2].map(k => `<i class="hy-car c${k}">${HY_CAR}</i>`).join("")}</div>`,
        photo: () => `<i class="vm-photo hy-koda"></i><i class="vm-photo hy-flicker"></i>` },
    ],
  },
];
