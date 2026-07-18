// THREADS service worker — bump CACHE_VERSION on every deploy
const CACHE_VERSION = 'threads-v23';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './css/style.css',
  './js/app.js',
  './js/vault.js',
  './js/claude-api.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/woods-bg.svg',
  './assets/iceland-bg.svg',
  './assets/woods-header.svg',
  './assets/iceland-header.svg',
  './assets/woods-closet.svg',
  './assets/iceland-closet.svg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
