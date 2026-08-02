/* LUMEN — service worker. Cache-first so the game plays fully offline. */
const CACHE = 'lumen-260802050005';
const ASSETS = [
  './',
  './index.html',
  './privacy.html',
  './manifest.json?v=260802050005',
  './css/style.css?v=260802050005',
  './js/audio.js?v=260802050005',
  './js/game.js?v=260802050005',
  './js/i18n.js?v=260802050005',
  './js/cosmetics.js?v=260802050005',
  './js/modes.js?v=260802050005',
  './js/missions.js?v=260802050005',
  './js/analytics.js?v=260802050005',
  './js/leaderboard.js?v=260802050005',
  './js/iap.js?v=260802050005',
  './js/voice.js?v=260802050005',
  './js/cheats.js?v=260802050005',
  './js/input.js?v=260802050005',
  './js/progression.js?v=260802050005',
  './js/scores.js?v=260802050005',
  './js/save.js?v=260802050005',
  './js/steam.js?v=260802050005',
  './js/native.js?v=260802050005',
  './js/poll.js?v=260802050005',
  './js/ui.js?v=260802050005',
  './js/main.js?v=260802050005',
  './assets/favicon.png',
  './assets/icon-192.png',
  './assets/icon-96.png',
  './assets/icon-maskable-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // don't cache cross-origin (e.g. Google Fonts) — just pass through
  if (url.origin !== location.origin) return;

  // The HTML is NETWORK-FIRST. It is the only file whose URL never changes, so if
  // it were served cache-first a returning player would keep the old document
  // forever — and with it the old ?v= script URLs, meaning a shipped update could
  // never reach them. Falling back to cache keeps offline play working.
  const isDoc = req.mode === 'navigate' || (req.destination === 'document');
  if (isDoc) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // Everything else is cache-first: those URLs carry a ?v= stamp, so a new build
  // asks for new URLs and can never be served a stale body.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => {
      // Never substitute the HTML document for a failed script/style request —
      // the browser refuses to execute it and the game boots to a black screen.
      return new Response('', { status: 504, statusText: 'offline' });
    }))
  );
});
