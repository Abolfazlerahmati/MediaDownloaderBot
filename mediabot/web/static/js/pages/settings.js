MB.ready(() => {
  'use strict';
  const { el } = MB;
  const view = document.getElementById('view');
  let state = null; // { values, schema, pending_restart, languages }
  const controls = {};

  const describe = (field) => {
    const meta = [];
    if (field.unit) meta.push('Unit: ' + field.unit);
    if (field.min !== null && field.min !== undefined) meta.push('min ' + field.min);
    if (field.max !== null && field.max !== undefined) meta.push('max ' + field.max);
    return meta.join(' · ');
  };

  const buildControl = (field, value) => {
    const id = 'set-' + field.key;
    switch (field.kind) {
      case 'bool': {
        const input = el('input', { id, type: 'checkbox', checked: value === true });
        controls[field.key] = { input, kind: 'bool', original: value };
        return el('label', { class: 'switch' }, input, el('span', { class: 'track', 'aria-hidden': 'true' }), el('span', null, value ? 'On' : 'Off'));
      }
      case 'int': {
        const input = el('input', { id, type: 'number', step: 1, value: String(value) });
        if (field.min !== null && field.min !== undefined) input.min = field.min;
        if (field.max !== null && field.max !== undefined) input.max = field.max;
        controls[field.key] = { input, kind: 'int', original: value };
        return input;
      }
      case 'choice': {
        const input = el('select', { id }, field.choices.map((c) => el('option', { value: c, selected: c === value }, c)));
        controls[field.key] = { input, kind: 'choice', original: value };
        return input;
      }
      case 'list': {
        const input = el('input', { id, type: 'text', value: (value || []).join(', ') });
        controls[field.key] = { input, kind: 'list', original: value };
        return input;
      }
      case 'text': {
        const input = el('input', { id, type: 'text', value: value ?? '', maxlength: 500 });
        controls[field.key] = { input, kind: 'text', original: value };
        return input;
      }
      default: {
        const input = el('textarea', { id, rows: 4, spellcheck: false }, JSON.stringify(value ?? {}, null, 2));
        controls[field.key] = { input, kind: 'json', original: value };
        return input;
      }
    }
  };

  const convert = (entry) => {
    const { input, kind } = entry;
    if (kind === 'bool') return input.checked;
    if (kind === 'int') {
      if (input.value.trim() === '') throw new MB.ApiError(422, 'Enter a number.', {});
      return Number(input.value);
    }
    if (kind === 'list') return input.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (kind === 'json') return JSON.parse(input.value || '{}');
    return input.value;
  };

  const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const render = () => {
    for (const key of Object.keys(controls)) delete controls[key];
    const groups = new Map();
    for (const field of state.schema) {
      if (!groups.has(field.group)) groups.set(field.group, []);
      groups.get(field.group).push(field);
    }
    const sections = [];
    for (const [group, fields] of groups) {
      sections.push(el('section', { class: 'form-section' },
        el('h3', null, group),
        el('div', { class: 'form-grid' }, fields.map((field) => {
          const value = state.values[field.key];
          const label = el('label', { for: 'set-' + field.key }, field.label,
            field.restart_required ? el('span', { class: 'badge badge-warn', style: null }, 'Restart required') : null);
          const hint = [field.help, describe(field)].filter(Boolean).join(' ');
          return el('div', { class: 'field', 'data-field': field.key },
            field.kind === 'bool' ? el('span', { class: 'field-label' }, field.label, field.restart_required ? el('span', { class: 'badge badge-warn' }, 'Restart required') : null) : label,
            buildControl(field, value),
            hint ? el('p', { class: 'help' }, hint) : null,
            el('p', { class: 'field-msg', role: 'alert' }));
        }))));
    }

    const pending = state.pending_restart.length
      ? MB.banner('warn', 'Restart needed', 'Saved, but these settings apply after a restart: ' + state.pending_restart.join(', ') + '.')
      : null;
    const save = el('button', { class: 'btn primary', type: 'submit' }, 'Save settings');
    const reset = el('button', { class: 'btn ghost', type: 'button' }, 'Discard changes');
    const form = el('form', { class: 'stack', novalidate: true },
      el('section', { class: 'card' }, sections),
      el('div', { class: 'row' }, save, reset, el('span', { class: 'muted small' }, 'Only changed fields are saved. Values are validated on the server.')));
    reset.addEventListener('click', () => load());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      MB.setFieldErrors(form, {});
      const changes = {};
      const localErrors = {};
      for (const [key, entry] of Object.entries(controls)) {
        try {
          const value = convert(entry);
          if (!sameValue(value, entry.original)) changes[key] = value;
        } catch (error) {
          localErrors[key] = error instanceof SyntaxError ? 'Invalid JSON.' : 'Enter a valid value.';
        }
      }
      if (Object.keys(localErrors).length) {
        MB.setFieldErrors(form, localErrors);
        MB.toast('Please correct the highlighted settings.', 'error');
        return;
      }
      if (Object.keys(changes).length === 0) { MB.toast('No changes to save.', 'info'); return; }
      save.disabled = true;
      try {
        const data = await MB.put('/api/settings', { changes });
        MB.toast(`Saved ${data.changed.length} setting(s).`, 'success');
        await load(true);
      } catch (error) {
        MB.setFieldErrors(form, error.fields || {});
        const extra = error.fields && Object.keys(error.fields).filter((k) => !controls[k]);
        MB.toast(extra && extra.length ? error.message + ' ' + extra.join(', ') : error.message, 'error');
      } finally {
        save.disabled = false;
      }
    });
    MB.clear(view).append(
      el('div', { class: 'view-head' }, el('div', null, el('h2', null, 'Runtime settings'),
        el('p', null, 'Changes take effect immediately unless marked “Restart required”. Stored in the database.'))),
      pending,
      form);
  };

  const load = async (keepScroll) => {
    const y = keepScroll ? window.scrollY : 0;
    state = await MB.get('/api/settings');
    render();
    if (keepScroll) window.scrollTo(0, y);
  };

  MB.clear(view).append(MB.loading('Loading settings…'));
  load().catch((error) => MB.clear(view).append(MB.banner('bad', 'Could not load settings.', MB.errorText(error))));
});
