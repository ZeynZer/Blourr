// Générique d'ouverture Blourr : le « B » s'allume puis on plonge dedans, avec un son de synthèse original.
import { h } from './ui.js';

// Son du générique : simple fichier audio (pas de Web Audio, qui bloquait la lecture des vidéos sur iPhone en mode appli)
let snd = null;
function soundEl() {
  if (!snd) { snd = new Audio('intro.m4a'); snd.preload = 'auto'; }
  return snd;
}
// Pendant un toucher (ex. bouton « Se connecter ») : autorise la lecture du son juste après
export function unlockAudio() {
  try { const a = soundEl(); a.muted = true; a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; }); } catch { /* rien */ }
}
export function releaseAudio() {
  if (!snd) return;
  try { snd.pause(); snd.removeAttribute('src'); snd.load(); } catch { /* rien */ }
  snd = null;
}
function sound() {
  try { const a = soundEl(); a.currentTime = 0; a.muted = false; a.play().catch(() => {}); return true; } catch { return false; }
}

export function playIntro() {
  return new Promise((resolve) => {
    const colors = ['#ff2e5b', '#ff3d7f', '#7c5cff', '#ff8a3d', '#ff2e5b', '#c13cff', '#ff2e5b', '#ff5f6d', '#7c5cff', '#ff2e5b', '#ffb03d', '#ff3d7f'];
    const rays = h('div', { class: 'intro-rays' }, colors.map((c, i) => h('i', { style: { background: c, left: `${(i / colors.length) * 100}%`, animationDelay: `${1.25 + (i % 4) * 0.04}s` } })));
    const el = h('div', { class: 'intro' },
      h('div', { class: 'intro-b' }, h('span', { class: 'intro-glow' }, 'B'), h('span', { class: 'intro-letter' }, 'B'), rays));
    let done = false;
    const finish = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 450); };
    el.addEventListener('click', () => finish());
    document.body.append(el);
    sound.played = sound();
    setTimeout(finish, 3000);
    setTimeout(releaseAudio, 4200);
  });
}
