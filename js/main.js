import { h, icon, errToast } from './ui.js';
import { sb, state, r2 } from './api.js';
import { onRoute, parts, go } from './router.js';
import { authView } from './auth.js';
import { galleryView } from './gallery.js';
import { cineView } from './cine.js';
import { studioView } from './studio.js';
import { profileView } from './profile.js';
import { familyView } from './family.js';
import { downloadsView } from './downloads.js';
import { openPlayer } from './player.js';
import { playIntro, unlockAudio } from './intro.js';

const app = document.getElementById('app');
let current = null;
let nav = null;

function buildNav() {
  nav = h('nav', { class: 'nav' },
    h('a', { href: '#/cine', 'data-sec': 'cine' }, icon('film'), 'Ciné', h('i', { class: 'nav-dot' })),
    h('a', { href: '#/galerie', 'data-sec': 'galerie' }, icon('images'), 'Galerie', h('i', { class: 'nav-dot' })),
    h('a', { href: '#/famille', 'data-sec': 'famille' }, icon('users'), 'Famille', h('i', { class: 'nav-dot' })),
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
  const sec = p[0] || 'cine';
  let view;
  if (sec === 'galerie') view = galleryView({ tab: p[1] || 'all' });
  else if (sec === 'album') view = galleryView({ albumId: p[1] });
  else if (sec === 'cine') view = cineView(p.slice(1));
  else if (sec === 'studio') view = studioView(p.slice(1));
  else if (sec === 'profil') view = profileView();
  else if (sec === 'famille') view = familyView();
  else if (sec === 'telechargements') view = downloadsView({ openPlayer });
  else { go('#/cine', true); return; }
  const navSec = sec === 'album' ? 'galerie' : (sec === 'studio' || sec === 'telechargements') ? 'cine' : sec;
  nav?.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.sec === navSec));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', navSec === 'cine' ? '#0c0c0e' : '#07070b');
  mount(view);
}

let booting = null;
// Présence « en ligne » : petit signal toutes les 60 s quand l'appli est ouverte
let presenceT = null;
function ping() {
  if (!state.profile || document.visibilityState !== 'visible') return;
  sb.from('presence').upsert({ user_id: state.profile.id, last_active: new Date().toISOString() }).then(() => {}, () => {});
}
function startPresence() {
  if (presenceT) return;
  ping();
  presenceT = setInterval(ping, 60000);
  document.addEventListener('visibilitychange', ping);
}
async function enter(session) {
  state.session = session;
  let { data: profile, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then((r) => r, (e) => ({ error: e }));
  // Hors connexion : on reprend le profil gardé sur l'appareil et on ouvre les téléchargements
  const offlineErr = error && (!navigator.onLine || /fetch|network|load failed/i.test(error.message || ''));
  if (offlineErr) {
    try { profile = JSON.parse(localStorage.getItem('blourr-profile') || 'null'); } catch { profile = null; }
    if (profile && profile.id === session.user.id) {
      state.session = session; state.profile = profile; state.isAdmin = profile.role === 'admin'; state.offline = true;
      if (!nav) buildNav();
      history.replaceState(null, '', '#/telechargements');
      route();
      return;
    }
  }
  if (!error && profile) { try { localStorage.setItem('blourr-profile', JSON.stringify(profile)); } catch { /* rien */ } }
  if (error || !profile) {
    errToast(error?.message || 'Ce compte n\'est pas rattaché à la famille.');
    await sb.auth.signOut();
    return;
  }
  state.profile = profile;
  state.isAdmin = profile.role === 'admin';
  try { const s = await r2('status'); state.configured = s.configured; } catch { state.configured = null; }
  if (!nav) buildNav();
  startPresence();
  // À l'ouverture de l'appli : direction le Ciné, avec le générique
  if (!sessionStorage.getItem('blourr-intro')) {
    sessionStorage.setItem('blourr-intro', '1');
    if (!location.hash || location.hash === '#/' || location.hash === '#/galerie') history.replaceState(null, '', '#/cine');
    route();
    await playIntro();
    return;
  }
  route();
}

function leave() {
  if (state.offline) return; // hors connexion : on reste sur les téléchargements
  sessionStorage.removeItem('blourr-intro');
  state.session = null; state.profile = null; state.isAdmin = false;
  nav?.remove(); nav = null;
  // ne pas reconstruire l'écran de connexion s'il est déjà affiché (sinon le clavier se referme)
  if (current?.isAuth) return;
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

// le premier toucher débloque le son (exigence de l'iPhone)
// (le son du générique n'est débloqué que juste avant de le jouer, puis libéré)

// retour de connexion après un démarrage hors ligne : on recharge pour tout récupérer
window.addEventListener('online', () => { if (state.offline) location.reload(); });

// Démarrage sans réseau : on ouvre directement les téléchargements avec le profil gardé sur l'appareil
if (!navigator.onLine) {
  try {
    const p = JSON.parse(localStorage.getItem('blourr-profile') || 'null');
    if (p) {
      state.profile = p; state.isAdmin = p.role === 'admin'; state.offline = true;
      buildNav();
      history.replaceState(null, '', '#/telechargements');
      route();
    }
  } catch { /* rien */ }
}
