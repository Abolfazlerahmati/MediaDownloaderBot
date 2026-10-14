import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/d1';
import { ensureSchema, resetSchemaCacheForTests, DEFAULT_ADMIN_PASSWORD } from '../src/db/schema';
import { handleApi } from '../src/web/api';
import { shell } from '../src/web/pages';
import type { Env } from '../src/env';

// ---------- panel translations (public/static/i18n.js) ----------

function loadI18n(): {
  tr: (text: string) => string;
  dictionary: Record<string, string>;
  setLang: (lang: string) => void;
} {
  const source = readFileSync(join(process.cwd(), 'public', 'static', 'i18n.js'), 'utf8');
  const sandbox: Record<string, unknown> = { window: {}, navigator: {}, NodeFilter: {}, document: {} };
  vm.runInNewContext(source, sandbox);
  return (sandbox.window as { MBI18N: ReturnType<typeof loadI18n> }).MBI18N;
}

const PERSIAN = /[\u0600-\u06FF]/;
const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test', 'fixtures', 'panel-strings.json'), 'utf8')) as string[];

describe('panel translations', () => {
  const i18n = loadI18n();
  i18n.setLang('fa');

  it('every visible English string in the fixture has a Persian translation', () => {
    const missing = fixture.filter((text) => {
      const out = i18n.tr(text);
      return out === text || !PERSIAN.test(out);
    });
    expect(missing).toEqual([]);
  });

  it('dictionary values are never empty', () => {
    for (const [key, value] of Object.entries(i18n.dictionary)) {
      expect(value.trim(), `empty translation for "${key}"`).not.toBe('');
    }
  });

  it('dynamic messages are translated with their numbers kept', () => {
    expect(i18n.tr('Enter a number from 1 to 60.')).toMatch(/1.*60/);
    expect(i18n.tr('Enter a number from 1 to 60.')).toMatch(PERSIAN);
    expect(i18n.tr('15 minutes ago')).toBe('15 دقیقه پیش');
    expect(i18n.tr('0 failed · 0% success')).toMatch(/^0 ناموفق · 0٪ موفقیت$/);
    expect(i18n.tr('D1 reachable, schema version 2.')).toContain('2');
  });

  it('English is returned unchanged when the panel is in English', () => {
    i18n.setLang('en');
    expect(i18n.tr('Dashboard')).toBe('Dashboard');
    i18n.setLang('fa');
  });

  it('unknown text is left as it is, so a missing entry never shows as blank', () => {
    expect(i18n.tr('Some text that is not in the dictionary')).toBe('Some text that is not in the dictionary');
  });
});

// ---------- per-account language on the server ----------

const ORIGIN = 'https://panel.example.workers.dev';
const env = {} as Env;
let t: TestDb;
let now: number;

beforeEach(async () => {
  resetSchemaCacheForTests();
  t = createTestDb();
  now = Date.UTC(2026, 9, 14, 12, 0, 0);
  await ensureSchema(t.db, now);
});

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; csrf?: string } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  if (init.csrf) headers['x-csrf-token'] = init.csrf;
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
  return { status: res.status, data };
}

async function signIn(): Promise<string> {
  const request = req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: DEFAULT_ADMIN_PASSWORD } });
  const res = await handleApi({ env, db: t.db, request, url: new URL(request.url), now });
  expect(res.status).toBe(200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

/** Signs in, changes the forced default password, and returns the cookie and CSRF token for the session. */
async function signedInAfterPasswordChange() {
  const cookie = await signIn();
  const me = await call('/api/auth/me', { cookie });
  const csrf = me.data.csrf as string;
  const changed = await call('/api/auth/password', {
    method: 'POST',
    cookie,
    csrf,
    body: { current_password: DEFAULT_ADMIN_PASSWORD, new_password: 'correct horse battery 42' },
  });
  expect(changed.status).toBe(200);
  return { cookie, csrf };
}

describe('panel language is per account, separate from the bot', () => {
  it('defaults to English and is returned by /api/auth/me', async () => {
    const { cookie } = await signedInAfterPasswordChange();
    const me = await call('/api/auth/me', { cookie });
    expect(me.data.appearance.lang).toBe('en');
  });

  it('saves Persian for this admin and does not touch the bot language setting', async () => {
    const { cookie, csrf } = await signedInAfterPasswordChange();
    const before = await call('/api/settings', { cookie });
    const botLanguage = before.data.values.default_language;

    const saved = await call('/api/account/appearance', {
      method: 'PUT',
      cookie,
      csrf,
      body: { theme: 'ios', mode: 'dark', lang: 'fa' },
    });
    expect(saved.status).toBe(200);
    expect(saved.data.appearance).toEqual({ theme: 'ios', mode: 'dark', lang: 'fa' });

    const me = await call('/api/auth/me', { cookie });
    expect(me.data.appearance).toEqual({ theme: 'ios', mode: 'dark', lang: 'fa' });

    const after = await call('/api/settings', { cookie });
    expect(after.data.values.default_language).toBe(botLanguage);
  });

  it('rejects an unknown language', async () => {
    const { cookie, csrf } = await signedInAfterPasswordChange();
    const res = await call('/api/account/appearance', {
      method: 'PUT',
      cookie,
      csrf,
      body: { theme: 'merchant', mode: 'light', lang: 'de' },
    });
    expect(res.status).toBe(422);
  });

  it('the page shell sets lang and dir from the saved language', () => {
    const fa = shell({ page: 'dashboard', theme: 'merchant', mode: 'light', lang: 'fa' });
    expect(fa).toContain('<html lang="fa" dir="rtl"');
    const en = shell({ page: 'dashboard', theme: 'merchant', mode: 'light', lang: 'en' });
    expect(en).toContain('<html lang="en" dir="ltr"');
    expect(shell({ page: 'login' })).toContain('<html lang="en" dir="ltr"');
  });

  it('loads the translation script before the panel script', () => {
    const html = shell({ page: 'settings', theme: 'ios', mode: 'system', lang: 'fa' });
    expect(html.indexOf('/static/i18n.js')).toBeGreaterThan(-1);
    expect(html.indexOf('/static/i18n.js')).toBeLessThan(html.indexOf('/static/app.js'));
  });
});
