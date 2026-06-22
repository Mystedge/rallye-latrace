/* Service worker minimal : met en cache la coquille statique (pour rouvrir l'app hors-ligne).
   Ne touche JAMAIS aux API, à l'admin ni aux photos — la résilience des données passe par IndexedDB. */
const CACHE = 'rallye-v1';
const SHELL = [
  '/styles.css',
  '/app.js',
  '/vendor/browser-image-compression.js',
  '/vendor/heic2any.min.js',
  '/icon-192.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // On ne sert jamais depuis le cache les données dynamiques
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/uploads')) return;
  // Coquille statique : cache d'abord, réseau en secours
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
