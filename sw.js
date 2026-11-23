// Service worker Blourr : volontairement SANS interception des requêtes.
// Sur iPhone (appli installée), faire passer les vidéos par un service worker peut figer la lecture.
// Il ne sert qu'à rendre l'appli installable, et nettoie les anciens caches.
const VERSION = 'blourr-v12';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
