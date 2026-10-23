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

// ---------------------------------------------------------------- NOIR
// kręgi na kałuży od kropel deszczu (dół karty)
const nrRipples = n => Array.from({ length: n }, () =>
  `<i class="nr-ripple" style="left:${vmN(4, 90)}%;bottom:${vmN(1, 12)}%;animation-delay:-${vmN(0, 2.4, 2)}s;animation-duration:${vmN(1.6, 2.6, 2)}s"></i>`).join("");
// pionowe rysy na taśmie filmowej, co chwilę w innym miejscu
const nrScratches = n => Array.from({ length: n }, () =>
  `<i class="nr-scratch" style="left:${vmN(6, 94)}%;animation-delay:-${vmN(0, 3, 2)}s;animation-duration:${vmN(1.4, 3.2, 2)}s"></i>`).join("");

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

// ---------------------------------------------------------------- ARABSKA
// latarnia fanous (viewBox 0 0 14 34), wielbłąd (viewBox 0 0 20 16), ośmioramienna gwiazda (dwa obrócone kwadraty)
const AR_LANTERN = `<svg viewBox="0 0 14 34" aria-hidden="true"><path d="M7 0 V4" stroke="#c8962a" stroke-width=".5"/><path d="M5 4 H9 L10 7 H4 Z" fill="#c8962a"/>
  <path d="M4 7 H10 L12.5 14 L10 26 H4 L1.5 14 Z" fill="#ffcf6a" opacity=".9"/><path d="M4 7 H10 L12.5 14 L10 26 H4 L1.5 14 Z M7 7 V26 M1.5 14 H12.5 M2.6 20 H11.4" fill="none" stroke="#8a5a14" stroke-width=".7"/>
  <g fill="#fff6d0"><circle cx="5" cy="11" r=".7"/><circle cx="9" cy="11" r=".7"/><circle cx="4.4" cy="17" r=".6"/><circle cx="9.6" cy="17" r=".6"/><circle cx="7" cy="22" r=".7"/></g>
  <path d="M4 26 H10 L8 30 H6 Z" fill="#c8962a"/><path d="M7 30 V34" stroke="#c8962a" stroke-width=".6"/></svg>`;
const AR_CAMEL = `<path d="M3 9 C3 6 5 5 6 6 C7 3 9 3 10 5 C11 3 13 3 14 6 L15 6 C16 4 17.5 3 18.6 3.4 L19.6 4.6 L18.4 5.2 C17.4 6 17 8 16 10 L16 15 L15 15 L14.6 11 L8 11 L7.4 15 L6.4 15 L6.6 10.6 C5 10.4 3.6 10 3 9 Z"/>`;
const arStar = (cx, cy, r, cls = "") => `<g class="${cls}"><rect x="${cx - r * .7}" y="${cy - r * .7}" width="${r * 1.4}" height="${r * 1.4}"/><rect x="${cx - r * .7}" y="${cy - r * .7}" width="${r * 1.4}" height="${r * 1.4}" transform="rotate(45 ${cx} ${cy})"/></g>`;
const arCaravan = (n = 3, cls = "") => `<span class="ar-caravan ${cls}">${Array.from({ length: n }, (_, k) => `<i style="left:${k * 14}%">${vmSvg(AR_CAMEL, "0 0 20 16", "", "xMidYMax meet")}</i>`).join("")}</span>`;
// wydmy na dole zdjęcia - viewBox 0 0 100 40
const arDunes = (c1, c2) => `<path d="M0 22 C16 12 30 14 46 20 C62 26 78 16 100 14 V40 H0 Z" fill="${c1}"/><path d="M0 30 C20 24 40 28 56 30 C72 32 86 26 100 25 V40 H0 Z" fill="${c2}"/>`;
// obwódka ostrołuku zdjęcia w jednostkach karty (zdjęcie: x 5.2-57.8, y 11-61.5)
const AR_ARCH = "M5.2 61.5 V31.2 C5.2 20.6 20.6 16 31.5 11 C42.4 16 57.8 20.6 57.8 31.2 V61.5";

// ---------------------------------------------------------------- PROPOZYCJE

const VARIANT_PROPOSALS = [
  {
    key: "noir", name: "Noir", icon: "🕵️", tag: "🕵️ NOIR",
    about: "nowa wersja na bazie „Żaluzji” i „Deszczowej nocy”: czerń i biel, cienie żaluzji (już nie zasłaniają napisów), deszcz, dym, ziarno starego filmu",
    looks: [
      { name: "Żaluzje i deszcz", desc: "Biuro detektywa w deszczową noc: za kartą deszcz, przez tło i zdjęcie (pod napisami) powoli przesuwają się miękkie cienie żaluzji, snuje się dym, ziarno filmu.",
        sub: () => "Noc była długa. Miasto milczało.",
        bg: () => `<div class="vm-bg nr-room"><i class="nr-rain soft"></i><i class="nr-blinds"></i><i class="nr-smoke a"></i><i class="nr-smoke b"></i></div>`,
        photo: () => `<i class="vm-photo nr-blinds ph"></i>`, deco: () => `<div class="vm-deco nr-clip"><i class="nr-grain"></i></div>` },
      { name: "Neon za oknem", desc: "Deszczowa noc, za oknem mruga czerwony neon: co chwilę przez żaluzje wpada na czarno-białą kartę czerwone światło, w tle deszcz.",
        sub: () => "Ten neon mrugał całą noc.",
        bg: () => `<div class="vm-bg nr-night"><i class="nr-rain"></i><i class="nr-blinds"></i><i class="nr-neon"></i></div>`,
        photo: () => `<i class="vm-photo nr-blinds ph"></i><i class="vm-photo nr-neon ph"></i>`, deco: () => `<div class="vm-deco nr-clip"><i class="nr-grain"></i></div>` },
      { name: "Pod latarnią", desc: "Postać w stożku światła ulicznej latarni: deszcz widać tylko w świetle, przy ziemi snuje się mgła, a na kałuży na dole rozchodzą się kręgi od kropel.",
        sub: () => "Czekał pod latarnią. Ona nie przyszła.",
        bg: () => `<div class="vm-bg nr-street"><i class="nr-cone"></i><i class="nr-rain lit"></i><i class="nr-fog"></i><i class="nr-puddle"></i>${nrRipples(7)}</div>`,
        photo: () => `<i class="vm-photo nr-side"></i>`, deco: () => `<div class="vm-deco nr-clip"><i class="nr-grain"></i></div>` },
      { name: "Kadr z filmu", desc: "Klatka starego filmu: po bokach perforacja taśmy, obraz lekko migocze, przelatują rysy i kurz, winieta, a zamiast „typ · skrzynka” napis jak z napisów do filmu.",
        sub: () => "— Ta sprawa śmierdziała od początku.",
        bg: () => `<div class="vm-bg nr-night"><i class="nr-rain soft"></i></div>`,
        deco: () => `<div class="vm-deco nr-clip nr-flick"><i class="nr-perf l"></i><i class="nr-perf r"></i>${nrScratches(3)}<i class="nr-dust"></i><i class="nr-vignette"></i><i class="nr-grain"></i></div>` },
    ],
  },
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
  {
    key: "arabic", name: "Arabska", icon: "🕌", tag: "✨ ARABIA",
    about: "poprawiona na bazie „Mozaiki” i „Pustyni”: zdjęcie w ostrołuku, geometryczne mozaiki w błękicie i złocie, wydmy i karawana",
    looks: [
      { name: "Brama pałacu", desc: "Zdjęcie w ostrołuku z grubą złotą, rzeźbioną ramą (podwójna linia i rząd złotych kropek), w narożnikach nad łukiem złote arabeski, dookoła mozaika z ośmioramiennych gwiazd.",
        bg: () => `<div class="vm-bg ar-zellige"></div>`,
        deco: () => `<div class="vm-deco ar-gate">${vmSvg(`<path class="o" d="${AR_ARCH}"/><path class="i" d="${AR_ARCH}"/><path class="d" d="${AR_ARCH}"/>`)}<i class="ar-spandrel l"></i><i class="ar-spandrel r"></i></div>` },
      { name: "Mozaika nocą", desc: "Granatowa mozaika, za zdjęciem w ostrołuku powoli obraca się wielka złota ośmioramienna gwiazda, migoczą złote iskierki, z boków zwisają latarnie.",
        bg: () => `<div class="vm-bg ar-zellige night"><i class="ar-medal">${vmSvg(arStar(50, 50, 46, "ar-star o") + arStar(50, 50, 38, "ar-star i"), "0 0 100 100", "", "xMidYMid meet")}</i>${vmScatter(14, "ar-twinkle")}</div>`,
        deco: () => `<div class="vm-deco ar-gate thin">${vmSvg(`<path class="o" d="${AR_ARCH}"/>`)}<i class="ar-lan a">${AR_LANTERN}</i><i class="ar-lan b">${AR_LANTERN}</i></div>` },
      { name: "Oaza", desc: "Okno w ostrołuku z widokiem na pustynię o zachodzie: na dole zdjęcia złote wydmy, palmy oazy i karawana wielbłądów idąca grzbietem wydmy, w tle ciepła mozaika.",
        bg: () => `<div class="vm-bg ar-zellige warm"></div>`,
        photo: () => `<i class="vm-photo ar-warm"></i><i class="vm-photo ar-scene">${vmSvg(arDunes("#d89a4a", "#b8742c"), "0 0 100 40")}${arCaravan(3)}${vmSvg(hyPalm(2, 4, .7, "#3a1a08") + hyPalm(86, 6, .6, "#3a1a08"), "0 0 100 40")}</i>`,
        deco: () => `<div class="vm-deco ar-gate">${vmSvg(`<path class="o" d="${AR_ARCH}"/><path class="i" d="${AR_ARCH}"/>`)}</div>` },
      { name: "Gwiaździsta pustynia", desc: "Noc na pustyni: granatowe niebo z gwiazdami i złotym półksiężycem w tle karty, na dole zdjęcia ciemne wydmy, po których powoli wędruje karawana, złota rama ostrołuku.",
        bg: () => `<div class="vm-bg ar-starry">${vmScatter(26, "ar-twinkle")}<i class="ar-moon"></i></div>`,
        photo: () => `<i class="vm-photo ar-night"></i><i class="vm-photo ar-scene">${vmSvg(arDunes("#1a1440", "#0e0a28"), "0 0 100 40")}${arCaravan(4, "dark")}</i>`,
        deco: () => `<div class="vm-deco ar-gate">${vmSvg(`<path class="o" d="${AR_ARCH}"/><path class="d" d="${AR_ARCH}"/>`)}</div>` },
    ],
  },
];
