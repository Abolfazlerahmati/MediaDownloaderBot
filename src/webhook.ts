// Telegram webhook: checks the secret token, answers fast, and processes the update after the reply.
import type { Env } from './env';
import { ensureSchema } from './db/schema';
import { handleUpdate } from './bot/handler';
import type { TgUpdate } from './bot/types';
import { productionBotDeps } from './bot/deps';
import { MAX_WEBHOOK_BYTES } from './limits';
import { constantTimeEqual } from './security/crypto';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.WEBHOOK_SECRET || !env.BOT_TOKEN) {
    console.error(JSON.stringify({ event: 'config_missing' }));
    return reply(500, { ok: false, error: 'server_not_configured' });
  }
  const provided = request.headers.get(SECRET_HEADER) ?? '';
  if (!constantTimeEqual(provided, env.WEBHOOK_SECRET)) {
    // Logged without the header value or the secret. A missing header usually means the webhook was registered before the secret was set.
    console.error(JSON.stringify({ event: 'webhook_rejected', reason: provided ? 'secret_mismatch' : 'secret_header_missing' }));
    return reply(403, { ok: false, error: 'forbidden' });
  }

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return reply(413, { ok: false, error: 'payload_too_large' });
  const text = await request.text();
  if (text.length > MAX_WEBHOOK_BYTES) return reply(413, { ok: false, error: 'payload_too_large' });

  let update: TgUpdate;
  try {
    update = JSON.parse(text) as TgUpdate;
  } catch {
    return reply(400, { ok: false, error: 'bad_json' });
  }

  ctx.waitUntil(
    (async () => {
      await ensureSchema(env.DB);
      await handleUpdate(update, productionBotDeps(env, env.DB));
    })().catch((error: unknown) => {
      const name = error instanceof Error ? error.name : 'unknown';
      console.error(JSON.stringify({ event: 'update_crashed', name }));
    }),
  );
  return reply(200, { ok: true });
}
