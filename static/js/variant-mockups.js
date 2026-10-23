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

// ---------------------------------------------------------------- zdjęcie przerysowane w canvasie (piksele, witraż)
// <img class="vm-photo vm-src" data-fx="pixel|glass|rose" onload="vmCanvas(this)"> - po wczytaniu zdjęcie jest wykadrowane
// jak .card-photo (object-fit: cover, 50% 18%), przerysowane i podmienione na <canvas> z tymi samymi klasami
const VM_PAL = {
  pico: ["000000", "1d2b53", "7e2553", "008751", "ab5236", "5f574f", "c2c3c7", "fff1e8", "ff004d", "ffa300", "ffec27", "00e436", "29adff", "83769c", "ffccaa"],   // 16 kolorów starej konsoli bez różu (twarze wychodziły różowe)
  gb: ["0f380f", "306230", "8bac0f", "9bbc0f"],
};
const vmRGB = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4), 16)];
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const vmSrc = (p, fx, data = "") => `<img class="vm-photo vm-src" src="${imgUrl(p.id)}" alt="" data-fx="${fx}" ${data} onload="vmCanvas(this)">`;

function vmCrop(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const nw = img.naturalWidth, nh = img.naturalHeight, ta = w / h;
  let sx = 0, sy = 0, sw = nw, sh = nh;
  if (nw / nh > ta) { sw = nh * ta; sx = (nw - sw) / 2; } else { sh = nw / ta; sy = (nh - sh) * .18; }
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return [c, ctx];
}
function vmCanvas(img) {
  if (img.dataset.done) return;
  img.dataset.done = "1";
  const box = img.parentElement, ratio = box && box.offsetHeight ? box.offsetWidth / box.offsetHeight : 1 / .96;
  const c = img.dataset.fx === "pixel" ? vmPixelArt(img, +img.dataset.w, img.dataset.pal, ratio, img.dataset.dither)
    : vmGlass(img, ratio, img.dataset.fx, +img.dataset.n || 12);
  c.className = img.className.replace("vm-src", "vm-canvas");
  img.replaceWith(c);
}
// pixel-art: zdjęcie zmniejszone do w pikseli szerokości i przemalowane na paletę (pico - 16 kolorów, gb - 4 zielenie
// z ditheringiem) albo z liczbą poziomów na kanał (np. "5"); wyświetlane powiększone (image-rendering: pixelated)
function vmPixelArt(img, w, pal, ratio, dither) {
  const h = Math.round(w / ratio), [c, ctx] = vmCrop(img, w, h), d = ctx.getImageData(0, 0, w, h), px = d.data;
  const P = VM_PAL[pal] ? VM_PAL[pal].map(vmRGB) : null;
  for (let i = 0; i < px.length; i += 4) {
    const x = (i / 4) % w, y = Math.floor(i / 4 / w), t = BAYER4[(y % 4) * 4 + x % 4] / 16 - .5;
    let r = px[i], g = px[i + 1], b = px[i + 2];
    if (pal === "gb") {
      [r, g, b] = P[Math.max(0, Math.min(3, Math.floor((.3 * r + .59 * g + .11 * b + t * 70) / 64)))];
    } else if (P) {
      if (dither) { r += t * 36; g += t * 36; b += t * 36; }
      let best = 0, bd = 1e9;
      for (let k = 0; k < P.length; k++) {
        const dr = r - P[k][0], dg = g - P[k][1], db = b - P[k][2], dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (dd < bd) { bd = dd; best = k; }
      }
      [r, g, b] = P[best];
    } else {
      const lv = +pal || 5, q = v => Math.round(Math.max(0, Math.min(255, v + t * 12)) / 255 * (lv - 1)) * 255 / (lv - 1);
      r = q(r); g = q(g); b = q(b);
    }
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
// witraż: zdjęcie podzielone na kawałki szkła (komórki Woronoja z losowych punktów albo pierścienie i promienie rozety),
// każdy w uśrednionym, nasyconym kolorze zdjęcia, jaśniejszy w środku, rozdzielone ciemnymi liniami ołowiu
function vmGlass(img, ratio, fx, cols) {
  const W = 240, H = Math.round(W / ratio), [c, ctx] = vmCrop(img, W, H), d = ctx.getImageData(0, 0, W, H), s = d.data;
  const cell = new Int32Array(W * H), dist = new Float32Array(W * H);
  if (fx === "rose") {
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2, rings = [.12, .25, .38, .52, .67, .83, 9], sect = [1, 8, 12, 18, 24, 30, 40];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - cx, y - cy) / R, a = (Math.atan2(y - cy, x - cx) / Math.PI / 2 + 1) % 1;
      const k = rings.findIndex(v => r < v), n = sect[k], sa = (a * n + (k % 2) * .5) % n;
      cell[y * W + x] = k * 64 + Math.floor(sa);
      dist[y * W + x] = Math.abs((sa % 1) - .5) * 2 * .6 + Math.abs(((r - (rings[k - 1] || 0)) / ((rings[k] > 2 ? 1.4 : rings[k]) - (rings[k - 1] || 0))) - .5) * .8;
    }
  } else {
    const seeds = [], rows = Math.round(cols / ratio);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++)
      seeds.push([(i + .5 + rand(-.42, .42)) * W / cols, (j + .5 + rand(-.42, .42)) * H / rows]);
    const cw = W / cols;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let best = 0, bd = 1e12;
      for (let k = 0; k < seeds.length; k++) { const dx = x - seeds[k][0], dy = y - seeds[k][1], dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = k; } }
      cell[y * W + x] = best;
      dist[y * W + x] = Math.min(1, Math.sqrt(bd) / cw);
    }
  }
  const sum = new Map();
  for (let i = 0; i < W * H; i++) {
    const a = sum.get(cell[i]) || [0, 0, 0, 0];
    a[0] += s[i * 4]; a[1] += s[i * 4 + 1]; a[2] += s[i * 4 + 2]; a[3]++;
    sum.set(cell[i], a);
  }
  const col = new Map();
  for (const [k, a] of sum) {
    let r = a[0] / a[3], g = a[1] / a[3], b = a[2] / a[3];
    const gray = (r + g + b) / 3;
    r = gray + (r - gray) * 1.9 + 8; g = gray + (g - gray) * 1.9 + 8; b = gray + (b - gray) * 1.9 + 8;
    col.set(k, [r, g, b]);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, k = cell[i];
    let lead = false;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && cell[ny * W + nx] !== k) { lead = true; break; }
    }
    const [r, g, b] = col.get(k), f = (1.18 - dist[i] * .38) * (1 + rand(-.05, .05));
    s[i * 4] = lead ? 34 : r * f; s[i * 4 + 1] = lead ? 28 : g * f; s[i * 4 + 2] = lead ? 22 : b * f;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
// kawałki szkła na tło (Tiffany): trójkąty z lekko przesuniętej siatki, kolory z palety, ołowiane linie
function vmShards(cols, rows, pal, lead = "#2a1d12") {
  const P = [];
  for (let j = 0; j <= rows; j++) {
    P.push([]);
    for (let i = 0; i <= cols; i++) {
      const ex = i === 0 || i === cols, ey = j === 0 || j === rows;
      P[j].push([i / cols * 63 + (ex ? 0 : rand(-2.6, 2.6)), j / rows * 88 + (ey ? 0 : rand(-2.6, 2.6))]);
    }
  }
  let out = "";
  const tri = (a, b, c) => { out += `<path d="M${a.map(v => v.toFixed(1)).join(" ")}L${b.map(v => v.toFixed(1)).join(" ")}L${c.map(v => v.toFixed(1)).join(" ")}Z" fill="${vmPick(pal)}" opacity="${vmN(.75, 1, 2)}"/>`; };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i];
    if (Math.random() < .5) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  return `<g stroke="${lead}" stroke-width=".7" stroke-linejoin="round">${out}</g>`;
}
// wybuch komiksowy (gwiazda o losowych ramionach) z napisem
function vmBurst(text, fill = "#ffe100", edge = "#e8202f") {
  let d = "";
  for (let k = 0; k < 28; k++) {
    const a = k / 28 * Math.PI * 2, r = k % 2 ? rand(26, 32) : rand(42, 50);
    d += (k ? "L" : "M") + (50 + Math.cos(a) * r).toFixed(1) + " " + (50 + Math.sin(a) * r * .8).toFixed(1);
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${d}Z" fill="${edge}" transform="translate(2.5 3)"/><path d="${d}Z" fill="${fill}" stroke="#000" stroke-width="2"/>
    <text x="50" y="59" text-anchor="middle" font-family="Bangers, Impact, sans-serif" font-size="26" fill="${edge}" stroke="#000" stroke-width="1.4" paint-order="stroke" transform="rotate(-8 50 50)">${text}</text></svg>`;
}

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
  {
    key: "pixel", name: "Pikselowa", icon: "👾", tag: "👾 PIXEL",
    about: "pixel art jak ze starych gier: zdjęcie z dużych pikseli na ograniczonej palecie, pikselowa czcionka i ramki",
    looks: [
      { name: "8-bit", desc: "Zdjęcie z 34 pikseli szerokości w 16 kolorach starej konsoli, granatowe tło z migającymi gwiazdkami, pikselowe ramki okien.",
        bg: () => `<div class="vm-bg">${Array.from({ length: 14 }, () => `<i class="px-star" style="left:${vmN(2, 96)}%;top:${vmN(2, 96)}%;animation-delay:-${vmN(0, 3, 1)}s"></i>`).join("")}</div>`,
        photo: p => vmSrc(p, "pixel", 'data-w="34" data-pal="pico"') },
      { name: "Kieszonkowa konsola", desc: "Cztery odcienie zieleni z ditheringiem jak na ekranie kieszonkowej konsoli, szara plastikowa obudowa z diodą.",
        photo: p => vmSrc(p, "pixel", 'data-w="46" data-pal="gb"'), sub: () => "● DOT MATRIX ●",
        deco: () => `<div class="vm-deco"><i class="px-led"></i><span class="px-gb-label">SCAMBOY</span></div>` },
      { name: "16-bit RPG", desc: "Jak w grach RPG z lat 90.: niebieskie okienka z białą ramką, pasek HP, migająca strzałka przy ataku, zdjęcie w 16-bitowych kolorach.",
        top: () => `<div class="px-status"><span>LV 99</span><span class="px-bar"><i></i></span></div>`,
        photo: p => vmSrc(p, "pixel", 'data-w="58" data-pal="6"') },
      { name: "Platformówka", desc: "Niebieskie niebo z pikselowymi chmurami, cegły na dole, skrzynka ze znakiem zapytania i licznik punktów u góry.",
        top: p => `<div class="px-score"><span>SCORE<br>${String(cardValue(p.id)).padStart(6, "0")}</span><span>●×${String(p.number || 0).padStart(2, "0")}</span><span>WORLD<br>1-1</span></div>`,
        bg: () => `<div class="vm-bg"><i class="px-cloud c1"></i><i class="px-cloud c2"></i><i class="px-bricks"></i></div>`,
        photo: p => vmSrc(p, "pixel", 'data-w="42" data-pal="pico"'),
        deco: () => `<div class="vm-deco"><i class="px-qblock">?</i><i class="px-coin"></i></div>` },
    ],
  },
  {
    key: "glass", name: "Witrażowa", icon: "⛪", tag: "⛪ VITRAIL",
    about: "moja propozycja: zdjęcie jak witraż - kawałki kolorowego szkła w kolorach zdjęcia, ołowiane linie, światło przechodzące przez szkło",
    looks: [
      { name: "Gotyckie okno", desc: "Zdjęcie jako witraż w ostrołukowym oknie katedry, w ciemnym kamieniu; szkło świeci, a światło pada na kartę.",
        bg: () => `<div class="vm-bg gl-stone"><i class="gl-glow"></i></div>`,
        photo: p => `${vmSrc(p, "glass", 'data-n="13"')}<i class="vm-photo gl-shine"></i><i class="vm-photo">${vmSvg(`<path d="M1 100 V46 C1 20 22 5 50 1 C78 5 99 20 99 46 V100" fill="none" stroke="#2a2218" stroke-width="3"/>`, "0 0 100 100")}</i>` },
      { name: "Rozeta", desc: "Okrągła rozeta: zdjęcie podzielone na pierścienie i promienie z kolorowego szkła, w kamiennej oprawie.",
        bg: () => `<div class="vm-bg gl-stone"><i class="gl-glow round"></i></div>`, photo: p => `${vmSrc(p, "rose")}<i class="vm-photo gl-shine"></i>` },
      { name: "Tiffany", desc: "Secesyjna lampa Tiffany: całe tło z bursztynowego, oliwkowego i turkusowego szkła, a zdjęcie też ze szkła, w ciepłym świetle.",
        bg: () => `<div class="vm-bg">${vmSvg(vmShards(7, 10, ["#e8a33a", "#d9822b", "#9aa83a", "#5f8a4a", "#3f8a7a", "#c86a3a", "#f2c46a", "#7a5a8a"]))}<i class="gl-warm"></i></div>`,
        photo: p => `${vmSrc(p, "glass", 'data-n="11"')}<i class="vm-photo gl-shine warm"></i>` },
      { name: "Światło w kościele", desc: "Jasny kamień, na który przez witraż padają kolorowe plamy światła i ukośne promienie; zdjęcie jako szybka witrażu.",
        bg: () => `<div class="vm-bg gl-light"><i class="gl-beams"></i>${["#ff3b5c", "#2f7bff", "#ffd23f", "#3fd07a", "#a84dff"].map((c, k) =>
          `<i class="gl-spot" style="--c:${c};left:${vmN(-10, 75)}%;top:${vmN(55, 85)}%;animation-delay:-${k * 2}s"></i>`).join("")}</div>`,
        photo: p => `${vmSrc(p, "glass", 'data-n="15"')}<i class="vm-photo gl-shine"></i>` },
    ],
  },
  {
    key: "popart", name: "Pop-art", icon: "💥", tag: "💥 POP!",
    about: "moja propozycja: pop-art lat 60. - kropki jak w drukowanym komiksie, dymki, BAM!, kolorowe portrety jak u Warhola",
    looks: [
      { name: "Komiksowe kropki", desc: "Żółte tło w czerwone kropki, gruba czarna ramka, zdjęcie w mocnych kolorach z rastrem kropek i dymek z nazwą ataku.",
        bg: () => `<div class="vm-bg pa-dots"></div>`, photo: () => `<i class="vm-photo pa-halftone"></i>`,
        deco: p => `<div class="vm-deco"><span class="pa-bubble">${esc(p.attack)}!</span></div>` },
      { name: "Cztery portrety", desc: "Jak sitodruk Warhola: zdjęcie cztery razy w kratce 2 × 2, każde w innych jaskrawych kolorach.",
        photo: p => ["#ff4fa0", "#ffe13b", "#2fd0ff", "#7cff4a"].map((c, k) =>
          `<i class="vm-photo pa-quad q${k + 1}" style="--c:${c}"><img src="${imgUrl(p.id)}" alt=""></i>`).join("") },
      { name: "BAM!", desc: "Kadr z komiksu akcji: linie ruchu za zdjęciem, przechylona ramka i wielki wybuch z napisem BAM!",
        bg: () => `<div class="vm-bg pa-speed"></div>`, photo: () => `<i class="vm-photo pa-halftone"></i>`,
        deco: () => `<div class="vm-deco"><i class="pa-burst">${vmBurst("BAM!")}</i></div>` },
      { name: "Przesunięty druk", desc: "Tani druk na gazetowym papierze: kolory cyjan, magenta i żółty rozjechały się, a całość jest z kropek rastra.",
        photo: p => `<i class="vm-photo pa-paper"></i>${[["#00b7eb", -2.2, 0], ["#ff2bb5", 2, 0], ["#ffe100", 0, 2.2]].map(([c, dx, dy]) =>
          `<i class="vm-photo pa-ink" style="--c:${c};translate:${dx}% ${dy}%"><img src="${imgUrl(p.id)}" alt=""><b></b></i>`).join("")}<i class="vm-photo pa-raster"></i>` },
    ],
  },
];
