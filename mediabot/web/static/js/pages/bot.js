MB.ready(() => {
  'use strict';
  const { el, fmt } = MB;
  const view = document.getElementById('view');

  const statusCard = el('section', { class: 'card' });
  const tokenCard = el('section', { class: 'card' });
  const healthCard = el('section', { class: 'card' });
  const platformCard = el('section', { class: 'card' });
  const jobsCard = el('section', { class: 'card' });
  const serviceCard = el('section', { class: 'card' });

  const renderStatus = (bot) => {
    const start = MB.button('Start', { kind: 'primary', disabled: bot.status === 'running' || bot.status === 'starting' || !bot.token.configured,
      onClick: async () => { await MB.post('/api/bot/start'); MB.toast('Bot start requested.', 'success'); refresh(); } });
    const stop = MB.button('Stop', { disabled: bot.status === 'stopped' || bot.status === 'not_configured',
      onClick: async () => { await MB.post('/api/bot/stop'); MB.toast('Bot stopped.', 'success'); refresh(); } });
    const restart = MB.button('Restart', { disabled: !bot.token.configured,
      onClick: async () => { await MB.post('/api/bot/restart'); MB.toast('Bot restarted.', 'success'); refresh(); } });
    const testApi = MB.button('Test Telegram API', { disabled: !bot.token.configured,
      onClick: async () => {
        const data = await MB.post('/api/bot/test-api');
        const c = data.check;
        MB.toast(`${c.title}: ${c.message}`, c.status === 'healthy' ? 'success' : 'error');
        refresh();
      } });
    MB.clear(statusCard).append(
      el('div', { class: 'card-head' },
        el('div', null, el('h2', null, 'Bot process'),
          el('p', null, 'Long polling. Runs inside this service; no webhook is used.')),
        MB.badge(bot.status)),
      el('dl', { class: 'kv' },
        el('dt', null, 'Username'), el('dd', null, bot.username ? '@' + bot.username : '—'),
        el('dt', null, 'Started'), el('dd', null, fmt.time(bot.started_at)),
        el('dt', null, 'Last successful API call'), el('dd', null, fmt.time(bot.last_api_ok_at)),
        el('dt', null, 'Last error'), el('dd', null, bot.last_error ? bot.last_error + ' (' + fmt.ago(bot.last_error_at) + ')' : 'None')),
      bot.enable_bot ? null : MB.banner('warn', 'Bot disabled', 'ENABLE_BOT is false, so the bot does not run in this process.'),
      el('div', { class: 'row' }, start, stop, restart, testApi));
  };

  const renderToken = (bot) => {
    const token = bot.token;
    const input = el('input', { id: 'token', type: 'password', autocomplete: 'off', spellcheck: false, maxlength: 200,
      placeholder: '123456789:AA…', disabled: !token.editable });
    const save = el('button', { class: 'btn primary', type: 'button', disabled: !token.editable }, 'Save token');
    const remove = el('button', { class: 'btn danger', type: 'button', disabled: !token.editable || !token.configured }, 'Remove token');
    save.addEventListener('click', async () => {
      if (!input.value.trim()) { MB.setFieldErrors(form, { token: 'Paste the token from BotFather.' }); return; }
      save.disabled = true;
      try {
        await MB.put('/api/bot/token', { token: input.value.trim() });
        input.value = '';
        MB.toast('Token saved. The bot is restarting with it.', 'success');
        renderAll();
      } catch (error) {
        MB.setFieldErrors(form, { token: error.message });
        MB.toast(MB.errorText(error), 'error');
      } finally { save.disabled = false; }
    });
    remove.addEventListener('click', async () => {
      if (!window.confirm('Remove the bot token? The bot will stop until a new token is saved.')) return;
      await MB.del('/api/bot/token');
      MB.toast('Token removed.', 'success');
      renderAll();
    });
    const form = el('form', { class: 'form', novalidate: true },
      el('div', { class: 'field', 'data-field': 'token' },
        el('label', { for: 'token' }, 'Bot token'),
        input,
        el('p', { class: 'help' }, token.source === 'environment'
          ? 'Set through the BOT_TOKEN environment variable. Change it there and restart the service.'
          : 'Stored encrypted with APP_SECRET_KEY. The full value is never shown again.'),
        el('p', { class: 'field-msg', role: 'alert' })),
      el('div', { class: 'row' }, save, remove));
    MB.clear(tokenCard).append(
      el('div', { class: 'card-head' },
        el('div', null, el('h2', null, 'Bot token'), el('p', null, 'From @BotFather. Never shared with the browser after saving.')),
        el('span', { class: 'mono small' }, token.configured ? token.masked : 'No token')),
      el('p', { class: 'muted small' }, 'Source: ' + (token.source === 'environment' ? 'environment (read-only here)' : token.source === 'panel' ? 'saved in the panel' : 'not configured')),
      form);
  };

  const renderHealth = (checks) => {
    const run = MB.button('Run all checks', { kind: 'primary', onClick: async () => { await MB.post('/api/health/run'); MB.toast('Checks finished.', 'success'); refreshHealth(); } });
    const rows = checks.checks.length === 0 ? MB.empty('No checks have run yet.') : el('div', null, checks.checks.map((c) => el('div', { class: 'check-row' },
      MB.badge(c.status),
      el('div', null, el('strong', null, c.title), el('span', { class: 'sub' }, c.message),
        el('span', { class: 'sub' }, 'Checked ' + fmt.ago(c.checked_at) + (c.last_success_at ? ' · last success ' + fmt.ago(c.last_success_at) : ''))),
      MB.button('Run', { onClick: async () => { await MB.post(`/api/health/${c.check_id}/run`); refreshHealth(); } }))));
    MB.clear(healthCard).append(
      el('div', { class: 'card-head' }, el('div', null, el('h2', null, 'Health checks'),
        el('p', null, 'Each check runs for real and times out after 45 seconds.')), run),
      rows);
  };

  const renderPlatforms = (items) => {
    const rows = items.length === 0 ? MB.empty('No platforms configured.') : el('div', { class: 'list' }, items.map((p) => el('div', { class: 'list-item' },
      el('div', { class: 'main-col' }, el('strong', null, p.name), el('span', { class: 'sub' }, p.adapter_name + ' · ' + (p.last_test_message || 'Not tested yet'))),
      el('div', { class: 'row' }, MB.badge(p.enabled && p.last_test_status !== 'healthy' ? 'enabled_unverified' : p.enabled ? 'healthy' : 'disabled'),
        MB.button('Live test', { onClick: async () => {
          const data = await MB.post(`/api/platforms/${encodeURIComponent(p.key)}/test`);
          MB.toast(`${p.name}: ${data.result.message}`, data.result.status === 'healthy' ? 'success' : 'error');
          refreshPlatforms();
        } })))));
    MB.clear(platformCard).append(
      el('div', { class: 'card-head' }, el('div', null, el('h2', null, 'Platform live tests'),
        el('p', null, 'Runs the adapter against its test URL. Failed tests disable an enabled platform.')),
        el('a', { class: 'btn small ghost', href: '/platforms' }, 'Manage platforms')),
      rows);
  };

  const renderJobs = (jobs) => {
    const cancel = (id) => MB.button('Cancel', { kind: 'danger', onClick: async () => { await MB.post(`/api/bot/jobs/${id}/cancel`); MB.toast('Cancellation requested.', 'info'); refreshJobs(); } });
    const rows = jobs.active.map((j) => el('tr', null,
      el('td', { class: 'mono' }, j.job_id),
      el('td', null, j.platform),
      el('td', null, j.stage),
      el('td', null, String(j.attempt)),
      el('td', { class: 'nowrap' }, fmt.duration(j.running_seconds)),
      el('td', null, el('div', { class: 'actions' }, cancel(j.job_id)))));
    const table = rows.length === 0
      ? MB.empty('No downloads are running.')
      : el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', null, 'Job'), el('th', null, 'Platform'), el('th', null, 'Stage'),
          el('th', null, 'Attempt'), el('th', null, 'Running'), el('th', null, ''))),
        el('tbody', null, rows)));
    MB.clear(jobsCard).append(
      el('div', { class: 'card-head' }, el('div', null, el('h2', null, 'Download queue'),
        el('p', null, `${jobs.queued} queued (limit ${jobs.max_queue_length}) · ${jobs.workers_alive}/${jobs.workers_configured} workers alive · ${jobs.completed} completed · ${jobs.failed} failed`))),
      table);
  };

  const renderService = (bot) => {
    const confirmInput = el('input', { id: 'restart-confirm', type: 'text', autocomplete: 'off', placeholder: 'RESTART' });
    const button = el('button', { class: 'btn danger', type: 'button' }, 'Restart service');
    button.addEventListener('click', async () => {
      try {
        const data = await MB.post('/api/system/restart', { confirm: confirmInput.value.trim() });
        MB.clear(serviceCard).append(MB.banner(data.supervised ? 'info' : 'warn', 'Restart requested', data.message));
      } catch (error) {
        MB.toast(MB.errorText(error), 'error');
      }
    });
    MB.clear(serviceCard).append(
      el('div', { class: 'card-head' }, el('div', null, el('h2', null, 'Service restart'),
        el('p', null, 'Stops polling, drains running jobs, then exits with code 75. A supervisor restarts it.'))),
      el('div', { class: 'toolbar' }, el('div', { class: 'field' }, el('label', { for: 'restart-confirm' }, 'Type RESTART to confirm'), confirmInput), button),
      bot.restart_supervised ? el('p', { class: 'muted small' }, 'A supervisor is configured (RESTART_SUPERVISED=true).')
        : MB.banner('warn', 'No supervisor configured', 'Without Docker restart policy or systemd, the service will not come back by itself.'));
  };

  const refreshStatus = async () => {
    const bot = await MB.get('/api/bot/status');
    renderStatus(bot);
    return bot;
  };
  const refreshHealth = async () => renderHealth(await MB.get('/api/health'));
  const refreshPlatforms = async () => renderPlatforms((await MB.get('/api/platforms')).items);
  const refreshJobs = async () => renderJobs(await MB.get('/api/bot/jobs'));
  const refresh = async () => {
    const bot = await refreshStatus();
    renderToken(bot);
    await Promise.all([refreshJobs(), refreshHealth(), refreshPlatforms()]);
    renderService(bot);
  };
  const renderAll = refresh;

  MB.clear(view).append(
    el('div', { class: 'view-head' }, el('div', null, el('h2', null, 'Bot and health'),
      el('p', null, 'Live status, token management, health checks and queue control.'))),
    el('div', { class: 'grid-2' }, statusCard, tokenCard),
    el('div', { class: 'grid-2' }, healthCard, platformCard),
    jobsCard,
    serviceCard);
  MB.clear(healthCard).append(MB.loading('Loading checks…'));
  MB.clear(platformCard).append(MB.loading('Loading platforms…'));
  MB.clear(jobsCard).append(MB.loading('Loading jobs…'));
  refresh().catch((error) => MB.toast(MB.errorText(error), 'error'));
  MB.every(() => { refreshStatus().catch(() => {}); refreshJobs().catch(() => {}); }, 8000);
});
