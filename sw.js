const CACHE = 'alias-static-v17';
const FILES = ['./', './index.html', './styles.css?v=16', './app.js?v=16', './words.js?v=16', './word-bank.js?v=16', './storage.js?v=16', './pwa.js?v=16', './preferences.js?v=16', './manifest.webmanifest?v=16', './icon.svg', './icon-192.png', './icon-512.png', './word-data-notice.txt'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => /^(alias-static-|svoyi-slova-static-)/.test(key) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'OFFLINE_STATUS' || !event.ports[0]) return;
  event.waitUntil(caches.open(CACHE).then(async cache => {
    const entries = await Promise.all(FILES.map(file => cache.match(file)));
    event.ports[0].postMessage({ ready: entries.every(Boolean) });
  }));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
