// Worker entry point: routes the webhook, the admin panel pages, the JSON API, static assets, and the hourly cron.
import type { Env } from './env';
import { ensureSchema, type Db } from './db/schema';
import { getSettings, pruneOldRows } from './db/store';
import { handleWebhook } from './webhook';
import { handleApi } from './web/api';
import { currentAuth } from './web/session';
import { shell, type PageName } from './web/pages';
import { apiError, html, json, redirect } from './web/http';
import { WEBHOOK_PATH } from './web/bot-admin';

const PAGES: Record<string, PageName> = {
  '/': 'dashboard',
  '/settings': 'settings',
  '/platforms': 'platforms',
  '/bot': 'bot',
  '/logs': 'logs',
  '/diagnostics': 'diagnostics',
  '/account': 'account',
  '/login': 'login',
};

async function handlePage(request: Request, env: Env, db: Db, now: number, path: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'method_not_allowed', 'Use GET.');
  const page = PAGES[path];
  if (!page) return html('<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found.</p>', 404);

  const auth = await currentAuth(db, request, now);
  if (page === 'login') {
    if (auth) return redirect('/');
    return html(shell({ page: 'login' }));
  }
  if (!auth) return redirect('/login');
  const mustChange = auth.user.must_change_password === 1;
  if (mustChange && page !== 'account') return redirect('/account');
  return html(
    shell({
      page,
      csrf: auth.csrf,
      theme: auth.user.appearance_theme,
      mode: auth.user.appearance_mode,
      lang: auth.user.appearance_lang,
      restricted: mustChange,
    }),
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === WEBHOOK_PATH) {
        if (request.method !== 'POST') return apiError(405, 'method_not_allowed', 'Use POST.');
        return await handleWebhook(request, env, ctx);
      }
      if (path === '/health' && request.method === 'GET') {
        return json({ ok: true, service: 'mediadownloaderbot' });
      }
      if (path.startsWith('/static/')) {
        if (!env.ASSETS || (request.method !== 'GET' && request.method !== 'HEAD')) return apiError(404, 'not_found', 'Not found.');
        return env.ASSETS.fetch(request);
      }

      const now = Date.now();
      try {
        await ensureSchema(env.DB, now);
      } catch {
        return apiError(503, 'database_unavailable', 'The database is not ready. Check the D1 binding in the Cloudflare dashboard.');
      }

      if (path.startsWith('/api/')) {
        return await handleApi({ env, db: env.DB, request, url, now });
      }
      return await handlePage(request, env, env.DB, now, path);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      console.error(JSON.stringify({ event: 'request_failed', name }));
      return apiError(500, 'internal', 'Something went wrong. The details were written to the log without secrets.');
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        await ensureSchema(env.DB, now);
        const settings = await getSettings(env.DB);
        await pruneOldRows(env.DB, now, settings);
      })().catch((error: unknown) => {
        const name = error instanceof Error ? error.name : 'unknown';
        console.error(JSON.stringify({ event: 'maintenance_failed', name }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
