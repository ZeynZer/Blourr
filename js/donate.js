import { h, icon, toast, errToast, sheet, bytes } from './ui.js';
import { sb, state, STORAGE_LIMIT } from './api.js';

const KEYS = ['donate_paypal', 'donate_iban', 'donate_holder', 'donate_message'];
export async function getDonate() {
  const { data } = await sb.from('app_settings').select('key, value').in('key', KEYS);
  return Object.fromEntries((data || []).map((r) => [r.key, r.value]));
}
// « https://paypal.me/zeyn », « paypal.me/zeyn » ou « zeyn » → nom d'utilisateur
const ppUser = (v) => (v || '').trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?paypal\.me\//i, '').replace(/\/.*$/, '');
const fmtIban = (v) => (v || '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
// coût estimé Cloudflare R2 : 0,015 $/Go/mois au-delà de 10 Go (≈ 0,014 €)
export const monthlyCost = (usedBytes) => Math.max(0, usedBytes / 1024 ** 3 - 10) * 0.014;

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} copié`); }
  catch { toast('Copie impossible : sélectionne le texte', 'err'); }
}

// Carte affichée en haut de l'onglet Famille
export function donateCard() {
  const box = h('div');
  Promise.all([getDonate(), sb.rpc('storage_usage')]).then(([d, { data: u }]) => {
    const pp = ppUser(d.donate_paypal);
    const iban = d.donate_iban;
    if (!pp && !iban) {
      if (state.isAdmin) box.replaceChildren(h('div', { class: 'banner', style: { cursor: 'pointer' }, onclick: () => { location.hash = '#/profil'; } }, icon('heart'), h('div', {}, 'Ajoute ton PayPal ou ton IBAN dans ', h('b', {}, 'Profil → Dons'), ' pour que la famille puisse participer aux frais.')));
      return;
    }
    box.replaceChildren(h('div', { class: 'card donate', style: { marginTop: '4px' } },
      h('h3', {}, icon('heart'), 'Soutenir Blourr'),
      h('p', { class: 'small', style: { margin: '0 0 6px', color: 'var(--text)' } }, d.donate_message || 'Blourr est gratuit pour toute la famille. Si tu veux, tu peux participer aux frais de stockage des photos et des films ❤️'),
      h('div', { style: { height: '8px' } }),
      pp ? h('div', { class: 'row', style: { marginBottom: '10px', flexWrap: 'wrap' } },
        [2, 5, 10].map((n) => h('a', { class: 'btn sm grow', href: `https://paypal.me/${encodeURIComponent(pp)}/${n}EUR`, target: '_blank', rel: 'noopener' }, `${n} €`)),
        h('a', { class: 'btn sm primary grow', href: `https://paypal.me/${encodeURIComponent(pp)}`, target: '_blank', rel: 'noopener' }, 'PayPal')) : null,
      iban ? h('button', { class: 'btn block', onclick: () => sheet(() => [
        h('h2', {}, 'Virement'),
        d.donate_holder ? h('div', { class: 'field' }, h('label', {}, 'Bénéficiaire'), h('div', { class: 'row' }, h('code', { class: 'code grow', style: { fontSize: '15px', padding: '10px' } }, d.donate_holder), h('button', { class: 'icon-btn', onclick: () => copy(d.donate_holder, 'Nom') }, icon('copy')))) : null,
        h('div', { class: 'field' }, h('label', {}, 'IBAN'), h('div', { class: 'row' }, h('code', { class: 'code grow', style: { fontSize: '15px', padding: '10px' } }, fmtIban(iban)), h('button', { class: 'icon-btn', onclick: () => copy(iban.replace(/\s+/g, ''), 'IBAN') }, icon('copy')))),
        h('p', { class: 'small muted' }, 'Astuce : dans ton appli bancaire, un « virement permanent » de 1 € par mois suffit, et c\'est gratuit.'),
      ]) }, icon('copy'), 'Virement (IBAN)') : null));
  }).catch(() => {});
  return box;
}

// Réglages (admin) dans le Profil
export function donateSettingsCard() {
  const pp = h('input', { class: 'input', placeholder: 'paypal.me/tonpseudo ou tonpseudo', autocapitalize: 'off', autocorrect: 'off' });
  const iban = h('input', { class: 'input', placeholder: 'FR76 …', autocapitalize: 'characters', autocorrect: 'off' });
  const holder = h('input', { class: 'input', placeholder: 'Nom du titulaire du compte' });
  const msg = h('textarea', { class: 'textarea', placeholder: 'Message affiché à la famille (facultatif)', maxlength: 300 });
  getDonate().then((d) => { pp.value = d.donate_paypal || ''; iban.value = d.donate_iban ? fmtIban(d.donate_iban) : ''; holder.value = d.donate_holder || ''; msg.value = d.donate_message || ''; });
  const save = h('button', { class: 'btn primary block' }, icon('check'), 'Enregistrer');
  save.onclick = async () => {
    const vals = { donate_paypal: ppUser(pp.value), donate_iban: iban.value.replace(/\s+/g, '').toUpperCase(), donate_holder: holder.value.trim(), donate_message: msg.value.trim() };
    if (vals.donate_iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(vals.donate_iban)) return errToast('IBAN invalide.');
    save.disabled = true;
    try {
      const up = Object.entries(vals).filter(([, v]) => v).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
      const del = Object.entries(vals).filter(([, v]) => !v).map(([k]) => k);
      if (up.length) { const { error } = await sb.from('app_settings').upsert(up); if (error) throw error; }
      if (del.length) await sb.from('app_settings').delete().in('key', del);
      toast('Enregistré — visible dans l\'onglet Famille');
    } catch (e) { errToast(e); } finally { save.disabled = false; }
  };
  return h('div', { class: 'card' },
    h('h3', {}, icon('heart'), 'Dons de la famille'),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Ces infos sont visibles uniquement par les membres connectés, dans l\'onglet Famille. Remplis au moins un des deux.'),
    h('div', { class: 'field' }, h('label', {}, 'PayPal.me'), pp),
    h('div', { class: 'field' }, h('label', {}, 'IBAN'), iban),
    h('div', { class: 'field' }, h('label', {}, 'Titulaire'), holder),
    h('div', { class: 'field' }, h('label', {}, 'Message'), msg),
    save);
}
