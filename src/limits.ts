// Hard limits. Keep them here so tests and docs reference one source of truth.

/** Largest file the bot will send. Larger files get a clear error (no partial send). */
export const MAX_UPLOAD_BYTES = 50_000_000; // 50 MB, as Telegram's Bot API documents it

/** Largest HTML page the bot will read while looking for a video. */
export const MAX_PAGE_BYTES = 5_000_000;

/** Largest webhook body accepted from Telegram. Real updates are a few KB. */
export const MAX_WEBHOOK_BYTES = 64 * 1024;

/** Downloads a single user may start per rolling minute. */
export const RATE_LIMIT_PER_MINUTE = 5;

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
