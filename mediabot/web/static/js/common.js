/* Shared browser helpers for the admin panel. No inline scripts (CSP: script-src 'self'). */
(() => {
  'use strict';

  const MB = (window.MB = window.MB || {});

  class ApiError extends Error {
    constructor(status, message, fields) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.fields = fields || {};
    }
  }
  MB.ApiError = ApiError;

  MB.cookie = (name) => {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  };

  /** DOM builder. Text is always set with textContent, never parsed as HTML. */
  MB.el = (tag, attrs, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };
  const el = MB.el;

  MB.clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  MB.api = async (method, url, body) => {
    const options = { method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (method !== 'GET') options.headers['X-CSRF-Token'] = MB.cookie('mb_csrf');
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new ApiError(0, 'Network error. Check your connection and try again.', {});
    }
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();
    if (response.status === 401 && !url.startsWith('/api/auth/login')) {
      location.assign('/login?next=' + encodeURIComponent(location.pathname));
      throw new ApiError(401, 'Your session has ended. Sign in again.', {});
    }
    if (!response.ok) {
      const detail = data && data.detail;
      let message = typeof data === 'string' && data ? data.slice(0, 200) : 'The request failed.';
      let fields = {};
      if (typeof detail === 'string') message = detail;
      else if (detail && typeof detail === 'object') {
        message = detail.message || message;
        fields = detail.fields || {};
      }
      throw new ApiError(response.status, message, fields);
    }
    return data;
  };
  MB.get = (url) => MB.api('GET', url);
  MB.post = (url, body) => MB.api('POST', url, body === undefined ? {} : body);
  MB.put = (url, body) => MB.api('PUT', url, body);
  MB.del = (url) => MB.api('DELETE', url);

  MB.toast = (message, kind = 'info') => {
    const box = document.getElementById('toasts');
    if (!box) return;
    const node = el('div', { class: 'toast toast-' + kind, role: kind === 'error' ? 'alert' : 'status' }, message);
    box.append(node);
    setTimeout(() => node.remove(), kind === 'error' ? 8000 : 4000);
  };

  MB.errorText = (error) => (error instanceof ApiError ? error.message : 'Something went wrong. ' + String(error.message || ''));

  MB.fmt = {
    time: (ts) => (ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '—'),
    ago: (ts) => {
      if (!ts) return 'never';
      const s = Math.max(0, Date.now() / 1000 - ts);
      if (s < 60) return Math.floor(s) + 's ago';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    },
    duration: (seconds) => {
      const s = Math.floor(seconds || 0);
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
      if (d) return `${d}d ${h}h`;
      if (h) return `${h}h ${m}m`;
      if (m) return `${m}m ${s % 60}s`;
      return `${s}s`;
    },
    bytes: (n) => {
      if (n === null || n === undefined) return '—';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = n, i = 0;
      while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
      return value.toFixed(i ? 1 : 0) + ' ' + units[i];
    },
    percent: (value) => (value === null || value === undefined ? '—' : value.toFixed(0) + '%'),
  };

  const STATUS = {
    healthy: ['ok', 'Healthy'],
    running: ['ok', 'Running'],
    warning: ['warn', 'Warning'],
    stopping: ['warn', 'Stopping'],
    enabled_unverified: ['warn', 'Enabled, not verified'],
    failed: ['bad', 'Failed'],
    error: ['bad', 'Error'],
    starting: ['info', 'Starting'],
    not_configured: ['neutral', 'Not configured'],
    stopped: ['neutral', 'Stopped'],
    disabled: ['neutral', 'Disabled'],
    unknown: ['neutral', 'Not tested'],
    untested: ['neutral', 'Not tested'],
  };
  MB.badge = (status) => {
    const [kind, label] = STATUS[status] || ['neutral', status || 'Unknown'];
    return el('span', { class: 'badge badge-' + kind }, label);
  };

  MB.empty = (text) => el('div', { class: 'empty' }, text);
  MB.loading = (text) => el('div', { class: 'loading' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), text || 'Loading…');
  MB.banner = (kind, title, body) => el('div', { class: 'banner ' + (kind || '') },
    el('div', null, title ? el('strong', null, title) : null, body ? el('span', null, body) : null));

  MB.button = (label, { kind = '', onClick, disabled = false, title } = {}) => {
    const button = el('button', { class: 'btn small ' + kind, type: 'button', disabled, title }, label);
    if (onClick) {
      button.addEventListener('click', async () => {
        if (button.classList.contains('is-busy')) return;
        button.classList.add('is-busy');
        try { await onClick(); } catch (error) { MB.toast(MB.errorText(error), 'error'); } finally { button.classList.remove('is-busy'); }
      });
    }
    return button;
  };

  /** Show server-side field errors next to their inputs (data-field wrappers). */
  MB.setFieldErrors = (root, fields) => {
    root.querySelectorAll('[data-field]').forEach((wrap) => {
      const name = wrap.dataset.field;
      const message = fields && fields[name];
      wrap.classList.toggle('invalid', Boolean(message));
      const msg = wrap.querySelector('.field-msg');
      if (msg) msg.textContent = message || '';
    });
  };

  /** Repeatedly call fn while the page is visible. */
  MB.every = (fn, ms) => {
    const timer = setInterval(() => { if (!document.hidden) fn(); }, ms);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    return timer;
  };

  MB.ready = (fn) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  };

  // ------------------------------------------------------------- appearance
  const MODES = ['light', 'dark', 'system'];
  MB.updateModeLabel = () => {
    const label = document.querySelector('[data-mode-label]');
    if (label) label.textContent = document.documentElement.dataset.mode;
  };
  MB.applyAppearance = (theme, mode) => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.mode = mode;
    const link = document.getElementById('theme-css');
    if (link) {
      const target = `/static/css/themes/${theme}.css`;
      if (!link.getAttribute('href').endsWith(target)) link.setAttribute('href', target);
    }
    MB.updateModeLabel();
  };
  MB.saveAppearance = async (theme, mode) => {
    const data = await MB.put('/api/account/appearance', { theme, mode });
    MB.applyAppearance(data.appearance.theme, data.appearance.mode);
    return data;
  };

  document.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    const action = trigger.dataset.action;
    if (action === 'logout') {
      try { await MB.post('/api/auth/logout'); } catch (error) { /* session already gone */ }
      location.assign('/login');
    } else if (action === 'mode') {
      const root = document.documentElement;
      const next = MODES[(MODES.indexOf(root.dataset.mode) + 1) % MODES.length];
      try {
        await MB.saveAppearance(root.dataset.theme, next);
      } catch (error) {
        MB.toast(MB.errorText(error), 'error');
      }
    }
  });

  MB.updateModeLabel();
})();
