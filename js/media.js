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
// Essaie de lire "S01E03" dans un nom de fichier
export function parseEpisode(filename) {
  const m = /s(\d{1,2})\s*[ex](\d{1,3})/i.exec(filename) || /(\d{1,2})x(\d{1,3})/i.exec(filename);
  if (m) return { season: +m[1], number: +m[2] };
  const e = /(?:ep|episode|épisode|e)\s*(\d{1,3})/i.exec(filename);
  if (e) return { season: null, number: +e[1] };
  return null;
}
