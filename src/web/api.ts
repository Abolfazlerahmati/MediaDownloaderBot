// JSON API for the admin panel. Every route except login needs a session. Unsafe methods also need a
// matching Origin and the CSRF token. While a password change is pending, only the auth routes work.
import type { Env } from '../env';
import type { Db } from '../db/schema';
import {
  addLoginFailure,
  anyUserMustChangePassword,
  clearLoginFailures,
  countEventsSince,
  countLoginFailures,
  deleteOtherSessions,
  deleteSession,
  getPlatform,
  getSettings,
  getUserByName,
  listPlatforms,
  recordPlatformTest,
  saveSettings,
  searchLogs,
  setAppearance,
  setPlatformEnabled,
  setPlatformSample,
  setState,
  updatePassword,
  writeLog,
  type PlatformRow,
} from '../db/store';
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from '../limits';
import { hashPassword, sha256Hex, verifyPassword } from '../security/crypto';
import { classifyUrl } from '../platforms';
import { resolveMedia } from '../extractors';
import { deleteWebhook, getMe, getWebhookInfo, setWebhook, TelegramError } from '../telegram';
import { DEFAULT_SETTINGS, SETTING_DEFS, validateChanges } from '../settings';
import { BodyError, apiError, json, readJson, sessionClearCookie, sessionSetCookie } from './http';
import { createSession, currentAuth, csrfMatches, originMatches, type AuthContext } from './session';
import { passwordProblem } from './password-policy';
import { getBotUsername, requireToken, siteOrigin, webhookSecretProblem, webhookUrlFor } from './bot-admin';
import { checkHealth, diagnostics } from './health';

export interface ApiContext {
  env: Env;
  db: Db;
  request: Request;
  url: URL;
  now: number;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function handleApi(ctx: ApiContext): Promise<Response> {
  try {
    return await dispatch(ctx);
  } catch (error) {
    if (error instanceof BodyError) return apiError(error.status, error.code, 'The request body is invalid.');
    throw error;
  }
}

async function dispatch(ctx: ApiContext): Promise<Response> {
  const { request, url, db, now } = ctx;
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/auth/login' && method === 'POST') return login(ctx);

  const auth = await currentAuth(db, request, now);
  if (!auth) return apiError(401, 'unauthenticated', 'Sign in first.');

  if (UNSAFE.has(method)) {
    if (!originMatches(request)) return apiError(403, 'bad_origin', 'Request origin is not allowed.');
    if (!csrfMatches(auth, request.headers.get('x-csrf-token'))) {
      return apiError(403, 'bad_csrf', 'The security token is missing or stale. Reload the page.');
    }
  }

  if (path === '/api/auth/logout' && method === 'POST') return logout(ctx, auth);
  if (path === '/api/auth/me' && method === 'GET') return me(auth);
  if (path === '/api/auth/password' && method === 'POST') return changePassword(ctx, auth);

  if (auth.user.must_change_password) {
    return apiError(403, 'must_change_password', 'Choose a new password before continuing.');
  }

  return route(ctx, auth, method, path);
}

async function route(ctx: ApiContext, auth: AuthContext, method: string, path: string): Promise<Response> {
  const { db, env, request, url, now } = ctx;

  if (path === '/api/dashboard' && method === 'GET') return dashboard(ctx, auth);

  if (path === '/api/settings' && method === 'GET') {
    return json({ ok: true, values: await getSettings(db), defs: SETTING_DEFS, defaults: DEFAULT_SETTINGS });
  }
  if (path === '/api/settings' && method === 'PUT') {
    const body = await readJson(request);
    const checked = validateChanges(body.changes);
    if (!checked.ok) return apiError(422, 'validation_failed', 'Some settings are invalid.', checked.errors);
    await saveSettings(db, checked.values, now);
    await writeLog(db, now, 'info', 'settings_changed', '', Object.keys(checked.values).join(','));
    return json({ ok: true, values: await getSettings(db) });
  }

  if (path === '/api/platforms' && method === 'GET') {
    return json({ ok: true, platforms: (await listPlatforms(db)).map(publicPlatform) });
  }

  const platformMatch = path.match(/^\/api\/platforms\/([a-z]+)\/(enable|sample|test)$/);
  if (platformMatch) {
    const [, key, action] = platformMatch;
    const platform = await getPlatform(db, key);
    if (!platform) return apiError(404, 'not_found', 'Unknown platform.');
    if (action === 'enable' && method === 'POST') {
      const body = await readJson(request);
      if (typeof body.enabled !== 'boolean') return apiError(422, 'validation_failed', 'enabled must be true or false.');
      if (body.enabled && !platform.implemented) {
        return apiError(422, 'not_implemented', `${platform.name} is not implemented in this version.`);
      }
      await setPlatformEnabled(db, key, body.enabled);
      await writeLog(db, now, 'info', 'platform_toggled', key, body.enabled ? 'on' : 'off');
      return json({ ok: true, platform: publicPlatform({ ...platform, enabled: body.enabled ? 1 : 0 }) });
    }
    if (action === 'sample' && method === 'PUT') {
      const body = await readJson(request);
      const sample = typeof body.sample_url === 'string' ? body.sample_url.trim() : '';
      if (sample.length > 500) return apiError(422, 'validation_failed', 'The link is too long.', { sample_url: 'too long' });
      if (sample !== '') {
        const classified = classifyUrl(sample);
        if (!classified || classified.platform !== key || !sample.startsWith('https://')) {
          return apiError(422, 'validation_failed', `Enter an https link from ${platform.name}.`, { sample_url: 'invalid' });
        }
      }
      await setPlatformSample(db, key, sample);
      return json({ ok: true });
    }
    if (action === 'test' && method === 'POST') {
      if (!platform.implemented) return apiError(422, 'not_implemented', `${platform.name} is not implemented in this version.`);
      if (!platform.sample_url) return apiError(422, 'validation_failed', 'Save a sample link first.');
      const classified = classifyUrl(platform.sample_url);
      if (!classified) return apiError(422, 'validation_failed', 'The saved sample link is invalid.');
      try {
        await resolveMedia(classified.platform, classified.url);
        const message = 'Found a video link. Extraction test only; no file was downloaded.';
        await recordPlatformTest(db, key, true, message, now);
        return json({ ok: true, test_ok: true, message });
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'internal';
        const message = `Extraction failed: ${code}`;
        await recordPlatformTest(db, key, false, message, now);
        return json({ ok: true, test_ok: false, message });
      }
    }
    return apiError(405, 'method_not_allowed', 'Method not allowed.');
  }

  if (path === '/api/bot' && method === 'GET') return botStatus(ctx);

  if (path === '/api/bot/test' && method === 'POST') {
    const token = requireToken(env);
    if (!token) return tokenMissing();
    try {
      const info = await getMe(token);
      await setState(db, 'bot_username', info.username ?? '', now);
      return json({ ok: true, username: info.username ?? null, first_name: info.first_name ?? null });
    } catch (error) {
      return telegramFailure(error);
    }
  }

  if (path === '/api/bot/webhook' && method === 'POST') {
    const token = requireToken(env);
    if (!token) return tokenMissing();
    const problem = webhookSecretProblem(env.WEBHOOK_SECRET);
    if (problem) return apiError(409, 'secret_invalid', problem);
    const target = webhookUrlFor(siteOrigin(request));
    try {
      await setWebhook(token, target, env.WEBHOOK_SECRET);
      await writeLog(db, now, 'info', 'webhook_registered', '', 'ok');
      return json({ ok: true, url: target });
    } catch (error) {
      return telegramFailure(error);
    }
  }

  if (path === '/api/bot/webhook' && method === 'DELETE') {
    const token = requireToken(env);
    if (!token) return tokenMissing();
    try {
      await deleteWebhook(token);
      await writeLog(db, now, 'info', 'webhook_removed', '', 'ok');
      return json({ ok: true });
    } catch (error) {
      return telegramFailure(error);
    }
  }

  if (path === '/api/health' && method === 'GET') {
    const checks = await checkHealth(ctx);
    return json({ ok: checks.every((c) => c.status !== 'error'), checks });
  }

  if (path === '/api/diagnostics' && method === 'GET') {
    return json({ ok: true, ...(await diagnostics(ctx)) });
  }

  if (path === '/api/logs' && method === 'GET') {
    const severity = url.searchParams.get('severity') ?? '';
    const event = (url.searchParams.get('event') ?? '').slice(0, 40);
    const q = (url.searchParams.get('q') ?? '').slice(0, 80);
    const limit = clampInt(url.searchParams.get('limit'), 1, 200, 50);
    const offset = clampInt(url.searchParams.get('offset'), 0, 1_000_000, 0);
    if (severity && !['info', 'warning', 'error'].includes(severity)) {
      return apiError(422, 'validation_failed', 'severity must be info, warning, or error.', { severity: 'invalid' });
    }
    const items = await searchLogs(db, {
      severity: severity || undefined,
      event: event || undefined,
      q: q || undefined,
      limit,
      offset,
    });
    return json({ ok: true, items, next_offset: items.length === limit ? offset + limit : null });
  }

  if (path === '/api/account/appearance' && method === 'PUT') {
    const body = await readJson(request);
    const theme = typeof body.theme === 'string' ? body.theme : '';
    const mode = typeof body.mode === 'string' ? body.mode : '';
    if (!['merchant', 'ios'].includes(theme) || !['light', 'dark', 'system'].includes(mode)) {
      return apiError(422, 'validation_failed', 'Unknown theme or mode.');
    }
    await setAppearance(db, auth.user.id, theme, mode, now);
    return json({ ok: true, appearance: { theme, mode } });
  }

  return apiError(404, 'not_found', 'No such API route.');
}

// ---------- auth ----------

async function login(ctx: ApiContext): Promise<Response> {
  const { db, request, now } = ctx;
  if (!originMatches(request)) return apiError(403, 'bad_origin', 'Request origin is not allowed.');
  let body: Record<string, unknown>;
  try {
    body = await readJson(request);
  } catch {
    return apiError(400, 'bad_json', 'The request body is invalid.');
  }
  const username = typeof body.username === 'string' ? body.username.trim().slice(0, 64) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  if (!username || !password) return apiError(422, 'validation_failed', 'Enter the username and password.');

  const throttleKey = await sha256Hex(`login:${username.toLowerCase()}`);
  if ((await countLoginFailures(db, throttleKey, now - LOGIN_WINDOW_MS)) >= LOGIN_MAX_FAILURES) {
    return apiError(429, 'too_many_attempts', 'Too many failed attempts. Try again in 15 minutes.');
  }

  const user = await getUserByName(db, username);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) {
    await addLoginFailure(db, throttleKey, now);
    return apiError(401, 'invalid_credentials', 'Wrong username or password.');
  }
  await clearLoginFailures(db, throttleKey);
  const { token } = await createSession(db, user.id, now);
  return json({ ok: true, must_change_password: user.must_change_password === 1 }, 200, {
    'set-cookie': sessionSetCookie(token),
  });
}

async function logout(ctx: ApiContext, auth: AuthContext): Promise<Response> {
  await deleteSession(ctx.db, auth.tokenHash);
  return json({ ok: true }, 200, { 'set-cookie': sessionClearCookie() });
}

function me(auth: AuthContext): Response {
  return json({
    ok: true,
    username: auth.user.username,
    must_change_password: auth.user.must_change_password === 1,
    csrf: auth.csrf,
    appearance: { theme: auth.user.appearance_theme, mode: auth.user.appearance_mode },
  });
}

async function changePassword(ctx: ApiContext, auth: AuthContext): Promise<Response> {
  const { db, request, now } = ctx;
  const body = await readJson(request);
  const current = typeof body.current_password === 'string' ? body.current_password : '';
  const next = typeof body.new_password === 'string' ? body.new_password : '';
  if (!(await verifyPassword(current, auth.user.password_hash))) {
    return apiError(400, 'wrong_password', 'The current password is wrong.', { current_password: 'wrong' });
  }
  const problem = passwordProblem(next, auth.user.username);
  if (problem) return apiError(422, 'weak_password', problem, { new_password: problem });
  await updatePassword(db, auth.user.id, await hashPassword(next), now);
  await deleteOtherSessions(db, auth.user.id, auth.tokenHash);
  await writeLog(db, now, 'info', 'password_changed', '', 'ok');
  return json({ ok: true });
}

// ---------- dashboard and bot ----------

async function dashboard(ctx: ApiContext, auth: AuthContext): Promise<Response> {
  const { db, env, now } = ctx;
  const since = now - 86_400_000;
  const settings = await getSettings(db);
  const platforms = await listPlatforms(db);
  const webhook = env.BOT_TOKEN ? await safeWebhookInfo(env.BOT_TOKEN) : null;
  const defaultPasswordActive = auth.user.must_change_password === 1 || (await anyUserMustChangePassword(db));
  return json({
    ok: true,
    bot_enabled: settings.bot_enabled,
    downloads_24h: {
      ok: await countEventsSince(db, 'download_ok', since),
      failed: await countEventsSince(db, 'download_failed', since),
    },
    platforms: platforms.map(publicPlatform),
    webhook_url: webhook?.url ?? null,
    webhook_pending_updates: webhook?.pending_update_count ?? null,
    warnings: [
      ...(defaultPasswordActive ? ['The default admin password has not been changed.'] : []),
      ...(!env.BOT_TOKEN ? ['BOT_TOKEN secret is missing.'] : []),
      ...(env.BOT_TOKEN && !webhook?.url ? ['The Telegram webhook is not registered.'] : []),
    ],
  });
}

async function safeWebhookInfo(token: string) {
  try {
    return await getWebhookInfo(token);
  } catch {
    return null;
  }
}

async function botStatus(ctx: ApiContext): Promise<Response> {
  const { db, env, request, now } = ctx;
  const settings = await getSettings(db);
  const token = requireToken(env);
  const expected = webhookUrlFor(siteOrigin(request));
  let info: Awaited<ReturnType<typeof getWebhookInfo>> | null = null;
  let error: string | null = null;
  if (token) {
    try {
      info = await getWebhookInfo(token);
    } catch (e) {
      error = e instanceof TelegramError ? e.description : 'Telegram is unreachable.';
    }
  }
  return json({
    ok: true,
    token_configured: !!token,
    bot_enabled: settings.bot_enabled,
    bot_username: await getBotUsername(db, token ?? undefined, now),
    expected_webhook_url: expected,
    webhook: info,
    webhook_registered: !!info && info.url === expected,
    error,
  });
}

// ---------- helpers ----------

export function publicPlatform(p: PlatformRow) {
  return {
    key: p.key,
    name: p.name,
    enabled: p.enabled === 1,
    implemented: p.implemented === 1,
    sample_url: p.sample_url,
    last_test_at: p.last_test_at,
    last_test_ok: p.last_test_ok === null ? null : p.last_test_ok === 1,
    last_test_message: p.last_test_message,
  };
}

function tokenMissing(): Response {
  return apiError(409, 'token_missing', 'Add the BOT_TOKEN secret in Cloudflare, then reload this page.');
}

function telegramFailure(error: unknown): Response {
  if (error instanceof TelegramError) return apiError(502, 'telegram_error', `Telegram said: ${error.description}`);
  return apiError(502, 'telegram_error', 'Telegram is unreachable right now.');
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = raw === null ? fallback : Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

