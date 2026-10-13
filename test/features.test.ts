import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/d1';
import { ensureSchema } from '../src/db/schema';
import {
  acquireJobSlot,
  claimDedupeKey,
  getLanguage,
  pruneOldRows,
  releaseJobSlot,
  setLanguage,
} from '../src/db/store';
import { extractUrls } from '../src/platforms';
import { withRetry } from '../src/media/retry';
import { BotError } from '../src/errors';
import { validateChanges, DEFAULT_SETTINGS } from '../src/settings';

let t: TestDb;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 14);

beforeEach(async () => {
  t = createTestDb();
  await ensureSchema(t.db, NOW);
});

describe('extractUrls', () => {
  it('returns every unique http(s) link in order, without trailing punctuation', () => {
    const urls = extractUrls('see https://a.example/x, then https://b.example/y. and https://a.example/x');
    expect(urls).toEqual(['https://a.example/x', 'https://b.example/y']);
  });

  it('returns nothing for text without links', () => {
    expect(extractUrls('hello world')).toEqual([]);
  });
});

describe('withRetry', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  it('retries transient upstream errors up to the attempt limit', async () => {
    sleeps.length = 0;
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new BotError('upstream_error');
      }, { attempts: 3, baseDelayMs: 100, sleep }),
    ).rejects.toThrow();
    expect(calls).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('does not retry permanent or timeout errors', async () => {
    for (const code of ['not_found', 'blocked', 'timeout', 'file_too_large'] as const) {
      sleeps.length = 0;
      let calls = 0;
      await expect(
        withRetry(async () => {
          calls++;
          throw new BotError(code);
        }, { attempts: 3, baseDelayMs: 100, sleep }),
      ).rejects.toThrow();
      expect(calls).toBe(1);
      expect(sleeps).toHaveLength(0);
    }
  });

  it('returns the value of a later successful attempt', async () => {
    let calls = 0;
    const value = await withRetry(async () => {
      calls++;
      if (calls < 2) throw new BotError('upstream_error');
      return 'ok';
    }, { attempts: 2, baseDelayMs: 1, sleep });
    expect(value).toBe('ok');
  });
});

describe('dedupe claims are atomic', () => {
  it('lets only the first claim inside the window through', async () => {
    const first = await claimDedupeKey(t.db, 'k1', NOW, 120_000);
    const second = await claimDedupeKey(t.db, 'k1', NOW + 1000, 120_000);
    const later = await claimDedupeKey(t.db, 'k1', NOW + 121_000, 120_000);
    expect([first, second, later]).toEqual([true, false, true]);
  });

  it('is off when the window is zero', async () => {
    expect(await claimDedupeKey(t.db, 'k2', NOW, 0)).toBe(true);
    expect(await claimDedupeKey(t.db, 'k2', NOW, 0)).toBe(true);
  });
});

describe('job slots', () => {
  it('never hands out more slots than the limit', async () => {
    expect(await acquireJobSlot(t.db, 'a', NOW, 2, 60_000)).toBe(true);
    expect(await acquireJobSlot(t.db, 'b', NOW, 2, 60_000)).toBe(true);
    expect(await acquireJobSlot(t.db, 'c', NOW, 2, 60_000)).toBe(false);
    await releaseJobSlot(t.db, 'a');
    expect(await acquireJobSlot(t.db, 'c', NOW, 2, 60_000)).toBe(true);
  });

  it('frees slots left behind by a job that never released them', async () => {
    expect(await acquireJobSlot(t.db, 'old', NOW - 10 * 60_000, 1, 60_000)).toBe(true);
    expect(await acquireJobSlot(t.db, 'new', NOW, 1, 60_000)).toBe(true);
  });
});

describe('temporary language mode', () => {
  it('pruning with store_language off removes every saved language choice', async () => {
    await setLanguage(t.db, 1, 'fa', NOW);
    await setLanguage(t.db, 2, 'en', NOW);
    await pruneOldRows(t.db, NOW, { log_retention_days: 7, language_retention_days: 90, store_language: false });
    expect(await getLanguage(t.db, 1, 'en')).toBe('en');
    const left = t.raw.prepare('SELECT COUNT(*) AS n FROM user_prefs').get() as { n: number };
    expect(left.n).toBe(0);
  });

  it('pruning with store_language on keeps recent choices and drops old ones', async () => {
    await setLanguage(t.db, 1, 'fa', NOW);
    await setLanguage(t.db, 2, 'fa', NOW - 100 * DAY);
    await pruneOldRows(t.db, NOW, { log_retention_days: 7, language_retention_days: 90, store_language: true });
    expect(await getLanguage(t.db, 1, 'en')).toBe('fa');
    expect(await getLanguage(t.db, 2, 'en')).toBe('en');
  });
});

describe('new settings validation', () => {
  it('accepts values inside each range', () => {
    const ok = validateChanges({
      max_links_per_message: 5,
      max_concurrent_jobs: 20,
      download_timeout_seconds: 300,
      retry_attempts: 3,
      store_language: false,
      language_retention_days: 365,
    });
    expect(ok.ok).toBe(true);
  });

  it('rejects values outside each range, with field errors', () => {
    const bad = validateChanges({
      max_links_per_message: 6,
      max_concurrent_jobs: 0,
      download_timeout_seconds: 9,
      retry_attempts: 4,
      language_retention_days: 366,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.errors).sort()).toEqual([
        'download_timeout_seconds',
        'language_retention_days',
        'max_concurrent_jobs',
        'max_links_per_message',
        'retry_attempts',
      ]);
    }
  });

  it('has defaults that match the documented values', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      max_links_per_message: 3,
      max_concurrent_jobs: 5,
      download_timeout_seconds: 90,
      retry_attempts: 2,
      store_language: true,
      language_retention_days: 90,
    });
  });
});
