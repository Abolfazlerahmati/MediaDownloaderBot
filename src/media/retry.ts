// Retries only transient source-site failures. Permanent failures (not found, blocked, no media,
// too large, invalid file) and timeouts are never retried.
import { BotError } from '../errors';

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

export function isTransient(error: unknown): boolean {
  return error instanceof BotError && error.code === 'upstream_error';
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const attempts = Math.max(1, Math.floor(opts.attempts));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransient(error) || attempt >= attempts) throw error;
      await opts.sleep(opts.baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
