// Worker entry point. Routes:
//   GET  /                     plain-text status (no secrets)
//   GET  /health               JSON status for uptime checks
//   POST /telegram/webhook     Telegram updates; requires the secret token header
import type { Env } from './env';
import { handleUpdate, productionDeps, type TelegramUpdate } from './bot';
import { d1Store } from './db';
import { MAX_WEBHOOK_BYTES } from './limits';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.WEBHOOK_SECRET || !env.BOT_TOKEN) {
    console.error(JSON.stringify({ event: 'config_missing' }));
    return json({ ok: false, error: 'server_not_configured' }, 500);
  }
  const provided = request.headers.get(SECRET_HEADER) ?? '';
  if (!timingSafeEqual(provided, env.WEBHOOK_SECRET)) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    return json({ ok: false, error: 'payload_too_large' }, 413);
  }
  const text = await request.text();
  if (text.length > MAX_WEBHOOK_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413);

  let update: TelegramUpdate;
  try {
    update = JSON.parse(text) as TelegramUpdate;
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  // Answer Telegram quickly and do the slow work after the response is sent.
  ctx.waitUntil(
    handleUpdate(update, productionDeps(env.BOT_TOKEN, d1Store(env.DB))).catch((error: unknown) => {
      const name = error instanceof Error ? error.name : 'unknown';
      console.error(JSON.stringify({ event: 'update_crashed', name }));
    }),
  );
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/') {
      return new Response('MediaDownloaderBot is running.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (request.method === 'GET' && pathname === '/health') {
      return json({ ok: true, service: 'mediadownloaderbot' });
    }
    if (request.method === 'POST' && pathname === '/telegram/webhook') {
      return handleWebhook(request, env, ctx);
    }
    return json({ ok: false, error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
