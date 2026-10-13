// Server-rendered page shells. The data is loaded by /static/app.js through the JSON API.
// No inline scripts or styles, so the Content-Security-Policy stays strict.
// Panel language (en | fa) is per admin account. It sets lang and dir here, and the
// translations are applied by /static/i18n.js. The bot's language setting is separate.

export type PageName = 'dashboard' | 'settings' | 'platforms' | 'bot' | 'logs' | 'diagnostics' | 'account' | 'login';
export type PanelLang = 'en' | 'fa';

interface NavItem {
  page: PageName;
  href: string;
  label: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { title: 'Overview', items: [{ page: 'dashboard', href: '/', label: 'Dashboard' }] },
  {
    title: 'Operations',
    items: [
      { page: 'platforms', href: '/platforms', label: 'Platforms' },
      { page: 'bot', href: '/bot', label: 'Bot and health' },
      { page: 'logs', href: '/logs', label: 'Logs' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { page: 'settings', href: '/settings', label: 'Settings' },
      { page: 'diagnostics', href: '/diagnostics', label: 'Diagnostics' },
    ],
  },
  { title: 'Account', items: [{ page: 'account', href: '/account', label: 'Account' }] },
];

export const PAGE_TITLES: Record<PageName, string> = {
  dashboard: 'Dashboard',
  settings: 'Settings',
  platforms: 'Platforms',
  bot: 'Bot and health',
  logs: 'Logs',
  diagnostics: 'Diagnostics',
  account: 'Account',
  login: 'Sign in',
};

const ICON_FOR: Record<PageName, string> = {
  dashboard: 'i-dashboard',
  platforms: 'i-platforms',
  bot: 'i-bot',
  logs: 'i-logs',
  settings: 'i-settings',
  diagnostics: 'i-diagnostics',
  account: 'i-account',
  login: 'i-shield',
};

export function iconRef(id: string, cls = 'icon'): string {
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="/static/icons.svg#${id}"/></svg>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export interface ShellOptions {
  page: PageName;
  csrf?: string;
  theme?: string;
  mode?: string;
  lang?: string;
  /** While a password change is pending, only the account page is available. */
  restricted?: boolean;
}

export function shell(opts: ShellOptions): string {
  const theme = opts.theme === 'ios' ? 'ios' : 'merchant';
  const mode = ['light', 'dark', 'system'].includes(opts.mode ?? '') ? opts.mode : 'system';
  const lang: PanelLang = opts.lang === 'fa' ? 'fa' : 'en';
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const title = PAGE_TITLES[opts.page];
  const csrf = opts.csrf ? `<meta name="csrf" content="${escapeHtml(opts.csrf)}">` : '';
  const head = `<!doctype html>
<html lang="${lang}" dir="${dir}" data-lang="${lang}" data-theme="${theme}" data-mode="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · MediaDownloaderBot</title>
${csrf}
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/static/fonts/estedad-latin-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/app.css">
</head>`;
  const footer = `<script src="/static/i18n.js" defer></script>
<script src="/static/app.js" defer></script>
</body>
</html>`;

  if (opts.page === 'login') {
    return `${head}
<body data-page="login">
<a class="skip-link" href="#main">Skip to content</a>
<main id="main" class="auth" tabindex="-1">
  <section class="auth-hero" aria-hidden="true">
    <span class="brand-mark">MD</span>
    <h2>MediaDownloaderBot</h2>
    <p>Admin panel</p>
  </section>
  <div id="app" class="auth-card"><p class="muted">Loading…</p></div>
</main>
<div id="toasts" class="toasts" role="status" aria-live="polite"></div>
${footer}`;
  }

  const groups = opts.restricted ? NAV_GROUPS.filter((g) => g.items.some((i) => i.page === 'account')) : NAV_GROUPS;
  const nav = groups
    .map(
      (g) =>
        `<div class="nav-group"><p class="nav-title">${escapeHtml(g.title)}</p>${g.items
          .map(
            (i) =>
              `<a class="nav-link" href="${i.href}"${i.page === opts.page ? ' aria-current="page"' : ''}>${iconRef(ICON_FOR[i.page], 'icon nav-icon')}<span>${escapeHtml(i.label)}</span></a>`,
          )
          .join('')}</div>`,
    )
    .join('');

  return `${head}
<body data-page="${opts.page}">
<a class="skip-link" href="#main">Skip to content</a>
<div class="shell">
  <aside class="sidebar" id="sidebar" aria-label="Main navigation">
    <div class="brand"><span class="brand-mark" aria-hidden="true">MD</span><span class="brand-text"><strong>MediaDownloaderBot</strong><small>Admin panel</small></span></div>
    <nav class="nav" aria-label="Sections">${nav}</nav>
    <div class="sidebar-foot">
      <button type="button" class="btn btn-ghost btn-block" data-action="logout">${iconRef('i-signout', 'icon')}<span>Sign out</span></button>
    </div>
  </aside>
  <div class="content">
    <header class="topbar">
      <button type="button" class="btn btn-ghost menu-toggle" data-action="menu" aria-expanded="false" aria-controls="sidebar">Menu</button>
      <p class="crumb" id="crumb">${escapeHtml(title)}</p>
      <div class="topbar-right" id="topbar-status"></div>
    </header>
    <main id="main" class="main" tabindex="-1">
      <div id="app" aria-busy="true"><p class="muted">Loading…</p></div>
    </main>
  </div>
</div>
<div class="scrim" data-action="menu-close" hidden></div>
<dialog id="confirm" class="dialog" aria-labelledby="confirm-title">
  <form method="dialog" class="dialog-body">
    <h2 id="confirm-title">Are you sure?</h2>
    <p id="confirm-text" class="muted"></p>
    <div class="dialog-actions">
      <button type="submit" value="cancel" class="btn">Cancel</button>
      <button type="submit" value="ok" class="btn btn-primary" id="confirm-ok">Confirm</button>
    </div>
  </form>
</dialog>
<div id="toasts" class="toasts" role="status" aria-live="polite"></div>
${footer}`;
}
