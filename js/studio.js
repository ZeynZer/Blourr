import { h, icon, toast, errToast, sheet, confirmBox, bytes, runtime, clock, parseClock, uid, ext } from './ui.js';
import { sb, state, lazyImg, bgInto, putUrls, putFile, removeKeys } from './api.js';
import { cat, loadCatalog, titleById, episodesOf, sagaTitles } from './catalog.js';
import { resizeImage, videoInfo, toVtt, guessName, parseEpisode } from './media.js';
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
  return {
    set(p, txt) { bar.style.width = (p * 100).toFixed(1) + '%'; if (txt) label.textContent = txt; },
    close() { ov.remove(); },
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
  const root = h('div', { class: 'view cine studio' });
  const body = h('div', {}, h('div', { class: 'center-load' }, h('div', { class: 'spinner' })));
  root.append(header('Studio', '#/cine'), body);

  (async () => {
    await loadCatalog(true);
    body.replaceChildren(
      h('div', { class: 'row', style: { padding: '0 16px 16px', flexWrap: 'wrap' } },
        h('button', { class: 'btn primary grow', onclick: () => go('#/studio/t/new/movie') }, icon('plus'), 'Film'),
        h('button', { class: 'btn primary grow', onclick: () => go('#/studio/t/new/series') }, icon('plus'), 'Série'),
        h('button', { class: 'btn grow', onclick: () => go('#/studio/sagas') }, icon('layers'), 'Sagas')),
      state.configured === false ? h('div', { class: 'banner' }, icon('cloud'), h('div', {}, 'Configure d\'abord le stockage dans ', h('a', { href: '#/profil', style: { textDecoration: 'underline' } }, 'Profil'), '.')) : null,
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
    const videoBox = t.kind === 'movie' ? h('div', { class: 'vid-box' },
      h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, 'Vidéo du film'),
      vidLabel,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', onclick: async () => {
          const [f] = await pick('video/*,.mp4,.mov,.m4v,.webm,.mkv'); if (!f) return;
          vidLabel.textContent = 'Analyse de la vidéo…';
          const info = await videoInfo(f, { max: 1600 });
          pending.video = { file: f, duration: info.duration };
          if (info.thumb) pending.autoBackdrop = info.thumb;
          if (!name.value) name.value = guessName(f.name);
          vidLabel.textContent = `Prête à envoyer : ${f.name} · ${bytes(f.size)} · ${runtime(info.duration)}`;
          if (/\.(mkv|avi)$/i.test(f.name)) toast('Attention : le .mkv ne se lit pas sur iPhone. Préfère du .mp4 (H.264).', 'err');
        } }, icon('upload'), t.video_key ? 'Remplacer la vidéo' : 'Choisir la vidéo'),
        h('button', { class: 'btn sm', onclick: async () => {
          const [f] = await pick('.srt,.vtt,text/vtt'); if (!f) return;
          pending.sub = await toVtt(f); subLabel.textContent = `Prêts : ${f.name}`;
        } }, icon('subtitles'), 'Sous-titres')),
      subLabel,
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
        if (pending.video) {
          const f = pending.video.file;
          row.video_key = `c/${t.id}/video_${v}.${ext(f.name)}`; row.video_size = f.size; row.duration = pending.video.duration || null;
          files.push({ key: row.video_key, body: f, type: f.type || 'video/mp4', label: 'Vidéo' }); old.push(t.video_key);
        }
        await uploadSet(files, modal);
        modal.set(1, 'Enregistrement…');
        const { error } = await sb.from('titles').upsert(row);
        if (error) throw error;
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
      h('div', { class: 'row', style: { marginBottom: '14px' } },
        h('button', { class: 'btn primary grow', onclick: () => addEpisodes(t, draw) }, icon('upload'), 'Ajouter des épisodes')),
      eps.length ? null : h('p', { class: 'muted small' }, 'Astuce : sélectionne plusieurs vidéos d\'un coup. Si les noms contiennent « S01E03 », la saison et le numéro sont détectés tout seuls.'),
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

async function addEpisodes(t, after) {
  const files = await pick('video/*,.mp4,.mov,.m4v,.webm,.mkv', true);
  if (!files.length) return;
  files.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  const eps = episodesOf(t.id);
  const lastSeason = eps.length ? Math.max(...eps.map((e) => e.season)) : 1;
  const seasonIn = h('input', { class: 'input', value: lastSeason, inputmode: 'numeric' });
  const startIn = h('input', { class: 'input', value: (eps.filter((e) => e.season === lastSeason).reduce((m, e) => Math.max(m, e.number), 0) + 1), inputmode: 'numeric' });
  const detected = files.map((f) => parseEpisode(f.name));
  const anyDetected = detected.some((d) => d && d.season);
  sheet((close) => [
    h('h2', {}, `${files.length} vidéo${files.length > 1 ? 's' : ''}`),
    anyDetected ? h('p', { class: 'muted small' }, 'Saisons et numéros détectés dans les noms de fichiers quand c\'est possible.') : null,
    h('div', { class: 'row' },
      h('div', { class: 'field grow' }, h('label', {}, 'Saison'), seasonIn),
      h('div', { class: 'field grow' }, h('label', {}, 'Premier n°'), startIn)),
    h('div', { style: { maxHeight: '200px', overflow: 'auto', marginBottom: '14px' } }, files.map((f, i) => h('div', { class: 'small muted', style: { padding: '4px 0' } }, `${detected[i]?.season ? `S${detected[i].season}É${detected[i].number}` : '•'} ${f.name} · ${bytes(f.size)}`))),
    h('button', { class: 'btn primary block', onclick: async () => {
      close();
      const season = parseInt(seasonIn.value, 10) || 1; let n = parseInt(startIn.value, 10) || 1;
      const modal = progressModal('Envoi des épisodes');
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const d = detected[i];
          const epId = uid();
          const info = await videoInfo(f, { max: 640 });
          const row = {
            id: epId, title_id: t.id,
            season: d?.season || season, number: d?.season ? d.number : (d?.number && !anyDetected ? n : n),
            name: guessName(f.name).replace(/s\d{1,2}\s*[ex]\d{1,3}/i, '').trim() || null,
            video_key: `c/${t.id}/e/${epId}.${ext(f.name)}`, video_size: f.size, duration: info.duration || null,
          };
          if (d?.season) row.number = d.number; else n++;
          const up = [{ key: row.video_key, body: f, type: f.type || 'video/mp4', label: `Épisode ${i + 1}/${files.length}` }];
          if (info.thumb) { row.thumb_key = `c/${t.id}/e/${epId}_t.jpg`; up.unshift({ key: row.thumb_key, body: info.thumb, type: 'image/jpeg', label: 'Miniature' }); }
          await uploadSet(up, modal, `${f.name} · `);
          const { error } = await sb.from('episodes').insert(row);
          if (error) throw error;
        }
        await loadCatalog(true);
        modal.close(); toast('Épisodes ajoutés'); after();
      } catch (e) { modal.close(); errToast(e); await loadCatalog(true); after(); }
    } }, icon('upload'), 'Envoyer'),
  ]);
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
