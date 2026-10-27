// Offline-Unterstützung: alle Dateien beim ersten Besuch zwischenspeichern.
const VERSION = 'stadtlichter-v2';
const FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/geo.js',
  'js/map.js',
  'js/match.js',
  'data/map.json',
  'data/places.json',
  'fonts/d-din-pro-400.woff2',
  'fonts/d-din-pro-700.woff2',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Erst Cache, im Hintergrund aktualisieren
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
