// Service worker Blourr : garde l'appli disponible hors connexion (pour regarder les téléchargements).
// Il ne touche qu'aux fichiers de l'appli : les vidéos et l'API passent directement par le réseau.
const VERSION = 'blourr-v21';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css?v=21', './js/main.js?v=21',
  './js/api.js', './js/ui.js', './js/router.js', './js/auth.js', './js/gallery.js', './js/media.js', './js/catalog.js',
  './js/cine.js', './js/player.js', './js/studio.js', './js/profile.js', './js/intro.js', './js/family.js', './js/donate.js', './js/fillin.js', './js/mselang.js', './js/vendor/mp4box.js',
  './js/downloads.js', './js/dlworker.js', './js/vendor/supabase.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'blourr-fonts').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open('blourr-fonts').then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return; // vidéos, images, API : jamais interceptées
  const net = req.mode === 'navigate' ? fetch(req) : fetch(req.url, { cache: 'no-cache' });
  e.respondWith(net.then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || caches.match('./index.html'))));
});
