// Admin panel client. Everything is built with DOM APIs and textContent, so server data is never
// interpreted as HTML. No inline handlers, no eval, no external scripts (see the CSP in src/web/http.ts).
(() => {
  'use strict';

  const page = document.body.dataset.page;
  const app = document.getElementById('app');
  const csrfMeta = document.querySelector('meta[name="csrf"]');
  const csrf = csrfMeta ? csrfMeta.getAttribute('content') || '' : '';

  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (method !== 'GET') opts.headers['x-csrf-token'] = csrf;
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      return { ok: false, status: 0, data: { detail: 'Network error. Try again.' } };
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && page !== 'login') {
      location.href = '/login';
    } else if (res.status === 403 && data.error === 'must_change_password' && page !== 'account') {
      location.href = '/account';
    }
    return { ok: res.ok, status: res.status, data };
  }

  const errorText = (res) => (res.data && (res.data.detail || res.data.error)) || 'The request failed.';
  const notice = (text, kind) => h('div', { class: 'notice ' + (kind || 'info'), role: kind === 'error' ? 'alert' : 'status' }, text);
  const setContent = (...nodes) => app.replaceChildren(...nodes);
  const card = (label, value) =>
    h('div', { class: 'card stat' }, h('div', { class: 'muted', text: label }), h('div', { class: 'stat-value', text: value }));
  const badge = (text, kind) => h('span', { class: 'badge ' + (kind || 'muted'), text });
  const when = (ms) => (ms ? new Date(ms).toLocaleString() : '—');


  // ---------- login ----------
  function renderLogin() {
    const msg = h('p', { class: 'msg', role: 'status' });
    const form = h(
      'form',
      { class: 'card narrow', novalidate: true },
      h('h1', { text: 'Sign in' }),
      h('label', {}, 'Username', h('input', { name: 'username', autocomplete: 'username', required: true, maxlength: 64 })),
      h('label', {}, 'Password', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 })),
      h('button', { type: 'submit', class: 'primary' }, 'Sign in'),
      msg,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      msg.textContent = '';
      const res = await api('POST', '/api/auth/login', {
        username: form.elements.namedItem('username').value,
        password: form.elements.namedItem('password').value,
      });
      if (res.ok) location.href = res.data.must_change_password ? '/account' : '/';
      else msg.textContent = errorText(res);
    });
    setContent(form);
  }

  // ---------- dashboard ----------
  async function renderDashboard() {
    const res = await api('GET', '/api/dashboard');
    if (!res.ok) return setContent(notice(errorText(res), 'error'));
    const d = res.data;
    setContent(
      h('h1', { text: 'Dashboard' }),
      ...d.warnings.map((w) => notice(w, 'warning')),
      h(
        'div',
        { class: 'grid' },
        card('Bot', d.bot_enabled ? 'Enabled' : 'Paused'),
        card('Downloads, last 24h', `${d.downloads_24h.ok} ok · ${d.downloads_24h.failed} failed`),
        card('Webhook', d.webhook_url ? 'Registered' : 'Not registered'),
        card('Pending Telegram updates', d.webhook_pending_updates === null ? '—' : String(d.webhook_pending_updates)),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Platforms' }),
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Platform' }), h('th', { text: 'Status' }))),
          h(
            'tbody',
            {},
            d.platforms.map((p) =>
              h(
                'tr',
                {},
                h('td', { text: p.name }),
                h('td', {}, !p.implemented ? badge('Not implemented in this version', 'warn') : badge(p.enabled ? 'Enabled' : 'Disabled', p.enabled ? 'ok' : 'muted')),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---------- settings ----------
  const SETTING_LABELS = {
    bot_enabled: 'Bot enabled',
    default_language: 'Default language (for new users)',
    group_mode: 'Group behaviour',
    rate_limit_per_minute: 'Downloads per minute per user',
    dedupe_seconds: 'Duplicate-link window (seconds)',
    max_file_mb: 'Maximum file size (MB, up to 50)',
    log_retention_days: 'Log retention (days)',
    maintenance_message: 'Maintenance message (private chats, shown when the bot is off)',
    max_links_per_message: 'Links processed per message (1–5)',
    max_concurrent_jobs: 'Downloads running at once, all chats (1–20)',
    download_timeout_seconds: 'Time limit per link (seconds, 10–300)',
    retry_attempts: 'Attempts for a transient source failure (1–3, 1 = no retry)',
    store_language: 'Store each user\'s language choice (off = temporary, nothing saved)',
    language_retention_days: 'Keep language choices for (days, 1–365)',
  };
  const ENUM_LABELS = {
    en: 'English',
    fa: 'Persian (فارسی)',
    addressed: 'Answer only when addressed',
    off: 'Ignore groups',
  };

  async function renderSettings() {
    const res = await api('GET', '/api/settings');
    if (!res.ok) return setContent(notice(errorText(res), 'error'));
    const values = res.data.values;
    const defs = res.data.defs;
    const msg = h('p', { class: 'msg', role: 'status' });
    const fields = [];
    for (const [key, def] of Object.entries(defs)) {
      let input;
      if (def.type === 'bool') {
        input = h('input', { type: 'checkbox', name: key, checked: values[key] === true });
      } else if (def.type === 'enum') {
        input = h(
          'select',
          { name: key },
          def.values.map((v) => h('option', { value: v, selected: values[key] === v, text: ENUM_LABELS[v] || v })),
        );
      } else if (def.type === 'int') {
        input = h('input', { type: 'number', name: key, min: def.min, max: def.max, step: 1, value: values[key] });
      } else {
        input = h('textarea', { name: key, maxlength: def.maxLength, rows: 3 }, values[key]);
      }
      fields.push(h('label', { class: def.type === 'bool' ? 'check' : '' }, input, ' ', SETTING_LABELS[key] || key));
    }
    const form = h('form', { class: 'card' }, h('h1', { text: 'Settings' }), ...fields, h('button', { type: 'submit', class: 'primary' }, 'Save settings'), msg);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const changes = {};
      for (const [key, def] of Object.entries(defs)) {
        const el = form.elements.namedItem(key);
        if (def.type === 'bool') changes[key] = el.checked;
        else if (def.type === 'int') changes[key] = Number(el.value);
        else changes[key] = el.value;
      }
      showFieldErrors(form, null);
      const put = await api('PUT', '/api/settings', { changes });
      if (put.ok) {
        msg.textContent = 'Saved.';
      } else {
        msg.textContent = errorText(put);
        showFieldErrors(form, put.data.fields);
      }
    });
    setContent(form);
  }

  // ---------- platforms ----------
  async function renderPlatforms() {
    const res = await api('GET', '/api/platforms');
    if (!res.ok) return setContent(notice(errorText(res), 'error'));
    setContent(
      h('h1', { text: 'Platforms' }),
      h('p', { class: 'muted', text: 'Only platforms with an implemented extractor can be enabled. Run a test with a public sample link before you enable a platform.' }),
      ...res.data.platforms.map(platformCard),
    );
  }

  function platformCard(p) {
    const result = h('p', { class: 'msg', role: 'status' }, p.last_test_message ? `${p.last_test_ok ? '✓' : '✗'} ${p.last_test_message}` : 'Not tested yet.');
    const sample = h('input', { type: 'url', value: p.sample_url, placeholder: 'https://…', maxlength: 500, 'aria-label': `${p.name} sample link` });
    const toggle = h('button', { type: 'button', class: 'primary', disabled: !p.implemented }, p.enabled ? 'Disable' : 'Enable');
    const save = h('button', { type: 'button' }, 'Save link');
    const test = h('button', { type: 'button', disabled: !p.implemented }, 'Run extraction test');

    toggle.addEventListener('click', async () => {
      const r = await api('POST', `/api/platforms/${p.key}/enable`, { enabled: !p.enabled });
      if (r.ok) renderPlatforms();
      else result.textContent = errorText(r);
    });
    save.addEventListener('click', async () => {
      const r = await api('PUT', `/api/platforms/${p.key}/sample`, { sample_url: sample.value.trim() });
      result.textContent = r.ok ? 'Link saved.' : errorText(r);
    });
    test.addEventListener('click', async () => {
      result.textContent = 'Testing…';
      const r = await api('POST', `/api/platforms/${p.key}/test`);
      result.textContent = r.ok ? `${r.data.test_ok ? '✓' : '✗'} ${r.data.message}` : errorText(r);
    });

    return h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'row' },
        h('h2', { text: p.name }),
        p.implemented ? badge('Implemented', 'ok') : badge('Not implemented in this version', 'warn'),
        badge(p.enabled ? 'Enabled' : 'Disabled', p.enabled ? 'ok' : 'muted'),
      ),
      h('div', { class: 'row' }, toggle),
      h('label', {}, 'Sample public link (used by the test)', sample),
      h('div', { class: 'row' }, save, test),
      result,
    );
  }

  // ---------- bot and health ----------
  async function renderBot() {
    const [bot, health] = await Promise.all([api('GET', '/api/bot'), api('GET', '/api/health')]);
    if (!bot.ok) return setContent(notice(errorText(bot), 'error'));
    const d = bot.data;
    const msg = h('p', { class: 'msg', role: 'status' });
    const run = (label, method, path) =>
      h('button', {
        type: 'button',
        onclick: async () => {
          msg.textContent = 'Working…';
          const r = await api(method, path);
          msg.textContent = r.ok ? label + ' done.' : errorText(r);
          if (r.ok) renderBot();
        },
      }, label);
    const checks = health.ok
      ? health.data.checks.map((c) =>
          h('li', {}, badge(c.status === 'ok' ? 'OK' : c.status === 'warning' ? 'Warning' : 'Error', c.status === 'ok' ? 'ok' : c.status === 'warning' ? 'warn' : 'err'), ' ', h('strong', { text: c.name }), ' — ', c.message),
        )
      : [h('li', { text: errorText(health) })];

    setContent(
      h('h1', { text: 'Bot and health' }),
      h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Telegram bot' }),
        h('dl', { class: 'kv' },
          h('dt', { text: 'Token (BOT_TOKEN secret)' }), h('dd', {}, d.token_configured ? badge('Set', 'ok') : badge('Missing', 'err')),
          h('dt', { text: 'Bot username' }), h('dd', { text: d.bot_username ? '@' + d.bot_username : '—' }),
          h('dt', { text: 'Bot enabled' }), h('dd', { text: d.bot_enabled ? 'Yes' : 'No (paused in Settings)' }),
          h('dt', { text: 'Expected webhook URL' }), h('dd', { text: d.expected_webhook_url }),
          h('dt', { text: 'Webhook registered' }), h('dd', {}, d.webhook_registered ? badge('Yes', 'ok') : badge('No', 'warn')),
          h('dt', { text: 'Pending updates' }), h('dd', { text: d.webhook ? String(d.webhook.pending_update_count ?? 0) : '—' }),
          h('dt', { text: 'Last Telegram error' }), h('dd', { text: d.webhook && d.webhook.last_error_message ? d.webhook.last_error_message : '—' }),
        ),
        d.error ? notice(d.error, 'error') : null,
        h('p', { class: 'muted' },
          'To set or change the bot token, open Cloudflare → Workers & Pages → mediadownloaderbot → Settings → Variables and secrets, add BOT_TOKEN as a Secret, then reload this page.'),
        h('div', { class: 'row' },
          run('Test connection', 'POST', '/api/bot/test'),
          run('Register webhook', 'POST', '/api/bot/webhook'),
          run('Remove webhook', 'DELETE', '/api/bot/webhook'),
        ),
        msg,
      ),
      h('section', { class: 'card' }, h('h2', { text: 'Health checks' }), h('ul', { class: 'checks' }, checks)),
    );
  }

  // ---------- logs ----------
  let logOffset = 0;
  function renderLogs() {
    const severity = h('select', { name: 'severity' },
      h('option', { value: '', text: 'All severities' }),
      h('option', { value: 'info', text: 'Info' }),
      h('option', { value: 'warning', text: 'Warning' }),
      h('option', { value: 'error', text: 'Error' }),
    );
    const event = h('input', { name: 'event', placeholder: 'Event, for example download_ok', maxlength: 40 });
    const q = h('input', { name: 'q', placeholder: 'Search detail', maxlength: 80 });
    const tbody = h('tbody', {});
    const more = h('button', { type: 'button', hidden: true }, 'Load more');
    const msg = h('p', { class: 'msg', role: 'status' });
    const form = h('form', { class: 'row' }, severity, event, q, h('button', { type: 'submit', class: 'primary' }, 'Apply'));

    async function load(reset) {
      if (reset) {
        logOffset = 0;
        tbody.replaceChildren();
      }
      const params = new URLSearchParams({ limit: '50', offset: String(logOffset) });
      if (severity.value) params.set('severity', severity.value);
      if (event.value.trim()) params.set('event', event.value.trim());
      if (q.value.trim()) params.set('q', q.value.trim());
      const res = await api('GET', `/api/logs?${params.toString()}`);
      if (!res.ok) {
        msg.textContent = errorText(res);
        return;
      }
      for (const row of res.data.items) {
        tbody.append(h('tr', {},
          h('td', { text: when(row.created_at) }),
          h('td', { text: row.severity }),
          h('td', { text: row.event }),
          h('td', { text: row.platform || '—' }),
          h('td', { text: row.detail || '—' }),
        ));
      }
      if (res.data.next_offset !== null) {
        logOffset = res.data.next_offset;
        more.hidden = false;
      } else {
        more.hidden = true;
      }
      msg.textContent = res.data.items.length === 0 && reset ? 'No log entries match.' : '';
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      load(true);
    });
    more.addEventListener('click', () => load(false));
    setContent(
      h('h1', { text: 'Logs' }),
      h('p', { class: 'muted', text: 'Logs never contain tokens, full links, or user identifiers. Retention is set in Settings.' }),
      h('section', { class: 'card' },
        form,
        h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Time' }), h('th', { text: 'Severity' }), h('th', { text: 'Event' }), h('th', { text: 'Platform' }), h('th', { text: 'Detail' }))),
          tbody,
        ),
        more,
        msg,
      ),
    );
    load(true);
  }

  // ---------- diagnostics ----------
  async function renderDiagnostics() {
    const res = await api('GET', '/api/diagnostics');
    if (!res.ok) return setContent(notice(errorText(res), 'error'));
    const { ok, ...rest } = res.data;
    setContent(
      h('h1', { text: 'Diagnostics' }),
      h('p', { class: 'muted', text: 'Redacted: secret values are never shown, only whether they are set.' }),
      h('section', { class: 'card' }, h('pre', { class: 'code', text: JSON.stringify(rest, null, 2) })),
    );
  }

  // ---------- account ----------
  async function renderAccount() {
    const me = await api('GET', '/api/auth/me');
    if (!me.ok) return setContent(notice(errorText(me), 'error'));
    const d = me.data;
    applyAppearance(d.appearance.theme, d.appearance.mode);

    const pwMsg = h('p', { class: 'msg', role: 'status' });
    const pwForm = h('form', { class: 'card' },
      h('h2', { text: d.must_change_password ? 'Choose a new password' : 'Change password' }),
      h('label', {}, 'Current password', h('input', { name: 'current_password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 })),
      h('label', {}, 'New password (at least 12 characters)', h('input', { name: 'new_password', type: 'password', autocomplete: 'new-password', required: true, minlength: 12, maxlength: 200 })),
      h('button', { type: 'submit', class: 'primary' }, 'Update password'),
      pwMsg,
    );
    pwForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      showFieldErrors(pwForm, null);
      const r = await api('POST', '/api/auth/password', {
        current_password: pwForm.elements.namedItem('current_password').value,
        new_password: pwForm.elements.namedItem('new_password').value,
      });
      if (r.ok) {
        location.href = '/';
      } else {
        pwMsg.textContent = errorText(r);
        showFieldErrors(pwForm, r.data.fields);
      }
    });

    const theme = h('select', { name: 'theme' },
      h('option', { value: 'merchant', selected: d.appearance.theme === 'merchant', text: 'Merchant (blue)' }),
      h('option', { value: 'ios', selected: d.appearance.theme === 'ios', text: 'iOS (soft)' }));
    const mode = h('select', { name: 'mode' },
      ['system', 'light', 'dark'].map((m) => h('option', { value: m, selected: d.appearance.mode === m, text: m[0].toUpperCase() + m.slice(1) })));
    const apMsg = h('p', { class: 'msg', role: 'status' });
    const apForm = h('form', { class: 'card' }, h('h2', { text: 'Appearance' }),
      h('label', {}, 'Theme', theme), h('label', {}, 'Mode', mode),
      h('button', { type: 'submit' }, 'Save appearance'), apMsg);
    apForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const r = await api('PUT', '/api/account/appearance', { theme: theme.value, mode: mode.value });
      if (r.ok) {
        applyAppearance(theme.value, mode.value);
        apMsg.textContent = 'Saved.';
      } else {
        apMsg.textContent = errorText(r);
      }
    });

    setContent(
      h('h1', { text: 'Account' }),
      d.must_change_password ? notice('The default password is still in use. Choose a new password before you can use the panel.', 'warning') : null,
      h('p', { class: 'muted', text: `Signed in as ${d.username}` }),
      pwForm,
      d.must_change_password ? null : apForm,
    );
  }

  function applyAppearance(theme, mode) {
    document.documentElement.dataset.theme = theme === 'ios' ? 'ios' : 'merchant';
    document.documentElement.dataset.mode = ['light', 'dark', 'system'].includes(mode) ? mode : 'system';
  }

  function showFieldErrors(form, fields) {
    form.querySelectorAll('.field-error').forEach((n) => n.remove());
    if (!fields) return;
    for (const [name, message] of Object.entries(fields)) {
      const input = form.elements.namedItem(name);
      if (input && input.parentElement) input.parentElement.append(h('span', { class: 'field-error', text: message }));
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="logout"]');
    if (!button) return;
    await api('POST', '/api/auth/logout');
    location.href = '/login';
  });

  const pages = {
    login: renderLogin,
    dashboard: renderDashboard,
    settings: renderSettings,
    platforms: renderPlatforms,
    bot: renderBot,
    logs: renderLogs,
    diagnostics: renderDiagnostics,
    account: renderAccount,
  };
  const render = pages[page];
  if (render) {
    Promise.resolve()
      .then(render)
      .catch((err) => setContent(notice(String((err && err.message) || err), 'error')));
  }
})();
