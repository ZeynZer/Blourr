import { h, icon, clock, sheet, errToast, runtime } from './ui.js';
import { sb, signedUrl, lazyImg } from './api.js';
import { uid } from './ui.js';
import { episodesOf, nextEpisode, saveProgress, progressOf, ratio } from './catalog.js';

const SPEEDS = [1, 1.25, 1.5, 0.75];
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const INTRO_FRESH = 8000; // durée d'affichage du bouton « Passer l'intro » sans toucher l'écran

export function openPlayer({ title: t, episode = null, start = 0, onExit = null }) {
  let ep = episode;
  let speedIdx = 0;
  let subsOn = true;
  let lastSave = 0;
  let hideT = null;
  let countdown = null;
  let closed = false;

  const video = h('video', { playsinline: true, preload: 'auto' });
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  const ttl = h('div', { class: 'tt' });
  const ppBtn = h('button', { class: 'pp', onclick: (e) => { e.stopPropagation(); toggle(); } }, icon('play'));
  const rail = h('div', { class: 'rail' });
  const buf = h('div', { class: 'buf' }); const fill = h('div', { class: 'fill' }); const knob = h('div', { class: 'knob' }); const tip = h('div', { class: 'tip' });
  rail.append(buf, fill, knob);
  const track = h('div', { class: 'pl-track' }, rail, tip);
  const remain = h('span', {}, '0:00');
  const elapsed = h('span', {}, '0:00');
  const subBtn = h('button', { class: 'hidden', onclick: () => setSubs(!subsOn) }, icon('subtitles'), 'Sous-titres');
  const speedBtn = h('button', { onclick: () => { speedIdx = (speedIdx + 1) % SPEEDS.length; video.playbackRate = SPEEDS[speedIdx]; speedBtn.lastChild.textContent = `Vitesse (${String(SPEEDS[speedIdx]).replace('.', ',')}x)`; } }, icon('speed'), h('span', {}, 'Vitesse (1x)'));
  const langBtn = h('button', { class: 'hidden', onclick: () => languageSheet() }, icon('volume'), h('span', {}, 'Langue'));
  const epsBtn = h('button', { class: t.kind === 'series' ? '' : 'hidden', onclick: () => episodesSheet() }, icon('episodes'), 'Épisodes');
  const nextBtn = h('button', { class: 'hidden', onclick: () => goNext() }, icon('nextep'), 'Épisode suivant');
  // Sur iPhone, le plein écran natif masquerait nos boutons : on propose un zoom (remplir l'écran) à la place
  const fsBtn = isIOS
    ? h('button', { title: 'Remplir l\'écran', onclick: () => { root.classList.toggle('zoomed'); fsBtn.classList.toggle('on', root.classList.contains('zoomed')); } }, icon('zoom'))
    : h('button', { title: 'Plein écran', onclick: () => fullscreen() }, icon('fullscreen'));
  let savedVol = 1;
  try { savedVol = Math.min(1, Math.max(0, parseFloat(localStorage.getItem('blourr-vol') ?? '1'))); } catch { /* rien */ }
  const muteBtn = h('button', { title: 'Son', onclick: () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.5; volUI(); } }, icon('volume'));
  const volRange = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: savedVol, oninput: () => { video.volume = +volRange.value; video.muted = +volRange.value === 0; volUI(); try { localStorage.setItem('blourr-vol', volRange.value); } catch { /* rien */ } } });
  const volBox = h('div', { class: 'pl-vol' }, muteBtn, isIOS ? null : volRange);
  function volUI() {
    muteBtn.replaceChildren(icon(video.muted || video.volume === 0 ? 'mute' : 'volume'));
    if (!isIOS) volRange.value = video.muted ? 0 : video.volume;
  }
  const skipIntro = h('button', { class: 'skip-intro hidden', onclick: (e) => { e.stopPropagation(); video.currentTime = cur().intro_end; skipIntro.classList.add('hidden'); } }, h('i', { class: 'fill' }), h('span', {}, 'Passer l\'intro'));
  let introSeenAt = 0;
  const nextUp = h('div', { class: 'next-up hidden' });
  const loading = h('div', { class: 'pl-loading' }, h('div', { class: 'spinner' }));
  const flashL = h('div', { class: 'seek-flash l' }, '−10 s');
  const flashR = h('div', { class: 'seek-flash r' }, '+10 s');

  const ui = h('div', { class: 'pl-ui' },
    h('div', { class: 'pl-top' }, h('button', { class: 'icon-btn plain', onclick: () => exit() }, icon('back')), ttl, h('div', { style: { width: '40px' } })),
    h('div', { class: 'pl-mid' },
      h('button', { class: 'sk', onclick: (e) => { e.stopPropagation(); seekBy(-10); } }, icon('rew10')),
      ppBtn,
      h('button', { class: 'sk', onclick: (e) => { e.stopPropagation(); seekBy(10); } }, icon('fwd10'))),
    h('div', { class: 'pl-bot' },
      h('div', { class: 'pl-seek' }, elapsed, track, remain),
      h('div', { class: 'pl-btns' }, volBox, speedBtn, epsBtn, langBtn, subBtn, h('div', { class: 'sp' }), nextBtn, fsBtn)));

  const root = h('div', { class: 'player' }, video, flashL, flashR, loading, ui, skipIntro, nextUp);
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  if (!isIOS) video.volume = savedVol;
  video.addEventListener('volumechange', volUI);
  volUI();

  const cur = () => (ep || t);

  // ---------- Chargement d'une vidéo ----------
  async function load(e, from) {
    ep = e;
    clearCountdown();
    flushSession();
    session = { id: uid(), secs: 0, saved: 0 };
    introSeenAt = 0; skipIntro.classList.add('hidden');
    nextUp.classList.add('hidden');
    loading.classList.remove('hidden');
    ttl.replaceChildren(t.name, ep ? h('small', {}, `  S${ep.season}:É${ep.number} « ${ep.name || 'Épisode ' + ep.number} »`) : null);
    const nx = ep ? nextEpisode(ep) : null;
    nextBtn.classList.toggle('hidden', !nx);
    video.querySelectorAll('track').forEach((tr) => tr.remove());
    const item = cur();
    try {
      const [src, sub] = await Promise.all([signedUrl(item.video_key), item.subtitle_key ? signedUrl(item.subtitle_key) : null]);
      if (closed) return;
      subBtn.classList.toggle('hidden', !sub);
      if (sub) {
        video.crossOrigin = 'anonymous';
        const tr = h('track', { kind: 'subtitles', srclang: 'fr', label: 'Français', src: sub, default: true });
        video.append(tr);
        tr.addEventListener('load', () => setSubs(subsOn));
      } else video.removeAttribute('crossorigin');
      video.src = src;
      video.playbackRate = SPEEDS[speedIdx];
      video.addEventListener('loadedmetadata', () => {
        const d = video.duration || 0;
        if (from > 5 && (!d || from < d - 15)) video.currentTime = from;
        setSubs(subsOn);
        setupLanguages();
      }, { once: true });
      video.play().catch(() => { loading.classList.add('hidden'); showUI(true); });
      mediaSession();
    } catch (err) { errToast(err); loading.classList.add('hidden'); }
  }

  // ---------- Langues (pistes audio multiples, lues par Safari / iPhone) ----------
  const LANG_NAMES = { fr: 'Français', fre: 'Français', fra: 'Français', en: 'Anglais', eng: 'Anglais', ja: 'Japonais', jpn: 'Japonais', es: 'Espagnol', spa: 'Espagnol', ar: 'Arabe', ara: 'Arabe', de: 'Allemand', ger: 'Allemand', deu: 'Allemand', it: 'Italien', ita: 'Italien', ko: 'Coréen', kor: 'Coréen' };
  const trackName = (tr, i) => LANG_NAMES[(tr.language || '').toLowerCase()] || tr.label || `Piste ${i + 1}`;
  const tracks = () => (video.audioTracks ? [...video.audioTracks] : []);
  function currentTrack() { return tracks().findIndex((t) => t.enabled); }
  function selectTrack(i) {
    tracks().forEach((t, j) => { t.enabled = j === i; });
    const t = tracks()[i];
    try { localStorage.setItem('blourr-lang', (t.language || '').toLowerCase()); } catch { /* rien */ }
    langBtn.lastChild.textContent = trackName(t, i);
  }
  function setupLanguages() {
    const list = tracks();
    langBtn.classList.toggle('hidden', list.length < 2);
    if (list.length < 2) return;
    let pref = null;
    try { pref = localStorage.getItem('blourr-lang'); } catch { /* rien */ }
    const same = (a, b) => (LANG_NAMES[a] || a) === (LANG_NAMES[b] || b);
    const i = pref ? list.findIndex((t) => same((t.language || '').toLowerCase(), pref)) : -1;
    if (i >= 0 && i !== currentTrack()) selectTrack(i);
    else { const c = Math.max(0, currentTrack()); langBtn.lastChild.textContent = trackName(list[c], c); }
  }
  function languageSheet() {
    const list = tracks();
    const cur = currentTrack();
    sheet((close) => [
      h('h2', {}, 'Langue'),
      list.map((t, i) => h('button', { class: 'list-btn', onclick: () => { selectTrack(i); close(); } },
        icon(i === cur ? 'check' : 'volume'), trackName(t, i))),
    ]);
  }

  function setSubs(on) {
    subsOn = on;
    for (const tr of video.textTracks) tr.mode = on ? 'showing' : 'hidden';
    subBtn.classList.toggle('on', on);
  }

  function toggle() { if (video.paused) video.play().catch(() => {}); else video.pause(); }
  function seekBy(s) {
    if (!video.duration) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 0.5, video.currentTime + s));
    const f = s < 0 ? flashL : flashR;
    f.classList.add('show'); setTimeout(() => f.classList.remove('show'), 350);
    showUI();
  }

  // ---------- Interface (masquage auto) ----------
  function showUI(stay = false) {
    root.classList.remove('idle');
    clearTimeout(hideT);
    if (!stay && !video.paused) hideT = setTimeout(() => root.classList.add('idle'), 3200);
  }
  let lastTap = 0; let tapT = null;
  root.addEventListener('click', (e) => {
    if (e.target !== video && e.target !== ui && !e.target.classList.contains('pl-mid')) return;
    const now = Date.now();
    const x = e.clientX / window.innerWidth;
    if (now - lastTap < 280) { // double tap
      clearTimeout(tapT); lastTap = 0;
      if (x < 0.38) seekBy(-10); else if (x > 0.62) seekBy(10); else toggle();
      return;
    }
    lastTap = now;
    tapT = setTimeout(() => {
      if (root.classList.contains('idle')) showUI(); else if (!video.paused) root.classList.add('idle'); else showUI(true);
    }, 280);
  });
  root.addEventListener('mousemove', () => showUI());

  // ---------- Barre de progression ----------
  function posFromEvent(e) {
    const r = rail.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0] : e).clientX;
    return Math.max(0, Math.min(1, (cx - r.left) / r.width));
  }
  let dragging = false; let dragP = 0;
  function dragMove(e) {
    if (!dragging) return;
    dragP = posFromEvent(e);
    paintBar(dragP);
    tip.style.left = (dragP * 100) + '%';
    tip.textContent = clock(dragP * (video.duration || 0));
    e.preventDefault();
  }
  function dragEnd() {
    if (!dragging) return;
    dragging = false; track.classList.remove('drag');
    if (video.duration) video.currentTime = dragP * video.duration;
    showUI();
  }
  const dragStart = (e) => { e.stopPropagation(); dragging = true; track.classList.add('drag'); clearTimeout(hideT); dragMove(e); };
  track.addEventListener('mousedown', dragStart);
  track.addEventListener('touchstart', dragStart, { passive: false });
  window.addEventListener('mousemove', dragMove);
  window.addEventListener('touchmove', dragMove, { passive: false });
  window.addEventListener('mouseup', dragEnd);
  window.addEventListener('touchend', dragEnd);
  track.addEventListener('click', (e) => e.stopPropagation());

  function paintBar(p) {
    fill.style.width = (p * 100) + '%';
    knob.style.left = (p * 100) + '%';
  }

  // ---------- Événements vidéo ----------
  video.addEventListener('waiting', () => loading.classList.remove('hidden'));
  video.addEventListener('playing', () => { loading.classList.add('hidden'); showUI(); });
  video.addEventListener('canplay', () => loading.classList.add('hidden'));
  video.addEventListener('play', () => { ppBtn.replaceChildren(icon('pause')); showUI(); });
  video.addEventListener('pause', () => { ppBtn.replaceChildren(icon('play')); showUI(true); persist(); });
  video.addEventListener('progress', () => {
    if (!video.duration || !video.buffered.length) return;
    buf.style.width = (video.buffered.end(video.buffered.length - 1) / video.duration * 100) + '%';
  });
  video.addEventListener('timeupdate', () => {
    const d = video.duration || 0; const c = video.currentTime;
    if (!dragging && d) paintBar(c / d);
    elapsed.textContent = clock(c);
    remain.textContent = '-' + clock(d - c);
    const it = cur();
    const inIntro = it.intro_end != null && it.intro_end > 0 && c >= (it.intro_start || 0) && c < it.intro_end - 1;
    if (!inIntro) { skipIntro.classList.add('hidden'); introSeenAt = 0; }
    else {
      if (!introSeenAt) {
        introSeenAt = Date.now();
        skipIntro.classList.remove('hidden', 'stale', 'fresh');
        void skipIntro.offsetWidth; // relance l'animation
        skipIntro.classList.add('fresh');
      }
      // après 8 s, le bouton ne reste visible que lorsque les commandes sont affichées
      skipIntro.classList.toggle('stale', Date.now() - introSeenAt > INTRO_FRESH);
    }
    if (ep && d && d - c < 25 && nextEpisode(ep)) showNextUp(false); else if (!countdown) nextUp.classList.add('hidden');
    if (Date.now() - lastSave > 10000) persist();
  });
  video.addEventListener('ended', () => {
    persist(true);
    if (ep && nextEpisode(ep)) showNextUp(true);
    else exit();
  });
  video.addEventListener('error', () => {
    loading.classList.add('hidden');
    if (video.error && video.src) errToast('Lecture impossible. Format non pris en charge (utilise du MP4 H.264) ou lien expiré.');
  });

  // ---------- Suivi du temps de visionnage (visible par l'admin) ----------
  let session = null;
  const tick = setInterval(() => {
    if (!session || video.paused || video.seeking || video.readyState < 3) return;
    session.secs++;
    if (session.secs - session.saved >= 20) flushSession();
  }, 1000);
  function flushSession() {
    if (!session || session.secs === session.saved || session.secs < 5) return;
    session.saved = session.secs;
    sb.from('watch_sessions').upsert({ id: session.id, title_id: t.id, episode_id: ep ? ep.id : null, seconds: session.secs, last_seen: new Date().toISOString() }).then(() => {}, () => {});
  }

  function persist(finished = false) {
    if (!video.duration || !cur().video_key) return;
    lastSave = Date.now();
    const pos = finished ? video.duration : video.currentTime;
    if (pos < 3 && !finished) return;
    saveProgress(t, ep, pos, video.duration).catch(() => {});
  }

  // ---------- Épisode suivant ----------
  function showNextUp(auto) {
    const nx = nextEpisode(ep);
    if (!nx) return;
    if (!nextUp.classList.contains('hidden') && !auto) return;
    const btn = h('button', { class: 'btn light', onclick: (e) => { e.stopPropagation(); goNext(); } }, icon('play'), 'Épisode suivant');
    nextUp.replaceChildren(
      h('div', { class: 'th' }, lazyImg(nx.thumb_key || t.backdrop_key, { eager: true })),
      h('div', { class: 't' }, `S${nx.season}:É${nx.number}`, h('b', {}, nx.name || 'Épisode ' + nx.number), btn));
    nextUp.classList.remove('hidden');
    if (auto) {
      let n = 5;
      btn.lastChild.textContent = `Épisode suivant dans ${n}`;
      clearCountdown();
      countdown = setInterval(() => {
        n--;
        if (n <= 0) { clearCountdown(); goNext(); return; }
        btn.lastChild.textContent = `Épisode suivant dans ${n}`;
      }, 1000);
      showUI(true);
    }
  }
  function clearCountdown() { if (countdown) clearInterval(countdown); countdown = null; }
  function goNext() {
    const nx = ep && nextEpisode(ep);
    if (!nx) return;
    persist();
    const pr = progressOf(nx.id);
    load(nx, pr && ratio(pr) < 0.95 ? pr.position : 0);
  }

  function episodesSheet() {
    const eps = episodesOf(t.id).filter((e) => e.video_key);
    const seasons = [...new Set(eps.map((e) => e.season))];
    let s = ep?.season || seasons[0];
    sheet((close) => {
      const list = h('div');
      const draw = () => list.replaceChildren(...eps.filter((e) => e.season === s).map((e) => {
        const p = ratio(progressOf(e.id));
        return h('div', { class: 'ep' + (ep && e.id === ep.id ? ' current' : ''), onclick: () => { close(); persist(); load(e, p < 0.95 && progressOf(e.id) ? progressOf(e.id).position : 0); } },
          h('div', { class: 'th' }, lazyImg(e.thumb_key || t.backdrop_key, { eager: true }), p > 0.01 ? h('div', { class: 'prog' }, h('i', { style: { width: p * 100 + '%' } })) : null),
          h('div', { class: 'ei' }, h('div', { class: 't' }, `${e.number}. ${e.name || 'Épisode ' + e.number}`, h('span', {}, runtime(e.duration)))));
      }));
      draw();
      return [h('h2', {}, t.name),
        seasons.length > 1 ? h('div', { class: 'chips', style: { padding: '0 0 10px' } }, seasons.map((x) => h('button', { class: 'chip' + (x === s ? ' active' : ''), onclick: (ev) => { s = x; ev.target.parentNode.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === ev.target)); draw(); } }, `Saison ${x}`))) : null,
        list];
    });
  }

  function fullscreen() {
    const el = root;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    if (el.requestFullscreen) el.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => video.webkitEnterFullscreen && video.webkitEnterFullscreen());
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  }

  function mediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: ep ? `${ep.name || 'Épisode ' + ep.number}` : t.name, artist: ep ? `${t.name} · S${ep.season}:É${ep.number}` : 'Blourr', album: 'Blourr' });
      navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
      navigator.mediaSession.setActionHandler('nexttrack', nextEpisode(ep || {}) ? () => goNext() : null);
    } catch { /* rien */ }
  }

  // ---------- Clavier ----------
  const onKey = (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft' || e.key === 'j') seekBy(-10);
    else if (e.key === 'ArrowRight' || e.key === 'l') seekBy(10);
    else if (e.key === 'f') fullscreen();
    else if (e.key === 'Escape' && !document.fullscreenElement) exit();
  };
  document.addEventListener('keydown', onKey);
  const onHide = () => { if (document.visibilityState === 'hidden') { persist(); flushSession(); } };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', persist);

  function exit() {
    if (closed) return;
    closed = true;
    persist();
    flushSession();
    clearInterval(tick);
    clearCountdown();
    video.pause();
    video.removeAttribute('src'); video.load();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', persist);
    window.removeEventListener('mousemove', dragMove);
    window.removeEventListener('touchmove', dragMove);
    window.removeEventListener('mouseup', dragEnd);
    window.removeEventListener('touchend', dragEnd);
    root.remove();
    document.body.style.overflow = '';
    onExit && onExit();
  }

  load(ep, start);
  showUI();
}
