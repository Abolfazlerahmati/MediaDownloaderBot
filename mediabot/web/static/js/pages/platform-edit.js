MB.ready(async () => {
  'use strict';
  const { el, fmt } = MB;
  const view = document.getElementById('view');
  const pathKey = location.pathname.startsWith('/platforms/new') ? null : decodeURIComponent(location.pathname.split('/').pop());
  const isNew = pathKey === null;
  const MEDIA = ['video', 'audio', 'image'];

  const lines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean);
  const numberOrNull = (input) => (input.value.trim() === '' ? null : Number(input.value));

  const fieldWrap = (name, label, control, help) => el('div', { class: 'field', 'data-field': name },
    el('label', { for: 'f-' + name }, label), control, help ? el('p', { class: 'help' }, help) : null, el('p', { class: 'field-msg', role: 'alert' }));

  let catalog;
  let record = null;
  try {
    [catalog, record] = await Promise.all([
      MB.get('/api/platforms/catalog'),
      isNew ? null : MB.get(`/api/platforms/${encodeURIComponent(pathKey)}`),
    ]);
  } catch (error) {
    MB.clear(view).append(MB.banner('bad', 'Could not load this platform.', MB.errorText(error)));
    return;
  }

  const inputs = {};
  const mediaBoxes = {};
  const optionInputs = {};

  const adapterSelect = el('select', { id: 'f-adapter', name: 'adapter' },
    catalog.adapters.map((a) => el('option', { value: a.adapter }, a.display_name)));
  inputs.adapter = adapterSelect;
  inputs.key = el('input', { id: 'f-key', name: 'key', type: 'text', maxlength: 32, autocomplete: 'off', value: record ? record.key : '', readonly: !isNew, required: true });
  inputs.name = el('input', { id: 'f-name', name: 'name', type: 'text', maxlength: 64, value: record ? record.name : '' });
  inputs.domains = el('textarea', { id: 'f-domains', name: 'domains', rows: 3 });
  inputs.url_patterns = el('textarea', { id: 'f-url_patterns', name: 'url_patterns', rows: 2 });
  inputs.max_file_size_mb = el('input', { id: 'f-max_file_size_mb', type: 'number', min: 1, max: 50, step: 1 });
  inputs.max_duration_seconds = el('input', { id: 'f-max_duration_seconds', type: 'number', min: 1, max: 86400, step: 1 });
  inputs.max_height = el('input', { id: 'f-max_height', type: 'number', min: 144, max: 4320, step: 1 });
  inputs.format_selector = el('input', { id: 'f-format_selector', type: 'text', maxlength: 200, autocomplete: 'off' });
  inputs.test_url = el('input', { id: 'f-test_url', type: 'url', maxlength: 2048, autocomplete: 'off' });
  inputs.thumbnails_enabled = el('input', { id: 'f-thumbnails_enabled', type: 'checkbox' });

  const optionsBox = el('div', { class: 'form-grid' });

  const renderOptions = (adapterKey, currentOptions) => {
    MB.clear(optionsBox);
    for (const key of Object.keys(optionInputs)) delete optionInputs[key];
    const info = catalog.adapters.find((a) => a.adapter === adapterKey);
    if (!info || info.options.length === 0) {
      optionsBox.append(el('p', { class: 'muted small' }, 'This adapter has no extra options.'));
      return;
    }
    for (const spec of info.options) {
      const name = 'options.' + spec.key;
      const current = currentOptions && spec.key in currentOptions ? currentOptions[spec.key] : spec.default;
      let control;
      if (spec.kind === 'bool') {
        control = el('label', { class: 'check' },
          el('input', { id: 'f-' + name, type: 'checkbox', checked: current === true }), el('span', null, spec.label));
        optionInputs[spec.key] = control.querySelector('input');
        optionsBox.append(el('div', { class: 'field', 'data-field': name }, control,
          el('p', { class: 'help' }, spec.help || ''), el('p', { class: 'field-msg', role: 'alert' })));
      } else {
        control = el('select', { id: 'f-' + name, name }, spec.choices.map((c) => el('option', { value: c, selected: c === current }, c)));
        optionInputs[spec.key] = control;
        optionsBox.append(fieldWrap(name, spec.label, control, spec.help));
      }
    }
  };

  // Populate initial values
  if (record) {
    inputs.adapter.value = record.adapter;
    inputs.domains.value = record.domains.join('\n');
    inputs.url_patterns.value = record.url_patterns.join('\n');
    inputs.max_file_size_mb.value = record.max_file_size_mb ?? '';
    inputs.max_duration_seconds.value = record.max_duration_seconds ?? '';
    inputs.max_height.value = record.max_height ?? '';
    inputs.format_selector.value = record.format_selector ?? '';
    inputs.test_url.value = record.test_url ?? '';
    inputs.thumbnails_enabled.checked = record.thumbnails_enabled;
  }
  const initialAdapter = record ? record.adapter : catalog.adapters[0].adapter;
  if (!record) inputs.adapter.value = initialAdapter;
  renderOptions(initialAdapter, record ? record.options : null);

  inputs.adapter.addEventListener('change', () => {
    const info = catalog.adapters.find((a) => a.adapter === inputs.adapter.value);
    if (!inputs.domains.value.trim() && info) inputs.domains.value = info.default_domains.join('\n');
    renderOptions(inputs.adapter.value, null);
  });

  const mediaSet = new Set(record ? record.allowed_media_types : ['video', 'audio']);
  const mediaGroup = el('div', { class: 'check-group' }, MEDIA.map((m) => {
    const box = el('input', { type: 'checkbox', value: m, checked: mediaSet.has(m) });
    mediaBoxes[m] = box;
    return el('label', { class: 'check' }, box, el('span', null, m[0].toUpperCase() + m.slice(1)));
  }));

  const collect = () => {
    const options = {};
    for (const [key, input] of Object.entries(optionInputs)) {
      options[key] = input.type === 'checkbox' ? input.checked : input.value;
    }
    return {
      key: isNew ? inputs.key.value.trim() : record.key,
      name: inputs.name.value.trim(),
      adapter: isNew ? inputs.adapter.value : record.adapter,
      domains: lines(inputs.domains.value),
      url_patterns: lines(inputs.url_patterns.value),
      allowed_media_types: MEDIA.filter((m) => mediaBoxes[m].checked),
      max_file_size_mb: numberOrNull(inputs.max_file_size_mb),
      max_duration_seconds: numberOrNull(inputs.max_duration_seconds),
      max_height: numberOrNull(inputs.max_height),
      format_selector: inputs.format_selector.value.trim() || null,
      thumbnails_enabled: inputs.thumbnails_enabled.checked,
      test_url: inputs.test_url.value.trim() || null,
      options,
    };
  };

  const form = el('form', { class: 'form', novalidate: true });
  const saveButton = el('button', { class: 'btn primary', type: 'submit' }, isNew ? 'Create platform' : 'Save changes');
  form.append(
    el('section', { class: 'form-section' },
      el('h3', null, 'Identity'),
      el('div', { class: 'form-grid' },
        fieldWrap('key', 'Key', inputs.key, isNew ? 'Lowercase letters, digits and underscores. Cannot be changed later.' : 'Keys cannot be changed.'),
        fieldWrap('name', 'Display name', inputs.name, 'Shown in the panel only.'),
        fieldWrap('adapter', 'Adapter', inputs.adapter, isNew ? 'The extraction logic used for this platform.' : null))),
    el('section', { class: 'form-section' },
      el('h3', null, 'Links'),
      el('div', { class: 'form-grid' },
        fieldWrap('domains', 'Domains', inputs.domains, 'One per line. Subdomains match automatically (up to 20).'),
        fieldWrap('url_patterns', 'URL patterns (optional)', inputs.url_patterns, 'Regular expressions matched against the canonical URL (up to 10).'))),
    el('section', { class: 'form-section' },
      el('h3', null, 'Media and limits'),
      el('div', { class: 'field', 'data-field': 'allowed_media_types' }, el('span', { class: 'field-label' }, 'Allowed media types'), mediaGroup, el('p', { class: 'field-msg', role: 'alert' })),
      el('div', { class: 'form-grid' },
        fieldWrap('max_file_size_mb', 'Max file size (MB)', inputs.max_file_size_mb, 'Between 1 and 50. Telegram bots cannot upload more than 50 MB.'),
        fieldWrap('max_duration_seconds', 'Max duration (seconds)', inputs.max_duration_seconds, 'Empty uses the global default.'),
        fieldWrap('max_height', 'Max video height (px)', inputs.max_height, 'Between 144 and 4320.'),
        fieldWrap('format_selector', 'Format selector (advanced)', inputs.format_selector, 'Empty uses the adapter default. yt-dlp format syntax; must not start with "-".')),
      el('div', { class: 'field', 'data-field': 'thumbnails_enabled' }, el('label', { class: 'check' }, inputs.thumbnails_enabled, el('span', null, 'Send the item’s own thumbnail where Telegram supports it')))),
    el('section', { class: 'form-section' },
      el('h3', null, 'Adapter options'), optionsBox),
    el('section', { class: 'form-section' },
      el('h3', null, 'Live test'),
      fieldWrap('test_url', 'Test URL', inputs.test_url, 'A public item used by the live test. It must match one of the domains above.')),
    el('div', { class: 'row' }, saveButton, el('a', { class: 'btn ghost', href: '/platforms' }, 'Back to platforms'))
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    MB.setFieldErrors(form, {});
    saveButton.disabled = true;
    try {
      const payload = collect();
      if (isNew) {
        await MB.post('/api/platforms', payload);
        MB.toast('Platform created. Run a live test before enabling it.', 'success');
        location.assign('/platforms/' + encodeURIComponent(payload.key));
        return;
      }
      const data = await MB.put(`/api/platforms/${encodeURIComponent(record.key)}`, payload);
      MB.toast('Saved.', 'success');
      if (data.integration_status !== record.integration_status && data.enabled === false && record.enabled) {
        MB.toast('Configuration changed, so the platform was disabled. Run a live test before enabling it.', 'info');
      }
      record = data;
      renderStatus();
    } catch (error) {
      MB.setFieldErrors(form, error.fields || {});
      MB.toast(MB.errorText(error), 'error');
    } finally {
      saveButton.disabled = false;
    }
  });

  // ---------------------------------------------------------------- status and tools
  const statusBox = el('section', { class: 'card' });
  const checkBox = el('section', { class: 'card' });

  const renderStatus = () => {
    if (isNew) { MB.clear(statusBox); return; }
    const state = record.enabled && record.last_test_status !== 'healthy' ? 'enabled_unverified'
      : record.enabled ? 'healthy' : (record.last_test_status === 'healthy' ? 'disabled' : 'untested');
    const test = MB.button('Run live test', {
      onClick: async () => {
        const data = await MB.post(`/api/platforms/${encodeURIComponent(record.key)}/test`);
        record = data.platform;
        MB.toast(`${data.result.status}: ${data.result.message}`, data.result.status === 'healthy' ? 'success' : 'error');
        renderStatus();
      },
    });
    const toggle = MB.button(record.enabled ? 'Disable' : 'Enable', {
      kind: record.enabled ? '' : 'primary',
      disabled: !record.enabled && record.last_test_status !== 'healthy',
      onClick: async () => {
        record = await MB.post(`/api/platforms/${encodeURIComponent(record.key)}/enable`, { enabled: !record.enabled });
        MB.toast(record.enabled ? 'Platform enabled.' : 'Platform disabled.', 'success');
        renderStatus();
      },
    });
    MB.clear(statusBox).append(
      el('div', { class: 'card-head' }, el('div', null, el('h2', null, 'Status'),
        el('p', null, record.last_test_message || 'No live test has run yet.')), MB.badge(state)),
      el('dl', { class: 'kv' },
        el('dt', null, 'Last test'), el('dd', null, fmt.time(record.last_test_at)),
        el('dt', null, 'Adapter'), el('dd', null, record.adapter_name)),
      el('div', { class: 'row', style: null }, test, toggle),
      record.enabled || record.last_test_status === 'healthy' ? null : el('p', { class: 'muted small' }, 'Enabling requires a successful live test.'));
  };

  const renderChecker = () => {
    const input = el('input', { id: 'check-url', type: 'url', maxlength: 2048, placeholder: 'https://…', autocomplete: 'off' });
    const result = el('div', { class: 'stack' });
    const go = el('button', { class: 'btn', type: 'button' }, 'Check URL');
    go.addEventListener('click', async () => {
      MB.clear(result);
      if (!input.value.trim()) { result.append(MB.banner('warn', '', 'Enter a URL to check.')); return; }
      if (isNew) { result.append(MB.banner('info', '', 'Save the platform first, then check URLs against it.')); return; }
      try {
        const data = await MB.post(`/api/platforms/${encodeURIComponent(record.key)}/check-url`, { url: input.value.trim() });
        result.append(el('div', { class: 'row' }, MB.badge(data.recognized ? 'healthy' : 'failed'), el('span', null, data.reason || '')));
        if (data.canonical) result.append(el('p', { class: 'mono break small' }, data.canonical));
      } catch (error) {
        result.append(MB.banner('bad', '', MB.errorText(error)));
      }
    });
    MB.clear(checkBox).append(
      el('div', { class: 'card-head' }, el('div', null, el('h2', null, 'URL checker'),
        el('p', null, 'Explains how a link would be classified. No network request is made.'))),
      el('div', { class: 'toolbar' }, el('div', { class: 'field', style: null }, el('label', { for: 'check-url' }, 'URL'), input), go),
      result);
  };

  const sideColumn = el('div', { class: 'stack' }, statusBox, checkBox);
  MB.clear(view).append(
    el('div', { class: 'view-head' }, el('div', null, el('h2', null, isNew ? 'New platform' : record.name),
      el('p', null, isNew ? 'Configure a platform. It stays disabled until a live test passes.' : 'Edit configuration, test, then enable.'))),
    el('div', { class: 'grid-2' },
      el('section', { class: 'card' }, form),
      sideColumn),
  );
  renderStatus();
  renderChecker();
});
