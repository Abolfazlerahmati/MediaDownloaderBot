// Admin panel client. Everything is built with DOM APIs and textContent, so server data is never
// interpreted as HTML. No inline handlers, no eval, no external scripts (see the CSP in src/web/http.ts).
(() => {
  'use strict';

  const page = document.body.dataset.page;
  const app = document.getElementById('app');
  const toastRoot = document.getElementById('toasts');
  const csrfMeta = document.querySelector('meta[name="csrf"]');
  const csrf = csrfMeta ? csrfMeta.getAttribute('content') || '' : '';
  const topbarStatus = document.getElementById('topbar-status');

  // Translations live in /static/i18n.js. The language is per admin account (set by the server in <html lang>).
  const tr = (text) => (window.MBI18N ? window.MBI18N.tr(text) : text);
  if (window.MBI18N) {
    window.MBI18N.setLang(document.documentElement.dataset.lang || 'en');
    // The login page has no account yet, so it follows the browser language when that is Persian.
    if (page === 'login' && /^fa\b/i.test(navigator.language || '')) window.MBI18N.setLang('fa');
    window.MBI18N.translateTree(document.body);
  }
  const activeLocale = () => (window.MBI18N && window.MBI18N.getLang() === 'fa' ? 'fa-u-nu-latn' : undefined);

  // ---------- DOM helpers ----------
  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = tr(String(value));
      else if (key === 'placeholder' || key === 'title' || key === 'aria-label') node.setAttribute(key, tr(String(value)));
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid instanceof Node ? kid : document.createTextNode(tr(String(kid))));
    }
    return node;
  }

  const $ = (selector, root = document) => root.querySelector(selector);

  // ---------- API ----------
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
      return { ok: false, status: 0, data: { detail: 'Network error. Check your connection and try again.' } };
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

  // ---------- feedback ----------
  function toast(message, kind = 'ok') {
    const node = h('div', { class: 'toast toast-' + (kind === 'err' ? 'err' : 'ok'), text: message });
    toastRoot.append(node);
    setTimeout(() => node.remove(), kind === 'err' ? 7000 : 4000);
  }

  function confirmDialog(title, text, okLabel) {
    const dialog = document.getElementById('confirm');
    $('#confirm-title').textContent = tr(title);
    $('#confirm-text').textContent = tr(text);
    $('#confirm-ok').textContent = tr(okLabel);
    return new Promise((resolve) => {
      const onClose = () => {
        dialog.removeEventListener('close', onClose);
        resolve(dialog.returnValue === 'ok');
      };
      dialog.addEventListener('close', onClose);
      dialog.showModal();
    });
  }

  // ---------- formatting ----------
  const fmtDate = (ms) =>
    ms ? new Date(ms).toLocaleString(activeLocale(), { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  function fmtRel(ms) {
    if (!ms) return '—';
    if (typeof Intl === 'undefined' || !Intl.RelativeTimeFormat) return fmtDate(ms);
    const rtf = new Intl.RelativeTimeFormat(activeLocale() || 'en', { numeric: 'auto' });
    const diff = (ms - Date.now()) / 1000;
    const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, secs] of units) {
      if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
    }
    return rtf.format(Math.round(diff), 'second');
  }

  const REASONS = {
    upstream_error: 'The source site failed or changed',
    not_found: 'The post or video was not found',
    blocked: 'The source site blocked the request',
    no_media: 'No downloadable video was found',
    file_too_large: 'The file is larger than the limit',
    timeout: 'The time limit was reached',
    telegram_error: 'Telegram rejected the upload',
    internal: 'Internal error',
  };
  const reasonText = (code) => REASONS[code] || code || '—';

  // ---------- building blocks ----------
  const badge = (label, kind = 'muted') => h('span', { class: 'badge badge-' + kind, text: label });

  function notice(kind, title, body, action) {
    return h(
      'div',
      { class: 'notice notice-' + kind, role: kind === 'err' ? 'alert' : 'status' },
      h('div', { class: 'notice-body' }, title ? h('p', { class: 'notice-title', text: title }) : null, body ? h('p', { text: body }) : null),
      action || null,
    );
  }

  function pageHead(title, desc, actions) {
    return h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', { text: title }), desc ? h('p', { class: 'page-desc', text: desc }) : null),
      actions && actions.length ? h('div', { class: 'page-actions' }, ...actions) : null,
    );
  }

  function kvList(rows) {
    return h('dl', { class: 'kv' }, rows.flatMap(([label, value]) => [h('dt', { text: label }), h('dd', {}, value)]));
  }

  function loading() {
    app.setAttribute('aria-busy', 'true');
    app.replaceChildren(
      h('div', { class: 'skeleton', 'aria-hidden': 'true' },
        h('div', { class: 'skeleton-bar skeleton-w1' }),
        h('div', { class: 'skeleton-bar skeleton-w2' }),
        h('div', { class: 'skeleton-bar skeleton-w3' }),
      ),
    );
  }

  // replaceChildren() would print null/false as text, so optional nodes are dropped here.
  function setView(...nodes) {
    app.setAttribute('aria-busy', 'false');
    app.replaceChildren(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
  }

  function failed(res, retry) {
    setView(
      pageHead(document.getElementById('crumb').textContent, null),
      notice('err', 'This page could not be loaded.', errorText(res), h('button', { type: 'button', class: 'btn btn-sm', onclick: retry }, 'Try again')),
    );
  }

  function section(title, desc, ...body) {
    const id = 's-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return h(
      'section',
      { class: 'card', 'aria-labelledby': id },
      h('div', { class: 'card-head' }, h('h2', { id, text: title }), desc ? h('p', { class: 'card-desc', text: desc }) : null),
      ...body,
    );
  }

  function emptyState(title, body) {
    return h('div', { class: 'empty' }, icon('i-inbox'), h('strong', { text: title }), body ? h('span', { text: body }) : null);
  }

  // ---------- login ----------
  function renderLogin() {
    const err = h('div', { class: 'notice notice-err', role: 'alert', hidden: true });
    const user = h('input', { id: 'li-user', name: 'username', autocomplete: 'username', required: true, maxlength: 64, autofocus: true });
    const pass = h('input', { id: 'li-pass', name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Sign in');
    const form = h(
      'form',
      { novalidate: true },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true', text: 'MD' }), h('span', { text: 'MediaDownloaderBot' })),
      h('h1', { text: 'Sign in' }),
      h('p', { class: 'muted', text: 'Panel accounts only. Telegram users never sign in here.' }),
      err,
      h('div', { class: 'field' }, h('label', { for: 'li-user', class: 'field-label', text: 'Username' }), user),
      h('div', { class: 'field' }, h('label', { for: 'li-pass', class: 'field-label', text: 'Password' }), pass),
      submit,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      err.hidden = true;
      if (!user.value.trim() || !pass.value) {
        err.textContent = 'Enter your username and password.';
        err.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      const res = await api('POST', '/api/auth/login', { username: user.value, password: pass.value });
      if (res.ok) {
        location.href = res.data.must_change_password ? '/account' : '/';
        return;
      }
      err.textContent = errorText(res);
      err.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Sign in';
      pass.value = '';
      pass.focus();
    });
    setView(form);
  }

  // ---------- dashboard ----------
  async function renderDashboard() {
    loading();
    const res = await api('GET', '/api/dashboard');
    if (!res.ok) return failed(res, renderDashboard);
    const d = res.data;
    const total = d.downloads_24h.ok + d.downloads_24h.failed;
    const rate = total ? `${Math.round((100 * d.downloads_24h.ok) / total)}% success` : 'No downloads yet';

    const warnings = d.warnings.map((text) => {
      let action = null;
      if (/password/i.test(text)) action = h('a', { class: 'btn btn-sm notice-action', href: '/account', text: 'Change password' });
      else if (/BOT_TOKEN/.test(text)) action = h('a', { class: 'btn btn-sm notice-action', href: '/bot', text: 'Open Bot and health' });
      else if (/webhook/i.test(text)) action = h('a', { class: 'btn btn-sm notice-action', href: '/bot', text: 'Open Bot and health' });
      return notice('warn', null, text, action);
    });

    const platformRows = d.platforms.map((p) =>
      h(
        'tr',
        {},
        h('td', { text: p.name }),
        h('td', {}, !p.implemented ? badge('No extractor', 'warn') : p.enabled ? badge('On', 'ok') : badge('Off', 'muted')),
        h('td', { class: 'wrap' }, p.last_test_at ? h('span', {}, p.last_test_ok ? badge('Passed', 'ok') : badge('Failed', 'err'), ' ', h('span', { class: 'muted', text: fmtRel(p.last_test_at) })) : h('span', { class: 'muted', text: 'Not tested' })),
      ),
    );

    const errorRows = (d.recent_errors || []).map((r) =>
      h(
        'tr',
        {},
        h('td', { class: 'num' }, h('time', { datetime: new Date(r.created_at).toISOString(), title: fmtDate(r.created_at), text: fmtRel(r.created_at) })),
        h('td', { text: r.platform || '—' }),
        h('td', { class: 'wrap', text: reasonText(r.detail) }),
      ),
    );

    setView(
      pageHead('Dashboard', 'Bot status, the last 24 hours of downloads, and anything that needs attention.', [
        h('button', { type: 'button', class: 'btn', onclick: renderDashboard }, 'Refresh'),
      ]),
      ...warnings,
      h(
        'div',
        { class: 'grid-kpi' },
        kpi('Bot', d.bot_enabled ? badge('Enabled', 'ok') : badge('Paused', 'warn'), d.bot_enabled ? 'Answering messages' : 'Turn on in Settings',
          { icon: 'i-bot', tone: d.bot_enabled ? 'ok' : 'warn' }),
        kpi('Downloads, last 24 hours', String(d.downloads_24h.ok), `${d.downloads_24h.failed} failed · ${rate}`,
          { icon: 'i-download', tone: total && d.downloads_24h.failed ? 'warn' : 'ok', ring: ringNode(d.downloads_24h.ok, total) }),
        kpi('Telegram webhook', d.webhook_url ? badge('Registered', 'ok') : badge('Not registered', 'warn'), d.webhook_url ? 'Telegram sends updates here' : 'Register it in Bot and health',
          { icon: 'i-link', tone: d.webhook_url ? 'ok' : 'warn' }),
        kpi('Pending updates', d.webhook_pending_updates === null ? '—' : String(d.webhook_pending_updates), 'Updates Telegram has not delivered yet',
          { icon: 'i-refresh' }),
      ),
      h(
        'div',
        { class: 'two-col' },
        section('Platforms', 'Enable platforms in the Platforms page.', h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Platform' }), h('th', { text: 'Status' }), h('th', { text: 'Last test' }))),
          h('tbody', {}, platformRows),
        ))),
        section('Recent failures', 'Only error codes are shown. No links or user IDs.', d.recent_errors && d.recent_errors.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
              h('thead', {}, h('tr', {}, h('th', { text: 'When' }), h('th', { text: 'Platform' }), h('th', { text: 'Reason' }))),
              h('tbody', {}, errorRows),
            ))
          : emptyState('No failed downloads', 'Nothing failed in the log retention window.')),
      ),
    );
  }

  // Icons come from /static/icons.svg (shared with the server-rendered navigation).
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(id, cls = 'icon') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '/static/icons.svg#' + id);
    svg.append(use);
    return svg;
  }

  // Success ring: share of successful downloads. Drawn with SVG attributes (no inline styles).
  function ringNode(ok, total) {
    const r = 26;
    const circumference = 2 * Math.PI * r;
    const share = total ? ok / total : 0;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ring');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('aria-hidden', 'true');
    const make = (name, attrs) => {
      const el = document.createElementNS(SVG_NS, name);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      return el;
    };
    svg.append(make('circle', { class: 'ring-track', cx: 32, cy: 32, r }));
    if (total) {
      svg.append(make('circle', {
        class: 'ring-ok', cx: 32, cy: 32, r,
        'stroke-dasharray': `${(share * circumference).toFixed(2)} ${circumference.toFixed(2)}`,
        transform: 'rotate(-90 32 32)',
      }));
    }
    const label = make('text', { x: 32, y: 37, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: 'currentColor' });
    label.textContent = total ? `${Math.round(share * 100)}%` : '—';
    svg.append(label);
    return svg;
  }

  function kpi(label, value, foot, opts = {}) {
    const chip = h('span', { class: 'kpi-chip' + (opts.tone ? ' is-' + opts.tone : '') }, icon(opts.icon || 'i-dashboard'));
    return h(
      'section',
      { class: 'card kpi' },
      h('div', { class: 'kpi-top' }, h('p', { class: 'kpi-label', text: label }), chip),
      h('div', { class: 'kpi-row' },
        h('p', { class: 'kpi-value' }, value instanceof Node ? value : document.createTextNode(String(value))),
        opts.ring || null),
      h('p', { class: 'kpi-foot', text: foot }),
    );
  }

  // ---------- settings ----------
  const SETTINGS_SECTIONS = [
    {
      id: 'bot', title: 'Bot behaviour', desc: 'How the bot answers in private chats and groups.',
      keys: ['bot_enabled', 'default_language', 'group_mode', 'maintenance_message'],
    },
    {
      id: 'limits', title: 'Limits', desc: 'Limits protect the chat and the Worker from overload. They are checked on save.',
      keys: ['rate_limit_per_minute', 'dedupe_seconds', 'max_file_mb', 'max_links_per_message', 'max_concurrent_jobs', 'download_timeout_seconds', 'retry_attempts'],
    },
    {
      id: 'privacy', title: 'Privacy and logs', desc: 'What is kept, and for how long. See docs/privacy.md for the full list.',
      keys: ['store_language', 'language_retention_days', 'log_retention_days'],
    },
  ];

  const SETTING_META = {
    bot_enabled: { label: 'Bot is on', hint: 'When off, the bot does not answer. Private chats get the maintenance message below.' },
    default_language: { label: 'Default language', hint: 'Used for people who have not picked a language with /language.' },
    group_mode: { label: 'Replies in groups', hint: '"Only when addressed" answers when someone mentions the bot or replies to it. "Ignore groups" never answers in groups.' },
    maintenance_message: { label: 'Maintenance message', hint: 'Shown to private chats while the bot is off. Leave empty for the default text.' },
    rate_limit_per_minute: { label: 'Downloads per user per minute', hint: 'Links beyond this limit get a rate-limit reply.' },
    dedupe_seconds: { label: 'Duplicate-link window (seconds)', hint: 'The same link in the same chat is ignored for this long. 0 turns the check off.' },
    max_file_mb: { label: 'Largest file to send (MB)', hint: 'Telegram accepts at most 50 MB from a bot. Larger files get an error message instead.' },
    max_links_per_message: { label: 'Links handled per message', hint: 'Extra links in one message are skipped, with one notice.' },
    max_concurrent_jobs: { label: 'Downloads at the same time', hint: 'Counted across all chats. When the limit is reached, new links get a busy reply.' },
    download_timeout_seconds: { label: 'Time limit per link (seconds)', hint: 'Covers the lookup, the download, and the upload. Longer jobs are stopped with a timeout message.' },
    retry_attempts: { label: 'Attempts for source-site errors', hint: '1 means no retry. Only temporary source errors are retried, never blocked or missing media.' },
    store_language: { label: 'Remember each user\u2019s language', hint: 'Off means no language choice is saved. Everyone gets the default language, and existing choices are deleted.' },
    language_retention_days: { label: 'Keep language choices for (days)', hint: 'Older choices are deleted by the hourly cleanup.' },
    log_retention_days: { label: 'Keep logs for (days)', hint: 'Older log entries are deleted by the hourly cleanup.' },
  };

  const ENUM_LABELS = { en: 'English', fa: 'Persian (فارسی)', addressed: 'Only when addressed', off: 'Ignore groups' };

  function buildField(key, def, value, controls) {
    const meta = SETTING_META[key] || { label: key, hint: '' };
    const id = 'f-' + key;
    const hintId = id + '-hint';
    const errId = id + '-err';
    const err = h('p', { class: 'field-error', id: errId, hidden: true });
    let input;
    let read;
    let write;
    let hint = meta.hint;

    if (def.type === 'bool') {
      input = h('input', { type: 'checkbox', id, 'aria-describedby': hintId + ' ' + errId });
      read = () => input.checked;
      write = (v) => {
        input.checked = v === true;
      };
      write(value);
      const field = h('div', { class: 'field check-row' }, input,
        h('div', {}, h('label', { for: id, class: 'field-label', text: meta.label }), h('p', { class: 'field-hint', id: hintId, text: hint }), err));
      controls[key] = { field, input, read, write, err };
      return field;
    }

    if (def.type === 'enum') {
      input = h('select', { id, name: key, 'aria-describedby': hintId + ' ' + errId },
        def.values.map((v) => h('option', { value: v, text: ENUM_LABELS[v] || v })));
      read = () => input.value;
      write = (v) => {
        input.value = v;
      };
    } else if (def.type === 'int') {
      hint = `${hint} Range: ${def.min}–${def.max}.`;
      input = h('input', { type: 'number', id, name: key, min: def.min, max: def.max, step: 1, inputmode: 'numeric', 'aria-describedby': hintId + ' ' + errId });
      read = () => (input.value.trim() === '' ? NaN : Number(input.value));
      write = (v) => {
        input.value = String(v);
      };
    } else {
      input = h('textarea', { id, name: key, maxlength: def.maxLength, rows: 3, 'aria-describedby': hintId + ' ' + errId });
      read = () => input.value;
      write = (v) => {
        input.value = v ?? '';
      };
    }
    write(value);
    const field = h('div', { class: 'field' },
      h('label', { for: id, class: 'field-label', text: meta.label }),
      input,
      h('p', { class: 'field-hint', id: hintId, text: hint }),
      err,
    );
    controls[key] = { field, input, read, write, err };
    return field;
  }

  function clientCheck(def, value) {
    if (def.type === 'int') {
      if (!Number.isInteger(value)) return 'Enter a whole number.';
      if (value < def.min || value > def.max) return `Enter a number from ${def.min} to ${def.max}.`;
    }
    if (def.type === 'text' && value.length > def.maxLength) return `Use at most ${def.maxLength} characters.`;
    if (def.type === 'enum' && !def.values.includes(value)) return 'Choose one of the listed values.';
    return null;
  }

  async function renderSettings() {
    loading();
    const res = await api('GET', '/api/settings');
    if (!res.ok) return failed(res, renderSettings);
    const values = res.data.values;
    const defs = res.data.defs;
    // Text fields may come back as null; treat that as an empty string so an untouched form is not "dirty".
    const initial = { ...values };
    for (const [k, def] of Object.entries(defs)) if (def.type === 'text') initial[k] = values[k] ?? '';
    const controls = {};

    const sections = SETTINGS_SECTIONS.map((sec) =>
      section(sec.title, sec.desc, h('div', { class: 'form-grid' }, sec.keys.map((k) => buildField(k, defs[k], values[k], controls)))),
    );

    const status = h('span', { class: 'status-text', role: 'status', text: 'No unsaved changes' });
    const discard = h('button', { type: 'button', class: 'btn', disabled: true }, 'Discard changes');
    const save = h('button', { type: 'submit', class: 'btn btn-primary', disabled: true }, 'Save changes');
    const form = h('form', { novalidate: true, class: 'stack' }, ...sections, h('div', { class: 'savebar' }, status, discard, save));

    const current = () => Object.fromEntries(Object.entries(controls).map(([k, c]) => [k, c.read()]));
    const changedKeys = () => {
      const cur = current();
      return Object.keys(cur).filter((k) => cur[k] !== initial[k]);
    };
    const clearErrors = () => {
      for (const c of Object.values(controls)) {
        c.err.hidden = true;
        c.err.textContent = '';
        c.field.classList.remove('is-invalid');
        c.input.removeAttribute('aria-invalid');
      }
    };
    const showError = (key, message) => {
      const c = controls[key];
      if (!c) return;
      c.err.textContent = message;
      c.err.hidden = false;
      c.field.classList.add('is-invalid');
      c.input.setAttribute('aria-invalid', 'true');
    };
    const refresh = () => {
      const n = changedKeys().length;
      status.textContent = tr(n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'No unsaved changes');
      status.classList.toggle('is-dirty', n > 0);
      save.disabled = n === 0;
      discard.disabled = n === 0;
    };

    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    discard.addEventListener('click', () => {
      for (const [k, c] of Object.entries(controls)) c.write(initial[k]);
      clearErrors();
      refresh();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors();
      const cur = current();
      let firstBad = null;
      for (const k of Object.keys(cur)) {
        const problem = defs[k] ? clientCheck(defs[k], cur[k]) : null;
        if (problem) {
          showError(k, problem);
          firstBad = firstBad || k;
        }
      }
      if (firstBad) {
        controls[firstBad].input.focus();
        toast('Fix the highlighted fields first.', 'err');
        return;
      }
      const changes = {};
      for (const k of changedKeys()) changes[k] = cur[k];
      save.disabled = true;
      save.textContent = 'Saving…';
      const r = await api('PUT', '/api/settings', { changes });
      save.textContent = 'Save changes';
      if (r.ok) {
        Object.assign(initial, r.data.values);
        toast('Settings saved.');
      } else {
        for (const [k, msg] of Object.entries(r.data.fields || {})) showError(k, msg);
        toast(errorText(r), 'err');
      }
      refresh();
    });

    setView(pageHead('Settings', 'Changes apply to the next message the bot receives. Nothing is saved until you press Save.'), form);
    refresh();
  }

  // ---------- platforms ----------
  async function renderPlatforms() {
    loading();
    const res = await api('GET', '/api/platforms');
    if (!res.ok) return failed(res, renderPlatforms);
    setView(
      pageHead('Platforms', 'Turn platforms on or off, save a sample link, and run an extraction test. A test only looks up the link. It never downloads or sends a file.'),
      h('div', { class: 'platform-grid' }, res.data.platforms.map(platformCard)),
    );
  }

  function platformCard(p) {
    const result = h('div', { class: 'test-result', role: 'status', hidden: !p.last_test_message });
    if (p.last_test_message) {
      result.textContent = `${p.last_test_ok ? 'Passed' : 'Failed'} · ${p.last_test_message} · ${fmtRel(p.last_test_at)}`;
      result.classList.add(p.last_test_ok ? 'ok' : 'bad');
    }
    const sampleId = 's-link-' + p.key;
    const sample = h('input', { type: 'url', id: sampleId, value: p.sample_url || '', placeholder: 'https://…', maxlength: 500, inputmode: 'url', autocomplete: 'off', 'aria-describedby': sampleId + '-hint ' + sampleId + '-err' });
    const sampleErr = h('p', { class: 'field-error', id: sampleId + '-err', hidden: true });
    const toggle = h('button', { type: 'button', class: p.enabled ? 'btn' : 'btn btn-primary', disabled: !p.implemented }, p.enabled ? 'Turn off' : 'Turn on');
    const saveLink = h('button', { type: 'button', class: 'btn' }, 'Save link');
    const runTest = h('button', { type: 'button', class: 'btn', disabled: !p.implemented || !p.sample_url }, 'Run test');

    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      const r = await api('POST', `/api/platforms/${p.key}/enable`, { enabled: !p.enabled });
      if (r.ok) {
        toast(`${p.name} is ${r.data.platform.enabled ? 'on' : 'off'}.`);
        renderPlatforms();
      } else {
        toast(errorText(r), 'err');
        toggle.disabled = false;
      }
    });
    saveLink.addEventListener('click', async () => {
      sampleErr.hidden = true;
      sample.parentElement.classList.remove('is-invalid');
      const value = sample.value.trim();
      if (value && !/^https:\/\//i.test(value)) {
        sampleErr.textContent = 'Use a full https:// link.';
        sampleErr.hidden = false;
        sample.parentElement.classList.add('is-invalid');
        sample.focus();
        return;
      }
      const r = await api('PUT', `/api/platforms/${p.key}/sample`, { sample_url: value });
      if (r.ok) {
        toast(value ? `Sample link saved for ${p.name}.` : `Sample link removed for ${p.name}.`);
        renderPlatforms();
      } else {
        sampleErr.textContent = (r.data.fields && r.data.fields.sample_url) || errorText(r);
        sampleErr.hidden = false;
        sample.parentElement.classList.add('is-invalid');
      }
    });
    runTest.addEventListener('click', async () => {
      runTest.disabled = true;
      runTest.textContent = 'Testing…';
      const r = await api('POST', `/api/platforms/${p.key}/test`);
      runTest.textContent = 'Run test';
      runTest.disabled = false;
      if (!r.ok) {
        toast(errorText(r), 'err');
        return;
      }
      result.hidden = false;
      result.className = 'test-result ' + (r.data.test_ok ? 'ok' : 'bad');
      result.textContent = `${r.data.test_ok ? 'Passed' : 'Failed'} · ${r.data.message} · ${fmtRel(Date.now())}`;
    });

    return h(
      'section',
      { class: 'card platform-card', 'aria-labelledby': 'p-' + p.key },
      h('div', { class: 'card-head' },
        h('h2', { id: 'p-' + p.key, text: p.name }),
      ),
      h('div', { class: 'badge-row' },
        p.implemented ? badge('Extractor ready', 'ok') : badge('No extractor in this version', 'warn'),
        badge(p.enabled ? 'On' : 'Off', p.enabled ? 'ok' : 'muted'),
      ),
      h('p', { class: 'platform-meta', text: p.implemented ? 'Public links only. Private, login-only, and story content is not supported.' : 'This platform is listed but cannot be turned on until an extractor exists.' }),
      h('div', { class: 'stack-sm section-gap' },
        h('div', {}, toggle),
        h('div', { class: 'field' },
          h('label', { for: sampleId, class: 'field-label', text: 'Sample public link' }),
          h('p', { class: 'field-hint', id: sampleId + '-hint', text: 'Used only by the extraction test. Use a public https link from this platform.' }),
          h('div', { class: 'inline' }, sample, saveLink, runTest),
          sampleErr,
        ),
        result,
      ),
    );
  }

  // ---------- bot and health ----------
  async function renderBot() {
    loading();
    const [bot, health] = await Promise.all([api('GET', '/api/bot'), api('GET', '/api/health')]);
    if (!bot.ok) return failed(bot, renderBot);
    const d = bot.data;
    const wh = d.webhook;

    const actionBtn = (label, method, path, done, { danger = false, confirmText = null } = {}) =>
      h('button', {
        type: 'button', class: danger ? 'btn btn-danger' : 'btn',
        onclick: async () => {
          if (confirmText && !(await confirmDialog(label, confirmText, label))) return;
          const r = await api(method, path);
          if (r.ok) {
            toast(done(r.data));
            renderBot();
          } else {
            toast(errorText(r), 'err');
          }
        },
      }, label);

    const tokenMissing = !d.token_configured;
    setView(
      pageHead('Bot and health', 'Check the Telegram connection, register the webhook, and review the health checks.', []),
      tokenMissing
        ? notice('err', 'The bot token is not set.', 'Add BOT_TOKEN as a Secret in Cloudflare (Workers & Pages → mediadownloaderbot → Settings → Variables and secrets, type Secret), then reload this page.')
        : null,
      d.error ? notice('err', 'Telegram did not answer.', d.error) : null,
      d.webhook_registered && !d.secret_matches
        ? notice('err', 'The webhook was not registered with the current WEBHOOK_SECRET.', 'Telegram may hold a missing or older secret, so updates are rejected with 403. Press Register webhook below once.')
        : null,
      h('div', { class: 'two-col' },
        section('Telegram bot', null, kvList([
          ['Bot token', d.token_configured ? badge('Set in Cloudflare Secrets', 'ok') : badge('Missing', 'err')],
          ['Bot username', d.bot_username ? '@' + d.bot_username : '—'],
          ['Bot is on', d.bot_enabled ? badge('Yes', 'ok') : badge('Paused in Settings', 'warn')],
          ['Webhook address', h('span', { class: 'mono', text: d.expected_webhook_url })],
          ['Webhook status', !d.webhook_registered ? badge('Not registered', 'warn') : d.secret_matches ? badge('Registered', 'ok') : badge('Register again', 'warn')],
          ['Pending updates', wh ? String(wh.pending_update_count ?? 0) : '—'],
          ['Last Telegram error', wh && wh.last_error_message ? wh.last_error_message : '—'],
        ])),
        section('Actions', 'Test first. Register the webhook once the test passes.', h('div', { class: 'stack-sm' },
          h('p', { class: 'muted', text: 'The token is read-only here. To change it, edit BOT_TOKEN in Cloudflare Secrets, then run Test connection and Register webhook.' }),
          h('p', { class: 'muted', text: 'Test connection calls Telegram getMe with the saved token.' }),
          actionBtn('Test connection', 'POST', '/api/bot/test', (x) => `Connected as @${x.username || 'unknown'}.`),
          h('p', { class: 'muted', text: 'Register points Telegram at this Worker and sends the WEBHOOK_SECRET value with it. Press it once after you create or change WEBHOOK_SECRET. Telegram sends updates only after this.' }),
          actionBtn('Register webhook', 'POST', '/api/bot/webhook', () => 'Webhook registered.'),
          h('p', { class: 'muted', text: 'Removing the webhook stops the bot from receiving messages.' }),
          actionBtn('Remove webhook', 'DELETE', '/api/bot/webhook', () => 'Webhook removed.', { danger: true, confirmText: 'The bot will stop receiving messages until you register the webhook again.' }),
        )),
      ),
      section('Health checks', 'Run again after you change a secret or a setting.', health.ok && health.data.checks
        ? h('ul', { class: 'checklist' }, health.data.checks.map((c) =>
            h('li', {},
              c.status === 'ok' ? badge('OK', 'ok') : c.status === 'warning' ? badge('Warning', 'warn') : badge('Error', 'err'),
              h('strong', { text: c.name }),
              h('span', { class: 'check-msg', text: c.message }))))
        : notice('err', 'Health checks could not run.', errorText(health))),
    );
  }

  // ---------- logs ----------
  function renderLogs() {
    let offset = 0;
    const severity = h('select', { id: 'lg-sev', name: 'severity' },
      h('option', { value: '', text: 'All severities' }),
      h('option', { value: 'info', text: 'Info' }),
      h('option', { value: 'warning', text: 'Warning' }),
      h('option', { value: 'error', text: 'Error' }));
    const event = h('input', { id: 'lg-ev', name: 'event', placeholder: 'e.g. download_failed', maxlength: 40, autocomplete: 'off' });
    const q = h('input', { id: 'lg-q', name: 'q', type: 'search', placeholder: 'Text in the detail', maxlength: 80, autocomplete: 'off' });
    const tbody = h('tbody', {});
    const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Time' }), h('th', { text: 'Severity' }), h('th', { text: 'Event' }), h('th', { text: 'Platform' }), h('th', { text: 'Detail' }))),
      tbody));
    const empty = h('div', { hidden: true }, emptyState('No log entries', 'Nothing matches these filters.'));
    const count = h('span', { class: 'muted', role: 'status' });
    const more = h('button', { type: 'button', class: 'btn', hidden: true }, 'Load more');
    const form = h('form', { class: 'filters', role: 'search' },
      h('div', { class: 'field' }, h('label', { for: 'lg-sev', class: 'field-label', text: 'Severity' }), severity),
      h('div', { class: 'field' }, h('label', { for: 'lg-ev', class: 'field-label', text: 'Event' }), event),
      h('div', { class: 'field field-search' }, h('label', { for: 'lg-q', class: 'field-label', text: 'Search detail' }), q),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Apply'),
      h('button', { type: 'reset', class: 'btn' }, 'Reset'));

    const SEV = { info: ['Info', 'info'], warning: ['Warning', 'warn'], error: ['Error', 'err'] };

    async function load(reset) {
      if (reset) {
        offset = 0;
        tbody.replaceChildren();
      }
      more.disabled = true;
      const params = new URLSearchParams({ limit: '50', offset: String(offset) });
      if (severity.value) params.set('severity', severity.value);
      if (event.value.trim()) params.set('event', event.value.trim());
      if (q.value.trim()) params.set('q', q.value.trim());
      const res = await api('GET', `/api/logs?${params.toString()}`);
      more.disabled = false;
      if (!res.ok) {
        toast(errorText(res), 'err');
        return;
      }
      for (const row of res.data.items) {
        const [label, kind] = SEV[row.severity] || [row.severity, 'muted'];
        tbody.append(h('tr', {},
          h('td', {}, h('time', { datetime: new Date(row.created_at).toISOString(), title: fmtDate(row.created_at), text: fmtRel(row.created_at) })),
          h('td', {}, badge(label, kind)),
          h('td', { class: 'mono', text: row.event }),
          h('td', { text: row.platform || '—' }),
          h('td', { class: 'wrap', text: row.detail || '—' }),
        ));
      }
      if (res.data.next_offset !== null) offset = res.data.next_offset;
      more.hidden = res.data.next_offset === null;
      empty.hidden = tbody.children.length > 0;
      table.hidden = tbody.children.length === 0;
      count.textContent = tr(`${tbody.children.length} shown`);
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      load(true);
    });
    form.addEventListener('reset', () => {
      setTimeout(() => load(true), 0);
    });
    more.addEventListener('click', () => load(false));

    setView(
      pageHead('Logs', 'Errors and events from the bot and the panel. Logs never contain tokens, full links, or user identifiers. Retention is set in Settings.'),
      section('Event log', null, form, table, empty, h('div', { class: 'pager' }, count, more)),
    );
    load(true);
  }

  // ---------- diagnostics ----------
  async function renderDiagnostics() {
    loading();
    const res = await api('GET', '/api/diagnostics');
    if (!res.ok) return failed(res, renderDiagnostics);
    const { ok, ...rest } = res.data;
    const label = (key) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const valueText = (v) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v === null || v === undefined ? '—' : String(v));
    const objRows = (obj) => Object.entries(obj).map(([k, v]) => [label(k), valueText(v)]);
    const secretKind = (v) => (v === 'set' ? badge('Set', 'ok') : badge('Missing or invalid', 'err'));
    const copy = h('button', {
      type: 'button', class: 'btn',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(rest, null, 2));
          toast('Copied the redacted diagnostics.');
        } catch (e) {
          toast('Copy failed. Select the text below and copy it.', 'err');
        }
      },
    }, 'Copy as JSON');

    setView(
      pageHead('Diagnostics', 'Redacted. Secret values are never shown, only whether each one is set.', [copy]),
      h('div', { class: 'two-col' },
        section('Runtime', null, kvList([
          ['App version', rest.app_version],
          ['Runtime', rest.runtime],
          ['Database schema', rest.schema_version],
        ])),
        section('Secrets', 'Set these in Cloudflare Secrets.', kvList([
          ['BOT_TOKEN', secretKind(rest.secrets.BOT_TOKEN)],
          ['WEBHOOK_SECRET', secretKind(rest.secrets.WEBHOOK_SECRET === 'set' ? 'set' : 'missing')],
        ])),
      ),
      h('div', { class: 'two-col section-gap' },
        section('Limits', null, kvList(objRows(rest.limits))),
        section('Logs, last 24 hours', null, kvList(objRows(rest.logs_last_24h))),
      ),
      section('Settings', 'Current values as stored.', kvList(objRows(rest.settings))),
      section('Platforms', null, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Key' }), h('th', { text: 'Implemented' }), h('th', { text: 'On' }))),
        h('tbody', {}, rest.platforms.map((p) => h('tr', {},
          h('td', { class: 'mono', text: p.key }),
          h('td', {}, p.implemented ? badge('Yes', 'ok') : badge('No', 'warn')),
          h('td', {}, p.enabled ? badge('On', 'ok') : badge('Off', 'muted')),
        )))))),
    );
  }

  // ---------- account ----------
  async function renderAccount() {
    loading();
    const me = await api('GET', '/api/auth/me');
    if (!me.ok) return failed(me, renderAccount);
    const d = me.data;
    const saved = { theme: d.appearance.theme, mode: d.appearance.mode, lang: d.appearance.lang || 'en' };
    applyAppearance(saved.theme, saved.mode);

    // Password
    const pwErr = h('div', { class: 'notice notice-err', role: 'alert', hidden: true });
    const cur = h('input', { id: 'pw-cur', name: 'current_password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
    const next = h('input', { id: 'pw-new', name: 'new_password', type: 'password', autocomplete: 'new-password', required: true, minlength: 12, maxlength: 200, 'aria-describedby': 'pw-new-hint pw-new-err' });
    const again = h('input', { id: 'pw-again', name: 'confirm_password', type: 'password', autocomplete: 'new-password', required: true, maxlength: 200, 'aria-describedby': 'pw-again-err' });
    const newErr = h('p', { class: 'field-error', id: 'pw-new-err', hidden: true });
    const againErr = h('p', { class: 'field-error', id: 'pw-again-err', hidden: true });
    const curErr = h('p', { class: 'field-error', id: 'pw-cur-err', hidden: true });
    const pwSubmit = h('button', { type: 'submit', class: 'btn btn-primary' }, d.must_change_password ? 'Set new password' : 'Update password');
    const pwForm = h('form', { class: 'stack', novalidate: true },
      pwErr,
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: 'pw-cur', class: 'field-label', text: 'Current password' }), cur, curErr),
        h('div', { class: 'field' }, h('label', { for: 'pw-new', class: 'field-label', text: 'New password' }), next,
          h('p', { class: 'field-hint', id: 'pw-new-hint', text: 'At least 12 characters. Do not reuse the username.' }), newErr),
        h('div', { class: 'field' }, h('label', { for: 'pw-again', class: 'field-label', text: 'Repeat new password' }), again, againErr),
      ),
      h('div', { class: 'form-actions' }, pwSubmit));

    pwForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      for (const el of [pwErr, curErr, newErr, againErr]) el.hidden = true;
      if (next.value.length < 12) {
        newErr.textContent = 'Use at least 12 characters.';
        newErr.hidden = false;
        next.focus();
        return;
      }
      if (next.value !== again.value) {
        againErr.textContent = 'The two passwords do not match.';
        againErr.hidden = false;
        again.focus();
        return;
      }
      pwSubmit.disabled = true;
      const r = await api('POST', '/api/auth/password', { current_password: cur.value, new_password: next.value });
      pwSubmit.disabled = false;
      if (r.ok) {
        toast('Password updated.');
        setTimeout(() => {
          location.href = '/';
        }, 600);
        return;
      }
      const f = r.data.fields || {};
      if (f.current_password) {
        curErr.textContent = 'The current password is wrong.';
        curErr.hidden = false;
        cur.focus();
      }
      if (f.new_password) {
        newErr.textContent = f.new_password;
        newErr.hidden = false;
      }
      if (!f.current_password && !f.new_password) {
        pwErr.textContent = errorText(r);
        pwErr.hidden = false;
      }
    });

    const children = [
      pageHead('Account', `Signed in as ${d.username}.`),
      d.must_change_password ? notice('warn', 'Set a new password first.', 'The default password is still in use. The rest of the panel unlocks after you change it.') : null,
      section('Password', null, pwForm),
    ];

    if (!d.must_change_password) {
      const themeInputs = [
        ['merchant', 'Merchant', 'Payments console: dark navigation, dense tables, blue accent.', ['#0b2545', '#2563eb', '#f3f5f9']],
        ['ios', 'iOS', 'Grouped surfaces, rounded corners, translucent bars, system blue.', ['#007aff', '#f2f2f7', '#1c1c1e']],
      ].map(([value, name, desc, swatches]) => {
        const input = h('input', { type: 'radio', name: 'theme', value, id: 'th-' + value });
        input.checked = saved.theme === value;
        input.addEventListener('change', preview);
        return h('label', { class: 'theme-card', for: 'th-' + value },
          input,
          h('span', { class: 'theme-name', text: name }),
          h('span', { class: 'field-hint', text: desc }),
          h('span', { class: 'swatches', 'aria-hidden': 'true' }, swatches.map((c) => swatchNode(c))),
        );
      });
      const modes = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([value, name]) => {
        const input = h('input', { type: 'radio', name: 'mode', value, id: 'md-' + value });
        input.checked = saved.mode === value;
        input.addEventListener('change', preview);
        return h('label', {}, input, h('span', { text: name }));
      });
      const langs = [['en', 'English'], ['fa', 'Persian (فارسی)']].map(([value, name]) => {
        const input = h('input', { type: 'radio', name: 'lang', value, id: 'lg-' + value });
        input.checked = saved.lang === value;
        input.addEventListener('change', preview);
        return h('label', {}, input, h('span', { text: name }));
      });
      const apStatus = h('span', { class: 'status-text', role: 'status', text: 'Showing your saved choice.' });
      const apSave = h('button', { type: 'submit', class: 'btn btn-primary', disabled: true }, 'Save appearance');
      const apReset = h('button', { type: 'button', class: 'btn', disabled: true }, 'Cancel');
      const apForm = h('form', { class: 'stack', novalidate: true },
        h('div', { class: 'field' }, h('span', { class: 'field-label', id: 'th-label', text: 'Theme' }),
          h('div', { class: 'theme-cards', role: 'radiogroup', 'aria-labelledby': 'th-label' }, themeInputs)),
        h('div', { class: 'field' }, h('span', { class: 'field-label', id: 'md-label', text: 'Mode' }),
          h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'md-label' }, modes),
          h('p', { class: 'field-hint', text: 'System follows the device setting. The preview applies at once; press Save to keep it.' })),
        h('div', { class: 'field' }, h('span', { class: 'field-label', id: 'lg-label', text: 'Panel language' }),
          h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'lg-label' }, langs),
          h('p', { class: 'field-hint', text: 'Panel language is saved with your account. Press Save appearance to apply it.' })),
        h('div', { class: 'savebar' }, apStatus, apReset, apSave));

      function current() {
        return {
          theme: apForm.elements.namedItem('theme').value,
          mode: apForm.elements.namedItem('mode').value,
          lang: apForm.elements.namedItem('lang').value,
        };
      }
      function preview() {
        const c = current();
        applyAppearance(c.theme, c.mode);
        const dirty = c.theme !== saved.theme || c.mode !== saved.mode || c.lang !== saved.lang;
        apSave.disabled = !dirty;
        apReset.disabled = !dirty;
        apStatus.textContent = dirty ? 'Preview on. Not saved yet.' : 'Showing your saved choice.';
        apStatus.classList.toggle('is-dirty', dirty);
      }
      apReset.addEventListener('click', () => {
        apForm.elements.namedItem('theme').value = saved.theme;
        for (const r of apForm.querySelectorAll('input[name="theme"]')) r.checked = r.value === saved.theme;
        for (const r of apForm.querySelectorAll('input[name="mode"]')) r.checked = r.value === saved.mode;
        for (const r of apForm.querySelectorAll('input[name="lang"]')) r.checked = r.value === saved.lang;
        preview();
      });
      apForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const c = current();
        apSave.disabled = true;
        const r = await api('PUT', '/api/account/appearance', c);
        if (r.ok) {
          const languageChanged = c.lang !== saved.lang;
          saved.theme = c.theme;
          saved.mode = c.mode;
          saved.lang = c.lang;
          toast('Appearance saved.');
          // Language changes the whole layout direction, so the page is reloaded once to render it.
          if (languageChanged) setTimeout(() => location.reload(), 600);
        } else {
          toast(errorText(r), 'err');
        }
        preview();
      });
      children.push(section('Appearance', null, apForm));
    }
    setView(...children);
  }

  // Swatch helper: builds a coloured square without inline style attributes (CSP style-src 'self').
  function swatchNode(color) {
    const node = h('span', { class: 'swatch' });
    node.style.background = color;
    return node;
  }

  function applyAppearance(theme, mode) {
    document.documentElement.dataset.theme = theme === 'ios' ? 'ios' : 'merchant';
    document.documentElement.dataset.mode = ['light', 'dark', 'system'].includes(mode) ? mode : 'system';
  }

  // ---------- shell wiring ----------
  document.addEventListener('click', async (event) => {
    const target = event.target;
    const action = target.closest && target.closest('[data-action]');
    if (!action) return;
    const kind = action.dataset.action;
    if (kind === 'logout') {
      await api('POST', '/api/auth/logout');
      location.href = '/login';
    } else if (kind === 'menu' || kind === 'menu-close') {
      toggleMenu(kind === 'menu' ? undefined : false);
    }
  });

  function toggleMenu(force) {
    const sidebar = document.getElementById('sidebar');
    const scrim = document.querySelector('.scrim');
    const open = force === undefined ? !sidebar.classList.contains('is-open') : force;
    sidebar.classList.toggle('is-open', open);
    if (scrim) scrim.hidden = !open;
    const btn = document.querySelector('[data-action="menu"]');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') toggleMenu(false);
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

  if (page !== 'login' && topbarStatus) {
    api('GET', '/api/auth/me').then((r) => {
      if (r.ok) topbarStatus.append(h('span', { class: 'muted', text: `Signed in as ${r.data.username}` }));
    });
  }

  const render = pages[page];
  if (render) {
    Promise.resolve()
      .then(render)
      .catch((err) => {
        setView(notice('err', 'Something went wrong on this page.', String((err && err.message) || err)));
      });
  }
})();
