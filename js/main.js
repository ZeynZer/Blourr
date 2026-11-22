import { h, icon, errToast } from './ui.js';
import { sb, state, r2 } from './api.js';
import { onRoute, parts, go } from './router.js';
import { authView } from './auth.js';
import { galleryView } from './gallery.js';
import { cineView } from './cine.js';
import { studioView } from './studio.js';
import { profileView } from './profile.js';

const app = document.getElementById('app');
let current = null;
let nav = null;

function buildNav() {
  nav = h('nav', { class: 'nav' },
    h('a', { href: '#/galerie', 'data-sec': 'galerie' }, icon('images'), 'Galerie', h('i', { class: 'nav-dot' })),
    h('a', { href: '#/cine', 'data-sec': 'cine' }, icon('film'), 'Ciné', h('i', { class: 'nav-dot' })),
    h('a', { href: '#/profil', 'data-sec': 'profil' }, icon('user'), 'Profil', h('i', { class: 'nav-dot' })));
  document.body.append(nav);
}

function mount(view) {
  if (current?.cleanup) try { current.cleanup(); } catch { /* rien */ }
  document.querySelectorAll('.detail-ov, .overlay').forEach((x) => x.remove());
  app.replaceChildren(view);
  current = view;
  window.scrollTo(0, 0);
}

function route() {
  if (!state.profile) return;
  const p = parts();
  const sec = p[0] || 'galerie';
  let view;
  if (sec === 'galerie') view = galleryView({ tab: p[1] || 'all' });
  else if (sec === 'album') view = galleryView({ albumId: p[1] });
  else if (sec === 'cine') view = cineView(p.slice(1));
  else if (sec === 'studio') view = studioView(p.slice(1));
  else if (sec === 'profil') view = profileView();
  else { go('#/galerie', true); return; }
  const navSec = sec === 'album' ? 'galerie' : sec === 'studio' ? 'cine' : sec;
  nav?.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.sec === navSec));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', navSec === 'cine' ? '#0c0c0e' : '#07070b');
  mount(view);
}

let booting = null;
async function enter(session) {
  state.session = session;
  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error || !profile) {
    errToast(error?.message || 'Ce compte n\'est pas rattaché à la famille.');
    await sb.auth.signOut();
    return;
  }
  state.profile = profile;
  state.isAdmin = profile.role === 'admin';
  try { const s = await r2('status'); state.configured = s.configured; } catch { state.configured = null; }
  if (!nav) buildNav();
  route();
}

function leave() {
  state.session = null; state.profile = null; state.isAdmin = false;
  nav?.remove(); nav = null;
  mount(authView());
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED') { state.session = session; return; }
  if (event === 'USER_UPDATED') { state.session = session; return; }
  if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
    if (state.profile && state.profile.id === session.user.id) return;
    // éviter l'appel Supabase directement dans le rappel (verrou interne)
    clearTimeout(booting);
    booting = setTimeout(() => enter(session).catch(errToast), 0);
  } else if (!session) {
    leave();
  }
});

onRoute(route);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
