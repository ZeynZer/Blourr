// Générique d'ouverture Blourr : le « B » s'allume puis on plonge dedans, avec un son de synthèse original.
import { h } from './ui.js';

let ctx = null;
function audio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}
// Débloque le son au premier toucher (l'iPhone interdit le son sans interaction)
export function releaseAudio() {
  if (!ctx) return;
  const c = ctx; ctx = null;
  try { c.close(); } catch { /* rien */ }
}
export function unlockAudio() { const a = audio(); if (a) { const b = a.createBuffer(1, 1, 22050); const s = a.createBufferSource(); s.buffer = b; s.connect(a.destination); s.start(0); } }

function sound() {
  const a = audio();
  if (!a || a.state !== 'running') return false;
  const t0 = a.currentTime + 0.05;
  const master = a.createGain(); master.gain.value = 0.9; master.connect(a.destination);
  const comp = a.createDynamicsCompressor(); comp.connect(master);

  // 1) impact grave (« boum ») avec chute de hauteur
  const thump = (t, f0, f1, dur, vol) => {
    const o = a.createOscillator(); const g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(comp); o.start(t); o.stop(t + dur + 0.05);
  };
  thump(t0, 150, 42, 0.9, 1);
  thump(t0 + 0.42, 120, 38, 1.4, 0.9);

  // 2) souffle filtré (texture)
  const len = a.sampleRate * 2; const buf = a.createBuffer(1, len, a.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const n = a.createBufferSource(); n.buffer = buf;
  const bp = a.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.setValueAtTime(300, t0 + 0.4); bp.frequency.exponentialRampToValueAtTime(4000, t0 + 1.6);
  const ng = a.createGain(); ng.gain.setValueAtTime(0.0001, t0 + 0.4); ng.gain.exponentialRampToValueAtTime(0.25, t0 + 1.5); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
  n.connect(bp); bp.connect(ng); ng.connect(comp); n.start(t0 + 0.4); n.stop(t0 + 2.7);

  // 3) accord lumineux qui s'ouvre (ré majeur ajouté) pendant la plongée
  [146.83, 220, 293.66, 369.99, 440, 659.25].forEach((f, i) => {
    const o = a.createOscillator(); const g = a.createGain(); const lp = a.createBiquadFilter();
    o.type = i % 2 ? 'sawtooth' : 'triangle'; o.frequency.value = f; o.detune.value = (i - 2.5) * 6;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t0 + 0.9); lp.frequency.exponentialRampToValueAtTime(5000, t0 + 2.0);
    g.gain.setValueAtTime(0.0001, t0 + 0.9); g.gain.exponentialRampToValueAtTime(0.06, t0 + 1.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.4);
    o.connect(lp); lp.connect(g); g.connect(comp); o.start(t0 + 0.9); o.stop(t0 + 3.5);
  });
  return true;
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
