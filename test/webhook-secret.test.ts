import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/d1';
import { ensureSchema, resetSchemaCacheForTests } from '../src/db/schema';
import { setState } from '../src/db/store';
import { registeredSecretMatches, secretFingerprint, SECRET_FINGERPRINT_KEY } from '../src/web/bot-admin';

const OLD = 'old-secret-0123456789abcdefghijklmnop';
const NEW = 'new-secret-0123456789abcdefghijklmnop';
let t: TestDb;

beforeEach(async () => {
  resetSchemaCacheForTests();
  t = createTestDb();
  await ensureSchema(t.db, Date.UTC(2026, 9, 14));
});

describe('webhook secret registration check', () => {
  it('reports a mismatch when nothing was registered yet', async () => {
    expect(await registeredSecretMatches(t.db, OLD)).toBe(false);
  });

  it('matches after the secret is stored at registration', async () => {
    await setState(t.db, SECRET_FINGERPRINT_KEY, await secretFingerprint(OLD), 1);
    expect(await registeredSecretMatches(t.db, OLD)).toBe(true);
  });

  it('reports a mismatch after WEBHOOK_SECRET is changed in Cloudflare', async () => {
    await setState(t.db, SECRET_FINGERPRINT_KEY, await secretFingerprint(OLD), 1);
    expect(await registeredSecretMatches(t.db, NEW)).toBe(false);
  });

  it('is false when the secret is missing', async () => {
    await setState(t.db, SECRET_FINGERPRINT_KEY, await secretFingerprint(OLD), 1);
    expect(await registeredSecretMatches(t.db, undefined)).toBe(false);
  });

  it('stores a hash, never the secret itself', async () => {
    const stored = await secretFingerprint(OLD);
    expect(stored).not.toContain(OLD);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });
});
