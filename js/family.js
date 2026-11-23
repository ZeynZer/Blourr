import { h, icon, sheet, errToast, avatar, dateFr } from './ui.js';
import { sb, state, lazyImg } from './api.js';
import { cat, loadCatalog, titleById } from './catalog.js';
import { openDetail } from './cine.js';
import { openViewer } from './gallery.js';
import { donateCard } from './donate.js';

// ======================================================================
// La famille : tous les inscrits, leur photo et leurs films préférés
// ======================================================================
export function familyView() {
  const root = h('div', { class: 'view' });
  const grid = h('div', { class: 'fam-grid' }, h('div', { class: 'center-load', style: { gridColumn: '1/-1' } }, h('div', { class: 'spinner' })));
  root.append(h('div', { class: 'topbar' }, h('h1', {}, 'Famille')), donateCard(), grid);

  (async () => {
    try {
      const [{ data: profiles, error }, { data: media }] = await Promise.all([
        sb.from('profiles').select('*').order('created_at'),
        sb.from('media').select('owner_id').limit(20000),
        loadCatalog(true),
      ]);
      if (error) throw error;
      const shared = {};
      for (const m of media || []) shared[m.owner_id] = (shared[m.owner_id] || 0) + 1;
      grid.replaceChildren(...profiles.map((p) => {
        const favs = cat.favAll.filter((f) => f.user_id === p.id).map((f) => titleById(f.title_id)).filter(Boolean);
        return h('div', { class: 'fam-card', onclick: () => memberSheet(p, shared[p.id] || 0) },
          avatar(p),
          h('div', { class: 'nm' }, p.display_name, p.id === state.profile.id ? h('span', { class: 'muted small' }, ' (toi)') : null),
          p.bio ? h('div', { class: 'bio' }, p.bio) : null,
          favs.length ? h('div', { class: 'fav-strip' }, favs.slice(0, 4).map((t) => h('div', { class: 'p' }, lazyImg(t.poster_key || t.backdrop_key)))) : null,
          h('div', { class: 'stats' }, `${favs.length} préféré${favs.length > 1 ? 's' : ''} · ${shared[p.id] || 0} partage${(shared[p.id] || 0) > 1 ? 's' : ''}`));
      }));
    } catch (e) { grid.replaceChildren(h('p', { class: 'muted' }, e.message)); }
  })();
  return root;
}

async function memberSheet(p, sharedCount) {
  const favs = cat.favAll.filter((f) => f.user_id === p.id).map((f) => titleById(f.title_id)).filter(Boolean);
  const photos = h('div');
  const close = sheet((closeFn) => [
    h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' } },
      avatar(p, 'xl'),
      h('h2', { style: { margin: '12px 0 2px' } }, p.display_name),
      p.role === 'admin' ? h('span', { class: 'role-pill' }, 'Administrateur') : null,
      p.bio ? h('div', { class: 'bio' }, p.bio) : null,
      h('div', { class: 'muted small', style: { marginTop: '8px' } }, `Membre depuis le ${dateFr(p.created_at)}`)),
    h('h3', { class: 'sh' }, `Ses films et séries préférés (${favs.length})`),
    favs.length
      ? h('div', { class: 'fav-grid' }, favs.map((t) => {
        const c = h('div', { class: 'c-card poster', onclick: () => { closeFn(); location.hash = '#/cine'; setTimeout(() => openDetail(t.id), 300); } });
        if (t.poster_key || t.backdrop_key) c.append(lazyImg(t.poster_key || t.backdrop_key, { eager: true }));
        else c.append(h('div', { class: 'fallback' }, t.name));
        if (!t.poster_key) c.append(h('div', { class: 'lbl' }, t.name));
        return c;
      }))
      : h('p', { class: 'muted small' }, p.id === state.profile.id ? 'Ajoute tes préférés avec le bouton « J\'adore » sur la fiche d\'un film.' : 'Pas encore de préférés.'),
    h('h3', { class: 'sh' }, `Ses derniers partages (${sharedCount})`),
    photos,
  ]);
  const { data } = await sb.from('media').select('*, owner:profiles(id, display_name, color, avatar_key)').eq('owner_id', p.id).neq('kind', 'file').order('created_at', { ascending: false }).limit(12);
  if (!data?.length) { photos.replaceChildren(h('p', { class: 'muted small' }, 'Rien de partagé pour l\'instant.')); return; }
  photos.replaceChildren(h('div', { class: 'mini-grid' }, data.map((m, i) => h('div', { class: 't', onclick: () => openViewer(data, i) }, lazyImg(m.thumb_key, { eager: true })))));
  return close;
}
