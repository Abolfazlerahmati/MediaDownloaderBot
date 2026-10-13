MB.ready(async () => {
  'use strict';
  const { el } = MB;
  const view = document.getElementById('view');
  const THEMES = [
    { id: 'merchant', name: 'Merchant', description: 'Navy navigation, compact cards and a restrained blue accent. Business dashboard style.' },
    { id: 'ios', name: 'iOS-inspired', description: 'Rounded grouped surfaces, pill controls and a system-blue accent.' },
  ];
  const MODES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];

  let me;
  try {
    me = await MB.get('/api/auth/me');
  } catch (error) {
    MB.clear(view).append(MB.banner('bad', 'Could not load your account.', MB.errorText(error)));
    return;
  }
  let current = { ...me.appearance };
  // A default or reset password must be replaced before anything else is available.
  const forced = Boolean(me.must_change_password);

  const themeCards = el('div', { class: 'choice-cards', role: 'group', 'aria-label': 'Design theme' }, THEMES.map((t) => {
    const card = el('button', { class: 'choice-card', type: 'button', 'aria-pressed': current.theme === t.id ? 'true' : 'false', 'data-theme-choice': t.id },
      el('div', { class: 'preview', 'aria-hidden': 'true' }), el('strong', null, t.name), el('span', { class: 'muted' }, t.description));
    card.addEventListener('click', () => choose({ theme: t.id }));
    return card;
  }));

  const modeButtons = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Colour mode' }, MODES.map(([id, label]) => {
    const button = el('button', { type: 'button', 'aria-pressed': current.mode === id ? 'true' : 'false', 'data-mode-choice': id }, label);
    button.addEventListener('click', () => choose({ mode: id }));
    return button;
  }));

  const choose = async (change) => {
    const next = { ...current, ...change };
    try {
      const data = await MB.saveAppearance(next.theme, next.mode);
      current = { ...data.appearance };
      themeCards.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === current.theme)));
      modeButtons.querySelectorAll('[data-mode-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modeChoice === current.mode)));
      MB.toast('Appearance saved for this administrator account.', 'success');
    } catch (error) {
      MB.toast(MB.errorText(error), 'error');
    }
  };

  const passwordForm = el('form', { class: 'form', novalidate: true });
  const currentPw = el('input', { id: 'pw-current', type: 'password', autocomplete: 'current-password', maxlength: 512 });
  const newPw = el('input', { id: 'pw-new', type: 'password', autocomplete: 'new-password', maxlength: 512 });
  const confirmPw = el('input', { id: 'pw-confirm', type: 'password', autocomplete: 'new-password', maxlength: 512 });
  const submit = el('button', { class: 'btn primary', type: 'submit' }, 'Change password');
  passwordForm.append(
    el('div', { class: 'field', 'data-field': 'current_password' }, el('label', { for: 'pw-current' }, 'Current password'), currentPw, el('p', { class: 'field-msg', role: 'alert' })),
    el('div', { class: 'field', 'data-field': 'new_password' }, el('label', { for: 'pw-new' }, 'New password'), newPw,
      el('p', { class: 'help' }, 'At least 12 characters. Other sessions are signed out after the change.'), el('p', { class: 'field-msg', role: 'alert' })),
    el('div', { class: 'field', 'data-field': 'confirm' }, el('label', { for: 'pw-confirm' }, 'Repeat new password'), confirmPw, el('p', { class: 'field-msg', role: 'alert' })),
    el('div', { class: 'row' }, submit));
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    MB.setFieldErrors(passwordForm, {});
    if (newPw.value !== confirmPw.value) {
      MB.setFieldErrors(passwordForm, { confirm: 'The passwords do not match.' });
      return;
    }
    submit.disabled = true;
    try {
      const data = await MB.post('/api/auth/password', { current_password: currentPw.value, new_password: newPw.value });
      passwordForm.reset();
      MB.toast(data.message, 'success');
      if (forced) {
        location.assign('/');
        return;
      }
    } catch (error) {
      MB.setFieldErrors(passwordForm, error.fields || (error.status === 400 ? { current_password: error.message } : { new_password: error.message }));
      MB.toast(MB.errorText(error), 'error');
    } finally {
      submit.disabled = false;
    }
  });

  const signOut = el('button', { class: 'btn danger', type: 'button', 'data-action': 'logout' }, 'Sign out of this browser');

  const passwordCard = el('section', { class: 'card stack' },
    el('div', null, el('h2', null, 'Password'), el('p', { class: 'muted small' }, 'Passwords are hashed with Argon2id.')),
    passwordForm);
  const notice = forced
    ? MB.banner('warn', 'Set a new password to continue.',
      'The default password is still in use. Enter it as the current password, then choose a new one. Other features unlock after the change.')
    : null;

  MB.clear(view).append(
    el('div', { class: 'view-head' }, el('div', null, el('h2', null, 'Account'),
      el('p', null, `Signed in as ${me.username}.`))),
    ...(forced ? [notice, passwordCard] : [el('div', { class: 'grid-2' },
      el('section', { class: 'card stack' },
        el('div', null, el('h2', null, 'Appearance'), el('p', { class: 'muted small' }, 'Applies immediately and is saved to your account.')),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Design theme'), themeCards),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Mode'), modeButtons,
          el('p', { class: 'help' }, 'System follows your operating system’s light or dark setting.'))),
      passwordCard)]),
    el('section', { class: 'card row' },
      el('div', { class: 'spacer' }, el('h2', null, 'Session'), el('p', { class: 'muted small' }, 'Sessions expire after the configured lifetime (SESSION_TTL_HOURS).')),
      signOut));
});
