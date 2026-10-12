"use strict";
// Panel admina: skrzynki i karty.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("pl-PL") + " $";

const A = { cat: null, crate: null, search: "", rarity: "all", showSecrets: false };
try { A.showSecrets = localStorage.getItem("adminSecrets") === "1"; } catch (_) {}

async function api(path, { method = "GET", json, form } = {}) {
  const opts = { method };
  if (json !== undefined) { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(json); }
  if (form) opts.body = form;
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = "/login"; throw new Error("Zaloguj się"); }
  if (!res.ok) throw new Error(data.error || "Błąd serwera");
  return data;
}

function toast(msg, err = false) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .4s"; t.style.opacity = 0; }, 3200);
  setTimeout(() => t.remove(), 3700);
}

async function load() {
  loadUsers();
  A.cat = await api("/api/admin/catalog");
  if (!A.crate || !A.cat.crates.some(c => c.id === A.crate)) A.crate = A.cat.crates.find(c => !c.hidden)?.id || null;
  render();
}

function hiddenSecret(card) { return card.rarity === "secret" && !A.showSecrets; }
function imgSrc(card, alt = false, force = false) {
  return `/img/${card.id}${alt ? "/alt" : ""}?admin=${A.showSecrets || force ? 1 : 0}&v=${card.imgv}`;
}

// ================================================================ RENDER

function render() {
  renderCrates();
  renderCrateForm();
  renderCards();
}

function renderCrates() {
  const counts = {};
  A.cat.cards.forEach(c => { if (!c.hidden) counts[c.crate] = (counts[c.crate] || 0) + 1; });
  $("#crateList").innerHTML = A.cat.crates.map(c => `
    <button class="a-crate${c.id === A.crate ? " active" : ""}${c.hidden ? " is-hidden" : ""}" data-crate="${c.id}"
            style="--c1:${esc(c.color1)}; --c2:${esc(c.color2)}">
      <span class="a-crate-ico">${esc(c.emoji)}</span>
      <span class="a-crate-txt"><b>${esc(c.name)}</b>
        <small>${c.hidden ? "ukryta" : `${counts[c.id] || 0} kart · ${fmt(c.price)}`}${c.builtin ? " · wbudowana" : " · własna"}${c.modified ? " · zmieniona" : ""}</small></span>
    </button>`).join("");
}

function crateFormHTML(c) {
  const isNew = !c.id;
  return `
    <div class="a-form-head">
      <h3>${isNew ? "Nowa skrzynka" : `Edytuj: ${esc(c.name)}`}</h3>
      <div class="a-crate-preview crate" style="--crate-bg: linear-gradient(180deg, ${esc(c.color1)} 0 50%, ${esc(c.color2)} 50%); --crate-lid: linear-gradient(180deg, ${esc(c.color1)}, ${esc(c.color2)})">
        <div class="crate-art"><div class="crate-box"><div class="crate-emblem">${esc(c.emoji)}</div></div><div class="crate-lid"></div><div class="crate-lock"></div></div>
      </div>
    </div>
    <input type="hidden" name="id" value="${esc(c.id || "")}">
    <div class="a-grid">
      <label>Nazwa<input type="text" name="name" value="${esc(c.name)}" required maxlength="60" placeholder="np. Skrzynka YouTuberów"></label>
      <label>Krótka nazwa<input type="text" name="short" value="${esc(c.short)}" maxlength="24" placeholder="np. YouTube"></label>
      <label>Kod (na kartach)<input type="text" name="code" value="${esc(c.code)}" maxlength="4" placeholder="np. YT"></label>
      <label>Emoji<input type="text" name="emoji" value="${esc(c.emoji)}" maxlength="8"></label>
      <label>Kolor górny<input type="color" name="color1" value="${esc(c.color1)}"></label>
      <label>Kolor dolny<input type="color" name="color2" value="${esc(c.color2)}"></label>
      <label>Cena skrzynki ($)<input type="number" name="price" value="${esc(c.price)}" min="1" max="1000000"></label>
      <label class="wide">Opis<input type="text" name="desc" value="${esc(c.desc)}" maxlength="120" placeholder="krótki opis pod nazwą"></label>
    </div>
    <div class="a-actions">
      <button class="btn primary" type="submit">💾 ${isNew ? "Utwórz skrzynkę" : "Zapisz"}</button>
      ${!isNew && c.hidden ? `<button class="btn" type="button" data-act="restore-crate">↩️ Przywróć skrzynkę</button>` : ""}
      ${!isNew && !c.hidden && c.builtin && c.modified ? `<button class="btn" type="button" data-act="restore-crate">↩️ Przywróć domyślne</button>` : ""}
      ${!isNew && !c.hidden ? `<button class="btn danger" type="button" data-act="delete-crate">${c.builtin ? "🙈 Ukryj skrzynkę" : "🗑️ Usuń skrzynkę"}</button>` : ""}
      ${isNew ? `<button class="btn" type="button" data-act="cancel-crate">Anuluj</button>` : ""}
    </div>`;
}

function renderCrateForm() {
  const c = A.crate === "__new"
    ? { name: "", short: "", code: "", emoji: "📦", color1: "#ffcf3f", color2: "#7a3b00", price: A.cat.defaultPrice, desc: "" }
    : A.cat.crates.find(x => x.id === A.crate);
  $("#crateForm").innerHTML = c ? crateFormHTML(c) : "<p class='muted'>Wybierz albo utwórz skrzynkę.</p>";
  $("#newCard").disabled = !c || A.crate === "__new" || c.hidden;
}

function renderCards() {
  $("#rarityFilter").innerHTML = [["all", "Wszystkie rzadkości"], ...A.cat.rarityOrder.map(r => [r, A.cat.rarities[r].name])]
    .map(([v, n]) => `<option value="${v}"${A.rarity === v ? " selected" : ""}>${n}</option>`).join("");
  const crate = A.cat.crates.find(c => c.id === A.crate);
  if (!crate || A.crate === "__new") { $("#cardList").innerHTML = ""; $("#cardsTitle").textContent = "Karty"; return; }
  const q = A.search.toLowerCase();
  const order = A.cat.rarityOrder;
  const cards = A.cat.cards.filter(c => c.crate === A.crate && (A.rarity === "all" || c.rarity === A.rarity) &&
    (!q || (!hiddenSecret(c) && c.name.toLowerCase().includes(q))))
    .sort((a, b) => a.hidden - b.hidden || order.indexOf(b.rarity) - order.indexOf(a.rarity) || a.name.localeCompare(b.name, "pl"));
  $("#cardsTitle").textContent = `Karty — ${crate.name} (${cards.filter(c => !c.hidden).length})`;
  $("#cardList").innerHTML = cards.map(c => {
    const R = A.cat.rarities[c.rarity];
    const secret = hiddenSecret(c);
    return `<button class="a-card${c.hidden ? " is-hidden" : ""}${c.rarity === "secret" ? " is-secret" : ""}" data-card="${c.id}" style="--rc:${R.color}">
      <img src="${imgSrc(c)}" alt="" loading="lazy">
      <span class="a-card-body">
        <b>${secret ? "★ ??? (tajna)" : esc(c.name)}</b>
        <small style="color:${R.color}">${R.name}</small>
        <small>${A.cat.types[c.type]?.icon || ""} ${secret ? "???" : esc(c.attack) + " · " + c.dmg} </small>
        <span class="a-badges">
          ${c.builtin ? '<i>wbudowana</i>' : '<i class="own">własna</i>'}
          ${c.modified ? '<i class="mod">zmieniona</i>' : ""}
          ${c.hidden ? '<i class="hid">ukryta</i>' : ""}
          ${!c.hasImage ? '<i class="warn">brak zdjęcia</i>' : ""}
          ${c.hasAlt ? '<i>alt</i>' : ""}
          ${c.owned ? `<i>masz ×${c.owned}</i>` : ""}
        </span>
      </span>
    </button>`;
  }).join("") || '<div class="empty">Brak kart. Dodaj pierwszą!</div>';
}

// ================================================================ FORMULARZ KARTY

function openCardForm(id) {
  const c = id ? A.cat.cards.find(x => x.id === id)
    : { id: "", name: "", crate: A.crate, rarity: "green", type: "polityka", hp: 60, attack: "", dmg: 40, wiki: null, builtin: false };
  if (id && hiddenSecret(c) && !confirm("To tajna karta. Pokazać, kto to jest?")) return;
  const isNew = !id;
  const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join("");
  $("#cardForm").innerHTML = `
    <div class="a-card-preview">
      <div class="a-img-box"><img src="${id ? imgSrc(c, false, true) : ""}" alt="" id="prevMain" ${id ? "" : "hidden"}><span>Zdjęcie główne</span></div>
      <div class="a-img-box"><img src="${id && c.hasAlt ? imgSrc(c, true, true) : ""}" alt="" id="prevAlt" ${id && c.hasAlt ? "" : "hidden"}><span>Zdjęcie Alt Art</span></div>
    </div>
    <div class="a-card-fields">
      <h3>${isNew ? "Nowa karta" : `Edytuj: ${esc(c.name)}`}</h3>
      <input type="hidden" name="id" value="${esc(c.id)}">
      <div class="a-grid">
        <label class="wide">Imię i nazwisko / nazwa<input type="text" name="name" value="${esc(c.name)}" required maxlength="60"></label>
        <label>Skrzynka<select name="crate">${opt(Object.fromEntries(A.cat.crates.filter(x => !x.hidden).map(x => [x.id, x.name])), c.crate)}</select></label>
        <label>Rzadkość<select name="rarity">${opt(Object.fromEntries(A.cat.rarityOrder.map(r => [r, A.cat.rarities[r].name])), c.rarity)}</select></label>
        <label>Typ<select name="type">${opt(Object.fromEntries(Object.entries(A.cat.types).map(([k, t]) => [k, `${t.icon} ${t.name}`])), c.type)}</select></label>
        <label>HP<input type="number" name="hp" value="${c.hp}" min="0" max="9999"></label>
        <label>Nazwa ataku<input type="text" name="attack" value="${esc(c.attack)}" maxlength="40"></label>
        <label>Obrażenia<input type="number" name="dmg" value="${c.dmg}" min="0" max="9999"></label>
      </div>

      <fieldset>
        <legend>Zdjęcie główne</legend>
        <div class="a-grid">
          <label>Wikipedia<select name="wiki_lang">${opt({ pl: "pl.wikipedia", en: "en.wikipedia", de: "de.wikipedia", fr: "fr.wikipedia" }, c.wiki?.[0] || "pl")}</select></label>
          <label class="wide">Tytuł artykułu<input type="text" name="wiki_title" value="${esc(c.wiki?.[1] || "")}" placeholder="np. Robert Lewandowski"></label>
          <label class="wide">…albo adres obrazka (URL)<input type="text" name="image_url" placeholder="https://…"></label>
          <label class="wide">…albo plik z dysku<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" data-prev="prevMain"></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Zdjęcie Alt Art (opcjonalne)</legend>
        <div class="a-grid">
          <label class="wide">Adres obrazka (URL)<input type="text" name="image_url_alt" placeholder="https://…"></label>
          <label class="wide">…albo plik z dysku<input type="file" name="image_alt" accept="image/jpeg,image/png,image/webp,image/gif" data-prev="prevAlt"></label>
          ${c.hasAlt ? '<label class="chk wide"><input type="checkbox" name="remove_alt" value="1"> usuń obecne zdjęcie Alt Art</label>' : ""}
        </div>
        <p class="muted small">Bez zdjęcia Alt Art wariant Alt użyje zdjęcia głównego w innym stylu. „Pobierz ponownie” spróbuje znaleźć drugie zdjęcie na Wikimedia Commons.</p>
      </fieldset>

      <div class="a-actions">
        <button class="btn primary" type="submit">💾 ${isNew ? "Dodaj kartę" : "Zapisz"}</button>
        ${!isNew && !c.hidden ? '<button class="btn" type="button" data-act="refetch">🔄 Pobierz zdjęcia ponownie</button>' : ""}
        ${!isNew && c.builtin && (c.modified || c.hidden) ? `<button class="btn" type="button" data-act="restore-card">↩️ ${c.hidden ? "Przywróć kartę" : "Przywróć domyślne"}</button>` : ""}
        ${!isNew && !c.hidden ? `<button class="btn danger" type="button" data-act="delete-card">${c.builtin ? "🙈 Ukryj kartę" : "🗑️ Usuń kartę"}</button>` : ""}
        <button class="btn" type="button" data-act="close-card">Anuluj</button>
      </div>
      ${c.owned ? `<p class="muted small">Masz ${c.owned} ${c.owned === 1 ? "egzemplarz" : "egzemplarzy"} tej karty. Usunięta karta zniknie z ekwipunku (ukrytą można przywrócić).</p>` : ""}
    </div>`;
  $("#cardModal").hidden = false;
}

function closeCardForm() { $("#cardModal").hidden = true; }

// ================================================================ GRACZE

async function loadUsers() {
  const { users, me, chestKinds } = await api("/api/admin/users");
  A.users = users; A.chestKinds = chestKinds;
  const chestTxt = u => Object.entries(u.chests || {}).map(([k, n]) => {
    const ck = chestKinds.find(c => c.kind === k);
    return `${ck ? ck.emoji : "📦"}×${n}`;
  }).join(" ") || '<span class="muted">—</span>';
  $("#userList").innerHTML = `
    <div class="a-user head"><span>Gracz</span><span>Saldo</span><span>Kolekcja</span><span>Karty</span><span>Skrzynki</span><span></span></div>
    ${users.map(u => `
    <div class="a-user" data-uid="${u.id}" data-name="${esc(u.username)}">
      <span><span class="av">${esc(u.avatar)}</span> <b>${esc(u.username)}</b> ${u.isAdmin ? "👑" : ""}${u.id === me ? ' <small class="muted">(ty)</small>' : ""}</span>
      <span>${fmt(u.balance)}</span>
      <span>${fmt(u.value)}</span>
      <span>${u.unique} / ${u.total}</span>
      <span class="a-chests">${chestTxt(u)}</span>
      <span class="a-user-actions">
        <button class="btn tiny" data-uact="chests">📦 Skrzynki</button>
        <button class="btn tiny" data-uact="money">💸 Pieniądze</button>
        <button class="btn tiny" data-uact="password">🔑 Hasło</button>
        ${u.id !== me ? `<button class="btn tiny" data-uact="admin">${u.isAdmin ? "Odbierz admina" : "👑 Daj admina"}</button>
        <button class="btn tiny danger" data-uact="delete">🗑</button>` : ""}
      </span>
    </div>`).join("")}`;
}

async function userAction(row, act) {
  const id = row.dataset.uid, name = row.dataset.name;
  try {
    if (act === "chests") return openChestDialog(id, name);
    if (act === "money") {
      const v = prompt(`Ile $ dodać graczowi ${name}? (ujemna kwota odejmuje)`, "5000");
      if (!v) return;
      await api(`/api/admin/users/${id}/money`, { method: "POST", json: { amount: parseInt(v, 10) } });
      toast(`Zmieniono saldo gracza ${name}`);
    }
    if (act === "password") {
      const v = prompt(`Nowe hasło dla ${name} (min. 4 znaki):`);
      if (!v) return;
      await api(`/api/admin/users/${id}/password`, { method: "POST", json: { password: v } });
      toast(`Zmieniono hasło gracza ${name}`);
    }
    if (act === "admin") {
      await api(`/api/admin/users/${id}/admin`, { method: "POST" });
      toast("Zmieniono uprawnienia");
    }
    if (act === "delete") {
      if (!confirm(`Usunąć konto ${name} razem z kartami? Tego nie da się cofnąć.`)) return;
      await api(`/api/admin/users/${id}`, { method: "DELETE" });
      toast(`Usunięto konto ${name}`);
    }
    loadUsers();
  } catch (e) { toast(e.message, true); }
}

function openChestDialog(id, name) {
  const u = A.users.find(x => String(x.id) === String(id));
  const dlg = document.createElement("div");
  dlg.className = "modal";
  dlg.innerHTML = `
    <form class="modal-box a-chest-form">
      <h3>📦 Skrzynki dla: ${esc(name)}</h3>
      <div class="a-grid">
        <label class="wide">Rodzaj skrzynki<select name="kind">${A.chestKinds.map(k =>
          `<option value="${esc(k.kind)}">${esc(k.emoji)} ${esc(k.name)} (ma: ${(u.chests || {})[k.kind] || 0})</option>`).join("")}</select></label>
        <label>Ilość<input type="number" name="count" value="5" min="-1000" max="1000" required></label>
      </div>
      <p class="muted small">Ujemna ilość zabiera skrzynki. Gracz znajdzie je w zakładce 🎒 Ekwipunek.</p>
      <div class="a-actions"><button class="btn primary" type="submit">📦 Daj skrzynki</button><button class="btn" type="button" data-x>Anuluj</button></div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-x]")) dlg.remove(); });
  dlg.querySelector("form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api(`/api/admin/users/${id}/chests`, { method: "POST", json: { kind: f.kind, count: parseInt(f.count, 10) } });
      const k = A.chestKinds.find(c => c.kind === f.kind);
      toast(`${parseInt(f.count, 10) > 0 ? "Dano" : "Zabrano"} ${Math.abs(f.count)} × ${k.emoji} ${k.name} — ${name}`);
      dlg.remove();
      loadUsers();
    } catch (err) { toast(err.message, true); }
  });
}

// ================================================================ ZDARZENIA

function bind() {
  $("#userList").addEventListener("click", e => {
    const b = e.target.closest("[data-uact]"); if (b) userAction(b.closest(".a-user"), b.dataset.uact);
  });
  $("#showSecrets").checked = A.showSecrets;
  $("#showSecrets").addEventListener("change", e => {
    A.showSecrets = e.target.checked;
    try { localStorage.setItem("adminSecrets", A.showSecrets ? "1" : "0"); } catch (_) {}
    renderCards();
  });
  $("#crateList").addEventListener("click", e => {
    const b = e.target.closest("[data-crate]"); if (!b) return;
    A.crate = b.dataset.crate; render();
  });
  $("#newCrate").addEventListener("click", () => { A.crate = "__new"; render(); $("#crateForm [name=name]").focus(); });
  $("#newCard").addEventListener("click", () => openCardForm(null));
  $("#cardSearch").addEventListener("input", e => { A.search = e.target.value; renderCards(); });
  $("#rarityFilter").addEventListener("change", e => { A.rarity = e.target.value; renderCards(); });
  $("#cardList").addEventListener("click", e => {
    const b = e.target.closest("[data-card]"); if (b) openCardForm(b.dataset.card);
  });

  // podgląd skrzynki na żywo
  $("#crateForm").addEventListener("input", e => {
    if (!["color1", "color2", "emoji"].includes(e.target.name)) return;
    const f = new FormData($("#crateForm"));
    const prev = $(".a-crate-preview");
    prev.style.setProperty("--crate-bg", `linear-gradient(180deg, ${f.get("color1")} 0 50%, ${f.get("color2")} 50%)`);
    prev.style.setProperty("--crate-lid", `linear-gradient(180deg, ${f.get("color1")}, ${f.get("color2")})`);
    $(".crate-emblem", prev).textContent = f.get("emoji");
  });
  $("#crateForm").addEventListener("submit", async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      const res = await api("/api/admin/crates", { method: "POST", json: data });
      A.crate = res.id;
      toast(data.id ? "Zapisano skrzynkę" : "Utworzono skrzynkę 📦");
      await load();
    } catch (err) { toast(err.message, true); }
  });
  $("#crateForm").addEventListener("click", async e => {
    const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
    const c = A.cat.crates.find(x => x.id === A.crate);
    try {
      if (act === "cancel-crate") { A.crate = A.cat.crates.find(x => !x.hidden)?.id || null; return render(); }
      if (act === "delete-crate") {
        const msg = c.builtin ? `Ukryć skrzynkę „${c.name}”? (Można ją przywrócić.)`
          : `Usunąć skrzynkę „${c.name}” razem z jej własnymi kartami? Tego nie da się cofnąć.`;
        if (!confirm(msg)) return;
        await api(`/api/admin/crates/${encodeURIComponent(c.id)}`, { method: "DELETE" });
        toast(c.builtin ? "Skrzynka ukryta" : "Skrzynka usunięta");
      }
      if (act === "restore-crate") {
        await api(`/api/admin/crates/${encodeURIComponent(c.id)}/restore`, { method: "POST" });
        toast("Przywrócono skrzynkę");
      }
      await load();
    } catch (err) { toast(err.message, true); }
  });

  // formularz karty
  $("#cardModal").addEventListener("click", e => { if (e.target.id === "cardModal") closeCardForm(); });
  $("#cardForm").addEventListener("change", e => {
    const inp = e.target;
    if (inp.type === "file" && inp.files[0]) {
      const img = $("#" + inp.dataset.prev);
      img.src = URL.createObjectURL(inp.files[0]); img.hidden = false;
    }
  });
  $("#cardForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("button[type=submit]", e.target);
    btn.disabled = true; btn.textContent = "Zapisuję…";
    try {
      const res = await api("/api/admin/cards", { method: "POST", form: new FormData(e.target) });
      (res.warnings || []).forEach(w => toast(w, true));
      toast("Zapisano kartę 🎴");
      closeCardForm();
      await load();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = "💾 Zapisz"; }
  });
  $("#cardForm").addEventListener("click", async e => {
    const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
    const id = $("#cardForm [name=id]").value;
    const c = A.cat.cards.find(x => x.id === id);
    try {
      if (act === "close-card") return closeCardForm();
      if (act === "refetch") {
        e.target.disabled = true; e.target.textContent = "Pobieram…";
        const r = await api(`/api/admin/cards/${encodeURIComponent(id)}/refetch`, { method: "POST" });
        toast(`Zdjęcie główne: ${r.main ? "✔" : "✘"} · Alt Art: ${r.alt ? "✔" : "nie znaleziono"}`, !r.main);
      }
      if (act === "delete-card") {
        const msg = c.builtin ? `Ukryć kartę „${c.name}”? (Można ją przywrócić.)` : `Usunąć kartę „${c.name}”? Tego nie da się cofnąć.`;
        if (!confirm(msg)) return;
        await api(`/api/admin/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast(c.builtin ? "Karta ukryta" : "Karta usunięta");
      }
      if (act === "restore-card") {
        await api(`/api/admin/cards/${encodeURIComponent(id)}/restore`, { method: "POST" });
        toast("Przywrócono kartę");
      }
      closeCardForm();
      await load();
    } catch (err) { toast(err.message, true); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeCardForm(); });
}

bind();
load();
