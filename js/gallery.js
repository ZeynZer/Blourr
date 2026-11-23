import { h, icon, toast, errToast, sheet, confirmBox, promptBox, bytes, clock, monthLabel, dateFr, avatar, uid, ext, sleep } from './ui.js';
import { sb, state, lazyImg, signedUrl, downloadUrl, removeKeys, putUrls, putFile, STORAGE_LIMIT } from './api.js';
import { kindOf, resizeImage, videoInfo } from './media.js';
import { costLabel } from './donate.js';
import { go } from './router.js';

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const bus = new EventTarget();
const PAGE = 240;

// ======================================================================
// Vue principale de la galerie (et d'un album)
// ======================================================================
export function galleryView({ albumId = null, tab = 'all' } = {}) {
  let filter = albumId ? 'all' : tab;
  let items = [];
  let reachedEnd = false;
  let loadingMore = false;
  let selecting = false;
  const selected = new Set();
  let album = null;

  const content = h('div');
  const usage = h('span', { class: 'storage-chip' }, '…');
  const selBtn = h('button', { class: 'icon-btn', title: 'Sélectionner', onclick: () => toggleSelect() }, icon('select'));
  const back = albumId ? h('button', { class: 'icon-btn', onclick: () => go('#/galerie/albums') }, icon('back')) : null;
  const title = h('h1', {}, albumId ? 'Album' : 'Galerie');
  const albumMenu = albumId ? h('button', { class: 'icon-btn', onclick: () => albumActions() }, icon('edit')) : null;
  const top = h('div', { class: 'topbar' }, back, title, albumId ? null : usage, albumMenu, selBtn);

  const chipDefs = [['all', 'Tout'], ['photo', 'Photos'], ['video', 'Vidéos'], ['file', 'Fichiers'], ['albums', 'Albums']];
  const chips = albumId ? null : h('div', { class: 'chips' }, chipDefs.map(([k, l]) =>
    h('button', { class: 'chip' + (k === filter ? ' active' : ''), 'data-k': k, onclick: () => go(k === 'all' ? '#/galerie' : '#/galerie/' + k) }, l)));

  const banner = h('div');
  const fab = h('button', { class: 'fab', title: 'Ajouter', onclick: () => pickFiles() }, icon('plus'));
  const selbar = h('div', { class: 'selbar hidden' });
  const sentinel = h('div', { style: { height: '1px' } });

  const root = h('div', { class: 'view' + (selecting ? ' selecting' : '') }, top, chips, banner, content, sentinel, fab, selbar);

  // ---- bannière stockage non configuré
  if (state.configured === false) {
    banner.append(h('div', { class: 'banner' }, icon('cloud'),
      h('div', { class: 'grow' }, state.isAdmin
        ? h('span', {}, 'Le stockage n\'est pas encore branché. ', h('a', { href: '#/profil', style: { textDecoration: 'underline', fontWeight: 700 } }, 'Configurer Cloudflare R2'))
        : 'Le stockage n\'est pas encore configuré par l\'administrateur.')));
  }

  async function loadUsage() {
    try {
      const { data } = await sb.rpc('storage_usage');
      if (data) {
        const used = Number(data.gallery) + Number(data.cine);
        usage.textContent = costLabel(used);
        usage.title = `${bytes(used)} stockés`;
      }
    } catch { /* rien */ }
  }

  async function load(more = false) {
    if (filter === 'albums') return renderAlbums();
    if (!more) { items = []; reachedEnd = false; content.replaceChildren(h('div', { class: 'center-load' }, h('div', { class: 'spinner' }))); }
    loadingMore = true;
    let q = sb.from('media').select('*, owner:profiles(id, display_name, color, avatar_key)').order('created_at', { ascending: false }).range(items.length, items.length + PAGE - 1);
    if (albumId) q = q.eq('album_id', albumId); else q = q.eq('is_private', false);
    if (filter === 'photo' || filter === 'video' || filter === 'file') q = q.eq('kind', filter);
    const { data, error } = await q;
    loadingMore = false;
    if (error) { content.replaceChildren(h('div', { class: 'empty' }, h('p', {}, error.message))); return; }
    items = items.concat(data);
    if (data.length < PAGE) reachedEnd = true;
    render();
  }

  function render() {
    if (!items.length) {
      const what = { photo: 'photo', video: 'vidéo', file: 'fichier' }[filter];
      content.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'em-ic' }, icon(filter === 'file' ? 'file' : filter === 'video' ? 'video' : 'images')),
        h('h3', {}, albumId ? 'Album vide' : what ? `Aucun ${what} pour l'instant` : 'Rien ici pour l\'instant'),
        h('p', {}, album?.private ? 'Ajoute ici tes fichiers privés : personne d\'autre ne les verra.' : 'Ajoute les premiers souvenirs de la famille.'),
        h('button', { class: 'btn primary', onclick: () => pickFiles() }, icon('upload'), 'Ajouter')));
      return;
    }
    content.replaceChildren();
    if (filter === 'file') {
      content.append(h('div', { class: 'files' }, items.map(fileRow)));
      return;
    }
    // Les fichiers non-média s'affichent en liste en bas en mode « Tout »
    const visual = items.filter((m) => m.kind !== 'file');
    const files = items.filter((m) => m.kind === 'file');
    const groups = new Map();
    for (const m of visual) {
      const d = new Date(m.taken_at || m.created_at);
      const k = d.getFullYear() * 100 + d.getMonth();
      if (!groups.has(k)) groups.set(k, { label: monthLabel(d), list: [] });
      groups.get(k).list.push(m);
    }
    const sorted = [...groups.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, g] of sorted) {
      content.append(h('div', { class: 'month' }, g.label, h('span', {}, g.list.length + ' élément' + (g.list.length > 1 ? 's' : ''))));
      content.append(h('div', { class: 'grid' }, g.list.map((m) => tile(m, visual))));
    }
    if (files.length) {
      content.append(h('div', { class: 'month' }, 'Fichiers', h('span', {}, String(files.length))));
      content.append(h('div', { class: 'files' }, files.map(fileRow)));
    }
  }

  function tile(m, list) {
    const img = lazyImg(m.thumb_key, { alt: m.name || '' });
    const t = h('div', { class: 'tile' + (selected.has(m.id) ? ' sel' : ''), 'data-id': m.id },
      m.thumb_key ? img : h('div', { class: 'ph' }, icon(m.kind === 'video' ? 'video' : 'images')),
      m.kind === 'video' ? h('div', { class: 'badge' }, icon('play'), m.duration ? clock(m.duration) : '') : null,
      h('div', { class: 'check' }, icon('check')));
    img.addEventListener('blourr-error', () => img.replaceWith(h('div', { class: 'ph' }, icon(m.kind === 'video' ? 'video' : 'images'))));
    t.addEventListener('click', () => {
      if (selecting) { toggleItem(m.id, t); return; }
      openViewer(list, list.indexOf(m), { onChange: refresh });
    });
    longPress(t, () => { if (!selecting) toggleSelect(); toggleItem(m.id, t); });
    return t;
  }

  function fileRow(m) {
    const row = h('div', { class: 'file-row' + (selected.has(m.id) ? ' sel' : ''), 'data-id': m.id },
      h('div', { class: 'fi' }, ext(m.name).slice(0, 4)),
      h('div', { class: 'meta' },
        h('div', { class: 'name' }, m.name || 'Fichier'),
        h('div', { class: 'sub' }, `${bytes(m.size)} · ${m.owner?.display_name || '—'} · ${dateFr(m.created_at)}`)),
      h('button', { class: 'icon-btn', onclick: (e) => { e.stopPropagation(); saveItems([m]); } }, icon('download')));
    row.addEventListener('click', () => {
      if (selecting) { toggleItem(m.id, row); return; }
      itemSheet(m, refresh);
    });
    longPress(row, () => { if (!selecting) toggleSelect(); toggleItem(m.id, row); });
    return row;
  }

  // ---- sélection multiple
  function toggleSelect(force) {
    selecting = force ?? !selecting;
    if (!selecting) { selected.clear(); root.querySelectorAll('.sel').forEach((e) => e.classList.remove('sel')); }
    root.classList.toggle('selecting', selecting);
    selBtn.replaceChildren(icon(selecting ? 'x' : 'select'));
    fab.classList.toggle('hidden', selecting);
    updateSelbar();
  }
  function toggleItem(id, el) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    el.classList.toggle('sel', selected.has(id));
    updateSelbar();
  }
  function updateSelbar() {
    selbar.classList.toggle('hidden', !selecting);
    const n = selected.size;
    const chosen = () => items.filter((m) => selected.has(m.id));
    selbar.replaceChildren(
      h('div', { class: 'count' }, n ? `${n} sélectionné${n > 1 ? 's' : ''}` : 'Touche pour choisir'),
      h('button', { class: 'icon-btn', disabled: !n, title: 'Télécharger', onclick: () => n && saveItems(chosen()) }, icon('download')),
      h('button', { class: 'icon-btn', disabled: !n, title: 'Album', onclick: () => n && pickAlbum(chosen(), () => { toggleSelect(false); refresh(); }) }, icon('album')),
      h('button', { class: 'icon-btn', disabled: !n, title: 'Supprimer', style: { color: 'var(--danger)' }, onclick: async () => {
        if (!n) return;
        const list = chosen();
        const mine = list.filter(canDelete);
        if (!mine.length) return toast('Tu ne peux supprimer que tes propres envois.', 'err');
        if (!(await confirmBox(`Supprimer ${mine.length} élément${mine.length > 1 ? 's' : ''} ?`, 'Ils seront effacés pour toute la famille.', 'Supprimer'))) return;
        await deleteItems(mine); toggleSelect(false); refresh();
      } }, icon('trash')));
  }

  // ---- albums
  async function renderAlbums() {
    content.replaceChildren(h('div', { class: 'center-load' }, h('div', { class: 'spinner' })));
    const [{ data: albums }, { data: med }] = await Promise.all([
      sb.from('albums').select('*').order('created_at', { ascending: false }),
      sb.from('media').select('album_id, thumb_key, created_at').not('album_id', 'is', null).order('created_at', { ascending: false }),
    ]);
    const counts = {}; const covers = {};
    for (const m of med || []) { counts[m.album_id] = (counts[m.album_id] || 0) + 1; if (!covers[m.album_id] && m.thumb_key) covers[m.album_id] = m.thumb_key; }
    const grid = h('div', { class: 'albums' },
      h('div', { class: 'album-card new', onclick: () => newAlbum() }, h('div', { class: 'cover' }, icon('plus')), h('div', { class: 't' }, 'Nouvel album'), h('div', { class: 'c' }, ' ')),
      (albums || []).sort((a, b) => (b.private ? 1 : 0) - (a.private ? 1 : 0)).map((a) => h('div', { class: 'album-card' + (a.private ? ' private' : ''), onclick: () => go('#/album/' + a.id) },
        h('div', { class: 'cover' }, covers[a.id] ? lazyImg(covers[a.id]) : icon(a.private ? 'lock' : 'album'), a.private ? h('span', { class: 'lock-badge' }, icon('lock'), 'Privé') : null),
        h('div', { class: 't' }, a.name),
        h('div', { class: 'c' }, `${counts[a.id] || 0} élément${(counts[a.id] || 0) > 1 ? 's' : ''}`))));
    content.replaceChildren(grid);
  }

  function newAlbum() {
    const nameIn = h('input', { class: 'input', placeholder: 'Ex : Vacances 2026' });
    const priv = h('input', { type: 'checkbox' });
    sheet((close) => [
      h('h2', {}, 'Nouvel album'),
      nameIn,
      state.isAdmin ? h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '16px 0 4px' } },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, '🔒 Album privé'), h('div', { class: 'small muted' }, 'Visible uniquement par toi. Son contenu n\'apparaît nulle part ailleurs.')),
        h('label', { class: 'switch' }, priv, h('span'))) : null,
      h('button', { class: 'btn primary block', style: { marginTop: '16px' }, onclick: async () => {
        const name = nameIn.value.trim();
        if (!name) return errToast('Donne un nom à l\'album.');
        const { data, error } = await sb.from('albums').insert({ name, created_by: state.profile.id, private: priv.checked }).select().single();
        if (error) return errToast(error);
        close(); go('#/album/' + data.id);
      } }, 'Créer'),
    ]);
    setTimeout(() => nameIn.focus(), 250);
  }

  function drawTitle() {
    title.replaceChildren(album?.private ? icon('lock') : null, album?.name || 'Album introuvable');
  }

  async function albumActions() {
    sheet((close) => [
      h('h2', {}, album?.name || 'Album'),
      state.isAdmin && album?.created_by === state.profile.id ? h('button', { class: 'list-btn', onclick: async () => {
        close();
        const to = !album.private;
        if (!(await confirmBox(to ? 'Rendre l\'album privé ?' : 'Rendre l\'album public ?', to ? 'Son contenu ne sera plus visible que par toi.' : 'Toute la famille pourra voir son contenu.', to ? 'Rendre privé' : 'Rendre public', false))) return;
        const { error } = await sb.from('albums').update({ private: to }).eq('id', albumId);
        if (error) return errToast(error);
        album.private = to; drawTitle(); toast(to ? 'Album privé' : 'Album visible par la famille');
      } }, icon('lock'), album?.private ? 'Rendre public' : 'Rendre privé') : null,
      h('button', { class: 'list-btn', onclick: async () => {
        close();
        const name = await promptBox('Renommer l\'album', { value: album.name, ok: 'Renommer' });
        if (!name) return;
        const { error } = await sb.from('albums').update({ name }).eq('id', albumId);
        if (error) return errToast(error);
        album.name = name; title.textContent = name;
      } }, icon('edit'), 'Renommer'),
      h('button', { class: 'list-btn danger', onclick: async () => {
        close();
        if (album?.private) {
          if (!(await confirmBox('Supprimer l\'album privé ?', 'Tout son contenu sera supprimé définitivement.', 'Tout supprimer'))) return;
          const { data: inside } = await sb.from('media').select('*').eq('album_id', albumId);
          if (inside?.length) await deleteItems(inside);
        } else if (!(await confirmBox('Supprimer l\'album ?', 'Les photos et vidéos restent dans la galerie.', 'Supprimer'))) return;
        const { error } = await sb.from('albums').delete().eq('id', albumId);
        if (error) return errToast(error);
        go('#/galerie/albums');
      } }, icon('trash'), 'Supprimer l\'album'),
    ]);
  }

  function pickFiles() {
    if (state.configured === false) return toast('Le stockage n\'est pas encore configuré.', 'err');
    sheet((close) => [
      h('h2', {}, 'Ajouter'),
      h('button', { class: 'list-btn', onclick: () => { close(); chooseFiles('image/*,video/*'); } }, icon('images'), 'Photos et vidéos'),
      h('button', { class: 'list-btn', onclick: () => { close(); chooseFiles(''); } }, icon('folder'), 'Fichiers (PDF, documents…)'),
    ]);
  }
  function chooseFiles(accept) {
    const inp = h('input', { type: 'file', multiple: true, accept: accept || undefined, style: { display: 'none' } });
    inp.addEventListener('change', () => { if (inp.files.length) uploadFiles([...inp.files], albumId); inp.remove(); });
    document.body.append(inp);
    inp.click();
  }

  function refresh() { load(); loadUsage(); }

  // ---- défilement infini
  const io = new IntersectionObserver((e) => {
    if (e[0].isIntersecting && !reachedEnd && !loadingMore && items.length && filter !== 'albums') load(true);
  }, { rootMargin: '800px' });
  io.observe(sentinel);

  const onChanged = () => refresh();
  bus.addEventListener('changed', onChanged);
  root.cleanup = () => { bus.removeEventListener('changed', onChanged); io.disconnect(); };

  (async () => {
    if (albumId) {
      const { data } = await sb.from('albums').select('*').eq('id', albumId).maybeSingle();
      album = data;
      drawTitle();
    }
    load(); loadUsage();
  })();
  return root;
}

function canDelete(m) { return state.isAdmin || m.owner_id === state.profile?.id; }

function longPress(el, fn) {
  let t; let moved = false;
  el.addEventListener('touchstart', () => { moved = false; t = setTimeout(() => { if (!moved) { fn(); el.dataset.lp = '1'; } }, 480); }, { passive: true });
  el.addEventListener('touchmove', () => { moved = true; clearTimeout(t); }, { passive: true });
  el.addEventListener('touchend', (e) => { clearTimeout(t); if (el.dataset.lp) { e.preventDefault(); delete el.dataset.lp; } });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ======================================================================
// Envoi de fichiers (file d'attente persistante pendant la navigation)
// ======================================================================
let upPanel = null; let upList = null; let upHead = null; const queue = []; let running = 0;
function ensurePanel() {
  if (!(upPanel && document.body.contains(upPanel))) {
    upHead = h('div', { class: 'head' });
    upList = h('div', { class: 'list' });
    upPanel = h('div', { class: 'uploads' }, upHead, upList);
    document.body.append(upPanel);
  }
  upHead.replaceChildren(h('div', { class: 'spinner', style: { width: '18px', height: '18px', borderWidth: '2px' } }), h('span', { class: 'grow' }, 'Envoi en cours…'));
}
function updateHead() {
  const left = queue.filter((q) => !q.done).length;
  if (!left) {
    upHead.replaceChildren(icon('check'), h('span', { class: 'grow' }, 'Envoi terminé'),
      h('button', { class: 'icon-btn plain', onclick: () => { upPanel.remove(); upPanel = null; queue.length = 0; } }, icon('x')));
    upHead.firstChild.style.cssText = 'width:20px;height:20px;color:var(--ok)';
    setTimeout(() => { if (upPanel && !queue.some((q) => !q.done)) { upPanel.remove(); upPanel = null; queue.length = 0; } }, 3500);
  } else {
    upHead.lastChild.textContent = `Envoi en cours… (${left} restant${left > 1 ? 's' : ''}) — garde l'appli ouverte`;
  }
}

export function uploadFiles(files, albumId = null) {
  ensurePanel();
  for (const f of files) {
    const bar = h('i');
    const pct = h('span', {}, '0 %');
    const el = h('div', { class: 'up-item' }, h('div', { class: 'n' }, h('b', {}, f.name), pct), h('div', { class: 'bar' }, bar));
    upList.append(el);
    queue.push({ file: f, albumId, el, bar, pct, done: false });
  }
  updateHead();
  pump();
}
function pump() {
  while (running < 2) {
    const job = queue.find((q) => !q.started);
    if (!job) break;
    job.started = true; running++;
    runJob(job).catch((e) => {
      job.el.classList.add('fail'); job.pct.textContent = 'Échec';
      toast(`${job.file.name} : ${e.message}`, 'err');
    }).finally(() => { job.done = true; running--; updateHead(); pump(); });
  }
}
async function runJob(job) {
  const f = job.file;
  const me = state.profile.id;
  const id = uid();
  const kind = kindOf(f);
  const key = `g/${me}/${id}.${ext(f.name)}`;
  const row = { id, owner_id: me, album_id: job.albumId, kind, key, name: f.name, mime: f.type || null, size: f.size, taken_at: f.lastModified ? new Date(f.lastModified).toISOString() : null };
  let thumb = null;
  try {
    if (kind === 'photo') { const r = await resizeImage(f, { max: 520 }); thumb = r.blob; row.width = r.width; row.height = r.height; }
    else if (kind === 'video') { const r = await videoInfo(f, { max: 520 }); thumb = r.thumb; row.duration = r.duration || null; row.width = r.width || null; row.height = r.height || null; }
  } catch { /* miniature facultative */ }
  if (thumb) row.thumb_key = `g/${me}/${id}_t.jpg`;
  const urls = await putUrls(row.thumb_key ? [key, row.thumb_key] : [key]);
  if (thumb) await putFile(urls[row.thumb_key], thumb, 'image/jpeg');
  await putFile(urls[key], f, f.type || 'application/octet-stream', (p) => {
    job.bar.style.width = (p * 100).toFixed(1) + '%';
    job.pct.textContent = Math.round(p * 100) + ' %';
  });
  const { error } = await sb.from('media').insert(row);
  if (error) { await removeKeys([key, row.thumb_key]); throw error; }
  job.bar.style.width = '100%'; job.pct.textContent = 'OK'; job.el.classList.add('done');
  bus.dispatchEvent(new Event('changed'));
}

// ======================================================================
// Téléchargement / partage
// ======================================================================
export async function saveItems(list) {
  if (isIOS && navigator.canShare && list.every((m) => m.size < 400 * 1024 * 1024)) {
    // Sur iPhone : on prépare les fichiers puis on ouvre la feuille de partage (Enregistrer dans Photos / Fichiers)
    let files = []; let cancelled = false;
    const status = h('p', { class: 'muted' }, 'Préparation…');
    const bar = h('i');
    const go2 = h('button', { class: 'btn primary block', disabled: true }, icon('download'), 'Enregistrer');
    const close = sheet(() => [h('h2', {}, list.length > 1 ? `${list.length} éléments` : (list[0].name || 'Fichier')), status, h('div', { class: 'bar', style: { margin: '6px 0 18px' } }, bar), go2], { onClose: () => { cancelled = true; } });
    try {
      let n = 0;
      for (const m of list) {
        const u = await signedUrl(m.key);
        const b = await (await fetch(u)).blob();
        files.push(new File([b], m.name || 'fichier', { type: m.mime || b.type || 'application/octet-stream' }));
        n++; bar.style.width = (n / list.length * 100) + '%';
        if (cancelled) return;
      }
      if (!navigator.canShare({ files })) throw new Error('partage impossible');
      status.textContent = 'Prêt ! Choisis « Enregistrer » dans la feuille de partage.';
      go2.disabled = false;
      go2.onclick = async () => { try { await navigator.share({ files }); close(); } catch (e) { if (e.name !== 'AbortError') errToast(e); } };
    } catch {
      close();
      await linkDownload(list);
    }
    return;
  }
  await linkDownload(list);
}
async function linkDownload(list) {
  try {
    for (const m of list) {
      const u = await downloadUrl(m.key, m.name || 'fichier');
      const a = h('a', { href: u, download: m.name || '', target: isIOS ? '_blank' : '', rel: 'noopener' });
      document.body.append(a); a.click(); a.remove();
      await sleep(700);
    }
  } catch (e) { errToast(e); }
}

async function deleteItems(list) {
  try {
    const ids = list.map((m) => m.id);
    const { error } = await sb.from('media').delete().in('id', ids);
    if (error) throw error;
    await removeKeys(list.flatMap((m) => [m.key, m.thumb_key]));
    toast(list.length > 1 ? `${list.length} éléments supprimés` : 'Supprimé');
  } catch (e) { errToast(e); }
}

async function pickAlbum(list, after) {
  const { data: albums } = await sb.from('albums').select('*').order('created_at', { ascending: false });
  const assign = async (albumId) => {
    const { error } = await sb.from('media').update({ album_id: albumId }).in('id', list.map((m) => m.id));
    if (error) return errToast(error);
    toast(albumId ? 'Ajouté à l\'album' : 'Retiré de l\'album');
    after && after();
  };
  sheet((close) => [
    h('h2', {}, 'Ajouter à un album'),
    h('button', { class: 'list-btn', onclick: async () => {
      close();
      const name = await promptBox('Nouvel album', { placeholder: 'Nom de l\'album', ok: 'Créer' });
      if (!name) return;
      const { data, error } = await sb.from('albums').insert({ name, created_by: state.profile.id }).select().single();
      if (error) return errToast(error);
      assign(data.id);
    } }, icon('plus'), 'Nouvel album'),
    (albums || []).map((a) => h('button', { class: 'list-btn', onclick: () => { close(); assign(a.id); } }, icon('album'), a.name)),
    list.some((m) => m.album_id) ? h('button', { class: 'list-btn danger', onclick: () => { close(); assign(null); } }, icon('x'), 'Retirer de l\'album') : null,
  ]);
}

function itemSheet(m, after) {
  sheet((close) => [
    h('h2', { style: { wordBreak: 'break-word' } }, m.name || 'Fichier'),
    h('p', { class: 'muted small', style: { marginTop: '-8px' } }, `${bytes(m.size)} · envoyé par ${m.owner?.display_name || '—'} le ${dateFr(m.created_at)}`),
    h('button', { class: 'list-btn', onclick: () => { close(); saveItems([m]); } }, icon('download'), 'Télécharger'),
    h('button', { class: 'list-btn', onclick: () => { close(); pickAlbum([m], after); } }, icon('album'), 'Ajouter à un album'),
    canDelete(m) ? h('button', { class: 'list-btn danger', onclick: async () => {
      close();
      if (!(await confirmBox('Supprimer ce fichier ?', 'Il sera effacé pour toute la famille.', 'Supprimer'))) return;
      await deleteItems([m]); after && after();
    } }, icon('trash'), 'Supprimer') : null,
  ]);
}

// ======================================================================
// Visionneuse plein écran (photos & vidéos, balayage)
// ======================================================================
export function openViewer(list, index, { onChange } = {}) {
  let i = index;
  const stage = h('div', { class: 'stage' });
  const name = h('div', { class: 'grow', style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } });
  const counter = h('span', { class: 'muted small' });
  const who = h('div', { class: 'who' });
  const actions = h('div', { class: 'actions' });
  const v = h('div', { class: 'viewer' },
    h('div', { class: 'vtop' }, h('button', { class: 'icon-btn', onclick: () => close() }, icon('x')), name, counter),
    stage,
    h('button', { class: 'icon-btn nav-arrow l', onclick: () => step(-1) }, icon('back')),
    h('button', { class: 'icon-btn nav-arrow r', onclick: () => step(1) }, icon('next')),
    h('div', { class: 'vbot' }, who, actions));
  document.body.append(v);
  document.body.style.overflow = 'hidden';

  function close() {
    stage.querySelectorAll('video').forEach((x) => x.pause());
    v.remove(); document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
  document.addEventListener('keydown', onKey);

  function step(d) {
    const n = i + d;
    if (n < 0 || n >= list.length) return;
    i = n; show();
  }

  function show() {
    const m = list[i];
    stage.querySelectorAll('video').forEach((x) => x.pause());
    stage.replaceChildren();
    name.textContent = m.name || '';
    counter.textContent = `${i + 1}/${list.length}`;
    who.replaceChildren(avatar(m.owner), h('div', { class: 'grow' },
      h('div', { style: { fontWeight: 600, fontSize: '14px' } }, m.owner?.display_name || 'Ancien membre'),
      h('div', { class: 'muted small' }, `${dateFr(m.taken_at || m.created_at)} · ${bytes(m.size)}`)));
    if (m.kind === 'video') {
      const vid = h('video', { controls: true, playsinline: true, autoplay: true, preload: 'metadata' });
      vid.setAttribute('playsinline', '');
      if (m.thumb_key) signedUrl(m.thumb_key).then((u) => { vid.poster = u; }).catch(() => {});
      signedUrl(m.key).then((u) => { vid.src = u; }).catch(errToast);
      stage.append(vid);
    } else {
      const img = h('img', { alt: m.name || '' });
      if (m.thumb_key) signedUrl(m.thumb_key).then((u) => { if (!img.src) img.src = u; }).catch(() => {});
      signedUrl(m.key).then((u) => {
        const full = new Image();
        full.onload = () => { img.src = u; };
        full.src = u;
      }).catch(() => {});
      stage.append(img);
      img.addEventListener('click', () => v.classList.toggle('chrome-off'));
    }
    actions.replaceChildren(
      h('button', { onclick: () => saveItems([m]) }, icon('download'), 'Enregistrer'),
      h('button', { onclick: () => pickAlbum([m], onChange) }, icon('album'), 'Album'),
      canDelete(m) ? h('button', { onclick: async () => {
        if (!(await confirmBox('Supprimer ?', 'Il sera effacé pour toute la famille.', 'Supprimer'))) return;
        await deleteItems([m]);
        list.splice(i, 1);
        onChange && onChange();
        if (!list.length) return close();
        if (i >= list.length) i = list.length - 1;
        show();
      } }, icon('trash'), 'Supprimer') : null);
  }

  // balayage horizontal
  let sx = 0, sy = 0, dx = 0, tracking = false;
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; tracking = true;
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (Math.abs(dy) > Math.abs(dx) && dy > 0) { v.style.opacity = String(Math.max(0.3, 1 - dy / 500)); stage.firstChild && (stage.firstChild.style.transform = `translateY(${dy}px)`); return; }
    if (stage.firstChild) stage.firstChild.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (!tracking) return; tracking = false;
    const dy = (e.changedTouches[0]?.clientY || sy) - sy;
    if (dy > 120 && Math.abs(dy) > Math.abs(dx)) return close();
    v.style.opacity = '';
    if (stage.firstChild) stage.firstChild.style.transform = '';
    if (dx < -60) step(1); else if (dx > 60) step(-1);
  });

  show();
}
