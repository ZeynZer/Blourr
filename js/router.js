// Routeur minimal basé sur le hash
const listeners = new Set();
export function go(hash, replace = false) {
  if (location.hash === hash) { listeners.forEach((f) => f()); return; }
  if (replace) history.replaceState(null, '', hash); else location.hash = hash;
  if (replace) listeners.forEach((f) => f());
}
export function onRoute(f) { listeners.add(f); window.addEventListener('hashchange', f); }
export function parts() { return (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent); }
