const V = 'trip-v1';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Кэш сначала (работает офлайн), в фоне обновляем из сети
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const hit = (await caches.match(r, { ignoreSearch: true })) ||
      (r.mode === 'navigate' ? await caches.match('index.html') : null);
    const net = fetch(r).then(res => {
      if (res && res.ok) {
        const cp = res.clone();
        caches.open(V).then(c => c.put(r, cp));
      }
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  })());
});
