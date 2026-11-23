// Remplissage rapide d'une fiche à partir d'un texte (rédigé par une IA par exemple)
import { h, icon, toast, errToast, sheet } from './ui.js';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const KEYS = {
  titre: 'name', title: 'name', nom: 'name',
  annee: 'year', 'annee de sortie': 'year', year: 'year', sortie: 'year',
  age: 'rating', classification: 'rating', 'age minimum': 'rating', 'tranche d\'age': 'rating', rating: 'rating', public: 'rating',
  genre: 'genres', genres: 'genres',
  resume: 'desc', synopsis: 'desc', description: 'desc', histoire: 'desc',
  saga: 'saga', franchise: 'saga', collection: 'saga',
  'ordre dans la saga': 'order', ordre: 'order', 'numero dans la saga': 'order', 'n° dans la saga': 'order',
  episodes: 'episodes', 'liste des episodes': 'episodes',
};

export function ratingFrom(v, allowed) {
  const s = norm(v);
  if (/tous|tout public|^tp$|^u$|^g$|all/.test(s)) return 'Tous publics';
  const m = s.match(/(\d{1,2})/);
  if (!m) return null;
  const n = +m[1];
  const nums = allowed.map((r) => parseInt(r, 10)).filter((x) => !isNaN(x)).sort((a, b) => a - b);
  let best = null;
  for (const x of nums) if (x <= n) best = x; // ex. 13 → 12+, 14 → 12+
  return best == null ? 'Tous publics' : best + '+';
}

export function genresFrom(v, known) {
  const alias = { 'sf': 'Science-fiction', 'science fiction': 'Science-fiction', 'scifi': 'Science-fiction', 'sci-fi': 'Science-fiction', 'comedie dramatique': 'Comédie', 'animation japonaise': 'Anime', 'anime': 'Anime', 'manga': 'Anime', 'crime': 'Policier', 'polar': 'Policier', 'epouvante': 'Horreur', 'fantasy': 'Fantastique', 'romantique': 'Romance', 'biopic': 'Historique', 'musical': 'Musique', 'suspense': 'Thriller', 'familial': 'Famille' };
  const out = [];
  for (let g of v.split(/[,;/|•·]| et /)) {
    g = g.replace(/[.*_]/g, '').trim();
    if (!g) continue;
    const n = norm(g);
    let hit = known.find((k) => norm(k) === n) || alias[n];
    if (!hit) hit = g.charAt(0).toUpperCase() + g.slice(1);
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

// "S1E3 : Nom | Résumé", "S01E03 - Nom — Résumé", "1x03 Nom : Résumé", "É3 : Nom | …" (saison courante)
function parseEpisodes(lines) {
  const eps = []; let season = 1;
  for (const raw of lines) {
    const l = raw.replace(/^[-*•\s]+/, '').replace(/\*\*/g, '').trim();
    if (!l) continue;
    const sh = l.match(/^saison\s*(\d+)\s*:?\s*$/i);
    if (sh) { season = +sh[1]; continue; }
    let m = l.match(/^s(\d{1,2})\s*[ée](\d{1,3})\s*[:.\-–—)]?\s*(.*)$/i) || l.match(/^(\d{1,2})x(\d{1,3})\s*[:.\-–—)]?\s*(.*)$/i);
    let s, n, rest;
    if (m) { s = +m[1]; n = +m[2]; rest = m[3]; }
    else {
      m = l.match(/^(?:[ée]p(?:isode)?|[ée])\.?\s*(\d{1,3})\s*[:.\-–—)]?\s*(.*)$/i) || l.match(/^(\d{1,3})\s*[:.)\-–—]\s*(.*)$/);
      if (!m) continue;
      s = season; n = +m[1]; rest = m[2];
    }
    let [name, ...d] = rest.split(/\s+[|—–]\s+|\s*\|\s*/);
    eps.push({ season: s, number: n, name: (name || '').replace(/^["«»“”\s]+|["«»“”\s]+$/g, '').trim() || null, description: d.join(' — ').trim() || null });
  }
  return eps;
}

export function parseSheet(text, { ratings, genres }) {
  const out = {}; let cur = null; const epLines = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/^\s*[-*•#>]+\s*/, '').replace(/\*\*/g, '');
    const m = line.match(/^([^:：]{2,28})\s*[:：]\s*(.*)$/);
    const key = m ? KEYS[norm(m[1]).replace(/\s+/g, ' ')] : null;
    if (key) { cur = key; if (key === 'episodes') { if (m[2].trim()) epLines.push(m[2]); } else out[key] = m[2].trim(); continue; }
    if (cur === 'episodes') epLines.push(line);
    else if (cur === 'desc' && line.trim()) out.desc = (out.desc ? out.desc + '\n' : '') + line.trim();
  }
  const res = {};
  if (out.name) res.name = out.name.replace(/^["«“]\s*|\s*["»”]$/g, '');
  if (out.year) { const y = out.year.match(/(19|20)\d{2}/); if (y) res.year = +y[0]; }
  if (out.rating) res.rating = ratingFrom(out.rating, ratings);
  if (out.genres) res.genres = genresFrom(out.genres, genres);
  if (out.desc) res.description = out.desc.trim();
  if (out.saga && !/^(aucune?|non|-|—|n\/a|none)$/i.test(out.saga.trim())) res.saga = out.saga.trim();
  if (out.order) { const o = parseInt(out.order, 10); if (o) res.order = o; }
  if (epLines.length) { const eps = parseEpisodes(epLines); if (eps.length) res.episodes = eps; }
  return res;
}

export function templateFor({ kind, name, year, genres }) {
  const series = kind === 'series';
  return `Remplis cette fiche pour ${series ? 'la série' : 'le film'} « ${name || '…'} »${year ? ` (${year})` : ''}. Fais des recherches pour que les infos soient exactes.
Règles :
- Réponds UNIQUEMENT avec la fiche remplie, sans aucun commentaire ni mise en forme.
- Âge : classification française (CNC), ou à défaut l'âge conseillé. Une seule valeur parmi : Tous publics, 7+, 10+, 12+, 16+, 18+.
- Genres : 1 à 3 genres, de préférence parmi : ${genres.join(', ')}.
- Résumé : en français, 2 à 4 phrases, sans spoiler.
- Saga : le nom de la saga/franchise si ${series ? 'la série' : 'le film'} en fait partie, sinon « Aucune ».${series ? `
- Épisodes : une ligne par épisode au format « S1E1 : Titre de l'épisode en français | Résumé en une phrase ».` : ''}

Titre : ${name || ''}
Année : ${year || ''}
Âge :
Genres :
Saga :
Ordre dans la saga :
Résumé :${series ? `
Épisodes :
S1E1 : Titre | Résumé` : ''}`;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text);
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

// Ouvre la feuille : copier le modèle, coller la réponse. onApply(résultat) → nombre de champs remplis
export function fillSheet(ctx, onApply) {
  const area = h('textarea', { class: 'textarea', placeholder: 'Colle ici le texte rempli…', style: { minHeight: '190px', fontSize: '14px' } });
  const status = h('div', { class: 'small muted', style: { minHeight: '18px', marginTop: '6px' } });
  let close;
  const body = h('div', {},
    h('h2', {}, 'Remplir avec un texte'),
    h('p', { class: 'small muted', style: { margin: '0 0 12px' } }, '1. Copie le modèle et donne-le à une IA (ChatGPT, Claude…). 2. Colle sa réponse ici. Les champs se remplissent tout seuls, tu pourras encore tout modifier.'),
    h('button', { class: 'btn block', onclick: async () => { (await copy(templateFor(ctx()))) ? toast('Modèle copié — colle-le dans l\'IA') : errToast('Copie impossible'); } }, icon('copy'), 'Copier le modèle pour l\'IA'),
    h('div', { style: { height: '14px' } }),
    h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '6px' } },
      h('label', { style: { fontWeight: 600 } }, 'Réponse de l\'IA'),
      navigator.clipboard?.readText ? h('button', { class: 'btn sm ghost', onclick: async () => { try { area.value = await navigator.clipboard.readText(); preview(); } catch { area.focus(); } } }, icon('copy'), 'Coller') : null),
    area, status,
    h('button', { class: 'btn primary block', style: { marginTop: '10px' }, onclick: () => {
      const r = parseSheet(area.value, ctx());
      if (!Object.keys(r).length) return errToast('Je n\'ai reconnu aucun champ. Vérifie le format « Titre : … ».');
      const n = onApply(r);
      toast(`${n} champ${n > 1 ? 's' : ''} rempli${n > 1 ? 's' : ''}`);
      close();
    } }, icon('check'), 'Remplir la fiche'));
  function preview() {
    const r = parseSheet(area.value, ctx());
    const parts = [];
    if (r.name) parts.push('titre'); if (r.year) parts.push('année'); if (r.rating) parts.push('âge ' + r.rating);
    if (r.genres) parts.push(r.genres.length + ' genre(s)'); if (r.description) parts.push('résumé'); if (r.saga) parts.push('saga');
    if (r.episodes) parts.push(r.episodes.length + ' épisode(s)');
    status.textContent = parts.length ? 'Reconnu : ' + parts.join(' · ') : (area.value.trim() ? 'Aucun champ reconnu pour l\'instant' : '');
  }
  area.addEventListener('input', preview);
  sheet((c) => { close = c; return body; });
}
