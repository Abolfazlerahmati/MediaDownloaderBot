MB.ready(() => {
  'use strict';
  const { el, fmt } = MB;
  const view = document.getElementById('view');

  const integration = (item) => (item.enabled && item.last_test_status !== 'healthy' ? 'enabled_unverified'
    : item.enabled ? 'healthy' : 'disabled');

  const actionButtons = (item, reload) => {
    const toggle = MB.button(item.enabled ? 'Disable' : 'Enable', {
      kind: item.enabled ? '' : 'primary',
      disabled: !item.enabled && item.last_test_status !== 'healthy',
      title: !item.enabled && item.last_test_status !== 'healthy' ? 'Run a successful live test before enabling' : undefined,
      onClick: async () => {
        await MB.post(`/api/platforms/${encodeURIComponent(item.key)}/enable`, { enabled: !item.enabled });
        MB.toast(item.enabled ? `${item.name} disabled.` : `${item.name} enabled.`, 'success');
        reload();
      },
    });
    const test = MB.button('Live test', {
      onClick: async () => {
        const data = await MB.post(`/api/platforms/${encodeURIComponent(item.key)}/test`);
        MB.toast(`${item.name}: ${data.result.status} — ${data.result.message}`, data.result.status === 'healthy' ? 'success' : 'error');
        reload();
      },
    });
    const remove = MB.button('Remove', {
      kind: 'danger',
      onClick: async () => {
        if (!window.confirm(`Remove ${item.name}? Its configuration is deleted.`)) return;
        await MB.del(`/api/platforms/${encodeURIComponent(item.key)}`);
        MB.toast(`${item.name} removed.`, 'success');
        reload();
      },
    });
    return el('div', { class: 'actions' }, test, toggle, el('a', { class: 'btn small ghost', href: `/platforms/${encodeURIComponent(item.key)}` }, 'Edit'), remove);
  };

  const render = (items, reload) => {
    const header = el('div', { class: 'view-head' },
      el('div', null, el('h2', null, 'Platforms'),
        el('p', null, 'Platforms are disabled until a live test passes. Changing a platform’s configuration disables it until it is tested again.')),
      el('a', { class: 'btn primary', href: '/platforms/new' }, 'Add platform'));
    const body = items.length === 0
      ? MB.empty('No platforms yet. Add one to start accepting links.')
      : el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null,
          el('th', null, 'Platform'), el('th', null, 'Adapter'), el('th', null, 'Domains'), el('th', null, 'Media'),
          el('th', null, 'Status'), el('th', null, 'Last test'), el('th', null, 'Actions'))),
        el('tbody', null, items.map((item) => el('tr', null,
          el('td', null, el('strong', null, item.name), el('span', { class: 'sub mono' }, item.key)),
          el('td', null, item.adapter_name),
          el('td', { class: 'break' }, item.domains.join(', ') || '—'),
          el('td', null, item.allowed_media_types.join(', ')),
          el('td', null, MB.badge(integration(item)), item.last_test_message ? el('span', { class: 'sub' }, item.last_test_message) : null),
          el('td', { class: 'nowrap' }, fmt.ago(item.last_test_at)),
          el('td', null, actionButtons(item, reload)))))));
    MB.clear(view).append(header, body);
  };

  const load = async () => {
    const data = await MB.get('/api/platforms');
    render(data.items, load);
  };

  MB.clear(view).append(MB.loading('Loading platforms…'));
  load().catch((error) => MB.clear(view).append(MB.banner('bad', 'Could not load platforms.', MB.errorText(error))));
});
