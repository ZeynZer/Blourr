// Traitement local des fichiers (miniatures, durée, redimensionnement)
export function kindOf(file) {
  const t = file.type || '';
  const n = (file.name || '').toLowerCase();
  if (t.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|avif)$/.test(n)) return 'photo';
  if (t.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/.test(n)) return 'video';
  return 'file';
}

function canvasBlob(canvas, q = 0.82) {
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', q));
}

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* repli */ }
  }
  return new Promise((res, rej) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(u), 1000); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Image illisible')); };
    img.src = u;
  });
}

// Redimensionne : mode 'fit' (garde le ratio, max côté) ou 'cover' (recadre en w×h)
export async function resizeImage(file, { max = 480, w, h, mode = 'fit', q = 0.82 } = {}) {
  const img = await loadImage(file);
  const iw = img.width, ih = img.height;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (mode === 'cover') {
    c.width = w; c.height = h;
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    const s = Math.min(1, max / Math.max(iw, ih));
    c.width = Math.round(iw * s); c.height = Math.round(ih * s);
    ctx.drawImage(img, 0, 0, c.width, c.height);
  }
  const blob = await canvasBlob(c, q);
  if (img.close) img.close();
  return { blob, width: iw, height: ih };
}

// Infos vidéo + image extraite (miniature)
export function videoInfo(file, { at = null, max = 640 } = {}) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const u = URL.createObjectURL(file);
    let done = false;
    const finish = (r) => { if (done) return; done = true; URL.revokeObjectURL(u); v.removeAttribute('src'); v.load(); resolve(r); };
    const timer = setTimeout(() => finish({ duration: v.duration || 0, width: v.videoWidth, height: v.videoHeight, thumb: null }), 12000);
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', '');
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) ? v.duration : 0;
      const t = at != null ? at : Math.min(Math.max(1, d * 0.12), Math.max(0, d - 0.5));
      try { v.currentTime = t; } catch { /* rien */ }
    };
    v.onseeked = async () => {
      try {
        const s = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * s) || 320; c.height = Math.round(v.videoHeight * s) || 180;
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        const thumb = await canvasBlob(c, 0.8);
        clearTimeout(timer);
        finish({ duration: isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight, thumb });
      } catch {
        clearTimeout(timer);
        finish({ duration: v.duration || 0, width: v.videoWidth, height: v.videoHeight, thumb: null });
      }
    };
    v.onerror = () => { clearTimeout(timer); finish({ duration: 0, width: 0, height: 0, thumb: null }); };
    v.src = u;
  });
}

// Sous-titres : convertit un .srt en .vtt si besoin
export async function toVtt(file) {
  let txt = await file.text();
  txt = txt.replace(/^﻿/, '').replace(/\r/g, '');
  if (!/^WEBVTT/.test(txt)) {
    txt = 'WEBVTT\n\n' + txt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }
  return new Blob([txt], { type: 'text/vtt' });
}

export function guessName(filename) {
  return (filename || '').replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// Devine saison / épisode à partir du nom de fichier (et du dossier)
// Gère : S01E03, 1x03, E03, Ep 3, Épisode 3, "Naruto - 012", "[12]", "Titre 07 VOSTFR"…
export function parseEpisode(filename, folder = '') {
  const base = (filename || '').replace(/\.[^.]+$/, '');
  let season = null; let number = null;
  let m = /s(\d{1,2})\s*[._ -]?\s*e(\d{1,4})/i.exec(base) || /\b(\d{1,2})x(\d{1,4})\b/i.exec(base);
  if (m) { season = +m[1]; number = +m[2]; }
  if (number == null && /^\s*\d{1,4}\s*$/.test(base)) number = +base.trim();
  if (number == null) {
    m = /(?:^|[^a-z])(?:ep|episode|épisode|e)[ ._-]*(\d{1,4})(?!\d)/i.exec(base)
      || /\[(\d{1,4})\]/.exec(base)
      || /[ _-]+(\d{1,4})(?:v\d)?(?=[ _.\-\[(]|$)(?![ ._-]*(?:p|bit|fps)\b)/i.exec(base.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\b(480|576|720|1080|2160)p?\b/gi, ' ').replace(/\b[xh]\.?26[45]\b/gi, ' '));
    if (m) number = +m[1];
  }
  if (season == null) {
    const s2 = /(?:saison|season|s)[ ._-]*(\d{1,2})\b/i.exec(folder) || /(?:saison|season)[ ._-]*(\d{1,2})\b/i.exec(base);
    if (s2) season = +s2[1];
  }
  return number == null && season == null ? null : { season, number };
}

// Nom d'épisode « propre » à partir du fichier
export function episodeName(filename, seriesName = '') {
  let n = (filename || '').replace(/\.[^.]+$/, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/s\d{1,2}\s*[._ -]?\s*e\d{1,4}/ig, ' ').replace(/\b\d{1,2}x\d{1,4}\b/ig, ' ')
    .replace(/\b(ep|episode|épisode)[ ._-]*\d{1,4}\b/ig, ' ')
    .replace(/\b(vostfr|vf|vff|multi|french|truefrench|1080p|720p|480p|2160p|x26[45]|h\.?26[45]|hevc|web(-?dl|rip)?|bluray|aac|ac3)\b/ig, ' ')
    .replace(/[._]+/g, ' ').replace(/\s+-\s+\d{1,4}\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (seriesName) n = n.replace(new RegExp('^' + seriesName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–:]?\\s*', 'i'), '');
  n = n.replace(/^[-–:\s\d]+$/, '').replace(/^[-–:]\s*/, '').trim();
  return n || null;
}
