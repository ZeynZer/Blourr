// Service worker Blourr : coque de l'appli disponible hors ligne, mises à jour en priorité réseau
const VERSION = 'blourr-v7';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css?v=7',
  './js/main.js?v=7', './js/api.js', './js/ui.js', './js/router.js', './js/auth.js', './js/gallery.js',
  './js/media.js', './js/catalog.js', './js/cine.js', './js/player.js', './js/studio.js', './js/profile.js', './js/intro.js', './js/family.js', './js/donate.js', './js/vendor/supabase.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Uniquement les fichiers de l'appli (jamais les vidéos/photos R2 ni l'API)
  if (url.origin !== location.origin) {
    if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'esm.sh') {
      e.respondWith(caches.open(VERSION + '-ext').then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }));
    }
    return;
  }
  // toujours la dernière version des fichiers de l'appli (contourne le cache HTTP)
  const net = e.request.mode === 'navigate' ? fetch(e.request) : fetch(e.request.url, { cache: 'no-cache' });
  e.respondWith(net.then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
