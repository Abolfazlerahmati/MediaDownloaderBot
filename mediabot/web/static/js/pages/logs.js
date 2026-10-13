MB.ready(() => {
  'use strict';
  const { el, fmt } = MB;
  const view = document.getElementById('view');
  const PAGE_SIZES = [25, 50, 100, 200];
  const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
  let offset = 0;
  let total = 0;

  const levelBoxes = {};
  const levelGroup = el('div', { class: 'check-group' }, LEVELS.map((lv) => {
    const box = el('input', { type: 'checkbox', value: lv, checked: lv !== 'DEBUG' });
    levelBoxes[lv] = box;
    return el('label', { class: 'check' }, box, el('span', null, lv));
  }));
  const component = el('select', { id: 'f-component' }, el('option', { value: '' }, 'All components'),
    ['bot', 'web', 'jobs', 'platforms', 'health', 'db', 'app', 'mediabot'].map((c) => el('option', { value: c }, c)));
  const category = el('input', { id: 'f-category', type: 'text', maxlength: 64, placeholder: 'e.g. platform_test' });
  const search = el('input', { id: 'f-q', type: 'search', maxlength: 120, placeholder: 'Search messages' });
  const since = el('input', { id: 'f-since', type: 'datetime-local' });
  const pageSize = el('select', { id: 'f-size' }, PAGE_SIZES.map((n) => el('option', { value: n, selected: n === 50 }, n + ' per page')));
  const results = el('div', { class: 'stack' });
  const pager = el('div', { class: 'pager' });

  const params = () => {
    const q = new URLSearchParams();
    const levels = LEVELS.filter((lv) => levelBoxes[lv].checked);
    if (levels.length && levels.length < LEVELS.length) q.set('level', levels.join(','));
    if (component.value) q.set('component', component.value);
    if (category.value.trim()) q.set('category', category.value.trim());
    if (search.value.trim()) q.set('q', search.value.trim());
    if (since.value) q.set('since', String(new Date(since.value).getTime() / 1000));
    q.set('limit', pageSize.value);
    q.set('offset', String(offset));
    return q.toString();
  };

  const row = (item) => {
    const details = item.details ? el('pre', { class: 'details-json' }, JSON.stringify(item.details, null, 2)) : null;
    return el('tr', { class: 'log-row' },
      el('td', { class: 'nowrap' }, fmt.time(item.timestamp)),
      el('td', null, el('span', { class: 'sev sev-' + item.severity.toLowerCase() }, item.severity)),
      el('td', null, item.component),
      el('td', { class: 'mono' }, item.category),
      el('td', { class: 'msg' }, item.message, details));
  };

  const load = async () => {
    try {
      const data = await MB.get('/api/logs?' + params());
      total = data.total;
      MB.clear(results);
      if (data.items.length === 0) {
        results.append(MB.empty('No log entries match these filters.'));
      } else {
        results.append(el('div', { class: 'table-wrap' }, el('table', null,
          el('thead', null, el('tr', null, el('th', null, 'Time'), el('th', null, 'Level'), el('th', null, 'Component'), el('th', null, 'Category'), el('th', null, 'Message'))),
          el('tbody', null, data.items.map(row)))));
      }
      const page = Math.floor(offset / Number(pageSize.value)) + 1;
      const pages = Math.max(1, Math.ceil(total / Number(pageSize.value)));
      MB.clear(pager).append(
        el('span', { class: 'muted small' }, `${total} matching entries · page ${page} of ${pages}`),
        el('div', { class: 'row' },
          MB.button('Previous', { onClick: () => { offset = Math.max(0, offset - Number(pageSize.value)); load(); } }),
          MB.button('Next', { onClick: () => { offset += Number(pageSize.value); load(); } })));
      pager.querySelectorAll('button')[0].disabled = offset === 0;
      pager.querySelectorAll('button')[1].disabled = offset + Number(pageSize.value) >= total;
    } catch (error) {
      MB.clear(results).append(MB.banner('bad', 'Could not load logs.', MB.errorText(error)));
    }
  };

  const applyFilters = () => { offset = 0; load(); };
  const filterBar = el('form', { class: 'card stack', novalidate: true },
    el('div', { class: 'toolbar' },
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Levels'), levelGroup),
      el('div', { class: 'field' }, el('label', { for: 'f-component' }, 'Component'), component),
      el('div', { class: 'field' }, el('label', { for: 'f-category' }, 'Category'), category),
      el('div', { class: 'field' }, el('label', { for: 'f-since' }, 'Since'), since),
      el('div', { class: 'field' }, el('label', { for: 'f-size' }, 'Page size'), pageSize)),
    el('div', { class: 'row' }, el('div', { class: 'field', style: null }, search), el('button', { class: 'btn primary', type: 'submit' }, 'Apply filters'),
      el('button', { class: 'btn ghost', type: 'button', onClick: () => { search.value = ''; category.value = ''; component.value = ''; since.value = ''; applyFilters(); } }, 'Reset')));
  filterBar.addEventListener('submit', (e) => { e.preventDefault(); applyFilters(); });
  pageSize.addEventListener('change', applyFilters);

  const purge = el('button', { class: 'btn danger', type: 'button' }, 'Clear all logs');
  purge.addEventListener('click', async () => {
    if (!window.confirm('Delete every stored operational log entry? This cannot be undone.')) return;
    const data = await MB.del('/api/logs');
    MB.toast(`Deleted ${data.removed} entries.`, 'success');
    applyFilters();
  });

  MB.clear(view).append(
    el('div', { class: 'view-head' },
      el('div', null, el('h2', null, 'Operational logs'),
        el('p', null, 'Redacted service events only. Retention is enforced in the background. Messages and files are never logged.')),
      purge),
    filterBar,
    results,
    pager);
  load();
});
