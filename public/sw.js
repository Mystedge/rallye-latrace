/* Service worker minimal : met en cache la coquille statique (pour rouvrir l'app hors-ligne).
   Ne touche JAMAIS aux API, à l'admin ni aux photos — la résilience des données passe par IndexedDB.
   Stratégie coquille : stale-while-revalidate → affichage instantané + mise à jour auto au chargement suivant
   (indispensable pour que les correctifs CSS/JS arrivent sans avoir à vider le cache à la main). */
const CACHE = 'rallye-v2';
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
  // Coquille statique : on renvoie le cache tout de suite et on rafraîchit en arrière-plan.
  if (SHELL.includes(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(e.request).then((cached) => {
          const reseau = fetch(e.request)
            .then((resp) => { if (resp && resp.ok) cache.put(e.request, resp.clone()); return resp; })
            .catch(() => cached);
          return cached || reseau;
        }),
      ),
    );
  }
});
