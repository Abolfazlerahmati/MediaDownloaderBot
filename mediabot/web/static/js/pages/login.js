MB.ready(() => {
  'use strict';
  const form = document.getElementById('login-form');
  const formError = form.querySelector('.form-error');
  const submit = form.querySelector('button[type="submit"]');

  const safeNext = (value) => (value && /^\/[A-Za-z0-9/_-]{0,80}$/.test(value) && !value.startsWith('//') ? value : '/');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    MB.setFieldErrors(form, {});
    formError.hidden = true;
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      MB.setFieldErrors(form, { username: username ? '' : 'Enter your username.', password: password ? '' : 'Enter your password.' });
      return;
    }
    submit.disabled = true;
    try {
      await MB.post('/api/auth/login', { username, password });
      const next = new URLSearchParams(location.search).get('next');
      location.assign(safeNext(next));
    } catch (error) {
      formError.textContent = MB.errorText(error);
      formError.hidden = false;
      form.password.value = '';
      form.password.focus();
    } finally {
      submit.disabled = false;
    }
  });
});
