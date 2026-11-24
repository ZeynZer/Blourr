import { h, icon, clock, sheet, errToast, toast, runtime } from './ui.js';
import { sb, signedUrl, freshUrl, lazyImg } from './api.js';
import { releaseAudio } from './intro.js';
import { localSources, setLocalProgress, downloadButton, supported as dlSupported } from './downloads.js';
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

  const video = h('video', { playsinline: true, preload: 'metadata' });
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
  // Plein écran : sur iPhone, on ouvre le lecteur d'Apple (le plus fluide) ; ailleurs, le plein écran du navigateur
  const fsBtn = h('button', { title: 'Plein écran', onclick: () => fullscreen() }, icon('fullscreen'));
  const zoomBtn = isIOS ? h('button', { title: 'Remplir l\'écran', onclick: () => { root.classList.toggle('zoomed'); zoomBtn.classList.toggle('on', root.classList.contains('zoomed')); } }, icon('zoom')) : null;
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
      h('div', { class: 'pl-btns' }, volBox, speedBtn, epsBtn, langBtn, subBtn, h('div', { class: 'sp' }), nextBtn, zoomBtn, fsBtn)));

  const root = h('div', { class: 'player' }, video, flashL, flashR, loading, ui, skipIntro, nextUp);
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  if (!isIOS) video.volume = savedVol;
  video.addEventListener('volumechange', volUI);
  volUI();

  const cur = () => (ep || t);
  releaseAudio();

  // ---------- Anti-blocage : si l'image ne progresse plus, on recharge la vidéo au même endroit ----------
  let lastT = -1; let stuck = 0; let recovering = false; let retries = 0;
  async function recover(reason) {
    if (recovering || closed || retries >= 3) return;
    recovering = true; retries++;
    const at = video.currentTime || 0;
    const wasPlaying = !video.paused;
    loading.classList.remove('hidden');
    try {
      const local = isLocal ? await localSources(cur().id) : null;
      const src = local ? local.video : await freshUrl(cur().video_key);
      video.src = src;
      video.addEventListener('loadedmetadata', () => { if (at > 1) video.currentTime = at; setupLanguages(); setSubs(subsOn); }, { once: true });
      if (wasPlaying || reason === 'stall') video.play().catch(() => showUI(true));
    } catch (e) { errToast(e); }
    setTimeout(() => { recovering = false; }, 4000);
  }
  // Palier 2 : démarrer sans le son (l'iPhone en mode appli bloque parfois le départ à cause du son), puis le remettre
  let tuCount = 0; let audioCheckT = null;
  const soundBtn = h('button', { class: 'sound-unlock hidden', onclick: (e) => { e.stopPropagation(); enableSound(); } }, icon('volume'), 'Activer le son');
  function audioBlocked() {
    mutedTrick = true;
    video.muted = true;
    video.play().catch(() => {});
    soundBtn.classList.remove('hidden');
  }
  root.append(soundBtn);
  function enableSound() {
    // pendant le toucher : on redemande la main sur le son à iOS
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* rien */ }
    const t0 = video.currentTime; const tu0 = tuCount;
    video.muted = false;
    video.play().catch(() => {});
    soundBtn.classList.add('hidden');
    setTimeout(() => {
      if (closed) return;
      if (tuCount === tu0 || Math.abs(video.currentTime - t0) < 0.2) {
        video.muted = true; video.play().catch(() => {});
        soundBtn.classList.remove('hidden');
        toast('iOS bloque encore le son : ferme complètement l\'appli (balaye-la vers le haut) puis rouvre-la.', 'err');
      }
    }, 2000);
  }
  let mutedTrick = false;
  function tryMuted() {
    mutedTrick = true; retries++;
    video.muted = true;
    video.play().catch(() => {});
    const t0 = video.currentTime;
    const chk = setInterval(() => {
      if (closed) return clearInterval(chk);
      if (video.currentTime > t0 + 0.5) {
        clearInterval(chk);
        video.muted = false;
        setTimeout(() => {
          if (video.paused || video.muted) { video.muted = true; video.play().catch(() => {}); toast('Touche 🔊 en bas à gauche pour remettre le son'); showUI(true); }
        }, 600);
      }
    }, 300);
    setTimeout(() => clearInterval(chk), 10000);
  }
  const watchdog = setInterval(() => {
    if (video.paused || video.seeking || video.ended || !video.src || recovering) { stuck = 0; lastT = video.currentTime; return; }
    if (Math.abs(video.currentTime - lastT) < 0.01) stuck++; else { stuck = 0; retries = 0; }
    lastT = video.currentTime;
    // données disponibles mais image figée : ~6 s ; en attente du réseau : ~16 s
    if (stuck >= (video.readyState >= 3 ? 3 : 8)) {
      stuck = 0;
      if (retries === 0) recover('stall');
      else if (retries === 1 && !mutedTrick) tryMuted();
      else if (retries === 2) { retries++; toast('La vidéo ne démarre pas : ferme complètement l\'appli puis rouvre-la.', 'err'); }
    }
  }, 2000);

  // ---------- Chargement d'une vidéo ----------
  let startAt = 0; let isLocal = false;
  async function load(e, from) {
    // « amorce » la vidéo pendant le toucher (iPhone en mode appli exige un geste pour lancer la lecture)
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
      const local = await localSources(item.id);
      isLocal = !!local;
      const [src, sub] = local ? [local.video, local.sub] : await Promise.all([signedUrl(item.video_key), item.subtitle_key ? signedUrl(item.subtitle_key) : null]);
      if (closed) return;
      subBtn.classList.toggle('hidden', !sub);
      if (sub) {
        video.crossOrigin = 'anonymous';
        const tr = h('track', { kind: 'subtitles', srclang: 'fr', label: 'Français', src: sub, default: true });
        video.append(tr);
        tr.addEventListener('load', () => setSubs(subsOn));
      } else video.removeAttribute('crossorigin');
      startAt = from > 5 ? from : 0;
      video.src = startAt && !isLocal ? `${src}#t=${Math.floor(startAt)}` : src;
      video.load();
      video.playbackRate = SPEEDS[speedIdx];
      video.addEventListener('loadedmetadata', () => {
        const d = video.duration || 0;
        if (startAt && d && startAt >= d - 15) video.currentTime = 0;
        else if (startAt && Math.abs(video.currentTime - startAt) > 3) video.currentTime = startAt;
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
  if (video.audioTracks) {
    video.audioTracks.addEventListener('addtrack', () => setupLanguages());
    video.audioTracks.addEventListener('removetrack', () => setupLanguages());
  }
  function currentTrack() { return tracks().findIndex((t) => t.enabled); }
  function selectTrack(i) {
    tracks().forEach((t, j) => { t.enabled = j === i; });
    const t = tracks()[i];
    try { localStorage.setItem('blourr-lang', (t.language || '').toLowerCase()); } catch { /* rien */ }
    langBtn.lastChild.textContent = trackName(t, i);
  }
  function setupLanguages() {
    const list = tracks();
    // Bouton toujours visible quand le navigateur sait changer de piste (Safari / iPhone)
    langBtn.classList.toggle('hidden', !video.audioTracks);
    if (list.length === 1) langBtn.lastChild.textContent = trackName(list[0], 0);
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
      list.length < 2 ? h('p', { class: 'muted', style: { marginTop: '-6px' } }, ep ? 'Cet épisode n\'existe qu\'en une seule langue.' : 'Ce film n\'existe qu\'en une seule langue.') : null,
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
  video.addEventListener('playing', () => {
    loading.classList.add('hidden'); showUI();
    // iOS (appli installée) : si le son de l'iPhone est « bloqué » (ex. après YouTube, Spotify, un appel),
    // la vidéo dit jouer mais son horloge ne bouge pas. On la relance alors sans le son, puis on propose de le réactiver.
    const tStart = video.currentTime; const tu0 = tuCount;
    clearTimeout(audioCheckT);
    audioCheckT = setTimeout(() => {
      if (closed || video.paused || video.muted) return;
      if (tuCount === tu0 && Math.abs(video.currentTime - tStart) < 0.05) audioBlocked();
    }, 2500);
  });
  video.addEventListener('timeupdate', () => { tuCount++; });
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
    if (!video.error || !video.src) return;
    // lien expiré ou coupure réseau : on réessaie avec un lien neuf, puis on affiche l'erreur
    if (retries < 3 && video.error.code !== 4) { recover('error'); return; }
    errToast(video.error.code === 4 ? 'Format vidéo non pris en charge sur cet appareil.' : 'Lecture impossible, vérifie ta connexion.');
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
    setLocalProgress(cur().id, finished ? 0 : pos);
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
          h('div', { class: 'ei' }, h('div', { class: 't' }, `${e.number}. ${e.name || 'Épisode ' + e.number}`), h('p', {}, runtime(e.duration))),
          dlSupported() ? downloadButton(t, e, { compact: true }) : null);
      }));
      draw();
      return [h('h2', {}, t.name),
        seasons.length > 1 ? h('div', { class: 'chips', style: { padding: '0 0 10px' } }, seasons.map((x) => h('button', { class: 'chip' + (x === s ? ' active' : ''), onclick: (ev) => { s = x; ev.target.parentNode.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === ev.target)); draw(); } }, `Saison ${x}`))) : null,
        list];
    });
  }

  function fullscreen() {
    if (isIOS && video.webkitEnterFullscreen) {
      try { if (video.paused) video.play().catch(() => {}); video.webkitEnterFullscreen(); } catch { /* rien */ }
      return;
    }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    const el = root;
    if (el.requestFullscreen) el.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
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
  const onHide = () => {
    if (document.visibilityState === 'hidden') { persist(); flushSession(); }
    else { stuck = 0; lastT = video.currentTime; }
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', persist);

  function exit() {
    if (closed) return;
    closed = true;
    persist();
    flushSession();
    clearInterval(tick);
    clearInterval(watchdog);
    clearTimeout(audioCheckT);
    clearCountdown();
    // libère complètement le lecteur vidéo de l'iPhone (sinon il reste occupé et bloque les vidéos suivantes)
    releaseVideo(video);
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        ['seekbackward', 'seekforward', 'nexttrack', 'play', 'pause'].forEach((a) => { try { navigator.mediaSession.setActionHandler(a, null); } catch { /* rien */ } });
      }
    } catch { /* rien */ }
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

// Arrête et décharge une vidéo pour libérer le décodeur (indispensable sur iPhone)
export function releaseVideo(v) {
  if (!v) return;
  try {
    v.pause();
    v.querySelectorAll('track, source').forEach((x) => x.remove());
    v.removeAttribute('src');
    v.srcObject = null;
    v.load();
  } catch { /* rien */ }
}
