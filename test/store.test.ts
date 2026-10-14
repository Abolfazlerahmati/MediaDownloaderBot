import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/d1';
import { ensureSchema } from '../src/db/schema';
import {
  addRateEvent,
  claimDedupeKey,
  countRateEvents,
  getLanguage,
  pruneOldRows,
  searchLogs,
  setLanguage,
  writeLog,
} from '../src/db/store';

let t: TestDb;
const DAY = 86_400_000;

beforeEach(async () => {
  t = createTestDb();
  await ensureSchema(t.db, Date.UTC(2026, 9, 14));
});

describe('rate limiting', () => {
  it('counts only events inside the window', async () => {
    const now = 10_000_000;
    await addRateEvent(t.db, 'u1', now - 120_000);
    await addRateEvent(t.db, 'u1', now - 10_000);
    await addRateEvent(t.db, 'u2', now - 5_000);
    expect(await countRateEvents(t.db, 'u1', now - 60_000)).toBe(1);
  });
});

describe('dedupe', () => {
  it('claims a key once inside the window and again after it expires', async () => {
    const now = 5_000_000;
    expect(await claimDedupeKey(t.db, 'k', now, 120_000)).toBe(true);
    expect(await claimDedupeKey(t.db, 'k', now + 1_000, 120_000)).toBe(false);
    expect(await claimDedupeKey(t.db, 'k', now + 121_000, 120_000)).toBe(true);
  });
});

describe('user preferences (privacy)', () => {
  it('stores only telegram_id and language in user_prefs', async () => {
    await setLanguage(t.db, 42, 'fa', 1);
    expect(await getLanguage(t.db, 42, 'en')).toBe('fa');
    expect(await getLanguage(t.db, 43, 'en')).toBe('en');
    const cols = (t.raw.prepare("PRAGMA table_info('user_prefs')").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols.sort()).toEqual(['language', 'telegram_id', 'updated_at']);
  });

  it('has no profile or download-history tables from the old design', () => {
    const names = (t.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name);
    expect(names).not.toContain('bot_users');
    expect(names).not.toContain('download_jobs');
  });
});

describe('logs', () => {
  it('filters by severity and free text, and truncates long details', async () => {
    await writeLog(t.db, 1000, 'error', 'download_failed', 'tiktok', 'blocked');
    await writeLog(t.db, 2000, 'info', 'download_ok', 'tiktok', 'x'.repeat(500));
    const errors = await searchLogs(t.db, { severity: 'error', limit: 10, offset: 0 });
    expect(errors.map((r) => r.event)).toEqual(['download_failed']);
    const found = await searchLogs(t.db, { q: 'blocked', limit: 10, offset: 0 });
    expect(found).toHaveLength(1);
    const ok = await searchLogs(t.db, { event: 'download_ok', limit: 10, offset: 0 });
    expect(ok[0].detail.length).toBeLessThanOrEqual(300);
  });

  it('prunes logs older than the retention window and keeps newer rows', async () => {
    const now = Date.UTC(2026, 9, 14);
    await writeLog(t.db, now - 10 * DAY, 'info', 'old', '', '');
    await writeLog(t.db, now - 1 * DAY, 'info', 'new', '', '');
    await pruneOldRows(t.db, now, { log_retention_days: 7, language_retention_days: 90, store_language: true });
    const left = (t.raw.prepare('SELECT event FROM app_logs').all() as Array<{ event: string }>).map((r) => r.event);
    expect(left).toEqual(['new']);
  });
});
