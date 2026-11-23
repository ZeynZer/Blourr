import { createClient } from './vendor/supabase.js';
import { setAvatarLoader } from './ui.js';

export const SUPABASE_URL = 'https://umqztmjhvkelviddnjcm.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_g2Lz5vdW6iZxvk4ecnpp_g_Jh7y-AoV';
export const STORAGE_LIMIT = 10 * 1024 ** 3; // offre gratuite Cloudflare R2

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'blourr-auth' },
});

export const state = { session: null, profile: null, isAdmin: false, configured: null };

async function call(fn, body) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* vide */ }
  if (!res.ok || data.error) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
export const r2 = (action, payload = {}) => call('r2', { action, ...payload });
export const signup = (payload) => call('signup', payload);

// ---------- URLs signées (mises en cache) ----------
const CACHE_KEY = 'blourr-urls';
const cache = new Map();
try {
  const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  const now = Date.now();
  for (const [k, v] of Object.entries(saved)) if (v.exp > now + 60000) cache.set(k, v);
} catch { /* rien */ }
let saveT;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      const o = {}; let n = 0;
      for (const [k, v] of cache) { if (n++ > 1500) break; o[k] = v; }
      localStorage.setItem(CACHE_KEY, JSON.stringify(o));
    } catch { /* plein */ }
  }, 400);
}

let queue = new Map(); let qTimer = null;
function flush() {
  const batch = queue; queue = new Map(); qTimer = null;
  const keys = [...batch.keys()];
  for (let i = 0; i < keys.length; i += 400) {
    const part = keys.slice(i, i + 400);
    r2('sign-get', { keys: part }).then(({ urls, ttl }) => {
      const exp = Date.now() + (ttl || 21600) * 1000 - 5 * 60000;
      for (const k of part) {
        const u = urls[k];
        if (u) cache.set(k, { url: u, exp });
        batch.get(k).forEach(([res, rej]) => (u ? res(u) : rej(new Error('Fichier introuvable'))));
      }
      persist();
    }).catch((e) => part.forEach((k) => batch.get(k).forEach(([, rej]) => rej(e))));
  }
}
export function signedUrl(key) {
  if (!key) return Promise.reject(new Error('Pas de fichier'));
  const c = cache.get(key);
  if (c && c.exp > Date.now()) return Promise.resolve(c.url);
  return new Promise((res, rej) => {
    if (!queue.has(key)) queue.set(key, []);
    queue.get(key).push([res, rej]);
    if (!qTimer) qTimer = setTimeout(flush, 25);
  });
}
export async function downloadUrl(key, name) {
  const { urls } = await r2('sign-get', { keys: [key], downloads: { [key]: name } });
  return urls[key];
}
export async function removeKeys(keys) {
  keys = keys.filter(Boolean);
  if (!keys.length) return;
  keys.forEach((k) => cache.delete(k));
  await r2('delete', { keys });
}

// ---------- Envoi direct vers R2 ----------
export async function putUrls(keys) {
  const { urls } = await r2('sign-put', { keys });
  return urls;
}
export function putFile(url, body, type, onProgress, signal) {
  return new Promise((res, rej) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (type) xhr.setRequestHeader('Content-Type', type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? res() : rej(new Error(`Envoi refusé (${xhr.status})`)));
    xhr.onerror = () => rej(new Error('Connexion interrompue (vérifie le CORS du bucket)'));
    xhr.onabort = () => rej(new Error('Envoi annulé'));
    if (signal) signal.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}
export async function uploadMany(items, onProgress) {
  // items: [{key, body, type}] — envoie tout, progression globale pondérée par la taille
  const urls = await putUrls(items.map((i) => i.key));
  const total = items.reduce((a, i) => a + (i.body.size || 1), 0);
  const done = new Array(items.length).fill(0);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await putFile(urls[it.key], it.body, it.type, (p) => {
      done[i] = p * (it.body.size || 1);
      onProgress && onProgress(done.reduce((a, b) => a + b, 0) / total);
    });
    done[i] = it.body.size || 1;
  }
  onProgress && onProgress(1);
}

// ---------- Images à chargement paresseux ----------
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    loadInto(e.target);
  }
}, { rootMargin: '600px 600px' }) : null;

function loadInto(img) {
  const key = img.dataset.key;
  if (!key) return;
  signedUrl(key).then((u) => {
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => img.dispatchEvent(new Event('blourr-error'));
    img.src = u;
  }).catch(() => img.dispatchEvent(new Event('blourr-error')));
}
export function lazyImg(key, props = {}) {
  const img = document.createElement('img');
  img.alt = props.alt || '';
  img.decoding = 'async';
  if (props.class) img.className = props.class;
  if (!key) return img;
  img.dataset.key = key;
  if (io && !props.eager) io.observe(img); else loadInto(img);
  return img;
}
export async function bgInto(el, key) {
  if (!key) return;
  try { const u = await signedUrl(key); el.style.backgroundImage = `url("${u}")`; } catch { /* rien */ }
}

setAvatarLoader(lazyImg);
