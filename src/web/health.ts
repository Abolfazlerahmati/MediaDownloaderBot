// Health checks and redacted diagnostics. Nothing here returns secret values, tokens, or user data.
import type { Env } from '../env';
import type { Db } from '../db/schema';
import { anyUserMustChangePassword, countLogsBySeveritySince, getSettings, listPlatforms, schemaVersion } from '../db/store';
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, MAX_UPLOAD_BYTES, PBKDF2_ITERATIONS, SESSION_TTL_MS } from '../limits';
import { getMe, getWebhookInfo, TelegramError } from '../telegram';
import { requireToken, siteOrigin, webhookSecretProblem, webhookUrlFor } from './bot-admin';

export interface HealthCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
}

export interface HealthContext {
  env: Env;
  db: Db;
  request: Request;
  now: number;
}

export async function checkHealth(ctx: HealthContext): Promise<HealthCheck[]> {
  const { env, db, request, now } = ctx;
  const checks: HealthCheck[] = [];

  try {
    const version = await schemaVersion(db);
    checks.push({ name: 'database', status: 'ok', message: `D1 reachable, schema version ${version}.` });
  } catch {
    checks.push({ name: 'database', status: 'error', message: 'D1 query failed.' });
  }

  const token = requireToken(env);
  checks.push(
    token
      ? { name: 'bot_token', status: 'ok', message: 'BOT_TOKEN secret is set.' }
      : { name: 'bot_token', status: 'error', message: 'BOT_TOKEN secret is missing.' },
  );

  const secretProblem = webhookSecretProblem(env.WEBHOOK_SECRET);
  checks.push(
    secretProblem
      ? { name: 'webhook_secret', status: 'error', message: secretProblem }
      : { name: 'webhook_secret', status: 'ok', message: 'WEBHOOK_SECRET is set and well formed.' },
  );

  const expected = webhookUrlFor(siteOrigin(request));
  if (token) {
    try {
      const me = await getMe(token);
      checks.push({ name: 'telegram_api', status: 'ok', message: `Telegram accepted the token (@${me.username ?? 'unknown'}).` });
    } catch (error) {
      checks.push({
        name: 'telegram_api',
        status: 'error',
        message: error instanceof TelegramError ? `Telegram said: ${error.description}` : 'Telegram is unreachable.',
      });
    }
    try {
      const info = await getWebhookInfo(token);
      if (info.url === expected) {
        const pending = info.pending_update_count ?? 0;
        checks.push({
          name: 'webhook',
          status: info.last_error_message ? 'warning' : 'ok',
          message: info.last_error_message
            ? `Registered, but Telegram reported an error: ${info.last_error_message}`
            : `Registered (${pending} pending updates).`,
        });
      } else {
        checks.push({ name: 'webhook', status: 'warning', message: 'Not registered for this site. Use “Register webhook”.' });
      }
    } catch {
      checks.push({ name: 'webhook', status: 'warning', message: 'Could not read webhook status.' });
    }
  } else {
    checks.push({ name: 'telegram_api', status: 'warning', message: 'Skipped: BOT_TOKEN is missing.' });
    checks.push({ name: 'webhook', status: 'warning', message: 'Skipped: BOT_TOKEN is missing.' });
  }

  for (const p of await listPlatforms(db)) {
    if (!p.enabled) continue;
    if (!p.implemented) {
      checks.push({ name: `platform_${p.key}`, status: 'error', message: `${p.name} is enabled but not implemented.` });
    } else if (!p.sample_url) {
      checks.push({ name: `platform_${p.key}`, status: 'warning', message: `${p.name}: add a sample link and run a test.` });
    } else if (p.last_test_ok === 0) {
      checks.push({ name: `platform_${p.key}`, status: 'warning', message: `${p.name}: last test failed. ${p.last_test_message}` });
    } else if (p.last_test_ok === null) {
      checks.push({ name: `platform_${p.key}`, status: 'warning', message: `${p.name}: not tested yet.` });
    } else {
      checks.push({ name: `platform_${p.key}`, status: 'ok', message: `${p.name}: last test passed.` });
    }
  }

  if (await anyUserMustChangePassword(db)) {
    checks.push({ name: 'admin_password', status: 'warning', message: 'The default admin password has not been changed.' });
  }
  return checks;
}

export async function diagnostics(ctx: HealthContext): Promise<Record<string, unknown>> {
  const { env, db, now } = ctx;
  const settings = await getSettings(db);
  const platforms = await listPlatforms(db);
  const logs = await countLogsBySeveritySince(db, now - 86_400_000);
  const secret = webhookSecretProblem(env.WEBHOOK_SECRET);
  return {
    app_version: '2.0.0',
    runtime: 'cloudflare-workers',
    running_version: {
      id: env.CF_VERSION_METADATA?.id ?? null,
      uploaded_at: env.CF_VERSION_METADATA?.timestamp ?? null,
    },
    schema_version: await schemaVersion(db),
    secrets: {
      BOT_TOKEN: requireToken(env) ? 'set' : 'missing',
      WEBHOOK_SECRET: secret ? 'missing or invalid' : 'set',
    },
    limits: {
      max_upload_bytes: MAX_UPLOAD_BYTES,
      pbkdf2_iterations: PBKDF2_ITERATIONS,
      session_ttl_hours: SESSION_TTL_MS / 3_600_000,
      login_max_failures: LOGIN_MAX_FAILURES,
      login_window_minutes: LOGIN_WINDOW_MS / 60_000,
    },
    settings,
    platforms: platforms.map((p) => ({ key: p.key, enabled: p.enabled === 1, implemented: p.implemented === 1 })),
    logs_last_24h: logs,
  };
}
