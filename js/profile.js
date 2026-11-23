import { h, icon, toast, errToast, confirmBox, promptBox, bytes, avatar, sheet } from './ui.js';
import { sb, state, r2, STORAGE_LIMIT, putUrls, putFile, removeKeys, lazyImg, encode } from './api.js';
import { resizeImage } from './media.js';
import { cat, loadCatalog, titleById } from './catalog.js';
import { openDetail } from './cine.js';
import { donateSettingsCard, costLabel } from './donate.js';

const CORS = `[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 86400
  }
]`;

export function profileView() {
  const p = state.profile;
  const root = h('div', { class: 'view' });
  const nameEl = h('div', { class: 'nm' }, p.display_name);
  const bioEl = h('div', { class: 'bio' }, p.bio || '');
  const avBox = h('div', { class: 'avatar-edit', title: 'Changer la photo', onclick: () => changePhoto() });
  const drawAv = () => avBox.replaceChildren(avatar(p, 'xl'), h('div', { class: 'cam' }, icon('images')));
  drawAv();
  async function changePhoto() {
    const choose = (accept) => new Promise((res) => {
      const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
      inp.addEventListener('change', () => { res(inp.files[0]); inp.remove(); });
      document.body.append(inp); inp.click();
    });
    const actions = [];
    sheet((close) => [
      h('h2', {}, 'Photo de profil'),
      h('button', { class: 'list-btn', onclick: async () => { close(); upload(await choose('image/*')); } }, icon('images'), 'Choisir une photo'),
      p.avatar_key ? h('button', { class: 'list-btn danger', onclick: async () => {
        close();
        const old = p.avatar_key;
        const { error } = await sb.from('profiles').update({ avatar_key: null }).eq('id', p.id);
        if (error) return errToast(error);
        p.avatar_key = null; drawAv(); removeKeys([old]).catch(() => {});
      } }, icon('trash'), 'Retirer la photo') : null,
      actions,
    ]);
    async function upload(file) {
      if (!file) return;
      if (state.configured === false) return errToast('Le stockage n\'est pas encore configuré.');
      try {
        toast('Envoi de la photo…');
        const { blob } = await resizeImage(file, { mode: 'cover', w: 480, h: 480, q: 0.86 });
        const key = `g/${p.id}/avatar_${Date.now().toString(36)}.jpg`;
        const urls = await putUrls([key]);
        await putFile(urls[key], blob, 'image/jpeg');
        const old = p.avatar_key;
        const { error } = await sb.from('profiles').update({ avatar_key: key }).eq('id', p.id);
        if (error) throw error;
        p.avatar_key = key; drawAv();
        if (old) removeKeys([old]).catch(() => {});
        toast('Photo mise à jour');
      } catch (e) { errToast(e); }
    }
  }
  const av = { set textContent(v) { drawAv(); } };
  root.append(
    h('div', { class: 'topbar' }, h('h1', {}, 'Profil')),
    h('div', { class: 'me' }, avBox, nameEl, bioEl,
      h('div', { class: 'muted small', style: { margin: '4px 0 8px' } }, state.session?.user?.email || ''),
      state.isAdmin ? h('span', { class: 'role-pill' }, 'Administrateur') : h('span', { class: 'role-pill', style: { background: 'var(--surface3)', color: 'var(--muted)' } }, 'Membre'),
      h('div', { class: 'row', style: { marginTop: '16px' } },
        h('button', { class: 'btn sm', onclick: async () => {
          const n = await promptBox('Ton prénom', { value: p.display_name, ok: 'Enregistrer' });
          if (!n) return;
          const { error } = await sb.from('profiles').update({ display_name: n }).eq('id', p.id);
          if (error) return errToast(error);
          p.display_name = n; nameEl.textContent = n; av.textContent = n.charAt(0).toUpperCase();
        } }, icon('edit'), 'Prénom'),
        h('button', { class: 'btn sm', onclick: async () => {
          const b = await promptBox('Ta petite phrase (150 caractères max)', { value: p.bio || '', placeholder: 'Ex : fan de Marvel et de mangas', ok: 'Enregistrer' });
          if (b === null) return;
          const { error } = await sb.from('profiles').update({ bio: b.slice(0, 150) || null }).eq('id', p.id);
          if (error) return errToast(error);
          p.bio = b.slice(0, 150); bioEl.textContent = p.bio;
        } }, icon('sparkle'), 'Bio'),
        h('button', { class: 'btn sm', onclick: async () => {
          const pw = await promptBox('Nouveau mot de passe', { placeholder: '6 caractères minimum', ok: 'Changer' });
          if (!pw) return;
          const { error } = await sb.auth.updateUser({ password: pw });
          if (error) return errToast(error.message);
          toast('Mot de passe changé');
        } }, icon('lock'), 'Mot de passe'))),
    favsCard(),
    privacyCard(p),
    usageCard(),
    state.isAdmin ? storageCard() : null,
    state.isAdmin ? encoderCard() : null,
    state.isAdmin ? familyCard() : null,
    state.isAdmin ? donateSettingsCard() : null,
    state.isAdmin ? membersCard() : null,
    installCard(),
    h('div', { style: { padding: '0 18px 30px' } },
      h('button', { class: 'btn danger block', onclick: async () => {
        if (!(await confirmBox('Se déconnecter ?', '', 'Déconnexion'))) return;
        await sb.auth.signOut();
      } }, icon('logout'), 'Se déconnecter'),
      h('p', { class: 'muted small', style: { textAlign: 'center', marginTop: '16px' } }, 'Blourr · la plateforme de la famille')));
  return root;
}

function usageCard() {
  const fillG = h('i', { style: { background: 'var(--a1)', display: 'inline-block' } });
  const fillC = h('i', { style: { background: 'var(--cine-red)', display: 'inline-block' } });
  const txt = h('div', { style: { fontWeight: 700, fontSize: '20px' } }, '…');
  const legend = h('div', { class: 'legend' });
  const bar = h('div', { class: 'bar', style: { display: 'flex' } }, fillG, fillC);
  sb.rpc('storage_usage').then(({ data }) => {
    if (!data) return;
    const g = Number(data.gallery), c = Number(data.cine);
    const tot = g + c || 1;
    txt.textContent = costLabel(g + c);
    fillG.style.width = (g / tot * 100) + '%';
    fillC.style.width = (c / tot * 100) + '%';
    legend.replaceChildren(
      h('span', {}, h('i', { style: { background: 'var(--a1)' } }), `Galerie ${bytes(g)}`),
      h('span', {}, h('i', { style: { background: 'var(--cine-red)' } }), `Ciné ${bytes(c)}`),
      h('span', {}, `Total ${bytes(g + c)}`));
  });
  return h('div', { class: 'card usage' }, h('h3', {}, icon('cloud'), 'Coût du stockage'), txt, bar, legend,
    h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, 'Estimation : les 10 premiers Go sont offerts, puis environ 0,014 € par Go et par mois. La facture exacte est dans ton tableau de bord Cloudflare.'));
}

function storageCard() {
  const accountId = h('input', { class: 'input', placeholder: 'ex : 3f2a…', autocapitalize: 'off', autocomplete: 'off' });
  const keyId = h('input', { class: 'input', placeholder: 'Access Key ID', autocapitalize: 'off', autocomplete: 'off' });
  const secret = h('input', { class: 'input', type: 'password', placeholder: 'Secret Access Key', autocomplete: 'new-password' });
  const bucket = h('input', { class: 'input', value: 'blourr', autocapitalize: 'off', autocomplete: 'off' });
  const status = h('div', { class: 'small', style: { marginBottom: '12px' } });
  const setStatus = () => {
    status.replaceChildren(state.configured
      ? h('span', { style: { color: 'var(--ok)', fontWeight: 600 } }, '● Stockage connecté')
      : h('span', { style: { color: '#f59e0b', fontWeight: 600 } }, '● Pas encore connecté'));
  };
  setStatus();
  r2('get-settings').then((s) => {
    accountId.value = s.accountId; keyId.value = s.accessKeyId; bucket.value = s.bucket || 'blourr';
    if (s.hasSecret) secret.placeholder = '•••••••• (enregistré — laisse vide pour garder)';
  }).catch(() => {});

  const save = h('button', { class: 'btn primary block' }, icon('check'), 'Enregistrer et tester');
  save.onclick = async () => {
    save.disabled = true;
    try {
      await r2('set-settings', { accountId: accountId.value.trim(), accessKeyId: keyId.value.trim(), secretAccessKey: secret.value.trim(), bucket: bucket.value.trim() });
      secret.value = '';
      const t = await r2('test');
      if (t.ok) { state.configured = true; toast('Connexion réussie !'); }
      else { state.configured = false; errToast(t.error || 'Le test a échoué : vérifie les informations.'); }
      setStatus();
    } catch (e) { errToast(e); } finally { save.disabled = false; }
  };

  const copyBtn = h('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(CORS); toast('Règle CORS copiée'); } catch { toast('Copie impossible : sélectionne le texte', 'err'); } } }, icon('copy'), 'Copier la règle CORS');

  return h('div', { class: 'card' },
    h('h3', {}, icon('key'), 'Stockage Cloudflare R2'),
    status,
    h('details', { style: { marginBottom: '14px' } },
      h('summary', { style: { cursor: 'pointer', fontWeight: 600, marginBottom: '8px' } }, 'Comment obtenir ces infos ?'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Tableau de bord Cloudflare → ', h('b', {}, 'R2'), ' → active R2 (offre gratuite).'),
        h('li', {}, 'Crée un bucket nommé ', h('code', {}, 'blourr'), '.'),
        h('li', {}, 'Dans le bucket → ', h('b', {}, 'Paramètres'), ' → ', h('b', {}, 'Stratégie CORS'), ' → colle cette règle :'),
        h('pre', { class: 'code' }, CORS), copyBtn,
        h('li', { style: { marginTop: '10px' } }, 'R2 → ', h('b', {}, 'Gérer les jetons d\'API'), ' → Créer un jeton : permission « Lecture et écriture d\'objets », limité au bucket blourr.'),
        h('li', {}, 'Copie ici l\'Account ID, l\'Access Key ID et le Secret Access Key.'))),
    h('div', { class: 'field' }, h('label', {}, 'Account ID'), accountId),
    h('div', { class: 'field' }, h('label', {}, 'Access Key ID'), keyId),
    h('div', { class: 'field' }, h('label', {}, 'Secret Access Key'), secret),
    h('div', { class: 'field' }, h('label', {}, 'Nom du bucket'), bucket),
    h('p', { class: 'small muted', style: { margin: '-4px 0 14px' } }, 'Ces clés restent sur le serveur : personne d\'autre ne peut les voir.'),
    save);
}

function familyCard() {
  const codeEl = h('code', { style: { fontSize: '18px', padding: '6px 12px' } }, '…');
  r2('get-settings').then((s) => { codeEl.textContent = s.familyCode || '—'; }).catch(() => {});
  return h('div', { class: 'card' },
    h('h3', {}, icon('shield'), 'Code famille'),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Donne ce code à ta famille : il est demandé pour créer un compte.'),
    h('div', { class: 'row' }, codeEl, h('div', { class: 'grow' }),
      h('button', { class: 'btn sm', onclick: async () => {
        const c = await promptBox('Nouveau code famille', { value: codeEl.textContent, ok: 'Changer' });
        if (!c || c.length < 4) return c && errToast('4 caractères minimum.');
        try { await r2('set-settings', { familyCode: c }); codeEl.textContent = c; toast('Code changé'); } catch (e) { errToast(e); }
      } }, icon('edit'), 'Changer'),
      navigator.share ? h('button', { class: 'btn sm', onclick: () => navigator.share({ title: 'Blourr', text: `Rejoins Blourr ! Crée ton compte avec le code famille : ${codeEl.textContent}`, url: location.origin + location.pathname }).catch(() => {}) }, icon('share')) : null));
}

function membersCard() {
  const list = h('div', {}, h('div', { class: 'spinner', style: { margin: '10px auto' } }));
  async function load() {
    try {
      const { members } = await r2('members');
      list.replaceChildren(...members.map((m) => h('div', { class: 'member' }, avatar(m),
        h('div', { class: 'meta' }, h('div', { style: { fontWeight: 600 } }, m.display_name, m.role === 'admin' ? h('span', { class: 'role-pill', style: { marginLeft: '8px' } }, 'Admin') : null),
          h('div', { class: 'small muted' }, m.email)),
        m.id === state.profile.id ? null : h('button', { class: 'icon-btn', onclick: () => memberMenu(m) }, icon('settings')))));
    } catch (e) { list.replaceChildren(h('p', { class: 'muted small' }, e.message)); }
  }
  async function memberMenu(m) {
    const { sheet } = await import('./ui.js');
    sheet((close) => [
      h('h2', {}, m.display_name),
      h('button', { class: 'list-btn', onclick: async () => {
        close();
        try { await r2('set-role', { userId: m.id, role: m.role === 'admin' ? 'member' : 'admin' }); toast('Rôle modifié'); load(); } catch (e) { errToast(e); }
      } }, icon('shield'), m.role === 'admin' ? 'Retirer les droits admin' : 'Rendre administrateur'),
      h('button', { class: 'list-btn danger', onclick: async () => {
        close();
        if (!(await confirmBox(`Retirer ${m.display_name} ?`, 'Son compte sera supprimé. Ses photos restent dans la galerie.', 'Retirer'))) return;
        try { await r2('remove-member', { userId: m.id }); toast('Membre retiré'); load(); } catch (e) { errToast(e); }
      } }, icon('trash'), 'Retirer de la famille'),
    ]);
  }
  load();
  return h('div', { class: 'card' }, h('h3', {}, icon('users'), 'Membres de la famille'), list);
}

function installCard() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return null;
  return h('div', { class: 'card' },
    h('h3', {}, icon('sparkle'), 'Installer l\'appli'),
    h('p', { class: 'small muted', style: { margin: 0 } }, 'Sur iPhone : ouvre Blourr dans Safari, touche ', h('b', {}, 'Partager'), ' puis ', h('b', {}, 'Sur l\'écran d\'accueil'), '. Sur Android : menu ⋮ → ', h('b', {}, 'Installer l\'application'), '.'));
}

function favsCard() {
  const grid = h('div', { class: 'fav-grid' }, h('div', { class: 'spinner', style: { margin: '10px auto', gridColumn: '1/-1' } }));
  loadCatalog().then(() => {
    const favs = [...cat.favs].map(titleById).filter(Boolean);
    if (!favs.length) { grid.replaceChildren(h('p', { class: 'muted small', style: { gridColumn: '1/-1', margin: 0 } }, 'Touche « J\'adore » sur la fiche d\'un film ou d\'une série : ils s\'afficheront ici et sur ta carte dans l\'onglet Famille.')); return; }
    grid.replaceChildren(...favs.map((t) => {
      const c = h('div', { class: 'c-card poster', onclick: () => { location.hash = '#/cine'; setTimeout(() => openDetail(t.id), 300); } });
      if (t.poster_key || t.backdrop_key) c.append(lazyImg(t.poster_key || t.backdrop_key));
      else c.append(h('div', { class: 'fallback' }, t.name));
      return c;
    }));
  }).catch(() => {});
  return h('div', { class: 'card' }, h('h3', {}, icon('heart'), 'Mes préférés'), grid);
}

function privacyCard(p) {
  const sw = h('input', { type: 'checkbox', checked: p.share_activity !== false });
  sw.addEventListener('change', async () => {
    const { error } = await sb.from('profiles').update({ share_activity: sw.checked }).eq('id', p.id);
    if (error) { sw.checked = !sw.checked; return errToast(error); }
    p.share_activity = sw.checked;
    toast(sw.checked ? 'La famille voit quand tu es en ligne' : 'Ton activité est masquée');
  });
  return h('div', { class: 'card' },
    h('h3', {}, icon('eye'), 'Confidentialité'),
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, 'Montrer mon activité'),
        h('div', { class: 'small muted' }, 'La famille voit quand tu es en ligne et ce que tu regardes.')),
      h('label', { class: 'switch' }, sw, h('span'))),
    h('p', { class: 'small muted', style: { margin: '12px 0 0' } }, 'L\'administrateur peut toujours voir l\'activité de chacun.'));
}

function encoderCard() {
  const tok = h('input', { class: 'input', type: 'password', placeholder: 'github_pat_…', autocomplete: 'new-password', autocapitalize: 'off' });
  const repo = h('input', { class: 'input', value: 'ZeynZer/blourr-encoder', autocapitalize: 'off', autocorrect: 'off' });
  const status = h('div', { class: 'small', style: { marginBottom: '12px' } });
  const setStatus = (ok) => status.replaceChildren(ok ? h('span', { style: { color: 'var(--ok)', fontWeight: 600 } }, '● Conversion prête') : h('span', { style: { color: '#f59e0b', fontWeight: 600 } }, '● Pas encore configurée'));
  r2('get-settings').then((s) => { repo.value = s.ghRepo || repo.value; if (s.hasGh) tok.placeholder = '•••••••• (enregistré — laisse vide pour garder)'; setStatus(s.hasGh); }).catch(() => {});
  const save = h('button', { class: 'btn primary block' }, icon('check'), 'Enregistrer et tester');
  save.onclick = async () => {
    save.disabled = true;
    try {
      await r2('set-settings', { ghToken: tok.value.trim(), ghRepo: repo.value.trim() });
      tok.value = '';
      const t = await encode('test');
      setStatus(t.ok);
      if (t.ok) toast('GitHub répond : la conversion est prête'); else errToast(t.error || 'Le test a échoué.');
    } catch (e) { errToast(e); } finally { save.disabled = false; }
  };
  return h('div', { class: 'card' },
    h('h3', {}, icon('cloud'), 'Conversion dans le cloud'),
    status,
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Permet d\'envoyer des .mkv depuis le Studio : ils sont convertis en MP4 par GitHub, puis supprimés.'),
    h('div', { class: 'field' }, h('label', {}, 'Jeton GitHub (fine-grained)'), tok),
    h('div', { class: 'field' }, h('label', {}, 'Dépôt de conversion'), repo),
    h('p', { class: 'small muted', style: { margin: '-4px 0 14px' } }, 'Le jeton reste sur le serveur : personne d\'autre ne peut le voir.'),
    save);
}
