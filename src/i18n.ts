// Bot messages in English and Persian. Persian text is a first draft and needs native review.
import type { ErrorCode } from './errors';

export type Lang = 'en' | 'fa';

const EN = {
  start:
    'Send a public TikTok, Pinterest, YouTube, or Instagram link and I will send the video here.\n' +
    'Maximum file size: {max} MB.',
  help:
    'Send a public link. Private or login-only content is not supported.\n' +
    'Commands: /start, /help, /language\n' +
    'Supported: TikTok, Pinterest, YouTube, and Instagram (public links). Maximum file size: {max} MB.',
  languagePrompt: 'Choose your language:',
  languageSet: 'Language set to English.',
  noUrl: 'Please send a link.',
  unsupportedUrl: 'This link is not from a supported site.',
  notImplemented: 'Downloads from this site are not implemented in this version.',
  platformDisabled: 'Downloads from this site are turned off right now.',
  rateLimited: 'Too many requests. The limit is {limit} per minute. Try again shortly.',
  duplicate: 'This link is already being processed.',
  processing: 'Processing…',
  maintenance: 'The bot is paused for maintenance. Please try again later.',
  err_not_found: 'The page was not found or was removed.',
  err_no_media: 'No downloadable video was found at this link.',
  err_blocked: 'The source site blocked the request. Try again later.',
  err_upstream_error: 'Could not get the video from the source site. Try again later.',
  err_file_too_large: 'The file is larger than {max} MB, so it cannot be sent.',
  err_invalid_media: 'The downloaded file is not a valid MP4 video.',
  err_telegram_error: 'Telegram did not accept the file. Try again later.',
  err_not_implemented: 'Downloads from this site are not implemented in this version.',
  err_internal: 'An internal error occurred. Try again later.',
};

const FA: typeof EN = {
  start:
    'یک لینک عمومی TikTok، Pinterest، YouTube یا Instagram بفرستید تا ویدیو را همین‌جا برایتان بفرستم.\n' +
    'حداکثر حجم فایل: {max} مگابایت.',
  help:
    'فقط لینک عمومی بفرستید. محتوای خصوصی یا محتوایی که نیاز به ورود دارد پشتیبانی نمی‌شود.\n' +
    'دستورها: /start، /help، /language\n' +
    'پشتیبانی‌شده: TikTok، Pinterest، YouTube و Instagram (فقط لینک‌های عمومی). حداکثر حجم فایل: {max} مگابایت.',
  languagePrompt: 'زبان را انتخاب کنید:',
  languageSet: 'زبان به فارسی تغییر کرد.',
  noUrl: 'لطفاً یک لینک بفرستید.',
  unsupportedUrl: 'این لینک از یک سایت پشتیبانی‌شده نیست.',
  notImplemented: 'دانلود از این سایت در این نسخه پیاده‌سازی نشده است.',
  platformDisabled: 'دانلود از این سایت در حال حاضر غیرفعال است.',
  rateLimited: 'تعداد درخواست‌ها زیاد است. حداکثر {limit} درخواست در دقیقه مجاز است. کمی بعد دوباره تلاش کنید.',
  duplicate: 'این لینک همین حالا در حال پردازش است.',
  processing: 'در حال پردازش…',
  maintenance: 'ربات برای نگهداری موقتاً متوقف شده است. بعداً دوباره تلاش کنید.',
  err_not_found: 'صفحه پیدا نشد یا حذف شده است.',
  err_no_media: 'در این لینک ویدیوی قابل دانلود پیدا نشد.',
  err_blocked: 'سایت مبدأ درخواست را مسدود کرد. بعداً دوباره تلاش کنید.',
  err_upstream_error: 'دریافت ویدیو از سایت مبدأ انجام نشد. بعداً دوباره تلاش کنید.',
  err_file_too_large: 'حجم فایل بیشتر از {max} مگابایت است و ارسال نمی‌شود.',
  err_invalid_media: 'فایل دریافتی یک ویدیوی MP4 معتبر نیست.',
  err_telegram_error: 'تلگرام فایل را نپذیرفت. بعداً دوباره تلاش کنید.',
  err_not_implemented: 'دانلود از این سایت در این نسخه پیاده‌سازی نشده است.',
  err_internal: 'خطای داخلی رخ داد. بعداً دوباره تلاش کنید.',
};

export type MessageKey = keyof typeof EN;

const TABLES: Record<Lang, Record<MessageKey, string>> = { en: EN, fa: FA };

export function t(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  let text = TABLES[lang][key];
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

export function errorKey(code: ErrorCode): MessageKey {
  return `err_${code}` as MessageKey;
}
