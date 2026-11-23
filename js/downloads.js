// Téléchargements hors connexion : fichiers rangés dans le stockage privé de l'appareil (OPFS)
import { h, icon, toast, errToast, confirmBox, bytes, runtime } from './ui.js';
import { signedUrl, state } from './api.js';

const KEY = 'blourr-downloads';
const PROG = 'blourr-offline-progress';
const bus = new EventTarget();
export const onDownloads = (fn) => { bus.addEventListener('change', fn); return () => bus.removeEventListener('change', fn); };
const emit = () => { bus.dispatchEvent(new Event('change')); updatePill(); };
let pill = null;
function updatePill() {
  const active = Object.values(db).filter((d) => d.status === 'downloading' || d.status === 'queued');
  if (!active.length) { pill?.remove(); pill = null; return; }
  const cur = active.find((d) => d.status === 'downloading') || active[0];
  const pct = cur.size ? Math.floor((cur.progress / cur.size) * 100) : 0;
  const name = cur.episode ? `${cur.title.name} · É${cur.episode.number}` : cur.title.name;
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'dl-pill';
    pill.addEventListener('click', () => { location.hash = '#/telechargements'; });
    document.body.append(pill);
  }
  pill.innerHTML = '';
  const label = document.createElement('div'); label.className = 'dl-pill-t';
  label.textContent = `⬇ ${name} — ${cur.status === 'queued' ? 'en attente' : pct + ' %'}${active.length > 1 ? ` (+${active.length - 1})` : ''}`;
  const bar = document.createElement('div'); bar.className = 'bar';
  const fill = document.createElement('i'); fill.style.width = pct + '%'; bar.append(fill);
  pill.append(label, bar);
}

export const supported = () => !!(navigator.storage && navigator.storage.getDirectory && window.Worker);

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function save(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* plein */ } }
let db = load();
// un téléchargement interrompu (appli fermée) repasse en « à reprendre »
for (const d of Object.values(db)) if (d.status === 'downloading' || d.status === 'queued') d.status = 'paused';
save(db);

export const list = () => Object.values(db).sort((a, b) => b.addedAt - a.addedAt);
export const get = (itemId) => db[itemId] || null;
export const isDone = (itemId) => db[itemId]?.status === 'done';

// ---- progression hors ligne (en plus de celle du serveur)
export function localProgress(itemId) { try { return JSON.parse(localStorage.getItem(PROG) || '{}')[itemId] || 0; } catch { return 0; } }
export function setLocalProgress(itemId, pos) {
  try { const p = JSON.parse(localStorage.getItem(PROG) || '{}'); p[itemId] = pos; localStorage.setItem(PROG, JSON.stringify(p)); } catch { /* rien */ }
}

// ---- worker
let worker = null; const waiters = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker('js/dlworker.js');
  worker.onmessage = (e) => {
    const m = e.data; const w = waiters.get(m.id);
    if (!w) return;
    if (m.progress != null) w.onProgress?.(m.progress, m.total);
    if (m.done) { waiters.delete(m.id); w.resolve(m.size); }
    if (m.error) { waiters.delete(m.id); w.reject(new Error(m.error)); }
  };
  return worker;
}
function fetchToDisk(jobId, url, name, onProgress) {
  return new Promise((resolve, reject) => {
    waiters.set(jobId, { resolve, reject, onProgress });
    getWorker().postMessage({ id: jobId, url, name });
  });
}
async function dir() { const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle('blourr', { create: true }); }
const urlCache = new Map();
export async function fileUrl(name) {
  if (!name) return null;
  if (urlCache.has(name)) return urlCache.get(name);
  const f = await (await (await dir()).getFileHandle(name)).getFile();
  const u = URL.createObjectURL(f);
  urlCache.set(name, u);
  return u;
}
async function removeFile(name) {
  if (!name) return;
  try { const u = urlCache.get(name); if (u) URL.revokeObjectURL(u); urlCache.delete(name); await (await dir()).removeEntry(name); } catch { /* déjà absent */ }
}

// ---- file d'attente (un téléchargement à la fois)
const queue = []; let running = false;
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
const T_KEYS = ['id', 'kind', 'name', 'year', 'rating', 'genres', 'description', 'duration', 'backdrop_key', 'poster_key', 'video_key', 'subtitle_key', 'intro_start', 'intro_end', 'saga_id'];
const E_KEYS = ['id', 'title_id', 'season', 'number', 'name', 'description', 'duration', 'video_key', 'subtitle_key', 'thumb_key', 'intro_start', 'intro_end'];

export async function startDownload(title, episode = null) {
  if (!supported()) return errToast('Ton navigateur ne permet pas les téléchargements hors connexion.');
  const item = episode || title;
  if (!item.video_key) return errToast('Pas de vidéo à télécharger.');
  const id = item.id;
  if (db[id]?.status === 'done') return;
  try { await navigator.storage.persist?.(); } catch { /* rien */ }
  try {
    const est = await navigator.storage.estimate?.();
    const need = (episode ? episode.video_size : title.video_size) || 0;
    if (est && need && est.quota - est.usage < need * 1.05) return errToast(`Pas assez de place sur l'appareil (il faut ${bytes(need)}).`);
  } catch { /* rien */ }
  db[id] = {
    id, titleId: title.id, kind: episode ? 'episode' : 'movie',
    title: pick(title, T_KEYS), episode: episode ? pick(episode, E_KEYS) : null,
    video: `${id}.mp4`, sub: item.subtitle_key ? `${id}.vtt` : null, img: `${id}.jpg`,
    size: (episode ? episode.video_size : title.video_size) || 0, progress: 0, status: 'queued', addedAt: Date.now(),
  };
  save(db); emit();
  queue.push(id); pump();
}
export function startMany(title, episodes) { episodes.filter((e) => e.video_key && !isDone(e.id)).forEach((e) => startDownload(title, e)); }

async function pump() {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  const d = db[id];
  if (!d || d.status === 'done') return pump();
  running = true;
  d.status = 'downloading'; d.error = null; save(db); emit();
  try {
    const item = d.episode || d.title;
    const imgKey = d.episode ? (d.episode.thumb_key || d.title.backdrop_key) : (d.title.backdrop_key || d.title.poster_key);
    if (imgKey) await fetchToDisk(id + '-img', await signedUrl(imgKey), d.img).catch(() => { d.img = null; });
    else d.img = null;
    if (d.sub) await fetchToDisk(id + '-sub', await signedUrl(item.subtitle_key), d.sub).catch(() => { d.sub = null; });
    let lastSave = 0;
    const size = await fetchToDisk(id, await signedUrl(item.video_key), d.video, (p, total) => {
      d.progress = p; if (total) d.size = total;
      if (Date.now() - lastSave > 3000) { lastSave = Date.now(); save(db); }
      emit();
    });
    d.size = size; d.progress = size; d.status = 'done'; d.doneAt = Date.now();
    save(db); emit();
    toast(`Téléchargé : ${d.episode ? `${d.title.name} S${d.episode.season}:É${d.episode.number}` : d.title.name}`);
  } catch (e) {
    if (db[id]) { db[id].status = e.message === 'annulé' ? 'paused' : 'error'; db[id].error = e.message; save(db); emit(); }
  } finally {
    running = false;
    pump();
  }
}

export function resume(id) { const d = db[id]; if (!d) return; d.status = 'queued'; save(db); emit(); queue.push(id); pump(); }
export function cancel(id) {
  const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1);
  if (db[id]?.status === 'downloading') getWorker().postMessage({ cancel: id });
}
export async function removeDownload(id) {
  const d = db[id]; if (!d) return;
  cancel(id);
  await Promise.all([removeFile(d.video), removeFile(d.sub), removeFile(d.img)]);
  delete db[id]; save(db); emit();
}
export async function localSources(itemId) {
  const d = db[itemId];
  if (!d || d.status !== 'done') return null;
  try { return { video: await fileUrl(d.video), sub: d.sub ? await fileUrl(d.sub) : null }; } catch { return null; }
}

// ======================================================================
// Bouton « Télécharger » réutilisable (fiche film, épisodes)
// ======================================================================
export function downloadButton(title, episode = null, { compact = false } = {}) {
  const item = episode || title;
  const btn = h('button', { class: compact ? 'dl-mini' : '' });
  const draw = () => {
    const d = get(item.id);
    let ic = 'download'; let label = 'Télécharger'; let pct = null;
    if (d?.status === 'done') { ic = 'check'; label = 'Téléchargé'; }
    else if (d?.status === 'downloading') { pct = d.size ? Math.floor((d.progress / d.size) * 100) : 0; label = `${pct} %`; ic = 'x'; }
    else if (d?.status === 'queued') { label = 'En attente'; ic = 'x'; }
    else if (d?.status === 'error' || d?.status === 'paused') { label = 'Reprendre'; ic = 'refresh'; }
    let ring = null;
    if (pct != null) { ring = h('span', { class: 'dl-ring' }, h('b', {}, String(pct))); ring.style.setProperty('--p', pct); }
    btn.replaceChildren(ring || icon(ic), compact ? null : label);
    btn.classList.toggle('on', d?.status === 'done');
  };
  btn.onclick = async (e) => {
    e.stopPropagation();
    const d = get(item.id);
    if (!d) return startDownload(title, episode);
    if (d.status === 'done') {
      if (await confirmBox('Supprimer le téléchargement ?', 'Tu pourras toujours le regarder en ligne.', 'Supprimer')) removeDownload(item.id);
    } else if (d.status === 'downloading' || d.status === 'queued') cancel(item.id);
    else resume(item.id);
  };
  draw();
  const off = onDownloads(draw);
  // se désabonne quand le bouton disparaît
  const mo = new MutationObserver(() => { if (!document.body.contains(btn)) { off(); mo.disconnect(); } });
  setTimeout(() => mo.observe(document.body, { childList: true, subtree: true }), 0);
  return btn;
}

// ======================================================================
// Page « Mes téléchargements »
// ======================================================================
export function downloadsView({ openPlayer }) {
  const root = h('div', { class: 'view cine' });
  const body = h('div', { style: { padding: 'calc(var(--safe-t) + 16px) 0 0' } });
  root.append(body);
  async function draw() {
    const items = list();
    let est = null;
    try { est = await navigator.storage.estimate(); } catch { /* rien */ }
    const used = items.filter((d) => d.status === 'done').reduce((a, d) => a + (d.size || 0), 0);
    const head = h('div', { class: 'topbar', style: { background: 'none' } },
      h('button', { class: 'icon-btn', onclick: () => history.length > 1 ? history.back() : (location.hash = '#/cine') }, icon('back')),
      h('h1', { style: { fontSize: '24px' } }, 'Mes téléchargements'));
    const info = h('p', { class: 'muted small', style: { padding: '0 18px', margin: '-4px 0 14px' } },
      `${bytes(used)} sur cet appareil${est?.quota ? ` · ${bytes(Math.max(0, est.quota - est.usage))} disponibles` : ''}`,
      state.offline ? h('b', { style: { color: '#f59e0b', display: 'block', marginTop: '6px' } }, 'Hors connexion : seuls tes téléchargements sont disponibles.') : null);
    if (!supported()) { body.replaceChildren(head, h('div', { class: 'empty' }, h('p', {}, 'Ton navigateur ne permet pas les téléchargements hors connexion.'))); return; }
    if (!items.length) {
      body.replaceChildren(head, info, h('div', { class: 'empty' },
        h('div', { class: 'em-ic' }, icon('download')), h('h3', {}, 'Aucun téléchargement'),
        h('p', {}, 'Touche « Télécharger » sur la fiche d\'un film ou d\'un épisode pour le regarder sans connexion (dans l\'avion, en voyage…).')));
      return;
    }
    // regroupe les épisodes par série
    const groups = new Map();
    for (const d of items) { const k = d.titleId; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
    const rows = [];
    for (const [, g] of groups) {
      const t = g[0].title;
      if (g[0].kind === 'episode') {
        g.sort((a, b) => a.episode.season - b.episode.season || a.episode.number - b.episode.number);
        rows.push(h('div', { class: 'sec-h', style: { fontSize: '16px', paddingTop: '14px' } }, t.name));
      }
      for (const d of g) rows.push(dlRow(d));
    }
    body.replaceChildren(head, info, ...rows, h('div', { style: { height: '30px' } }));
  }
  function dlRow(d) {
    const th = h('div', { class: 'th' });
    if (d.img) fileUrl(d.img).then((u) => { th.style.backgroundImage = `url("${u}")`; }).catch(() => {});
    const pct = d.size ? Math.floor((d.progress / d.size) * 100) : 0;
    const name = d.episode ? `${d.episode.number}. ${d.episode.name || 'Épisode ' + d.episode.number}` : d.title.name;
    const sub = d.status === 'done' ? `${bytes(d.size)}${d.episode ? ` · S${d.episode.season}` : ''} · ${runtime((d.episode || d.title).duration)}`
      : d.status === 'downloading' ? `${pct} % · ${bytes(d.progress)} / ${bytes(d.size)} — garde l'appli ouverte`
      : d.status === 'queued' ? 'En attente…' : `Interrompu${d.error && d.error !== 'annulé' ? ` (${d.error})` : ''}`;
    const prog = localProgress(d.id);
    return h('div', { class: 'dl-row', onclick: () => {
      if (d.status !== 'done') return;
      openPlayer({ title: d.title, episode: d.episode, start: prog, offlineEntry: d });
    } },
      h('div', { class: 'th-wrap' }, th, d.status === 'done' ? h('div', { class: 'pi' }, icon('play')) : null,
        d.status === 'downloading' ? h('div', { class: 'bar dl-bar' }, h('i', { style: { width: pct + '%' } })) : null),
      h('div', { class: 'meta' }, h('b', {}, name), h('div', { class: 'small', style: { color: '#999' } }, sub)),
      d.status === 'done' ? null : h('button', { class: 'icon-btn', onclick: (e) => { e.stopPropagation(); d.status === 'downloading' || d.status === 'queued' ? cancel(d.id) : resume(d.id); } }, icon(d.status === 'downloading' || d.status === 'queued' ? 'x' : 'refresh')),
      h('button', { class: 'icon-btn', onclick: async (e) => { e.stopPropagation(); if (await confirmBox('Supprimer ce téléchargement ?', '', 'Supprimer')) removeDownload(d.id); } }, icon('trash')));
  }
  let t = null;
  const off = onDownloads(() => { clearTimeout(t); t = setTimeout(draw, 250); });
  root.cleanup = () => { off(); clearTimeout(t); };
  draw();
  return root;
}
