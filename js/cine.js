import { h, icon, errToast, toast, runtime, avatar, confirmBox, dateFr } from './ui.js';
import { sb, state, lazyImg, bgInto } from './api.js';
import { cat, loadCatalog, titleById, sagaById, episodesOf, sagaTitles, progressOf, ratio, resumeTarget, continueWatching, toggleList, isPlayable } from './catalog.js';
import { openPlayer } from './player.js';
import { go } from './router.js';

const DAY = 86400000;
const isNew = (t) => Date.now() - new Date(t.created_at).getTime() < 14 * DAY;
let refreshCurrent = null;

function seasonsLabel(t) {
  const s = new Set(episodesOf(t.id).map((e) => e.season));
  return s.size ? `${s.size} saison${s.size > 1 ? 's' : ''}` : 'Série';
}
function metaBits(t) {
  return [t.year, t.kind === 'movie' ? runtime(t.duration) : seasonsLabel(t), t.genres?.[0]].filter(Boolean);
}

// ---------- Cartes ----------
function card(t, { cw = null, poster = false, onclick = null } = {}) {
  const key = poster ? (t.poster_key || t.backdrop_key) : (t.backdrop_key || t.poster_key);
  const el = h('div', { class: 'c-card' + (poster ? ' poster' : '') + (cw ? ' cw' : '') });
  el.addEventListener('click', onclick || (() => (cw ? play(t, cw.target) : openDetail(t.id))));
  if (key) el.append(lazyImg(key, { alt: t.name }));
  else el.append(h('div', { class: 'fallback' }, t.name));
  if (!cw && isNew(t)) el.append(h('div', { class: 'new-tag' }, 'NOUVEAU'));
  if (cw) {
    el.append(h('div', { class: 'play-ic' }, icon('play')));
    el.append(h('div', { class: 'lbl' }, t.name, cw.target.sub ? h('small', {}, cw.target.sub) : null));
    el.append(h('div', { class: 'prog' }, h('i', { style: { width: Math.max(3, cw.target.progress * 100) + '%' } })));
  } else if (key && (!poster || !t.poster_key)) {
    el.append(h('div', { class: 'lbl' }, t.name));
  }
  return el;
}
function sagaCard(s) {
  const list = sagaTitles(s.id);
  const key = s.backdrop_key || list[0]?.backdrop_key;
  const el = h('div', { class: 'c-card saga', onclick: () => go('#/cine/saga/' + s.id) });
  if (key) el.append(lazyImg(key, { alt: s.name }));
  el.append(h('div', { class: 'lbl' }, s.name, h('small', { style: { fontFamily: 'Inter, sans-serif', fontSize: '12px' } }, `${list.length} titre${list.length > 1 ? 's' : ''}`)));
  return el;
}
function row(titleText, cards) {
  if (!cards.length) return null;
  return h('section', { class: 'c-row' }, h('h3', {}, titleText), h('div', { class: 'c-scroll' }, cards));
}

function play(t, target) {
  target = target || resumeTarget(t);
  if (!target || !isPlayable(t)) return errToast('La vidéo n\'est pas encore en ligne.');
  openPlayer({ title: t, episode: target.episode, start: target.position, onExit: () => refreshCurrent && refreshCurrent() });
}

// ---------- Barre du haut ----------
function topBar(active) {
  const bar = h('div', { class: 'cine-top' },
    h('div', { class: 'brand', onclick: () => go('#/cine'), style: { cursor: 'pointer' } }, h('span', { class: 'b-short' }, 'B'), h('span', { class: 'b-long' }, 'BLOURR')),
    h('div', { class: 'links' },
      [['series', 'Séries'], ['films', 'Films'], ['liste', 'Ma liste'], ['demandes', 'Demandes']].map(([k, l]) =>
        h('button', { class: (active === k ? 'active' : '') + (k === 'demandes' ? ' l-req' : ''), onclick: () => go(active === k ? '#/cine' : '#/cine/' + k) }, l))),
    h('button', { class: 'icon-btn plain only-mobile' + (active === 'demandes' ? ' on' : ''), title: 'Demandes', onclick: () => go('#/cine/demandes') }, icon('bulb')),
    h('button', { class: 'icon-btn plain', title: 'Rechercher', onclick: () => go('#/cine/recherche') }, icon('search')),
    state.isAdmin ? h('button', { class: 'icon-btn plain', title: 'Studio', onclick: () => go('#/studio') }, icon('settings')) : null);
  const onScroll = () => bar.classList.toggle('solid', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  bar.cleanup = () => window.removeEventListener('scroll', onScroll);
  return bar;
}

// ---------- Grande affiche ----------
function hero(t) {
  const bg = h('div', { class: 'bg' });
  const wide = window.matchMedia('(min-width: 800px)').matches;
  bgInto(bg, wide ? (t.backdrop_key || t.poster_key) : (t.poster_key || t.backdrop_key));
  const saga = t.saga_id && sagaById(t.saga_id);
  const target = resumeTarget(t);
  return h('div', { class: 'hero' }, bg,
    h('div', { class: 'info' },
      h('div', { class: 'kicker' }, t.kind === 'series' ? 'Série' : 'Film', saga ? ` · ${saga.name}` : ''),
      h('h2', {}, t.name),
      h('div', { class: 'tags' }, metaBits(t).map((b) => h('span', {}, b))),
      t.description ? h('p', {}, t.description) : null,
      h('div', { class: 'btns' },
        isPlayable(t) ? h('button', { class: 'btn light', onclick: () => play(t) }, icon('play'), target?.label === 'Reprendre' ? 'Reprendre' : 'Lecture') : null,
        h('button', { class: 'btn ghost', onclick: () => openDetail(t.id) }, icon('info'), 'Plus d\'infos'))));
}

// ======================================================================
// Accueil ciné
// ======================================================================
export function cineView(sub = []) {
  const mode = sub[0] || 'home';
  if (mode === 'recherche') return searchView();
  if (mode === 'saga') return sagaView(sub[1]);
  if (mode === 'demandes') return requestsView();
  const root = h('div', { class: 'view cine' });
  const top = topBar(mode);
  const body = h('div', {}, h('div', { class: 'center-load', style: { minHeight: '80vh' } }, h('div', { class: 'spinner' })));
  root.append(top, body);
  root.cleanup = () => { top.cleanup(); refreshCurrent = null; };
  let heroId = null;

  async function render(force) {
    try { await loadCatalog(force); } catch (e) { body.replaceChildren(h('div', { class: 'empty', style: { paddingTop: '120px' } }, h('p', {}, e.message))); return; }
    let pool = cat.titles.filter(isPlayable);
    if (mode === 'series') pool = pool.filter((t) => t.kind === 'series');
    if (mode === 'films') pool = pool.filter((t) => t.kind === 'movie');
    if (mode === 'liste') pool = cat.listOrder.map(titleById).filter(Boolean);

    body.replaceChildren();
    if (!pool.length) {
      const pending = state.isAdmin && cat.titles.length && mode !== 'liste';
      body.append(h('div', { class: 'hero empty-hero' }, h('div', { class: 'bg' })),
        h('div', { class: 'empty', style: { marginTop: '-200px', position: 'relative' } },
          h('div', { class: 'em-ic' }, icon('film')),
          h('h3', {}, mode === 'liste' ? 'Ta liste est vide' : pending ? 'Aucune vidéo en ligne' : 'Le catalogue est vide'),
          h('p', {}, mode === 'liste' ? 'Ajoute des films et des séries avec « Ma liste ».'
            : pending ? 'Tes titres apparaîtront ici dès qu\'une vidéo est envoyée.'
            : state.isAdmin ? 'Ajoute ton premier film ou ta première série depuis le Studio.' : 'L\'administrateur n\'a pas encore ajouté de vidéos.'),
          state.isAdmin && mode !== 'liste' ? h('button', { class: 'btn primary', onclick: () => go('#/studio') }, icon('plus'), 'Ouvrir le Studio') : null));
      return;
    }
    if (mode === 'liste') {
      body.append(h('div', { style: { height: 'calc(var(--safe-t) + 74px)' } }),
        h('section', { class: 'c-row' }, h('h3', {}, 'Ma liste'),
          h('div', { class: 'sim-grid', style: { padding: '0 16px' } }, pool.map((t) => card(t, { poster: true })))));
      return;
    }
    const featured = pool.filter((t) => t.featured);
    const heroPool = featured.length ? featured : pool.slice(0, 5);
    let heroT = heroPool.find((t) => t.id === heroId);
    if (!heroT) { heroT = heroPool[Math.floor(Math.random() * heroPool.length)]; heroId = heroT.id; }
    body.append(hero(heroT));

    const rows = [];
    const cw = continueWatching().filter((x) => pool.includes(x.title));
    rows.push(row(`Reprendre avec ${state.profile.display_name}`, cw.map((x) => card(x.title, { cw: x }))));
    const myl = cat.listOrder.map(titleById).filter((t) => t && pool.includes(t));
    rows.push(row('Ma liste', myl.map((t) => card(t))));
    // Chaque titre n'apparaît qu'une fois dans les rangées du catalogue
    // (« Reprendre » et « Ma liste » sont personnelles et restent à part).
    const big = pool.length >= 12;
    if (big) rows.push(row('Nouveautés', pool.slice(0, 10).map((t) => card(t))));
    if (mode === 'home') {
      const sagas = cat.sagas.filter((s) => sagaTitles(s.id).some((t) => pool.includes(t)));
      rows.push(row('Sagas', sagas.map(sagaCard)));
    }
    const used = new Set(big ? pool.slice(0, 10).map((t) => t.id) : []);
    let genreRows = 0;
    if (pool.length >= 8) {
      const count = {};
      for (const t of pool) for (const g of t.genres || []) count[g] = (count[g] || 0) + 1;
      for (const g of Object.keys(count).sort((a, b) => count[b] - count[a])) {
        const list = pool.filter((t) => !used.has(t.id) && (t.genres || []).includes(g));
        if (list.length < 3) continue;
        list.forEach((t) => used.add(t.id));
        rows.push(row(g, list.map((t) => card(t))));
        genreRows++;
      }
    }
    const rest = pool.filter((t) => !used.has(t.id));
    const more = genreRows ? 'Encore plus de ' : '';
    if (mode !== 'films') rows.push(row(more ? more + 'séries' : 'Séries', rest.filter((t) => t.kind === 'series').map((t) => card(t, { poster: true }))));
    if (mode !== 'series') rows.push(row(more ? more + 'films' : 'Films', rest.filter((t) => t.kind === 'movie').map((t) => card(t, { poster: true }))));
    body.append(h('div', { style: { marginTop: '-30px', position: 'relative', zIndex: 2 } }, rows));
  }
  refreshCurrent = () => render(false);
  render(false);
  return root;
}

// ======================================================================
// Page d'une saga
// ======================================================================
function sagaView(id) {
  const root = h('div', { class: 'view cine saga-page' });
  const top = topBar('');
  const body = h('div');
  root.append(top, body);
  root.cleanup = () => { top.cleanup(); refreshCurrent = null; };
  async function render() {
    await loadCatalog();
    const s = sagaById(id);
    if (!s) { body.replaceChildren(h('div', { class: 'empty', style: { paddingTop: '120px' } }, h('h3', {}, 'Saga introuvable'))); return; }
    const list = sagaTitles(id);
    const bg = h('div', { class: 'bg' });
    bgInto(bg, s.backdrop_key || list[0]?.backdrop_key);
    const next = list.find((t) => isPlayable(t) && (t.kind === 'movie' ? ratio(progressOf(t.id)) < 0.95 : resumeTarget(t)?.label !== 'Revoir')) || list.find(isPlayable);
    body.replaceChildren(
      h('div', { class: 'hero' }, bg, h('div', { class: 'info' },
        h('div', { class: 'kicker' }, 'Saga'),
        h('h2', {}, s.name),
        h('div', { class: 'tags' }, h('span', {}, `${list.length} titre${list.length > 1 ? 's' : ''}`)),
        s.description ? h('p', { style: { display: '-webkit-box' } }, s.description) : null,
        next ? h('div', { class: 'btns' }, h('button', { class: 'btn light', onclick: () => play(next) }, icon('play'), next.name)) : null)),
      h('div', { style: { padding: '0 16px', maxWidth: '860px', margin: '0 auto' } },
        list.map((t, i) => {
          const p = t.kind === 'movie' ? ratio(progressOf(t.id)) : 0;
          return h('div', { class: 'saga-item', onclick: () => openDetail(t.id) },
            h('div', { class: 'n' }, i + 1),
            h('div', { class: 'th', style: { position: 'relative' } }, lazyImg(t.backdrop_key || t.poster_key),
              p > 0.01 ? h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '3px', background: 'rgba(255,255,255,.25)' } }, h('i', { style: { display: 'block', height: '100%', width: p * 100 + '%', background: 'var(--cine-red)' } })) : null),
            h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, t.name), h('div', { class: 'small', style: { color: '#999' } }, metaBits(t).join(' · '))));
        })));
  }
  refreshCurrent = render;
  render();
  return root;
}

// ======================================================================
// Recherche
// ======================================================================
function searchView() {
  const root = h('div', { class: 'view cine' });
  const top = topBar('');
  const inp = h('input', { class: 'input', placeholder: 'Titres, genres, sagas, années…', type: 'search' });
  const res = h('div', { class: 'res' });
  const label = h('h3', { style: { margin: '0 0 12px', fontSize: '18px' } });
  root.append(top, h('div', { class: 'c-search' }, h('div', { class: 'sw' }, icon('search'), inp), label, res));
  root.cleanup = () => top.cleanup();
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function run() {
    const q = norm(inp.value.trim());
    const pool = cat.titles.filter(isPlayable);
    const out = !q ? pool : pool.filter((t) => {
      const saga = t.saga_id ? sagaById(t.saga_id)?.name : '';
      return [t.name, t.description, saga, ...(t.genres || []), t.year].some((x) => norm(x).includes(q));
    });
    label.textContent = q ? (out.length ? 'Résultats' : 'Aucun résultat') : 'Tout le catalogue';
    res.replaceChildren(...out.map((t) => card(t, { poster: true })));
  }
  inp.addEventListener('input', run);
  loadCatalog().then(() => { run(); setTimeout(() => inp.focus(), 250); }).catch(errToast);
  return root;
}

// ======================================================================
// Fiche détaillée (film / série)
// ======================================================================
export async function openDetail(id) {
  await loadCatalog();
  const t = titleById(id);
  if (!t) return;
  document.querySelectorAll('.detail-ov').forEach((x) => x.remove());
  const d = h('div', { class: 'detail' });
  const ov = h('div', { class: 'detail-ov' }, d);
  const esc = (e) => e.key === 'Escape' && close();
  function close() { ov.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', esc); refreshCurrent && refreshCurrent(); }
  document.addEventListener('keydown', esc);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.body.style.overflow = 'hidden';
  document.body.append(ov);

  function render() {
    const target = resumeTarget(t);
    const heroEl = h('div', { class: 'd-hero' }, h('div', { class: 'd-title' }, t.name));
    bgInto(heroEl, t.backdrop_key || t.poster_key);
    const inList = cat.myList.has(t.id);
    const saga = t.saga_id && sagaById(t.saga_id);
    const playable = isPlayable(t);
    const remaining = target && target.progress > 0.01
      ? Math.max(1, Math.round(((target.episode?.duration || t.duration || 0) * (1 - target.progress)) / 60)) : 0;

    d.replaceChildren(
      h('button', { class: 'icon-btn close', onclick: close }, icon('x')),
      heroEl,
      h('div', { class: 'body' },
        h('div', { class: 'meta-line' },
          isNew(t) ? h('span', { class: 'match' }, 'Nouveau') : null,
          t.year ? h('span', {}, t.year) : null,
          t.rating ? h('span', { class: 'age' }, t.rating) : null,
          h('span', {}, t.kind === 'movie' ? runtime(t.duration) : seasonsLabel(t)),
          h('span', { class: 'hd' }, 'HD'),
          t.subtitle_key || episodesOf(t.id).some((e) => e.subtitle_key) ? h('span', { class: 'hd' }, 'ST') : null),
        playable
          ? h('button', { class: 'btn light play-main', onclick: () => { close(); play(t, target); } }, icon('play'), (target?.label || 'Lecture') + (target?.sub ? ` ${target.sub}` : ''))
          : h('button', { class: 'btn play-main', disabled: true }, 'Bientôt disponible'),
        remaining ? h('div', { class: 'resume-prog' }, h('div', { class: 'bar' }, h('i', { style: { width: target.progress * 100 + '%' } })), h('span', {}, `${remaining} min restantes`)) : null,
        t.description ? h('div', { class: 'desc' }, t.description) : null,
        h('div', { class: 'cast' },
          t.genres?.length ? h('div', {}, h('b', {}, 'Genres : '), t.genres.join(', ')) : null,
          saga ? h('div', {}, h('b', {}, 'Saga : '), h('a', { href: '#/cine/saga/' + saga.id, onclick: close, style: { textDecoration: 'underline' } }, saga.name)) : null),
        h('div', { class: 'd-actions' },
          h('button', { onclick: async () => { try { await toggleList(t.id); render(); } catch (e) { errToast(e); } } }, icon(inList ? 'check' : 'plus'), 'Ma liste'),
          navigator.share ? h('button', { onclick: () => navigator.share({ title: t.name, text: `Regarde « ${t.name} » sur Blourr`, url: location.origin + location.pathname }).catch(() => {}) }, icon('share'), 'Partager') : null,
          state.isAdmin ? h('button', { onclick: () => { close(); go('#/studio/t/' + t.id); } }, icon('edit'), 'Modifier') : null),
        t.kind === 'series' ? episodesBlock(t, close) : null,
        saga ? sagaBlock(t, saga) : null,
        similarBlock(t)));
  }

  function sagaBlock(t2, saga) {
    const list = sagaTitles(saga.id);
    if (list.length < 2) return null;
    return h('div', { class: 'd-section' },
      h('div', { class: 'd-section-h' }, h('h4', {}, saga.name)),
      list.map((x, i) => h('div', { class: 'saga-item' + (x.id === t2.id ? ' current' : ''), onclick: () => { if (x.id !== t2.id) openDetail(x.id); } },
        h('div', { class: 'n' }, i + 1),
        h('div', { class: 'th' }, lazyImg(x.backdrop_key || x.poster_key)),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, x.name), h('div', { class: 'small', style: { color: '#999' } }, metaBits(x).join(' · '))))));
  }

  function similarBlock(t2) {
    const scored = cat.titles.filter((x) => x.id !== t2.id && isPlayable(x))
      .map((x) => ({ x, s: (x.genres || []).filter((g) => (t2.genres || []).includes(g)).length + (x.saga_id && x.saga_id === t2.saga_id ? 2 : 0) }))
      .filter((o) => o.s > 0).sort((a, b) => b.s - a.s).slice(0, 9).map((o) => o.x);
    if (!scored.length) return null;
    return h('div', { class: 'd-section', style: { marginTop: '18px' } },
      h('div', { class: 'd-section-h' }, h('h4', {}, 'Titres similaires')),
      h('div', { class: 'sim-grid' }, scored.map((x) => card(x, { poster: true, onclick: () => openDetail(x.id) }))));
  }

  render();
}

function episodesBlock(t, closeDetail) {
  const eps = episodesOf(t.id);
  if (!eps.length) return h('div', { class: 'd-section' }, h('p', { class: 'muted' }, 'Aucun épisode pour l\'instant.'));
  const seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => a - b);
  const target = resumeTarget(t);
  let current = target?.episode?.season || seasons[0];
  const list = h('div');
  const sel = h('select', { class: 'season-sel select', onchange: () => { current = +sel.value; draw(); } },
    seasons.map((s) => h('option', { value: s, selected: s === current }, `Saison ${s}`)));
  function draw() {
    list.replaceChildren(...eps.filter((e) => e.season === current).map((e) => {
      const p = ratio(progressOf(e.id));
      return h('div', { class: 'ep' + (target?.episode?.id === e.id ? ' current' : ''), onclick: () => {
        if (!e.video_key) return errToast('Épisode pas encore en ligne.');
        closeDetail();
        const pr = progressOf(e.id);
        openPlayer({ title: t, episode: e, start: pr && ratio(pr) < 0.95 ? pr.position : 0, onExit: () => refreshCurrent && refreshCurrent() });
      } },
        h('div', { class: 'th' }, lazyImg(e.thumb_key || t.backdrop_key),
          h('div', { class: 'pi' }, h('span', {}, icon('play'))),
          p > 0.01 ? h('div', { class: 'prog' }, h('i', { style: { width: p * 100 + '%' } })) : null),
        h('div', { class: 'ei' },
          h('div', { class: 't' }, `${e.number}. ${e.name || 'Épisode ' + e.number}`, h('span', {}, runtime(e.duration))),
          e.description ? h('p', {}, e.description) : null,
          !e.video_key ? h('p', { style: { color: '#f59e0b' } }, 'Vidéo manquante') : null));
    }));
  }
  draw();
  return h('div', { class: 'd-section' },
    h('div', { class: 'd-section-h' }, h('h4', {}, 'Épisodes'), seasons.length > 1 ? sel : h('span', { class: 'muted' }, `Saison ${current}`)),
    list);
}

// ======================================================================
// Demandes d'ajout (avec likes)
// ======================================================================
const KIND_LABEL = { movie: 'Film', series: 'Série', anime: 'Anime' };
function requestsView() {
  const root = h('div', { class: 'view cine' });
  const top = topBar('demandes');
  let tab = 'pending';
  const list = h('div');
  const titleIn = h('input', { class: 'input', placeholder: 'Titre du film, de la série ou de l\'anime', maxlength: 120 });
  const kindSel = h('select', { class: 'select', style: { width: '120px', flex: 'none' } }, Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k }, l)));
  const noteIn = h('input', { class: 'input', placeholder: 'Précision (saison, version…) — facultatif', maxlength: 300, style: { marginTop: '8px' } });
  const send = h('button', { class: 'btn primary block', style: { marginTop: '10px' } }, icon('plus'), 'Proposer');
  const tabs = h('div', { class: 'req-tabs' });
  root.append(top,
    h('div', { style: { height: 'calc(var(--safe-t) + 70px)' } }),
    h('div', { class: 'sec-h' }, 'Demandes d\'ajout'),
    h('p', { class: 'muted small', style: { padding: '0 16px', margin: '-4px 0 14px' } }, 'Propose un film ou une série, et like les idées des autres : les plus demandés passent en premier.'),
    h('div', { class: 'req-form' }, h('div', { class: 'row' }, titleIn, kindSel), noteIn, send),
    tabs, list);
  root.cleanup = () => top.cleanup();

  send.onclick = async () => {
    const title = titleIn.value.trim();
    if (!title) return errToast('Écris un titre.');
    send.disabled = true;
    try {
      const { data, error } = await sb.from('requests').insert({ title, kind: kindSel.value, note: noteIn.value.trim() || null }).select().single();
      if (error) throw error;
      await sb.from('request_votes').insert({ request_id: data.id });
      titleIn.value = ''; noteIn.value = '';
      toast('Demande envoyée');
      tab = 'pending'; load();
    } catch (e) { errToast(e); } finally { send.disabled = false; }
  };

  async function load() {
    const { data, error } = await sb.from('requests')
      .select('*, author:profiles(id, display_name, color), votes:request_votes(user_id)')
      .order('created_at', { ascending: false });
    if (error) { list.replaceChildren(h('p', { class: 'muted', style: { padding: '0 16px' } }, error.message)); return; }
    const counts = { pending: 0, added: 0, refused: 0 };
    data.forEach((r) => counts[r.status]++);
    tabs.replaceChildren(...[['pending', 'En attente'], ['added', 'Ajoutés'], ['refused', 'Refusés']].map(([k, l]) =>
      h('button', { class: 'chip' + (tab === k ? ' active' : ''), onclick: () => { tab = k; load(); } }, `${l} (${counts[k]})`)));
    const shown = data.filter((r) => r.status === tab).sort((a, b) => b.votes.length - a.votes.length || new Date(b.created_at) - new Date(a.created_at));
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'empty', style: { padding: '30px' } }, h('p', {}, tab === 'pending' ? 'Aucune demande en attente.' : 'Rien ici pour l\'instant.')));
      return;
    }
    list.replaceChildren(...shown.map((r) => {
      const mine = r.votes.some((v) => v.user_id === state.profile.id);
      const likeBtn = h('button', { class: 'like' + (mine ? ' on' : ''), disabled: r.status !== 'pending', onclick: async () => {
        try {
          if (mine) await sb.from('request_votes').delete().eq('request_id', r.id).eq('user_id', state.profile.id);
          else await sb.from('request_votes').insert({ request_id: r.id });
          load();
        } catch (e) { errToast(e); }
      } }, icon(mine ? 'heartf' : 'heart'), String(r.votes.length));
      const canDelete = state.isAdmin || r.user_id === state.profile.id;
      const setStatus = async (status) => {
        const { error: e2 } = await sb.from('requests').update({ status }).eq('id', r.id);
        if (e2) return errToast(e2);
        toast(status === 'added' ? 'Marqué comme ajouté' : status === 'refused' ? 'Demande refusée' : 'Remis en attente');
        load();
      };
      return h('div', { class: 'req' },
        avatar(r.author),
        h('div', { class: 'meta' },
          h('b', {}, r.title, h('span', { class: 'kind' }, KIND_LABEL[r.kind] || r.kind),
            r.status !== 'pending' ? h('span', { class: 'status-pill ' + r.status, style: { marginLeft: '6px' } }, r.status === 'added' ? 'Ajouté' : 'Refusé') : null),
          h('div', { class: 'sub' }, `par ${r.author?.display_name || 'un ancien membre'} · ${dateFr(r.created_at)}`),
          r.note ? h('div', { class: 'note' }, r.note) : null,
          state.isAdmin || canDelete ? h('div', { class: 'adm' },
            state.isAdmin && r.status !== 'added' ? h('button', { onclick: () => setStatus('added') }, '✓ Ajouté') : null,
            state.isAdmin && r.status !== 'refused' ? h('button', { onclick: () => setStatus('refused') }, 'Refuser') : null,
            state.isAdmin && r.status !== 'pending' ? h('button', { onclick: () => setStatus('pending') }, 'Remettre en attente') : null,
            state.isAdmin && r.status === 'pending' ? h('button', { onclick: () => go('#/studio/t/new/' + (r.kind === 'movie' ? 'movie' : 'series')) }, '+ Ajouter au Studio') : null,
            canDelete ? h('button', { style: { color: 'var(--danger)' }, onclick: async () => {
              if (!(await confirmBox('Supprimer cette demande ?', '', 'Supprimer'))) return;
              const { error: e3 } = await sb.from('requests').delete().eq('id', r.id);
              if (e3) return errToast(e3);
              load();
            } }, 'Supprimer') : null) : null),
        likeBtn);
    }));
  }
  load();
  return root;
}
