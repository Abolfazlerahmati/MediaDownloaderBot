// Errors the user can see. Each code maps to one clear Persian message.
// Raw upstream responses or stack traces are never shown to users.

export type ErrorCode =
  | 'not_found' // page removed or wrong URL
  | 'no_media' // page has no downloadable video
  | 'blocked' // site refused the request (403, 401, 429)
  | 'upstream_error' // other failure from the source site
  | 'file_too_large' // over MAX_UPLOAD_BYTES
  | 'telegram_error' // Telegram refused the file or the request
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

export const ERROR_MESSAGES_FA: Record<ErrorCode, string> = {
  not_found: 'صفحه پیدا نشد یا حذف شده است.',
  no_media: 'در این لینک ویدیوی قابل دانلود پیدا نشد.',
  blocked: 'سایت مبدأ درخواست را مسدود کرد. بعداً دوباره تلاش کنید.',
  upstream_error: 'خطا در دریافت از سایت مبدأ. بعداً دوباره تلاش کنید.',
  file_too_large: 'حجم فایل بیشتر از ۵۰ مگابایت است و ارسال نمی‌شود.',
  telegram_error: 'ارسال فایل به تلگرام انجام نشد.',
  internal: 'خطای داخلی رخ داد. بعداً دوباره تلاش کنید.',
};
