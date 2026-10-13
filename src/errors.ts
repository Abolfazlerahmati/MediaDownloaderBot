// Errors the user can see. Each code maps to a fixed message (see i18n.ts). Raw details are logged only.

export type ErrorCode =
  | 'not_found' // page removed or wrong URL
  | 'no_media' // page has no downloadable video
  | 'blocked' // site refused the request (401, 403, 429)
  | 'upstream_error' // other failure from the source site
  | 'file_too_large' // over MAX_UPLOAD_BYTES
  | 'invalid_media' // the downloaded bytes are not an MP4 file
  | 'telegram_error' // Telegram refused the file or the request
  | 'not_implemented' // platform is listed but not implemented on Workers
  | 'internal';

export class BotError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BotError';
  }
}
