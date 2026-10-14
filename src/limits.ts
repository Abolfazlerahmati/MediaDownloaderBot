// Hard limits and defaults in one place. Settings in the panel can only go within these bounds.

/** Largest file the bot sends. Larger files get a clear error. Telegram's Bot API upload limit is 50 MB. */
export const MAX_UPLOAD_BYTES = 50_000_000;

/** Largest HTML page the bot reads while looking for a video. */
export const MAX_PAGE_BYTES = 5_000_000;

/** Largest webhook body accepted from Telegram. Real updates are a few KB. */
export const MAX_WEBHOOK_BYTES = 64 * 1024;

/** Largest JSON body the panel accepts. */
export const MAX_PANEL_BODY_BYTES = 16 * 1024;

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const PASSWORD_MIN_LENGTH = 12;
/**
 * PBKDF2-SHA256 iterations. Workers Free allows 10 ms of CPU per request, and higher counts exceed it.
 * The hash string stores its own count, so it can be raised on a paid plan without breaking old hashes.
 */
export const PBKDF2_ITERATIONS = 20_000;

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
