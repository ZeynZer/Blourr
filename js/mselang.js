// Changement de langue sur les navigateurs qui ne savent pas le faire seuls (Chrome, Edge, Firefox sur PC).
// On lit le MP4 par morceaux, on garde la vidéo + la piste audio choisie, et on les donne au lecteur (Media Source).
import { createFile } from './vendor/mp4box.js';

const CHUNK = 4 * 1024 * 1024;
const AHEAD = 90; // secondes gardées en avance
const BEHIND = 30; // secondes gardées derrière

const clean = (url) => url.replace(/#.*$/, '');

async function getRange(url, start, end, signal) {
  const r = await fetch(clean(url), { headers: { Range: `bytes=${start}-${end}` }, signal });
  if (r.status === 416) return { buf: new ArrayBuffer(0), partial: true, total: start }; // au-delà de la fin
  if (!r.ok) throw new Error('HTTP ' + r.status);
  let buf = await r.arrayBuffer();
  if (r.status === 206) {
    const m = (r.headers.get('Content-Range') || '').match(/\/(\d+)$/);
    return { buf, partial: true, total: m ? +m[1] : null };
  }
  // le serveur (ou le cache) a renvoyé le fichier entier : on garde la partie demandée
  const total = buf.byteLength;
  buf = start >= total ? new ArrayBuffer(0) : buf.slice(start, Math.min(end + 1, total));
  return { buf, partial: true, total };
}

export const mseSupported = () => typeof window.MediaSource !== 'undefined';

// Lit le début du fichier pour connaître ses pistes audio
export async function probeTracks(url, { maxBytes = 32 * 1024 * 1024 } = {}) {
  const f = createFile();
  let info = null; let failed = null;
  f.onReady = (i) => { info = i; };
  f.onError = (e) => { failed = e; };
  let pos = 0;
  while (!info && !failed && pos < maxBytes) {
    const { buf } = await getRange(url, pos, pos + 2 * 1024 * 1024 - 1);
    if (!buf.byteLength) break;
    buf.fileStart = pos;
    const next = f.appendBuffer(buf);
    if (buf.byteLength < 2 * 1024 * 1024) { f.flush(); break; }
    pos = next || pos + buf.byteLength;
  }
  if (!info) return null;
  return {
    video: info.videoTracks[0] || null,
    audio: info.audioTracks.map((t) => ({ id: t.id, codec: t.codec, language: (t.language || '').toLowerCase(), label: t.name || '' })),
  };
}

// Joue la vidéo avec la piste audio audioId à partir de startAt (secondes)
export function msePlay(video, url, audioId, startAt = 0, { onError } = {}) {
  const ms = new MediaSource();
  const objUrl = URL.createObjectURL(ms);
  let f = null; let stopped = false; let ctrl = null; let pos = 0; let eof = false; let fileSize = Infinity; let chunk = 1024 * 1024;
  let sbs = []; const queues = new Map();
  let wake = null;
  const sleep = (ms_) => new Promise((r) => { const t = setTimeout(r, ms_); wake = () => { clearTimeout(t); r(); }; });
  const fail = (e) => { if (!stopped) { console.warn('[langue]', e); onError && onError(e); } };

  function aheadOf(t) {
    let min = Infinity;
    for (const sb of sbs) {
      let a = 0;
      for (let i = 0; i < sb.buffered.length; i++) if (sb.buffered.start(i) <= t + 0.3 && sb.buffered.end(i) > t) a = sb.buffered.end(i) - t;
      min = Math.min(min, a);
    }
    return sbs.length ? min : 0;
  }
  function pump(sb) {
    if (stopped || sb.updating || ms.readyState === 'closed') return;
    const q = queues.get(sb);
    const t = video.currentTime;
    // libère la mémoire derrière la lecture
    if (sb.buffered.length && sb.buffered.start(0) < t - BEHIND - 10) {
      try { sb.remove(0, t - BEHIND); return; } catch { /* rien */ }
    }
    if (!q.length) {
      if (eof && ms.readyState === 'open' && sbs.every((s) => !s.updating && !queues.get(s).length)) { try { ms.endOfStream(); } catch { /* rien */ } }
      return;
    }
    try { sb.appendBuffer(q[0]); q.shift(); }
    catch (e) {
      if (e.name === 'QuotaExceededError') { try { sb.remove(0, Math.max(0, t - 5)); } catch { /* rien */ } }
      else fail(e);
    }
  }

  async function feed() {
    const gen = ctrl;
    while (!stopped && gen === ctrl) {
      if (eof || aheadOf(video.currentTime) > AHEAD) { await sleep(1000); continue; }
      let res;
      const size = chunk; chunk = Math.min(CHUNK, chunk * 2); // petit morceau d'abord pour repartir vite
      try { res = await getRange(url, pos, pos + size - 1, gen.signal); }
      catch (e) { if (e.name === 'AbortError' || stopped) return; fail(e); return; }
      if (gen !== ctrl || stopped) return;
      const { buf, total } = res;
      if (total) fileSize = total;
      buf.fileStart = pos;
      if (!ready && buf.byteLength) { const c = buf.slice(0); c.fileStart = pos; head.push(c); }
      if (!buf.byteLength) { fileSize = Math.min(fileSize, pos); f.flush(); eof = true; sbs.forEach(pump); continue; }
      let next;
      try { next = f.appendBuffer(buf); }
      catch (e) { fail(e); return; }
      if (pos + buf.byteLength >= fileSize || buf.byteLength < size) { fileSize = Math.min(fileSize, pos + buf.byteLength); f.flush(); eof = true; sbs.forEach(pump); continue; }
      pos = next || pos + buf.byteLength;
    }
  }
  function restart() { ctrl?.abort(); ctrl = new AbortController(); eof = false; chunk = 1024 * 1024; feed(); }

  function onSeeking() {
    if (!f || stopped) return;
    const t = video.currentTime;
    if (aheadOf(t) > 1) return; // déjà en mémoire
    jump(t);
  }
  // Nouveau lecteur mp4box à chaque saut hors mémoire : on lui redonne l'en-tête (gardé), puis on lit depuis l'image clé
  let head = []; let ready = false; let vt = null; let at = null;
  function makeFile() {
    const nf = createFile();
    nf.onError = fail;
    nf.onReady = (info) => {
      try {
        vt = info.videoTracks[0];
        at = info.audioTracks.find((x) => x.id === audioId) || info.audioTracks[0];
        if (!sbs.length) {
          if (info.duration && info.timescale) ms.duration = info.duration / info.timescale;
          const sv = ms.addSourceBuffer(`video/mp4; codecs="${vt.codec}"`);
          const sa = ms.addSourceBuffer(`audio/mp4; codecs="${at.codec}"`);
          sbs = [sv, sa];
          for (const sb of sbs) { queues.set(sb, []); sb.addEventListener('updateend', () => pump(sb)); }
        }
        nf.setSegmentOptions(vt.id, sbs[0], { nbSamples: 48 });
        nf.setSegmentOptions(at.id, sbs[1], { nbSamples: 100 });
        for (const seg of nf.initializeSegmentation()) queues.get(seg.user).push(seg.buffer);
        nf.onSegment = (id, sb, buffer, sampleNum) => {
          if (stopped || nf !== f) return;
          nf.releaseUsedSamples(id, sampleNum); // libère la mémoire
          queues.get(sb).push(buffer); pump(sb);
        };
        nf.start();
        ready = true;
      } catch (e) { fail(e); }
    };
    return nf;
  }
  function jump(t) {
    if (!ready) return;
    ctrl?.abort();
    try { f.stop(); } catch { /* rien */ }
    for (const q of queues.values()) q.length = 0;
    f = makeFile();
    for (const hb of head) { const c = hb.slice(0); c.fileStart = hb.fileStart; f.appendBuffer(c); }
    f.seek(t, true);
    let off = Infinity;
    for (const ft of f.fragmentedTracks) {
      const smp = ft.trak.samples[ft.trak.nextSample];
      if (smp) off = Math.min(off, smp.offset);
    }
    if (!isFinite(off)) return;
    pos = off;
    restart();
  }
  const kick = () => wake && wake();

  ms.addEventListener('sourceopen', () => {
    if (stopped) return;
    f = makeFile();
    const firstReady = f.onReady;
    f.onReady = (info) => {
      firstReady(info);
      sbs.forEach(pump);
      if (startAt > 0.5) { video.currentTime = startAt; jump(startAt); }
    };
    ctrl = new AbortController();
    feed();
  }, { once: true });

  video.addEventListener('seeking', onSeeking);
  video.addEventListener('timeupdate', kick);
  video.src = objUrl;

  return {
    destroy() {
      if (stopped) return;
      stopped = true;
      ctrl?.abort();
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('timeupdate', kick);
      try { f?.stop(); } catch { /* rien */ }
      URL.revokeObjectURL(objUrl);
    },
  };
}
