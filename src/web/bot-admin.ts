// Helpers for the bot admin page: webhook URL, secret checks, and cached bot username.
import type { Db } from '../db/schema';
import { getState, setState } from '../db/store';
import { getMe } from '../telegram';
import { sha256Hex } from '../security/crypto';

export const WEBHOOK_PATH = '/telegram/webhook';

/** bot_state key holding a hash of the WEBHOOK_SECRET that was sent to Telegram at the last registration. */
export const SECRET_FINGERPRINT_KEY = 'webhook_secret_fingerprint';

/** Hash of the secret, never the secret itself. Used only to notice when WEBHOOK_SECRET changed after registration. */
export function secretFingerprint(secret: string): Promise<string> {
  return sha256Hex(`mb-webhook-secret:${secret}`);
}

/**
 * True when the secret in Cloudflare is the one registered with Telegram.
 * Returns false when nothing was registered by this version yet, so the panel asks for one registration.
 */
export async function registeredSecretMatches(db: Db, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  const stored = await getState(db, SECRET_FINGERPRINT_KEY);
  return !!stored && stored === (await secretFingerprint(secret));
}

/** Origin of the Worker as seen by the browser, for example https://mediadownloaderbot.example.workers.dev. */
export function siteOrigin(request: Request): string {
  return new URL(request.url).origin;
}

export function webhookUrlFor(origin: string): string {
  return `${origin}${WEBHOOK_PATH}`;
}

/** The token is usable only when it is present and not an obvious placeholder. */
export function requireToken(env: { BOT_TOKEN?: string }): string | null {
  return env.BOT_TOKEN && env.BOT_TOKEN.length > 10 ? env.BOT_TOKEN : null;
}

/** Telegram accepts secret_token made of A-Z, a-z, 0-9, _ and -, with 1 to 256 characters. */
export function webhookSecretProblem(secret: string | undefined): string | null {
  if (!secret) return 'Add the WEBHOOK_SECRET secret in Cloudflare, then reload this page.';
  if (secret.length < 32) return 'WEBHOOK_SECRET must be at least 32 characters.';
  if (secret.length > 256 || !/^[A-Za-z0-9_-]+$/.test(secret)) {
    return 'WEBHOOK_SECRET may only contain letters, digits, underscore and hyphen.';
  }
  return null;
}

/** Returns the bot username, asking Telegram once and caching the answer. */
export async function getBotUsername(db: Db, token?: string, now: number = Date.now()): Promise<string | null> {
  const cached = await getState(db, 'bot_username');
  if (cached) return cached;
  if (!token) return null;
  try {
    const me = await getMe(token);
    if (me.username) {
      await setState(db, 'bot_username', me.username, now);
      return me.username;
    }
  } catch {
    // Telegram is unreachable. The caller treats the username as unknown.
  }
  return null;
}
