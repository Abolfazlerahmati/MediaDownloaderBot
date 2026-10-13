import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/d1';
import { ensureSchema, resetSchemaCacheForTests, DEFAULT_ADMIN_PASSWORD } from '../src/db/schema';
import { handleApi } from '../src/web/api';
import { validateChanges, DEFAULT_SETTINGS } from '../src/settings';
import { getSettings, anyUserMustChangePassword } from '../src/db/store';
import type { Env } from '../src/env';
import { LOGIN_MAX_FAILURES } from '../src/limits';

const ORIGIN = 'https://panel.example.workers.dev';
const env = {} as Env;

let t: TestDb;
let now: number;

beforeEach(async () => {
  t = createTestDb();
  now = Date.UTC(2026, 9, 14, 12, 0, 0);
  await ensureSchema(t.db, now);
});

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; csrf?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  if (init.csrf) headers['x-csrf-token'] = init.csrf;
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function call(path: string, init: Parameters<typeof req>[1] = {}) {
  const request = req(path, init);
  const res = await handleApi({ env, db: t.db, request, url: new URL(request.url), now });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, data, headers: res.headers };
}

async function login(username: string, password: string) {
  const res = await call('/api/auth/login', { method: 'POST', body: { username, password } });
  const cookie = res.headers.get('set-cookie') ?? '';
  return { ...res, cookie: cookie.split(';')[0] };
}

describe('schema and seed', () => {
  it('seeds one admin who must change the default password', async () => {
    const row = t.raw.prepare('SELECT username, must_change_password FROM panel_users').get() as { username: string; must_change_password: number };
    expect(row).toEqual({ username: 'admin', must_change_password: 1 });
    expect(await anyUserMustChangePassword(t.db)).toBe(true);
  });

  it('seeds the media platforms and only enables implemented ones', () => {
    const rows = t.raw.prepare('SELECT key, implemented, enabled FROM media_platforms ORDER BY key').all() as Array<{ key: string; implemented: number; enabled: number }>;
    const tiktok = rows.find((r) => r.key === 'tiktok');
    expect(tiktok?.implemented).toBe(1);
    for (const r of rows) if (r.implemented === 0) expect(r.enabled).toBe(0);
  });

  it('refreshes the implemented flags on existing databases without changing admin choices', async () => {
    t.raw.prepare("UPDATE media_platforms SET implemented = 0, enabled = 1 WHERE key = 'youtube'").run();
    resetSchemaCacheForTests();
    await ensureSchema(t.db, now);
    const row = t.raw.prepare("SELECT implemented, enabled FROM media_platforms WHERE key = 'youtube'").get() as { implemented: number; enabled: number };
    expect(row).toEqual({ implemented: 1, enabled: 1 });
  });

  it('is idempotent', async () => {
    const before = t.raw.prepare('SELECT COUNT(*) AS n FROM panel_users').get() as { n: number };
    await ensureSchema(t.db, now);
    const after = t.raw.prepare('SELECT COUNT(*) AS n FROM panel_users').get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});

describe('login and forced password change', () => {
  it('rejects a wrong password without revealing which field was wrong', async () => {
    const res = await login('admin', 'nope-nope');
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('invalid_credentials');
  });

  it('sets an HttpOnly, Secure, SameSite=Strict session cookie', async () => {
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Strict/);
    expect(res.data.must_change_password).toBe(true);
  });

  it('blocks every panel route until the password is changed', async () => {
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    const blocked = await call('/api/settings', { cookie: res.cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.data.error).toBe('must_change_password');
    const me = await call('/api/auth/me', { cookie: res.cookie });
    expect(me.status).toBe(200);
    expect(me.data.must_change_password).toBe(true);
  });

  it('rejects the default password as the new password and accepts a strong one', async () => {
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    const csrf = (await call('/api/auth/me', { cookie: res.cookie })).data.csrf;
    const weak = await call('/api/auth/password', {
      method: 'POST', cookie: res.cookie, csrf, body: { current_password: DEFAULT_ADMIN_PASSWORD, new_password: 'short' },
    });
    expect(weak.status).toBe(422);
    const ok = await call('/api/auth/password', {
      method: 'POST', cookie: res.cookie, csrf, body: { current_password: DEFAULT_ADMIN_PASSWORD, new_password: 'correct horse battery 42' },
    });
    expect(ok.status).toBe(200);
    expect(await anyUserMustChangePassword(t.db)).toBe(false);
    const settings = await call('/api/settings', { cookie: res.cookie, csrf });
    expect(settings.status).toBe(200);
  });
});

describe('CSRF and Origin', () => {
  async function signedIn() {
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    await call('/api/auth/password', {
      method: 'POST', cookie: res.cookie, csrf: 'x', body: {},
    });
    t.raw.prepare('UPDATE panel_users SET must_change_password = 0').run();
    const me = await call('/api/auth/me', { cookie: res.cookie });
    return { cookie: res.cookie, csrf: me.data.csrf as string | undefined };
  }

  it('rejects a state-changing request with no CSRF token', async () => {
    const s = await signedIn();
    const res = await call('/api/settings', { method: 'PUT', cookie: s.cookie, body: { changes: {} } });
    expect(res.status).toBe(403);
    expect(res.data.error).toBe('bad_csrf');
  });

  it('rejects a cross-site Origin even with a valid CSRF token', async () => {
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    t.raw.prepare('UPDATE panel_users SET must_change_password = 0').run();
    const row = t.raw.prepare('SELECT csrf_token FROM panel_sessions').get() as { csrf_token: string };
    const cross = await call('/api/settings', {
      method: 'PUT', cookie: res.cookie, csrf: row.csrf_token, origin: 'https://evil.example', body: { changes: {} },
    });
    expect(cross.status).toBe(403);
    expect(cross.data.error).toBe('bad_origin');
  });

  it('rejects state changes with no Origin header', async () => {
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    t.raw.prepare('UPDATE panel_users SET must_change_password = 0').run();
    const row = t.raw.prepare('SELECT csrf_token FROM panel_sessions').get() as { csrf_token: string };
    const res2 = await call('/api/settings', { method: 'PUT', cookie: res.cookie, csrf: row.csrf_token, origin: null, body: { changes: {} } });
    expect(res2.status).toBe(403);
  });

  it('refuses requests without a session', async () => {
    const res = await call('/api/settings');
    expect(res.status).toBe(401);
  });

  it('logout ends the session', async () => {
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    const row = t.raw.prepare('SELECT csrf_token FROM panel_sessions').get() as { csrf_token: string };
    t.raw.prepare('UPDATE panel_users SET must_change_password = 0').run();
    await call('/api/auth/logout', { method: 'POST', cookie: res.cookie, csrf: row.csrf_token });
    const after = await call('/api/auth/me', { cookie: res.cookie });
    expect(after.status).toBe(401);
  });
});

describe('login throttling', () => {
  it('locks the username after repeated failures', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await login('admin', 'wrong-wrong-1');
    const locked = await login('admin', DEFAULT_ADMIN_PASSWORD);
    expect(locked.status).toBe(429);
  });

  it('stores only hashed throttle keys', async () => {
    await login('victim-name', 'x');
    const rows = t.raw.prepare('SELECT key_hash FROM login_attempts').all() as Array<{ key_hash: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.key_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('settings validation', () => {
  it('accepts a valid change set', () => {
    const r = validateChanges({ rate_limit_per_minute: 3, default_language: 'fa', bot_enabled: false });
    expect(r.ok).toBe(true);
  });

  it('rejects unknown keys, out-of-range numbers, and bad enums with field errors', () => {
    const r = validateChanges({ rate_limit_per_minute: 9999, default_language: 'de', surprise: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors)).toEqual(expect.arrayContaining(['rate_limit_per_minute', 'default_language']));
    }
  });

  it('rejects max_file_mb above the 50 MB Telegram cap', () => {
    const r = validateChanges({ max_file_mb: 51 });
    expect(r.ok).toBe(false);
  });

  it('saves through the API and reads back the stored values', async () => {
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    const csrfRow = () => (t.raw.prepare('SELECT csrf_token FROM panel_sessions').get() as { csrf_token: string }).csrf_token;
    await call('/api/auth/password', { method: 'POST', cookie: res.cookie, csrf: csrfRow(), body: { current_password: DEFAULT_ADMIN_PASSWORD, new_password: 'correct horse battery 42' } });
    const bad = await call('/api/settings', { method: 'PUT', cookie: res.cookie, csrf: csrfRow(), body: { changes: { dedupe_seconds: 601 } } });
    expect(bad.status).toBe(422);
    expect(bad.data.fields.dedupe_seconds).toBeTruthy();
    const ok = await call('/api/settings', { method: 'PUT', cookie: res.cookie, csrf: csrfRow(), body: { changes: { rate_limit_per_minute: 7 } } });
    expect(ok.status).toBe(200);
    const stored = await getSettings(t.db);
    expect(stored.rate_limit_per_minute).toBe(7);
    expect(stored.max_file_mb).toBe(DEFAULT_SETTINGS.max_file_mb);
  });
});

describe('platform management', () => {
  it('refuses to enable a platform that is not implemented', async () => {
    t.raw.prepare("UPDATE media_platforms SET implemented = 0 WHERE key = 'youtube'").run();
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    const csrf = () => (t.raw.prepare('SELECT csrf_token FROM panel_sessions').get() as { csrf_token: string }).csrf_token;
    await call('/api/auth/password', { method: 'POST', cookie: res.cookie, csrf: csrf(), body: { current_password: DEFAULT_ADMIN_PASSWORD, new_password: 'correct horse battery 42' } });
    const r = await call('/api/platforms/youtube/enable', { method: 'POST', cookie: res.cookie, csrf: csrf(), body: { enabled: true } });
    expect(r.status).toBe(422);
    expect(r.data.error).toBe('not_implemented');
  });

  it('rejects a sample link that belongs to another platform', async () => {
    const res = await login('admin', DEFAULT_ADMIN_PASSWORD);
    const csrf = () => (t.raw.prepare('SELECT csrf_token FROM panel_sessions').get() as { csrf_token: string }).csrf_token;
    await call('/api/auth/password', { method: 'POST', cookie: res.cookie, csrf: csrf(), body: { current_password: DEFAULT_ADMIN_PASSWORD, new_password: 'correct horse battery 42' } });
    const r = await call('/api/platforms/tiktok/sample', { method: 'PUT', cookie: res.cookie, csrf: csrf(), body: { sample_url: 'https://www.pinterest.com/pin/1/' } });
    expect(r.status).toBe(422);
  });
});
