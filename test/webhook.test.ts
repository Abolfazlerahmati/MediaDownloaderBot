import { describe, expect, it } from 'vitest';
import { handleWebhook } from '../src/webhook';
import { webhookSecretProblem } from '../src/web/bot-admin';
import type { Env } from '../src/env';

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const SECRET = 'a'.repeat(40);

function hook(body: string, headers: Record<string, string> = {}) {
  return new Request('https://x.example/telegram/webhook', { method: 'POST', body, headers });
}

describe('webhook entry', () => {
  it('fails closed when the secret or token is not configured', async () => {
    const res = await handleWebhook(hook('{}'), { DB: {} } as unknown as Env, ctx);
    expect(res.status).toBe(500);
  });

  it('rejects a wrong or missing Telegram secret header', async () => {
    const env = { BOT_TOKEN: '1:abc', WEBHOOK_SECRET: SECRET, DB: {} } as unknown as Env;
    expect((await handleWebhook(hook('{}'), env, ctx)).status).toBe(403);
    const wrong = await handleWebhook(hook('{}', { 'x-telegram-bot-api-secret-token': 'b'.repeat(40) }), env, ctx);
    expect(wrong.status).toBe(403);
  });

  it('rejects oversized bodies before parsing', async () => {
    const env = { BOT_TOKEN: '1:abc', WEBHOOK_SECRET: SECRET, DB: {} } as unknown as Env;
    const big = 'x'.repeat(70 * 1024);
    const res = await handleWebhook(hook(big, { 'x-telegram-bot-api-secret-token': SECRET, 'content-length': String(big.length) }), env, ctx);
    expect(res.status).toBe(413);
  });

  it('rejects malformed JSON after the secret check', async () => {
    const env = { BOT_TOKEN: '1:abc', WEBHOOK_SECRET: SECRET, DB: {} } as unknown as Env;
    const res = await handleWebhook(hook('{not json', { 'x-telegram-bot-api-secret-token': SECRET }), env, ctx);
    expect(res.status).toBe(400);
  });

  it('requires a secret of at least 32 characters', () => {
    expect(webhookSecretProblem(undefined)).toBeTruthy();
    expect(webhookSecretProblem('short')).toBeTruthy();
    expect(webhookSecretProblem(SECRET)).toBeNull();
  });
});
