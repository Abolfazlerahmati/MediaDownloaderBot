MB.ready(() => {
  'use strict';
  const { el, fmt } = MB;
  const view = document.getElementById('view');
  let loadedOnce = false;

  const statCard = (label, valueNode, sub) => el('div', { class: 'card stat' },
    el('span', { class: 'stat-label' }, label), valueNode, sub ? el('span', { class: 'stat-sub' }, sub) : null);

  const meter = (percent, label) => {
    const level = percent === null || percent === undefined ? '' : percent >= 90 ? ' bad' : percent >= 75 ? ' warn' : '';
    const bar = el('div', { class: 'meter' + level, role: 'progressbar', 'aria-label': label,
      'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(percent || 0) }, el('span'));
    bar.firstChild.style.width = Math.min(100, Math.max(0, percent || 0)) + '%';
    return bar;
  };

  const platformState = (item) => {
    if (!item.enabled) return 'disabled';
    return item.status === 'healthy' ? 'healthy' : 'enabled_unverified';
  };

  const render = (data) => {
    const bot = data.bot;
    const botStatus = bot.status;
    const botCard = statCard('Bot', el('div', null, MB.badge(botStatus)),
      bot.username ? '@' + bot.username : (bot.message || ''));
    const apiCard = statCard('Telegram API', el('div', null, MB.badge(data.telegram_api.status)),
      data.telegram_api.last_successful_test_at ? 'Last success ' + fmt.ago(data.telegram_api.last_successful_test_at) : data.telegram_api.message);
    const workers = data.workers;
    const workerCard = statCard('Download workers',
      el('div', { class: 'stat-value' }, `${workers.alive}/${workers.configured}`),
      `${workers.completed} completed · ${workers.failed} failed since start`);
    const queue = data.queue;
    const queueCard = statCard('Queue',
      el('div', { class: 'stat-value' }, `${queue.queued}`),
      `of ${queue.limit} maximum · ${data.active_downloads.length} active`);
    const p = data.platforms;
    const platformCard = statCard('Verified platforms',
      el('div', { class: 'stat-value' }, `${p.verified}/${p.enabled}`),
      `${p.enabled} enabled of ${p.total} configured`);
    const uptimeCard = statCard('Uptime', el('div', { class: 'stat-value' }, fmt.duration(data.app.uptime_seconds)),
      `v${data.app.version} · yt-dlp ${data.app.ytdlp_version || 'missing'}`);

    const res = data.resources;
    const resourceRows = [
      ['CPU', res.cpu_percent === null ? null : res.cpu_percent, res.cpu_percent === null ? 'Unavailable' : res.cpu_percent.toFixed(0) + '%'],
      ['Memory', res.memory ? res.memory.percent : null, res.memory ? `${res.memory.used_mb} of ${res.memory.total_mb} MB` : 'Unavailable (psutil)'],
      ['Disk (data directory)', res.disk ? res.disk.percent : null, res.disk ? `${res.disk.used_gb} of ${res.disk.total_gb} GB` : 'Unavailable'],
    ];
    const resourcesCard = el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Resources'), el('span', { class: 'muted small' }, 'Live sample')),
      el('div', { class: 'stack' }, resourceRows.map(([label, pct, text]) =>
        el('div', { class: 'stack' },
          el('div', { class: 'row' }, el('span', { class: 'field-label' }, label), el('span', { class: 'spacer' }), el('span', { class: 'muted small' }, text)),
          pct === null ? el('div', { class: 'meter' }) : meter(pct, label)))),
      el('p', { class: 'muted small' }, res.temp ? `Temporary files in use: ${res.temp.used_mb} MB` : 'Temporary file usage unavailable.'));

    const active = data.active_downloads;
    const activeCard = el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Active downloads'), el('a', { class: 'btn small ghost', href: '/bot' }, 'Manage jobs')),
      active.length === 0
        ? MB.empty('No downloads are running right now.')
        : el('div', { class: 'table-wrap' }, el('table', null,
          el('thead', null, el('tr', null, el('th', null, 'Job'), el('th', null, 'Platform'), el('th', null, 'Stage'), el('th', null, 'Running'))),
          el('tbody', null, active.map((job) => el('tr', null,
            el('td', { class: 'mono' }, job.job_id),
            el('td', null, job.platform),
            el('td', null, job.stage),
            el('td', { class: 'nowrap' }, fmt.duration(job.running_seconds))))))));

    const platformList = el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Platforms'), el('a', { class: 'btn small ghost', href: '/platforms' }, 'Manage')),
      p.items.length === 0 ? MB.empty('No platforms configured.') : el('div', { class: 'list' }, p.items.map((item) => el('div', { class: 'list-item' },
        el('div', { class: 'main-col' }, el('strong', null, item.name), el('span', { class: 'sub mono' }, item.key)),
        el('div', { class: 'row' }, MB.badge(platformState(item)))))));

    const problems = data.recent_errors;
    const problemsCard = el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Recent problems'), el('a', { class: 'btn small ghost', href: '/diagnostics' }, 'Diagnostics')),
      problems.length === 0 ? MB.empty('No warnings or errors in the last 24 hours.') : el('div', { class: 'list' }, problems.map((item) => el('div', { class: 'list-item' },
        el('div', { class: 'main-col' },
          el('span', { class: 'sev sev-' + item.severity.toLowerCase() }, item.severity), ' ',
          el('strong', null, item.explanation),
          el('span', { class: 'sub' }, fmt.time(item.timestamp) + ' · ' + item.component + ' · ' + item.category))))));

    const stamp = el('p', { class: 'muted small' }, 'Updated ' + new Date().toLocaleTimeString() + ' · refreshes every 10 seconds');
    MB.clear(view).append(
      el('div', { class: 'view-head' }, el('div', null, el('h2', null, 'Overview'), el('p', null, 'Live status from this process. Nothing here is simulated.')), stamp),
      el('div', { class: 'grid' }, botCard, apiCard, workerCard, queueCard, platformCard, uptimeCard),
      el('div', { class: 'grid-2' }, resourcesCard, platformList),
      el('div', { class: 'grid-2' }, activeCard, problemsCard),
      data.bot.status === 'error' ? MB.banner('bad', 'The bot is not polling Telegram.', data.bot.message || 'Open Bot & health for details.') : null,
    );
  };

  const load = async () => {
    try {
      const data = await MB.get('/api/dashboard');
      render(data);
      loadedOnce = true;
    } catch (error) {
      if (!loadedOnce) MB.clear(view).append(MB.banner('bad', 'Could not load the dashboard.', MB.errorText(error)));
    }
  };

  MB.clear(view).append(MB.loading('Loading live status…'));
  load();
  MB.every(load, 10000);
});
