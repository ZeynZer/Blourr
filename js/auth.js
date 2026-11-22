import { h } from './ui.js';
import { sb, signup } from './api.js';
import { unlockAudio } from './intro.js';

export function authView() {
  let mode = 'login';
  const err = h('div', { class: 'err' });
  const name = h('input', { class: 'input', placeholder: 'Ton prénom', autocomplete: 'given-name' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'adresse@mail.com', autocomplete: 'email', inputmode: 'email', autocapitalize: 'off' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: '6 caractères minimum', autocomplete: 'current-password' });
  const code = h('input', { class: 'input', placeholder: 'Code donné par l\'admin', autocapitalize: 'off', autocomplete: 'off' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Se connecter');

  const nameF = h('div', { class: 'field hidden' }, h('label', {}, 'Prénom'), name);
  const codeF = h('div', { class: 'field hidden' }, h('label', {}, 'Code famille'), code);
  const hint = h('div', { class: 'hint hidden' }, 'Le tout premier compte créé devient administrateur : le code famille que tu tapes devient celui que tu donneras à ta famille.');

  const segL = h('button', { type: 'button', class: 'active', onclick: () => setMode('login') }, 'Connexion');
  const segS = h('button', { type: 'button', onclick: () => setMode('signup') }, 'Créer un compte');

  function setMode(m) {
    mode = m; err.textContent = '';
    segL.classList.toggle('active', m === 'login');
    segS.classList.toggle('active', m === 'signup');
    nameF.classList.toggle('hidden', m === 'login');
    codeF.classList.toggle('hidden', m === 'login');
    hint.classList.toggle('hidden', m === 'login');
    pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    btn.textContent = m === 'login' ? 'Se connecter' : 'Créer mon compte';
  }

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      unlockAudio();
      err.textContent = '';
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = 'Patiente…';
      try {
        if (mode === 'signup') {
          await signup({ email: email.value, password: pass.value, name: name.value, code: code.value });
        }
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim().toLowerCase(), password: pass.value });
        if (error) throw new Error(/invalid/i.test(error.message) ? 'E-mail ou mot de passe incorrect.' : error.message);
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        btn.disabled = false; btn.textContent = old;
      }
    },
  },
  h('div', { class: 'seg' }, segL, segS),
  nameF,
  h('div', { class: 'field' }, h('label', {}, 'E-mail'), email),
  h('div', { class: 'field' }, h('label', {}, 'Mot de passe'), pass),
  codeF, hint, err, btn);

  return h('div', { class: 'auth' },
    h('div', { class: 'auth-card' },
      h('h1', { class: 'auth-logo logo-word' }, 'BLOURR'),
      h('p', { class: 'auth-sub' }, 'Les souvenirs et le ciné de la famille'),
      form));
}
