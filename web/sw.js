/* Moje kancelář – service worker: aplikaci jde nainstalovat a otevřít i bez signálu.
   Soubory aplikace: nejdřív síť (vždy nejnovější verze), bez sítě poslední uložená kopie.
   Supabase, katalog a jiné domény jdou rovnou na síť (necachují se). */
const CACHE = 'mk-v1';
const ZAKLAD = ['/', '/kalk.js', '/manifest.webmanifest', '/ikony/ikona-192.png', '/ikony/ikona-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ZAKLAD)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok && res.type === 'basic') { const kopie = res.clone(); caches.open(CACHE).then(c => c.put(r, kopie)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(x => x || (r.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});
