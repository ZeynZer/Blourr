import { h, icon, toast, errToast, sheet, confirmBox, bytes, runtime, clock, parseClock, uid, ext, avatar, dateFr } from './ui.js';
import { sb, state, lazyImg, bgInto, putUrls, putFile, removeKeys, encode } from './api.js';
import { cat, loadCatalog, titleById, episodesOf, sagaTitles } from './catalog.js';
import { resizeImage, videoInfo, toVtt, guessName, parseEpisode, episodeName } from './media.js';
import { go } from './router.js';

const GENRES = ['Action', 'Aventure', 'Animation', 'Comédie', 'Drame', 'Famille', 'Fantastique', 'Science-fiction', 'Horreur', 'Thriller', 'Policier', 'Documentaire', 'Romance', 'Anime', 'Historique', 'Guerre', 'Western', 'Musique', 'Sport', 'Religieux'];
const RATINGS = ['', 'Tous publics', '7+', '10+', '12+', '16+', '18+'];

// Fenêtre de progression bloquante pendant les gros envois
function progressModal(titleText) {
  const bar = h('i'); const label = h('div', { class: 'muted small' }, 'Préparation…');
  const ov = h('div', { class: 'overlay', style: { alignItems: 'center' } },
    h('div', { class: 'sheet', style: { borderRadius: '24px', maxWidth: '420px', margin: '0 16px' } },
      h('h2', {}, titleText), label, h('div', { class: 'bar', style: { margin: '12px 0 8px', height: '8px' } }, bar),
      h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, 'Garde l\'appli ouverte et l\'écran allumé jusqu\'à la fin.')));
  document.body.append(ov);
  // garde l'écran allumé pendant l'envoi (si le navigateur le permet)
  let lock = null;
  navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
  return {
    set(p, txt) { bar.style.width = (p * 100).toFixed(1) + '%'; if (txt) label.textContent = txt; },
    close() { ov.remove(); lock?.release().catch(() => {}); },
  };
}
async function uploadSet(files, modal, prefixText = '') {
  // files : [{key, body, type, label}]
  if (!files.length) return;
  const urls = await putUrls(files.map((f) => f.key));
  const total = files.reduce((a, f) => a + f.body.size, 0) || 1;
  let done = 0;
  for (const f of files) {
    await putFile(urls[f.key], f.body, f.type, (p) => {
      const g = (done + p * f.body.size) / total;
      modal.set(g, `${prefixText}${f.label} — ${Math.round(p * 100)} % (${bytes(done + p * f.body.size)} / ${bytes(total)})`);
    });
    done += f.body.size;
  }
}

function pick(accept, multiple = false) {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}

// ======================================================================
export function studioView(sub = []) {
  if (!state.isAdmin) { go('#/cine', true); return h('div'); }
  if (sub[0] === 't') return titleEditor(sub[1] === 'new' ? null : sub[1], sub[2]);
  if (sub[0] === 'sagas') return sagasView();
  if (sub[0] === 'activite') return activityView();
  const root = h('div', { class: 'view cine studio' });
  const body = h('div', {}, h('div', { class: 'center-load' }, h('div', { class: 'spinner' })));
  root.append(header('Studio', '#/cine'), body);
  const jobsBox = h('div');
  let jobsTimer = null;
  async function loadJobs() {
    const { data } = await sb.from('encode_jobs').select('id, label, status, progress, step, error, size, src_size, options, created_at, updated_at').order('created_at', { ascending: false }).limit(30);
    const jobs = (data || []).filter((j) => j.status !== 'done' || Date.now() - new Date(j.updated_at).getTime() < 3 * 86400000);
    const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    clearTimeout(jobsTimer);
    if (active) jobsTimer = setTimeout(async () => { const was = active; await loadJobs(); if (was && !jobs.some((j) => j.status === 'running' || j.status === 'queued')) loadCatalog(true); }, 8000);
    if (!jobs.length) { jobsBox.replaceChildren(); return; }
    jobsBox.replaceChildren(h('div', { style: { padding: '0 16px 6px', fontWeight: 800, fontSize: '17px' } }, '☁️ Conversions'),
      ...jobs.map((j) => {
        const pct = Math.round((j.progress || 0) * 100);
        const st = j.status === 'done' ? `Prêt · ${bytes(j.size)}` : j.status === 'error' ? `Échec : ${j.error || ''}` : j.status === 'queued' ? (Date.now() - new Date(j.updated_at).getTime() > 5 * 60000 ? 'Pas encore démarré : touche ↻ pour relancer' : 'En attente d\'un serveur… (1 à 2 min)') : `${j.step || 'Conversion'} · ${pct} %`;
        return h('div', { class: 'studio-item', style: { cursor: 'default' } },
          h('div', { class: 'meta' }, h('b', {}, j.label || 'Vidéo'),
            h('span', { style: { color: j.status === 'error' ? 'var(--danger)' : j.status === 'done' ? 'var(--ok)' : '#999' } }, st),
            j.status === 'running' || j.status === 'queued' ? h('div', { class: 'bar', style: { marginTop: '6px' } }, h('i', { style: { width: Math.max(2, pct) + '%' } })) : null),
          j.status === 'error' || (j.status === 'queued' && Date.now() - new Date(j.updated_at).getTime() > 5 * 60000) ? h('button', { class: 'icon-btn', title: 'Relancer', onclick: async () => { try { await encode('retry', { id: j.id }); toast('Conversion relancée'); loadJobs(); } catch (e) { errToast(e); } } }, icon('refresh')) : null,
          j.status !== 'running' ? h('button', { class: 'icon-btn', title: j.status === 'done' ? 'Masquer' : 'Annuler', onclick: async () => {
            if (j.status !== 'done' && !(await confirmBox('Annuler cette conversion ?', 'Le fichier source sera supprimé.', 'Annuler la conversion'))) return;
            try { await encode('cancel', { id: j.id }); loadJobs(); } catch (e) { errToast(e); }
          } }, icon('x')) : null);
      }),
      h('div', { style: { height: '10px' } }));
  }
  root.cleanup = () => clearTimeout(jobsTimer);
  loadJobs().catch(() => {});

  (async () => {
    await loadCatalog(true);
    body.replaceChildren(
      h('div', { class: 'row', style: { padding: '0 16px 16px', flexWrap: 'wrap' } },
        h('button', { class: 'btn primary grow', onclick: () => go('#/studio/t/new/movie') }, icon('plus'), 'Film'),
        h('button', { class: 'btn primary grow', onclick: () => go('#/studio/t/new/series') }, icon('plus'), 'Série'),
        h('button', { class: 'btn grow', onclick: () => go('#/studio/sagas') }, icon('layers'), 'Sagas'),
        h('button', { class: 'btn grow', onclick: () => go('#/studio/activite') }, icon('chart'), 'Activité')),
      state.configured === false ? h('div', { class: 'banner' }, icon('cloud'), h('div', {}, 'Configure d\'abord le stockage dans ', h('a', { href: '#/profil', style: { textDecoration: 'underline' } }, 'Profil'), '.')) : null,
      jobsBox,
      cat.titles.length ? null : h('div', { class: 'empty' }, h('div', { class: 'em-ic' }, icon('film')), h('h3', {}, 'Rien pour l\'instant'), h('p', {}, 'Ajoute ton premier film ou ta première série.')),
      cat.titles.map((t) => {
        const eps = episodesOf(t.id);
        const missing = t.kind === 'movie' ? !t.video_key : !eps.some((e) => e.video_key);
        return h('div', { class: 'studio-item', onclick: () => go('#/studio/t/' + t.id) },
          h('div', { class: 'th' }, t.backdrop_key || t.poster_key ? lazyImg(t.backdrop_key || t.poster_key) : icon('film')),
          h('div', { class: 'meta' }, h('b', {}, t.name),
            h('span', {}, missing ? h('span', { class: 'warn-dot' }) : null,
              t.kind === 'movie' ? `Film${t.year ? ' · ' + t.year : ''}${t.duration ? ' · ' + runtime(t.duration) : ''}${missing ? ' · vidéo manquante' : ''}`
                : `Série · ${eps.length} épisode${eps.length > 1 ? 's' : ''}`, t.featured ? ' · ★ à la une' : '')),
          icon('next'));
      }));
  })().catch(errToast);
  return root;
}

function header(text, backHash) {
  return h('div', { class: 'cine-top solid' },
    h('button', { class: 'icon-btn plain', onclick: () => go(backHash) }, icon('back')),
    h('div', { style: { flex: 1, fontWeight: 800, fontSize: '19px' } }, text));
}

// ======================================================================
// Édition d'un film / d'une série
// ======================================================================
function titleEditor(id, newKind) {
  const root = h('div', { class: 'view cine studio' });
  const body = h('div', { style: { padding: '0 16px', maxWidth: '720px', margin: '0 auto' } }, h('div', { class: 'center-load' }, h('div', { class: 'spinner' })));
  root.append(header(id ? 'Modifier' : newKind === 'series' ? 'Nouvelle série' : 'Nouveau film', '#/studio'), body);

  (async () => {
    await loadCatalog(true);
    const existing = id ? titleById(id) : null;
    if (id && !existing) { body.replaceChildren(h('p', {}, 'Titre introuvable.')); return; }
    const t = existing ? { ...existing } : { id: uid(), kind: newKind === 'series' ? 'series' : 'movie', name: '', genres: [], featured: false };
    const pending = { poster: null, backdrop: null, video: null, sub: null, autoBackdrop: null };

    const name = h('input', { class: 'input', value: t.name || '', placeholder: 'Titre' });
    const year = h('input', { class: 'input', value: t.year || '', placeholder: '2024', inputmode: 'numeric' });
    const rating = h('select', { class: 'select' }, RATINGS.map((r) => h('option', { value: r, selected: (t.rating || '') === r }, r || '—')));
    const desc = h('textarea', { class: 'textarea', placeholder: 'Résumé' }, t.description || '');
    const genres = new Set(t.genres || []);
    const genreBox = h('div', { class: 'tag-input' });
    const genreInput = h('input', { placeholder: 'Ajouter un genre…' });
    const sugg = h('div', { class: 'genre-sugg' });
    function drawGenres() {
      genreBox.replaceChildren(...[...genres].map((g) => h('span', { class: 'tg' }, g, h('button', { onclick: () => { genres.delete(g); drawGenres(); } }, icon('x')))), genreInput);
      sugg.replaceChildren(...GENRES.filter((g) => !genres.has(g)).map((g) => h('button', { onclick: () => { genres.add(g); drawGenres(); } }, '+ ' + g)));
    }
    genreInput.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',') && genreInput.value.trim()) { e.preventDefault(); genres.add(genreInput.value.trim()); genreInput.value = ''; drawGenres(); setTimeout(() => genreInput.focus()); }
    });
    drawGenres();

    const sagaSel = h('select', { class: 'select' }, h('option', { value: '' }, 'Aucune'), cat.sagas.map((s) => h('option', { value: s.id, selected: t.saga_id === s.id }, s.name)), h('option', { value: '__new' }, '+ Nouvelle saga…'));
    const sagaOrder = h('input', { class: 'input', value: t.saga_order ?? '', placeholder: 'N°', inputmode: 'numeric' });
    sagaSel.addEventListener('change', async () => {
      if (sagaSel.value !== '__new') return;
      const s = await editSaga(null);
      if (s) { await loadCatalog(true); sagaSel.insertBefore(h('option', { value: s.id }, s.name), sagaSel.lastChild); sagaSel.value = s.id; sagaOrder.value = 1; }
      else sagaSel.value = t.saga_id || '';
    });
    const featured = h('input', { type: 'checkbox', checked: !!t.featured });

    // Images
    const posterPick = h('div', { class: 'pick tall' + (t.poster_key ? ' has' : '') }, h('div', {}, icon('images'), 'Affiche', h('br'), h('small', {}, 'verticale')));
    const backPick = h('div', { class: 'pick wide' + (t.backdrop_key ? ' has' : '') }, h('div', {}, icon('images'), 'Image de fond', h('br'), h('small', {}, 'horizontale')));
    if (t.poster_key) bgInto(posterPick, t.poster_key);
    if (t.backdrop_key) bgInto(backPick, t.backdrop_key);
    posterPick.onclick = async () => {
      const [f] = await pick('image/*'); if (!f) return;
      try { pending.poster = (await resizeImage(f, { mode: 'cover', w: 600, h: 900, q: 0.86 })).blob; posterPick.style.backgroundImage = `url(${URL.createObjectURL(pending.poster)})`; posterPick.classList.add('has'); } catch (e) { errToast(e); }
    };
    backPick.onclick = async () => {
      const [f] = await pick('image/*'); if (!f) return;
      try { pending.backdrop = (await resizeImage(f, { mode: 'cover', w: 1600, h: 900, q: 0.86 })).blob; backPick.style.backgroundImage = `url(${URL.createObjectURL(pending.backdrop)})`; backPick.classList.add('has'); } catch (e) { errToast(e); }
    };

    // Vidéo (film)
    const vidLabel = h('div', { class: 'small muted' }, t.video_key ? `Vidéo en ligne · ${bytes(t.video_size)} · ${runtime(t.duration)}` : 'Aucune vidéo');
    const subLabel = h('div', { class: 'small muted' }, t.subtitle_key ? 'Sous-titres en ligne' : 'Pas de sous-titres (.srt ou .vtt)');
    const introS = h('input', { class: 'input', value: t.intro_start != null ? clock(t.intro_start) : '', placeholder: '0:00' });
    const introE = h('input', { class: 'input', value: t.intro_end != null ? clock(t.intro_end) : '', placeholder: '1:30' });
    const encOpts = encodeOptions();
    const encBox = h('div', { class: 'hidden', style: { marginTop: '10px' } });
    const videoBox = t.kind === 'movie' ? h('div', { class: 'vid-box' },
      h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, 'Vidéo du film'),
      vidLabel,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', onclick: async () => {
          const [f] = await pick('video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi'); if (!f) return;
          if (!name.value) name.value = guessName(f.name);
          const needs = NEEDS_CONVERT.test(f.name);
          pending.video = { file: f, duration: null };
          encBox.replaceChildren(encOpts.el); encBox.classList.remove('hidden');
          encOpts.setOn(needs);
          if (needs) { vidLabel.textContent = `Prête : ${f.name} · ${bytes(f.size)} — sera convertie en MP4 dans le cloud`; return; }
          vidLabel.textContent = 'Analyse de la vidéo…';
          const info = await videoInfo(f, { max: 1600 });
          pending.video.duration = info.duration;
          if (info.thumb) pending.autoBackdrop = info.thumb;
          vidLabel.textContent = `Prête à envoyer : ${f.name} · ${bytes(f.size)} · ${runtime(info.duration)}`;
        } }, icon('upload'), t.video_key ? 'Remplacer la vidéo' : 'Choisir la vidéo'),
        h('button', { class: 'btn sm', onclick: async () => {
          const [f] = await pick('.srt,.vtt,text/vtt'); if (!f) return;
          pending.sub = await toVtt(f); subLabel.textContent = `Prêts : ${f.name}`;
        } }, icon('subtitles'), 'Sous-titres')),
      subLabel,
      encBox,
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('div', { class: 'field grow', style: { margin: 0 } }, h('label', {}, 'Début de l\'intro'), introS),
        h('div', { class: 'field grow', style: { margin: 0 } }, h('label', {}, 'Fin de l\'intro'), introE)),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Facultatif : affiche le bouton « Passer l\'intro ».')) : null;

    const saveBtn = h('button', { class: 'btn primary block', style: { marginTop: '8px' } }, icon('check'), existing ? 'Enregistrer' : 'Créer');
    saveBtn.onclick = async () => {
      if (!name.value.trim()) return errToast('Donne un titre.');
      if (state.configured === false && (pending.video || pending.poster || pending.backdrop)) return errToast('Configure d\'abord le stockage (Profil).');
      saveBtn.disabled = true;
      const modal = progressModal(existing ? 'Enregistrement' : 'Création');
      try {
        const row = {
          id: t.id, kind: t.kind, name: name.value.trim(), description: desc.value.trim() || null,
          year: parseInt(year.value, 10) || null, rating: rating.value || null, genres: [...genres],
          saga_id: sagaSel.value && sagaSel.value !== '__new' ? sagaSel.value : null,
          saga_order: parseInt(sagaOrder.value, 10) || null, featured: featured.checked,
        };
        if (t.kind === 'movie') { row.intro_start = parseClock(introS.value); row.intro_end = parseClock(introE.value); }
        const files = []; const old = [];
        const v = Date.now().toString(36);
        if (pending.poster) { row.poster_key = `c/${t.id}/poster_${v}.jpg`; files.push({ key: row.poster_key, body: pending.poster, type: 'image/jpeg', label: 'Affiche' }); old.push(t.poster_key); }
        const back = pending.backdrop || (!t.backdrop_key && pending.autoBackdrop);
        if (back) { row.backdrop_key = `c/${t.id}/backdrop_${v}.jpg`; files.push({ key: row.backdrop_key, body: back, type: 'image/jpeg', label: 'Image de fond' }); old.push(t.backdrop_key); }
        if (pending.sub) { row.subtitle_key = `c/${t.id}/sub_${v}.vtt`; files.push({ key: row.subtitle_key, body: pending.sub, type: 'text/vtt', label: 'Sous-titres' }); old.push(t.subtitle_key); }
        let srcJob = null;
        if (pending.video && encOpts.on()) {
          // envoi du fichier source : la conversion en MP4 se fait dans le cloud
          const f = pending.video.file;
          srcJob = { key: `c/${t.id}/src/${v}.${ext(f.name)}`, size: f.size };
          files.push({ key: srcJob.key, body: f, type: 'application/octet-stream', label: 'Vidéo source' });
        } else if (pending.video) {
          const f = pending.video.file;
          row.video_key = `c/${t.id}/video_${v}.${ext(f.name)}`; row.video_size = f.size; row.duration = pending.video.duration || null;
          files.push({ key: row.video_key, body: f, type: f.type || 'video/mp4', label: 'Vidéo' }); old.push(t.video_key);
        }
        await uploadSet(files, modal);
        modal.set(1, 'Enregistrement…');
        const { error } = await sb.from('titles').upsert(row);
        if (error) throw error;
        if (srcJob) {
          modal.set(1, 'Lancement de la conversion…');
          await encode('create', { target_type: 'movie', target_id: t.id, src_key: srcJob.key, src_size: srcJob.size, options: encOpts.get(), label: row.name });
          toast('Conversion lancée : suis-la dans le Studio');
        }
        await removeKeys(old.filter(Boolean)).catch(() => {});
        await loadCatalog(true);
        modal.close();
        toast(existing ? 'Enregistré' : (t.kind === 'series' ? 'Série créée — ajoute les épisodes' : 'Film ajouté'));
        if (!existing) go('#/studio/t/' + t.id, true); else go('#/studio/t/' + t.id, true);
      } catch (e) { modal.close(); errToast(e); saveBtn.disabled = false; }
    };

    const del = existing ? h('button', { class: 'btn danger block', style: { marginTop: '10px' }, onclick: async () => {
      if (!(await confirmBox(`Supprimer « ${t.name} » ?`, 'La vidéo, les images et les épisodes seront effacés définitivement.', 'Supprimer'))) return;
      const eps = episodesOf(t.id);
      const keys = [t.poster_key, t.backdrop_key, t.video_key, t.subtitle_key, ...eps.flatMap((e) => [e.video_key, e.thumb_key, e.subtitle_key])];
      const { error } = await sb.from('titles').delete().eq('id', t.id);
      if (error) return errToast(error);
      await removeKeys(keys.filter(Boolean)).catch(() => {});
      await loadCatalog(true);
      toast('Supprimé'); go('#/studio');
    } }, icon('trash'), 'Supprimer') : null;

    body.replaceChildren(
      h('div', { class: 'row', style: { alignItems: 'stretch', marginBottom: '14px' } },
        h('div', { style: { width: '32%' } }, posterPick),
        h('div', { class: 'grow' }, backPick)),
      h('div', { class: 'field' }, h('label', {}, 'Titre'), name),
      h('div', { class: 'row' },
        h('div', { class: 'field grow' }, h('label', {}, 'Année'), year),
        h('div', { class: 'field grow' }, h('label', {}, 'Âge'), rating)),
      h('div', { class: 'field' }, h('label', {}, 'Résumé'), desc),
      h('div', { class: 'field' }, h('label', {}, 'Genres'), genreBox, sugg),
      h('div', { class: 'row' },
        h('div', { class: 'field grow' }, h('label', {}, 'Saga'), sagaSel),
        h('div', { class: 'field', style: { width: '90px' } }, h('label', {}, 'Ordre'), sagaOrder)),
      h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '4px 0 18px' } },
        h('div', {}, h('div', { style: { fontWeight: 600 } }, 'À la une'), h('div', { class: 'small muted' }, 'Peut apparaître en grand sur l\'accueil')),
        h('label', { class: 'switch' }, featured, h('span'))),
      videoBox,
      saveBtn, del,
      existing && t.kind === 'series' ? episodesEditor(t) : null,
      h('div', { style: { height: '40px' } }));
  })().catch(errToast);
  return root;
}

// ---------- Épisodes ----------
function episodesEditor(t) {
  const box = h('div', { class: 'd-section', style: { marginTop: '26px' } });
  function draw() {
    const eps = episodesOf(t.id);
    const seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => a - b);
    box.replaceChildren(
      h('div', { class: 'd-section-h' }, h('h4', {}, `Épisodes (${eps.length})`)),
      h('div', { class: 'row', style: { marginBottom: '14px', flexWrap: 'wrap' } },
        h('button', { class: 'btn primary grow', onclick: () => addEpisodes(t, draw) }, icon('upload'), 'Choisir des épisodes'),
        'webkitdirectory' in document.createElement('input') && !/iP(hone|ad|od)/.test(navigator.userAgent)
          ? h('button', { class: 'btn grow', onclick: () => addEpisodes(t, draw, true) }, icon('folder'), 'Tout un dossier') : null),
      eps.length ? null : h('p', { class: 'muted small' }, 'Sélectionne tous les épisodes d\'un coup (et leurs .srt si tu en as). Sur ordinateur, « Tout un dossier » prend aussi les sous-dossiers « Saison 1 », « Saison 2 »…'),
      seasons.map((s) => [
        h('div', { style: { fontWeight: 700, margin: '14px 0 6px' } }, `Saison ${s}`),
        eps.filter((e) => e.season === s).map((e) => h('div', { class: 'studio-item', style: { margin: '0 0 8px' }, onclick: () => editEpisode(t, e, draw) },
          h('div', { class: 'th' }, e.thumb_key ? lazyImg(e.thumb_key) : icon('video')),
          h('div', { class: 'meta' }, h('b', {}, `${e.number}. ${e.name || 'Épisode ' + e.number}`),
            h('span', {}, !e.video_key ? h('span', { class: 'warn-dot' }) : null, e.video_key ? `${runtime(e.duration)} · ${bytes(e.video_size)}` : 'Vidéo manquante', e.subtitle_key ? ' · ST' : '')),
          icon('edit'))),
      ]));
  }
  draw();
  return box;
}

const VIDEO_RE = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const NEEDS_CONVERT = /\.(mkv|avi|webm|wmv|flv|ts|m2ts)$/i;

// Options de conversion dans le cloud (qualité, images/s, langues, sous-titres)
function encodeOptions(defaults = {}) {
  const sel = (opts, val) => h('select', { class: 'select' }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
  const quality = sel([['source', 'Garder l\'original'], ['1080', '1080p max'], ['720', '720p (plus léger)']], defaults.quality || 'source');
  const fps = sel([['source', 'Garder'], ['24', '24 i/s'], ['30', '30 i/s']], defaults.fps || 'source');
  const langs = sel([['both', 'VF + VO'], ['vf', 'VF seule'], ['vo', 'VO seule']], defaults.langs || 'both');
  const subs = sel([['none', 'Non'], ['fr', 'Oui (si présents)']], defaults.subs || 'none');
  const sw = h('input', { type: 'checkbox', checked: true });
  const grid = h('div', { class: 'enc-grid' },
    h('div', { class: 'field' }, h('label', {}, 'Qualité'), quality),
    h('div', { class: 'field' }, h('label', {}, 'Images / s'), fps),
    h('div', { class: 'field' }, h('label', {}, 'Langues'), langs),
    h('div', { class: 'field' }, h('label', {}, 'Sous-titres FR'), subs));
  const el = h('div', { class: 'enc-box' },
    h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '8px' } },
      h('div', {}, h('b', {}, '☁️ Convertir dans le cloud'), h('div', { class: 'small muted' }, 'Le fichier devient un MP4 lisible partout, puis l\'original est supprimé.')),
      h('label', { class: 'switch' }, sw, h('span'))),
    grid);
  sw.addEventListener('change', () => grid.classList.toggle('hidden', !sw.checked));
  return {
    el,
    on: () => sw.checked,
    setOn: (v) => { sw.checked = v; grid.classList.toggle('hidden', !v); },
    get: () => ({ quality: quality.value, fps: fps.value, langs: langs.value, subs: subs.value }),
  };
}

const SUB_RE = /\.(srt|vtt)$/i;
const baseOf = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();

function pickFolder() {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    inp.setAttribute('webkitdirectory', '');
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}

async function addEpisodes(t, after, folder = false) {
  const all = folder ? await pickFolder() : await pick('video/*,.mp4,.mov,.m4v,.webm,.mkv,.srt,.vtt', true);
  const files = all.filter((f) => VIDEO_RE.test(f.name) || (f.type || '').startsWith('video/'));
  const subs = all.filter((f) => SUB_RE.test(f.name));
  if (!files.length) { if (all.length) errToast('Aucune vidéo trouvée.'); return; }
  const dirOf = (f) => (f.webkitRelativePath || '').split('/').slice(0, -1).join('/');
  files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, 'fr', { numeric: true }));

  const existing = episodesOf(t.id);
  const lastSeason = existing.length ? Math.max(...existing.map((e) => e.season)) : 1;
  const seasonIn = h('input', { class: 'input', value: lastSeason, inputmode: 'numeric' });

  // Lignes éditables
  const rows = files.map((f) => {
    const d = parseEpisode(f.name, dirOf(f)) || {};
    const sub = subs.find((s) => baseOf(s.name) === baseOf(f.name))
      || subs.find((s) => { const ds = parseEpisode(s.name, dirOf(s)); return ds && d.number != null && ds.number === d.number && (ds.season ?? d.season) === d.season; });
    return { file: f, sub, dSeason: d.season ?? null, dNumber: d.number ?? null, name: episodeName(f.name, t.name), keep: true };
  });
  function assign() {
    const def = parseInt(seasonIn.value, 10) || 1;
    const next = {};
    const maxOf = (s) => {
      if (next[s] == null) next[s] = existing.filter((e) => e.season === s).reduce((m, e) => Math.max(m, e.number), 0);
      return next[s];
    };
    // les numéros détectés d'abord, puis on complète les trous dans l'ordre
    for (const r of rows) { r.season = r.manualS ?? r.dSeason ?? def; r.number = r.manualN ?? r.dNumber; }
    for (const r of rows) if (r.number != null) next[r.season] = Math.max(maxOf(r.season), r.number);
    for (const r of rows) if (r.number == null) { next[r.season] = maxOf(r.season) + 1; r.number = next[r.season]; }
  }

  const listEl = h('div', { style: { maxHeight: '46vh', overflow: 'auto', margin: '4px 0 14px' } });
  const summary = h('div', { class: 'small muted' });
  function draw() {
    assign();
    const kept = rows.filter((r) => r.keep);
    summary.textContent = `${kept.length} épisode${kept.length > 1 ? 's' : ''} · ${bytes(kept.reduce((a, r) => a + r.file.size, 0))} · ${kept.filter((r) => r.sub).length} sous-titre(s) associé(s)`;
    listEl.replaceChildren(...rows.slice().sort((a, b) => a.season - b.season || a.number - b.number).map((r) => {
      if (!r.keep) return null;
      const sIn = h('input', { class: 'input', value: r.season, inputmode: 'numeric', style: { width: '52px', height: '38px', padding: '0 8px', textAlign: 'center' } });
      const nIn = h('input', { class: 'input', value: r.number, inputmode: 'numeric', style: { width: '62px', height: '38px', padding: '0 8px', textAlign: 'center' } });
      const nameIn = h('input', { class: 'input', value: r.name || '', placeholder: 'Titre (facultatif)', style: { height: '38px', fontSize: '14px' } });
      sIn.onchange = () => { r.manualS = parseInt(sIn.value, 10) || 1; draw(); };
      nIn.onchange = () => { r.manualN = parseInt(nIn.value, 10) || null; draw(); };
      nameIn.oninput = () => { r.name = nameIn.value.trim() || null; };
      const clash = existing.find((e) => e.season === r.season && e.number === r.number);
      const bad = NEEDS_CONVERT.test(r.file.name) && !encOpts.on();
      return h('div', { style: { padding: '10px 0', borderBottom: '1px solid var(--line)' } },
        h('div', { class: 'row' },
          h('span', { class: 'small muted' }, 'S'), sIn, h('span', { class: 'small muted' }, 'É'), nIn,
          h('div', { class: 'grow' }, nameIn),
          h('button', { class: 'icon-btn', style: { width: '34px', height: '34px' }, onclick: () => { r.keep = false; draw(); } }, icon('x'))),
        h('div', { class: 'small muted', style: { marginTop: '4px', wordBreak: 'break-all' } },
          `${r.file.name} · ${bytes(r.file.size)}`,
          r.sub ? h('span', { style: { color: 'var(--ok)' } }, ' · ST ✓') : null,
          clash ? h('span', { style: { color: '#f59e0b' } }, ' · remplace l\'épisode existant') : null,
          bad ? h('span', { style: { color: 'var(--danger)' } }, ' · .mkv/.avi illisible sur iPhone') : null));
    }));
  }
  const encOpts = encodeOptions();
  const anyConvert = rows.some((r) => NEEDS_CONVERT.test(r.file.name));
  encOpts.setOn(anyConvert);
  encOpts.el.addEventListener('change', draw);
  seasonIn.addEventListener('input', draw);
  draw();

  sheet((close) => [
    h('h2', {}, 'Ajouter des épisodes'),
    h('p', { class: 'muted small', style: { marginTop: '-8px' } }, 'Saisons et numéros sont devinés depuis les noms (S01E03, « - 12 », Ep 5…) et les dossiers (« Saison 2 »). Vérifie et corrige si besoin.'),
    h('div', { class: 'field', style: { marginBottom: '6px' } }, h('label', {}, 'Saison par défaut (si non détectée)'), seasonIn),
    summary, listEl,
    anyConvert ? h('div', { style: { marginBottom: '12px' } }, encOpts.el, h('p', { class: 'small muted', style: { margin: '6px 0 0' } }, 'S\'applique aux fichiers .mkv / .avi. Les .mp4 sont envoyés tels quels.')) : null,
    h('button', { class: 'btn primary block', onclick: () => { close(); sendEpisodes(t, rows.filter((r) => r.keep), existing, after, anyConvert && encOpts.on() ? encOpts.get() : null); } }, icon('upload'), 'Tout envoyer'),
  ]);
}

async function sendEpisodes(t, rows, existing, after, convert = null) {
  if (!rows.length) return;
  const modal = progressModal('Envoi des épisodes');
  const failed = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const f = r.file;
    const prefix = `${i + 1}/${rows.length} · S${r.season}É${r.number} · `;
    try {
      modal.set(i / rows.length, prefix + 'analyse…');
      const clash = existing.find((e) => e.season === r.season && e.number === r.number);
      const epId = clash ? clash.id : uid();
      const v = Date.now().toString(36);
      if (convert && NEEDS_CONVERT.test(f.name)) {
        // envoi du fichier source puis conversion dans le cloud
        const srcKey = `c/${t.id}/src/${epId}_${v}.${ext(f.name)}`;
        await uploadSet([{ key: srcKey, body: f, type: 'application/octet-stream', label: f.name }], { set: (p, txt) => modal.set((i + p) / rows.length, prefix + (txt || '')) });
        const base = { id: epId, title_id: t.id, season: r.season, number: r.number, name: r.name || clash?.name || null };
        const { error } = clash ? await sb.from('episodes').update(base).eq('id', epId) : await sb.from('episodes').insert(base);
        if (error) throw error;
        await encode('create', { target_type: 'episode', target_id: epId, title_id: t.id, src_key: srcKey, src_size: f.size, options: convert, label: `${t.name} S${r.season}:É${r.number}` });
        continue;
      }
      const info = await videoInfo(f, { max: 640 });
      const row = {
        id: epId, title_id: t.id, season: r.season, number: r.number,
        name: r.name || clash?.name || null,
        video_key: `c/${t.id}/e/${epId}_${v}.${ext(f.name)}`, video_size: f.size, duration: info.duration || null,
      };
      const up = [];
      if (info.thumb) { row.thumb_key = `c/${t.id}/e/${epId}_t_${v}.jpg`; up.push({ key: row.thumb_key, body: info.thumb, type: 'image/jpeg', label: 'Miniature' }); }
      if (r.sub) { row.subtitle_key = `c/${t.id}/e/${epId}_${v}.vtt`; up.push({ key: row.subtitle_key, body: await toVtt(r.sub), type: 'text/vtt', label: 'Sous-titres' }); }
      up.push({ key: row.video_key, body: f, type: f.type || 'video/mp4', label: f.name });
      await uploadSet(up, { set: (p, txt) => modal.set((i + p) / rows.length, prefix + (txt || '')) });
      const { error } = clash
        ? await sb.from('episodes').update(row).eq('id', epId)
        : await sb.from('episodes').insert(row);
      if (error) throw error;
      if (clash) removeKeys([clash.video_key, row.thumb_key ? clash.thumb_key : null, row.subtitle_key ? clash.subtitle_key : null].filter(Boolean)).catch(() => {});
    } catch (e) {
      failed.push(`${f.name} (${e.message})`);
    }
  }
  await loadCatalog(true);
  modal.close();
  if (failed.length) errToast(`${rows.length - failed.length}/${rows.length} envoyés. Échecs : ${failed.join(', ')}`);
  else toast(convert ? 'Épisodes envoyés : la conversion suit dans « Conversions » du Studio' : `${rows.length} épisode${rows.length > 1 ? 's' : ''} ajouté${rows.length > 1 ? 's' : ''}`);
  after();
}

function editEpisode(t, e, after) {
  const pending = { video: null, sub: null, thumb: null };
  const nameIn = h('input', { class: 'input', value: e.name || '' });
  const seasonIn = h('input', { class: 'input', value: e.season, inputmode: 'numeric' });
  const numIn = h('input', { class: 'input', value: e.number, inputmode: 'numeric' });
  const descIn = h('textarea', { class: 'textarea' }, e.description || '');
  const introS = h('input', { class: 'input', value: e.intro_start != null ? clock(e.intro_start) : '', placeholder: '0:00' });
  const introE = h('input', { class: 'input', value: e.intro_end != null ? clock(e.intro_end) : '', placeholder: '1:30' });
  const vLabel = h('div', { class: 'small muted' }, e.video_key ? `Vidéo en ligne · ${bytes(e.video_size)}` : 'Aucune vidéo');
  sheet((close) => [
    h('h2', {}, `S${e.season}:É${e.number}`),
    h('div', { class: 'field' }, h('label', {}, 'Titre de l\'épisode'), nameIn),
    h('div', { class: 'row' }, h('div', { class: 'field grow' }, h('label', {}, 'Saison'), seasonIn), h('div', { class: 'field grow' }, h('label', {}, 'Numéro'), numIn)),
    h('div', { class: 'field' }, h('label', {}, 'Résumé'), descIn),
    h('div', { class: 'row' }, h('div', { class: 'field grow' }, h('label', {}, 'Début intro'), introS), h('div', { class: 'field grow' }, h('label', {}, 'Fin intro'), introE)),
    vLabel,
    h('div', { class: 'row', style: { margin: '10px 0 16px', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm', onclick: async () => {
        const [f] = await pick('video/*,.mp4,.mov,.m4v,.webm'); if (!f) return;
        vLabel.textContent = 'Analyse…';
        const info = await videoInfo(f, { max: 640 });
        pending.video = { file: f, duration: info.duration }; pending.thumb = info.thumb;
        vLabel.textContent = `Prête : ${f.name} · ${bytes(f.size)}`;
      } }, icon('upload'), 'Vidéo'),
      h('button', { class: 'btn sm', onclick: async () => {
        const [f] = await pick('.srt,.vtt'); if (!f) return;
        pending.sub = await toVtt(f); vLabel.textContent += ' · sous-titres prêts';
      } }, icon('subtitles'), 'Sous-titres'),
      h('button', { class: 'btn sm', onclick: async () => {
        const [f] = await pick('image/*'); if (!f) return;
        pending.thumb = (await resizeImage(f, { mode: 'cover', w: 640, h: 360 })).blob; vLabel.textContent += ' · miniature prête';
      } }, icon('images'), 'Miniature')),
    h('button', { class: 'btn primary block', onclick: async () => {
      close();
      const modal = progressModal('Enregistrement');
      try {
        const v = Date.now().toString(36);
        const row = { name: nameIn.value.trim() || null, season: parseInt(seasonIn.value, 10) || 1, number: parseInt(numIn.value, 10) || 1, description: descIn.value.trim() || null, intro_start: parseClock(introS.value), intro_end: parseClock(introE.value) };
        const files = []; const old = [];
        if (pending.video) { const f = pending.video.file; row.video_key = `c/${t.id}/e/${e.id}_${v}.${ext(f.name)}`; row.video_size = f.size; row.duration = pending.video.duration || null; files.push({ key: row.video_key, body: f, type: f.type || 'video/mp4', label: 'Vidéo' }); old.push(e.video_key); }
        if (pending.thumb) { row.thumb_key = `c/${t.id}/e/${e.id}_t_${v}.jpg`; files.push({ key: row.thumb_key, body: pending.thumb, type: 'image/jpeg', label: 'Miniature' }); old.push(e.thumb_key); }
        if (pending.sub) { row.subtitle_key = `c/${t.id}/e/${e.id}_${v}.vtt`; files.push({ key: row.subtitle_key, body: pending.sub, type: 'text/vtt', label: 'Sous-titres' }); old.push(e.subtitle_key); }
        await uploadSet(files, modal);
        const { error } = await sb.from('episodes').update(row).eq('id', e.id);
        if (error) throw error;
        await removeKeys(old.filter(Boolean)).catch(() => {});
        await loadCatalog(true); modal.close(); toast('Épisode enregistré'); after();
      } catch (err) { modal.close(); errToast(err); }
    } }, icon('check'), 'Enregistrer'),
    h('button', { class: 'btn danger block', style: { marginTop: '10px' }, onclick: async () => {
      close();
      if (!(await confirmBox('Supprimer cet épisode ?', '', 'Supprimer'))) return;
      const { error } = await sb.from('episodes').delete().eq('id', e.id);
      if (error) return errToast(error);
      await removeKeys([e.video_key, e.thumb_key, e.subtitle_key].filter(Boolean)).catch(() => {});
      await loadCatalog(true); after();
    } }, icon('trash'), 'Supprimer l\'épisode'),
  ]);
}

// ======================================================================
// Sagas
// ======================================================================
function sagasView() {
  const root = h('div', { class: 'view cine studio' });
  const body = h('div', { style: { padding: '0 16px', maxWidth: '720px', margin: '0 auto' } });
  root.append(header('Sagas', '#/studio'), body);
  async function draw() {
    await loadCatalog(true);
    body.replaceChildren(
      h('button', { class: 'btn primary block', style: { marginBottom: '16px' }, onclick: async () => { if (await editSaga(null)) draw(); } }, icon('plus'), 'Nouvelle saga'),
      cat.sagas.length ? null : h('p', { class: 'muted' }, 'Une saga regroupe plusieurs films (ex. : une trilogie). Tu choisis ensuite la saga et l\'ordre dans la fiche de chaque film.'),
      cat.sagas.map((s) => h('div', { class: 'studio-item', style: { margin: '0 0 8px' }, onclick: async () => { if (await editSaga(s)) draw(); } },
        h('div', { class: 'th' }, s.backdrop_key ? lazyImg(s.backdrop_key) : icon('layers')),
        h('div', { class: 'meta' }, h('b', {}, s.name), h('span', {}, sagaTitles(s.id).map((x) => x.name).join(' · ') || 'Aucun titre')),
        icon('edit'))));
  }
  draw().catch(errToast);
  return root;
}

function editSaga(s) {
  return new Promise((resolve) => {
    let result = null; let img = null;
    const nameIn = h('input', { class: 'input', value: s?.name || '', placeholder: 'Ex : Le Seigneur des…' });
    const descIn = h('textarea', { class: 'textarea', placeholder: 'Description (facultatif)' }, s?.description || '');
    const pickEl = h('div', { class: 'pick wide' + (s?.backdrop_key ? ' has' : ''), style: { marginBottom: '14px' } }, h('div', {}, icon('images'), 'Image de la saga (facultatif)'));
    if (s?.backdrop_key) bgInto(pickEl, s.backdrop_key);
    pickEl.onclick = async () => {
      const [f] = await pick('image/*'); if (!f) return;
      img = (await resizeImage(f, { mode: 'cover', w: 1600, h: 900 })).blob;
      pickEl.style.backgroundImage = `url(${URL.createObjectURL(img)})`; pickEl.classList.add('has');
    };
    sheet((close) => [
      h('h2', {}, s ? 'Modifier la saga' : 'Nouvelle saga'),
      pickEl,
      h('div', { class: 'field' }, h('label', {}, 'Nom'), nameIn),
      h('div', { class: 'field' }, h('label', {}, 'Description'), descIn),
      h('button', { class: 'btn primary block', onclick: async () => {
        if (!nameIn.value.trim()) return errToast('Donne un nom.');
        const id = s?.id || uid();
        const row = { id, name: nameIn.value.trim(), description: descIn.value.trim() || null };
        try {
          if (img) {
            row.backdrop_key = `c/sagas/${id}_${Date.now().toString(36)}.jpg`;
            const urls = await putUrls([row.backdrop_key]);
            await putFile(urls[row.backdrop_key], img, 'image/jpeg');
          }
          const { data, error } = await sb.from('sagas').upsert(row).select().single();
          if (error) throw error;
          if (img && s?.backdrop_key) removeKeys([s.backdrop_key]).catch(() => {});
          result = data; close();
        } catch (e) { errToast(e); }
      } }, icon('check'), 'Enregistrer'),
      s ? h('button', { class: 'btn danger block', style: { marginTop: '10px' }, onclick: async () => {
        const { error } = await sb.from('sagas').delete().eq('id', s.id);
        if (error) return errToast(error);
        if (s.backdrop_key) removeKeys([s.backdrop_key]).catch(() => {});
        result = { deleted: true }; close();
      } }, icon('trash'), 'Supprimer la saga') : null,
    ], { onClose: () => resolve(result) });
  });
}

// ======================================================================
// Activité : qui regarde quoi, et combien de temps
// ======================================================================
function dur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
function ago(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 90) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  if (s < 7 * 86400) return `il y a ${Math.round(s / 86400)} j`;
  return dateFr(d);
}

function activityView() {
  const root = h('div', { class: 'view cine studio' });
  const body = h('div', {}, h('div', { class: 'center-load' }, h('div', { class: 'spinner' })));
  root.append(header('Activité', '#/studio'), body);
  let range = 7;
  let timer = null;

  async function load() {
    try {
      await loadCatalog();
      const since = new Date(Date.now() - range * 86400000).toISOString();
      const [{ data: sessions, error }, { data: profiles }] = await Promise.all([
        sb.from('watch_sessions').select('*').gte('last_seen', since).order('last_seen', { ascending: false }).limit(1000),
        sb.from('profiles').select('*').order('created_at'),
      ]);
      if (error) throw error;
      const prof = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
      const label = (x) => {
        const t = titleById(x.title_id);
        const e = x.episode_id && episodesOf(x.title_id).find((y) => y.id === x.episode_id);
        return { t, e, text: (t?.name || 'Titre supprimé') + (e ? ` · S${e.season}:É${e.number}` : '') };
      };
      const live = sessions.filter((x) => Date.now() - new Date(x.last_seen).getTime() < 75000);
      const liveUsers = new Set();

      // Totaux par membre
      const per = {};
      for (const x of sessions) {
        const o = per[x.user_id] = per[x.user_id] || { secs: 0, last: x.last_seen, titles: {} };
        o.secs += x.seconds;
        if (x.last_seen > o.last) o.last = x.last_seen;
        o.titles[x.title_id] = (o.titles[x.title_id] || 0) + x.seconds;
      }
      // Titres les plus regardés
      const perTitle = {};
      for (const x of sessions) {
        const o = perTitle[x.title_id] = perTitle[x.title_id] || { secs: 0, users: new Set() };
        o.secs += x.seconds; o.users.add(x.user_id);
      }

      body.replaceChildren(
        h('div', { class: 'req-tabs' }, [[1, 'Aujourd\'hui'], [7, '7 jours'], [30, '30 jours']].map(([d, l]) =>
          h('button', { class: 'chip' + (range === d ? ' active' : ''), onclick: () => { range = d; load(); } }, l))),

        h('div', { class: 'sec-h' }, 'En ce moment'),
        live.length ? live.filter((x) => !liveUsers.has(x.user_id) && liveUsers.add(x.user_id)).map((x) => {
          const l = label(x);
          return h('div', { class: 'live' }, h('span', { class: 'live-dot' }), avatar(prof[x.user_id]),
            h('div', { class: 'grow' }, h('b', {}, prof[x.user_id]?.display_name || '—'), h('div', { class: 'small', style: { color: '#ccc' } }, `regarde ${l.text}`)),
            h('span', { class: 'small muted' }, dur(x.seconds)));
        }) : h('p', { class: 'muted small', style: { padding: '0 16px 6px' } }, 'Personne ne regarde en ce moment.'),

        h('div', { class: 'sec-h', style: { marginTop: '10px' } }, 'Par membre'),
        h('div', { class: 'stat-grid' }, (profiles || []).map((p) => {
          const o = per[p.id];
          const top = o ? Object.entries(o.titles).sort((a, b) => b[1] - a[1])[0] : null;
          return h('div', { class: 'stat' },
            h('div', { class: 'who' }, avatar(p), p.display_name),
            h('div', { class: 'big' }, o ? dur(o.secs) : '0 min'),
            h('div', { class: 'small' }, o ? `vu ${ago(o.last)}` : 'aucun visionnage'),
            top ? h('div', { class: 'small', style: { marginTop: '6px' } }, `Surtout : ${titleById(top[0])?.name || '—'}`) : null);
        })),

        Object.keys(perTitle).length ? [
          h('div', { class: 'sec-h' }, 'Les plus regardés'),
          Object.entries(perTitle).sort((a, b) => b[1].secs - a[1].secs).slice(0, 8).map(([tid, o]) => {
            const t = titleById(tid);
            return h('div', { class: 'hist' },
              h('div', { class: 'th' }, t ? lazyImg(t.backdrop_key || t.poster_key) : null),
              h('div', { class: 'meta' }, h('b', {}, t?.name || 'Titre supprimé'),
                h('div', { class: 'sub' }, `${dur(o.secs)} · ${o.users.size} personne${o.users.size > 1 ? 's' : ''}`)));
          })] : null,

        h('div', { class: 'sec-h', style: { marginTop: '10px' } }, 'Historique'),
        sessions.length ? sessions.slice(0, 150).map((x) => {
          const l = label(x);
          return h('div', { class: 'hist' },
            h('div', { class: 'th' }, l.e?.thumb_key || l.t ? lazyImg(l.e?.thumb_key || l.t?.backdrop_key || l.t?.poster_key) : null),
            h('div', { class: 'meta' },
              h('div', {}, h('b', {}, prof[x.user_id]?.display_name || '—'), ` · ${l.text}`),
              h('div', { class: 'sub' }, `${dur(x.seconds)} regardé · ${ago(x.last_seen)}`)));
        }) : h('p', { class: 'muted small', style: { padding: '0 16px' } }, 'Aucun visionnage sur cette période.'),
        h('div', { style: { height: '30px' } }));
    } catch (e) { body.replaceChildren(h('p', { class: 'muted', style: { padding: '16px' } }, e.message)); }
  }
  load();
  timer = setInterval(load, 30000);
  root.cleanup = () => clearInterval(timer);
  return root;
}
