MB.ready(() => {
  'use strict';
  const { el, fmt } = MB;
  const view = document.getElementById('view');

  const render = (data) => {
    const attention = data.checks_needing_attention;
    const attentionCard = el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Needs attention'),
        el('span', { class: 'muted small' }, attention.length ? attention.length + ' item(s)' : 'All checks pass or are not configured')),
      attention.length === 0 ? MB.empty('Nothing needs attention right now.') : el('div', null, attention.map((c) => el('div', { class: 'check-row' },
        MB.badge(c.status),
        el('div', null, el('strong', null, c.title), el('span', { class: 'sub' }, c.message),
          c.steps && c.steps.length ? el('ol', { class: 'steps' }, c.steps.map((s) => el('li', null, s))) : null),
        el('span', { class: 'muted small nowrap' }, fmt.ago(c.checked_at))))));

    const issues = data.recent_issues;
    const issuesCard = el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Recent issues'),
        el('span', { class: 'muted small' }, `Warnings and errors in the last ${data.window_hours} hours, grouped by category`)),
      issues.length === 0 ? MB.empty('No warnings or errors in the last 24 hours.') : el('div', null, issues.map((issue) => el('div', { class: 'check-row' },
        el('span', { class: 'sev sev-' + issue.severity }, issue.severity),
        el('div', null, el('strong', null, issue.title), el('span', { class: 'sub' }, `${issue.count} occurrence(s) · category ${issue.category} · last ${fmt.ago(issue.last_seen)}`),
          el('p', { class: 'small' }, issue.explanation),
          issue.steps && issue.steps.length ? el('ol', { class: 'steps' }, issue.steps.map((s) => el('li', null, s))) : null,
          issue.examples.map((ex) => el('div', { class: 'msg details-json' }, ex.message)))))));

    const download = el('a', { class: 'btn primary', href: '/api/diagnostics/report', download: 'mediabot-diagnostics.txt' }, 'Download report');
    MB.clear(view).append(
      el('div', { class: 'view-head' },
        el('div', null, el('h2', null, 'Diagnostics'),
          el('p', null, 'Explains recent problems and what to do. Tokens, passwords, cookies and user identifiers are never included.')),
        download),
      el('div', { class: 'stack' }, attentionCard, issuesCard));
  };

  MB.clear(view).append(MB.loading('Analysing recent problems…'));
  MB.get('/api/diagnostics').then(render).catch((error) => {
    MB.clear(view).append(MB.banner('bad', 'Could not load diagnostics.', MB.errorText(error)));
  });
});
