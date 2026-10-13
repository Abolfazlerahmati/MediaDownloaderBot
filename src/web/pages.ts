// Server-rendered page shells. The data is loaded by /static/app.js through the JSON API.
// No inline scripts or styles, so the Content-Security-Policy stays strict.

export type PageName = 'dashboard' | 'settings' | 'platforms' | 'bot' | 'logs' | 'diagnostics' | 'account' | 'login';

const NAV: Array<{ page: PageName; href: string; label: string }> = [
  { page: 'dashboard', href: '/', label: 'Dashboard' },
  { page: 'settings', href: '/settings', label: 'Settings' },
  { page: 'platforms', href: '/platforms', label: 'Platforms' },
  { page: 'bot', href: '/bot', label: 'Bot and health' },
  { page: 'logs', href: '/logs', label: 'Logs' },
  { page: 'diagnostics', href: '/diagnostics', label: 'Diagnostics' },
  { page: 'account', href: '/account', label: 'Account' },
];

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export interface ShellOptions {
  page: PageName;
  csrf?: string;
  theme?: string;
  mode?: string;
  /** While a password change is pending, only the account page is available. */
  restricted?: boolean;
}

export function shell(opts: ShellOptions): string {
  const theme = opts.theme === 'ios' ? 'ios' : 'merchant';
  const mode = ['light', 'dark', 'system'].includes(opts.mode ?? '') ? opts.mode : 'system';
  const title = opts.page === 'login' ? 'Sign in' : (NAV.find((n) => n.page === opts.page)?.label ?? 'Admin');
  const nav =
    opts.page === 'login'
      ? ''
      : `<nav class="nav" aria-label="Main">${
          (opts.restricted ? NAV.filter((n) => n.page === 'account') : NAV)
            .map(
              (n) =>
                `<a href="${n.href}"${n.page === opts.page ? ' aria-current="page"' : ''}>${escapeHtml(n.label)}</a>`,
            )
            .join('')
        }<button type="button" class="link" data-action="logout">Sign out</button></nav>`;
  const csrf = opts.csrf ? `<meta name="csrf" content="${escapeHtml(opts.csrf)}">` : '';
  return `<!doctype html>
<html lang="en" data-theme="${theme}" data-mode="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · MediaDownloaderBot</title>
${csrf}
<link rel="stylesheet" href="/static/app.css">
</head>
<body data-page="${opts.page}">
<header class="top"><strong>MediaDownloaderBot</strong>${nav}</header>
<main id="app" class="wrap" data-page="${opts.page}"><p class="muted">Loading…</p></main>
<script src="/static/app.js" defer></script>
</body>
</html>`;
}
