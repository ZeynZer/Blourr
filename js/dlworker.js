// Worker de téléchargement : écrit le fichier morceau par morceau sur le stockage privé de l'appareil (OPFS),
// sans jamais charger toute la vidéo en mémoire.
const jobs = new Map();

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.cancel) { jobs.get(msg.cancel)?.abort(); return; }
  const { id, url, name } = msg;
  const ctrl = new AbortController();
  jobs.set(id, ctrl);
  let access = null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('blourr', { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    access = await fh.createSyncAccessHandle();
    access.truncate(0);
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Téléchargement refusé (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    let done = 0; let last = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      access.write(value, { at: done });
      done += value.byteLength;
      const now = Date.now();
      if (now - last > 400) { last = now; self.postMessage({ id, progress: done, total }); }
    }
    access.flush();
    access.close(); access = null;
    self.postMessage({ id, done: true, size: done });
  } catch (err) {
    try { access?.close(); } catch { /* rien */ }
    self.postMessage({ id, error: err.name === 'AbortError' ? 'annulé' : (err.message || String(err)) });
  } finally {
    jobs.delete(id);
  }
};
