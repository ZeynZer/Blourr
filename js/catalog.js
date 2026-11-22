import { sb } from './api.js';

export const cat = { titles: [], sagas: [], episodes: [], progress: [], myList: new Set(), loaded: false };

export async function loadCatalog(force = false) {
  if (cat.loaded && !force) return cat;
  const [t, s, e, p, l] = await Promise.all([
    sb.from('titles').select('*').order('created_at', { ascending: false }),
    sb.from('sagas').select('*').order('name'),
    sb.from('episodes').select('*').order('season').order('number'),
    sb.from('watch_progress').select('*').order('updated_at', { ascending: false }),
    sb.from('my_list').select('title_id, created_at').order('created_at', { ascending: false }),
  ]);
  const err = t.error || s.error || e.error || p.error || l.error;
  if (err) throw err;
  cat.titles = t.data; cat.sagas = s.data; cat.episodes = e.data; cat.progress = p.data;
  cat.myList = new Set(l.data.map((x) => x.title_id));
  cat.listOrder = l.data.map((x) => x.title_id);
  cat.loaded = true;
  return cat;
}
export const titleById = (id) => cat.titles.find((t) => t.id === id);
export const sagaById = (id) => cat.sagas.find((s) => s.id === id);
export const episodesOf = (tid) => cat.episodes.filter((e) => e.title_id === tid).sort((a, b) => a.season - b.season || a.number - b.number);
export const sagaTitles = (sid) => cat.titles.filter((t) => t.saga_id === sid).sort((a, b) => (a.saga_order ?? 999) - (b.saga_order ?? 999) || (a.year || 0) - (b.year || 0));
export const progressOf = (itemId) => cat.progress.find((p) => p.item_id === itemId);
export const ratio = (p) => (p && p.duration ? p.position / p.duration : 0);
export const isDone = (p) => ratio(p) >= 0.95;
export const isPlayable = (t) => (t.kind === 'movie' ? !!t.video_key : episodesOf(t.id).some((e) => e.video_key));

export function nextEpisode(ep) {
  const list = episodesOf(ep.title_id).filter((e) => e.video_key);
  const i = list.findIndex((e) => e.id === ep.id);
  return i >= 0 ? list[i + 1] || null : null;
}

// Où reprendre la lecture d'un titre
export function resumeTarget(t) {
  if (t.kind === 'movie') {
    const p = progressOf(t.id);
    const r = ratio(p);
    if (p && r > 0.01 && r < 0.95) return { episode: null, position: p.position, progress: r, label: 'Reprendre' };
    return { episode: null, position: 0, progress: 0, label: 'Lecture' };
  }
  const eps = episodesOf(t.id).filter((e) => e.video_key);
  if (!eps.length) return null;
  const last = cat.progress.find((p) => p.title_id === t.id && p.episode_id);
  if (!last) return { episode: eps[0], position: 0, progress: 0, label: 'Lecture', sub: `S${eps[0].season}:É${eps[0].number}` };
  const ep = eps.find((e) => e.id === last.episode_id);
  if (!ep) return { episode: eps[0], position: 0, progress: 0, label: 'Lecture' };
  if (isDone(last)) {
    const nx = nextEpisode(ep);
    if (nx) return { episode: nx, position: 0, progress: 0, label: 'Reprendre', sub: `S${nx.season}:É${nx.number}` };
    return { episode: eps[0], position: 0, progress: 0, label: 'Revoir', sub: `S${eps[0].season}:É${eps[0].number}` };
  }
  return { episode: ep, position: last.position, progress: ratio(last), label: 'Reprendre', sub: `S${ep.season}:É${ep.number}` };
}

export function continueWatching() {
  const seen = new Set(); const out = [];
  for (const p of cat.progress) {
    if (seen.has(p.title_id)) continue;
    seen.add(p.title_id);
    const t = titleById(p.title_id);
    if (!t) continue;
    const r = resumeTarget(t);
    if (!r) continue;
    if (t.kind === 'movie' && !(r.progress > 0.01)) continue;
    if (t.kind === 'series' && r.label === 'Revoir') continue;
    out.push({ title: t, target: r, updated: p.updated_at });
  }
  return out;
}

export async function saveProgress(t, ep, position, duration) {
  const item_id = ep ? ep.id : t.id;
  const row = { item_id, title_id: t.id, episode_id: ep ? ep.id : null, position, duration, updated_at: new Date().toISOString() };
  const i = cat.progress.findIndex((p) => p.item_id === item_id);
  if (i >= 0) cat.progress.splice(i, 1);
  cat.progress.unshift(row);
  await sb.from('watch_progress').upsert(row, { onConflict: 'user_id,item_id' });
}

export async function toggleList(tid) {
  if (cat.myList.has(tid)) {
    cat.myList.delete(tid);
    cat.listOrder = cat.listOrder.filter((x) => x !== tid);
    await sb.from('my_list').delete().eq('title_id', tid);
    return false;
  }
  cat.myList.add(tid);
  cat.listOrder.unshift(tid);
  await sb.from('my_list').insert({ title_id: tid });
  return true;
}
