// Générique d'ouverture Blourr (sans son) : le « B » se dessine en rubans, brille, puis on plonge dedans.
import { h } from './ui.js';

export function unlockAudio() { /* plus de son d'ouverture */ }
export function releaseAudio() { /* plus de son d'ouverture */ }

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  kids.forEach((c) => el.append(c));
  return el;
}

export function playIntro() {
  return new Promise((resolve) => {
    // Le « B » : un pilier + deux boucles, chacun dessiné comme un ruban
    const defs = svg('defs', {},
      svg('linearGradient', { id: 'bStem', x1: '0', y1: '0', x2: '1', y2: '0' },
        svg('stop', { offset: '0', 'stop-color': '#8f0d2e' }), svg('stop', { offset: '.55', 'stop-color': '#ff2e5b' }), svg('stop', { offset: '1', 'stop-color': '#c4123f' })),
      svg('linearGradient', { id: 'bLoop', x1: '0', y1: '0', x2: '1', y2: '1' },
        svg('stop', { offset: '0', 'stop-color': '#ff4f74' }), svg('stop', { offset: '1', 'stop-color': '#b10f39' })),
      svg('linearGradient', { id: 'bShine', x1: '0', y1: '0', x2: '1', y2: '0' },
        svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0' }), svg('stop', { offset: '.5', 'stop-color': '#fff', 'stop-opacity': '.85' }), svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' })),
      svg('clipPath', { id: 'bClip' },
        svg('rect', { x: '40', y: '20', width: '46', height: '220' }),
        svg('path', { d: 'M62 43 H120 a48 48 0 0 1 0 96 H62 Z M62 139 H128 a50 50 0 0 1 0 100 H62 Z' })));
    const loopTop = svg('path', { class: 'b-loop b-loop1', d: 'M63 43 H120 a48 48 0 0 1 0 96 H63', fill: 'none', stroke: 'url(#bLoop)', 'stroke-width': '44', pathLength: '100' });
    const loopBot = svg('path', { class: 'b-loop b-loop2', d: 'M63 139 H128 a50 50 0 0 1 0 100 H63', fill: 'none', stroke: 'url(#bLoop)', 'stroke-width': '44', pathLength: '100' });
    const stem = svg('rect', { class: 'b-stem', x: '40', y: '20', width: '46', height: '220', fill: 'url(#bStem)' });
    const shadow = svg('rect', { class: 'b-shadow', x: '84', y: '20', width: '10', height: '220', fill: '#000', opacity: '.35' });
    const shine = svg('g', { 'clip-path': 'url(#bClip)' }, svg('rect', { class: 'b-shine', x: '-120', y: '0', width: '90', height: '260', fill: 'url(#bShine)', transform: 'skewX(-18)' }));
    const logo = svg('svg', { class: 'intro-svg', viewBox: '0 0 220 260' }, defs, loopTop, loopBot, shadow, stem, shine);

    // Les rubans de couleur dans lesquels on plonge
    const palette = ['#ff2e5b', '#ff3d7f', '#b10f39', '#7c5cff', '#ff8a3d', '#e11d48', '#c13cff', '#ff5f6d', '#5b21b6', '#ff2e5b', '#ffb03d', '#9f1239', '#ff3d7f', '#4c1d95', '#f43f5e', '#ff2e5b'];
    const ribbons = h('div', { class: 'intro-ribbons' }, Array.from({ length: 48 }, (_, i) => h('i', {
      style: { left: `${(i / 48) * 100}%`, width: `${1.2 + ((i * 37) % 5) * 0.5}%`, background: palette[(i * 7) % palette.length], animationDelay: `${1.55 + ((i * 13) % 9) * 0.025}s`, opacity: '0' },
    })));

    const el = h('div', { class: 'intro' }, h('div', { class: 'intro-stage' }, logo, ribbons), h('div', { class: 'intro-flash' }));
    let done = false;
    const finish = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 500); };
    el.addEventListener('click', finish);
    document.body.append(el);
    setTimeout(finish, 3300);
  });
}
