import { describe, expect, it } from 'vitest';
import worker, { timingSafeEqual } from '../src/index';
import type { Env } from '../src/env';

const env = { DB: {} as D1Database, CACHE: {} as KVNamespace, BOT_TOKEN: '123:abc', WEBHOOK_SECRET: 'x'.repeat(40) } as Env;

function ctx() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    context: { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => undefined } as unknown as ExecutionContext,
  };
}

function webhook(body: string, headers: Record<string, string> = {}) {
  return new Request('https://worker.example/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('routes', () => {
  it('serves status endpoints without secrets', async () => {
    const root = await worker.fetch(new Request('https://w.example/'), env, ctx().context);
    expect(await root.text()).toContain('running');
    const health = await worker.fetch(new Request('https://w.example/health'), env, ctx().context);
    expect(await health.json()).toEqual({ ok: true, service: 'mediadownloaderbot' });
  });

  it('returns 404 for unknown paths and for GET on the webhook', async () => {
    expect((await worker.fetch(new Request('https://w.example/admin'), env, ctx().context)).status).toBe(404);
    expect((await worker.fetch(new Request('https://w.example/telegram/webhook'), env, ctx().context)).status).toBe(404);
  });
});

describe('webhook security', () => {
  it('rejects a missing or wrong secret token with 403 and does no work', async () => {
    const c = ctx();
    const missing = await worker.fetch(webhook('{}'), env, c.context);
    const wrong = await worker.fetch(webhook('{}', { 'x-telegram-bot-api-secret-token': 'nope' }), env, c.context);
    expect(missing.status).toBe(403);
    expect(wrong.status).toBe(403);
    expect(c.pending).toHaveLength(0);
  });

  it('accepts the right secret, answers 200 and schedules the update', async () => {
    const c = ctx();
    const res = await worker.fetch(
      webhook(JSON.stringify({ update_id: 1 }), { 'x-telegram-bot-api-secret-token': env.WEBHOOK_SECRET }),
      env,
      c.context,
    );
    expect(res.status).toBe(200);
    expect(c.pending).toHaveLength(1);
    await Promise.allSettled(c.pending);
  });

  it('refuses to run without configuration', async () => {
    const res = await worker.fetch(webhook('{}', { 'x-telegram-bot-api-secret-token': '' }), { ...env, WEBHOOK_SECRET: '' }, ctx().context);
    expect(res.status).toBe(500);
  });

  it('rejects oversized and malformed bodies', async () => {
    const big = await worker.fetch(
      webhook('x'.repeat(70_000), { 'x-telegram-bot-api-secret-token': env.WEBHOOK_SECRET }),
      env,
      ctx().context,
    );
    expect(big.status).toBe(413);
    const bad = await worker.fetch(webhook('{nope', { 'x-telegram-bot-api-secret-token': env.WEBHOOK_SECRET }), env, ctx().context);
    expect(bad.status).toBe(400);
  });
});

describe('timingSafeEqual', () => {
  it('compares full strings and different lengths', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });
});
