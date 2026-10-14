// Service worker gry: dzięki niemu telefon pozwala "zainstalować" grę jak aplikację.
// NIE zapisuje plików gry (zawsze ładuje się najnowsza wersja z serwera) - tylko pokazuje
// czytelną stronę, gdy nie ma internetu.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

const OFFLINE = `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ScamBox</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e1a;color:#e8ecf6;font:16px system-ui,sans-serif;text-align:center;padding:24px">
<div><div style="font-size:64px">📡</div><h2>Brak internetu</h2><p style="color:#8c97b2">ScamBox potrzebuje połączenia z serwerem.<br>Sprawdź internet i spróbuj ponownie.</p>
<button onclick="location.reload()" style="font:inherit;font-weight:700;padding:12px 22px;border:0;border-radius:12px;background:#ffcf3f;color:#241800">🔄 Spróbuj ponownie</button></div>`;

self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;  // pliki, obrazki i API idą normalnie przez sieć
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
