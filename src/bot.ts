// Telegram update handling. All side effects go through `Deps`, so tests can replace them.
import { classifyUrl, extractFirstUrl, type ClassifiedUrl } from './platforms';
import { ERROR_MESSAGES_FA, BotError } from './errors';
import { RATE_LIMIT_PER_MINUTE } from './limits';
import { resolveMedia, UNSUPPORTED_PLATFORMS, type MediaInfo } from './extractors';
import { openMedia, type MediaStream } from './media';
import { sendMessage as tgSendMessage, sendVideoStream } from './telegram';
import type { Store } from './db';

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; is_bot?: boolean };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface Deps {
  store: Store;
  sendText(chatId: number, text: string): Promise<void>;
  resolve(info: ClassifiedUrl): Promise<MediaInfo>;
  open(info: MediaInfo): Promise<MediaStream>;
  sendVideo(chatId: number, media: MediaStream, info: MediaInfo): Promise<void>;
  now(): Date;
  log(event: string, detail: Record<string, string | number>): void;
}

export const TEXT = {
  start:
    'سلام! لینک عمومی ویدیوی TikTok یا Pinterest را بفرستید تا فایل را برایتان ارسال کنم.\n' +
    'دانلود از YouTube و Instagram در این نسخه هنوز پشتیبانی نمی‌شود.\n' +
    'حداکثر حجم فایل: ۵۰ مگابایت.',
  help:
    'فقط لینک‌های عمومی را بفرستید. لینک خصوصی یا نیازمند ورود کار نمی‌کند.\n' +
    'پلتفرم‌های فعال: TikTok، Pinterest.\n' +
    'حداکثر حجم فایل: ۵۰ مگابایت.',
  noUrl: 'لطفاً یک لینک بفرستید.',
  unsupportedUrl: 'این لینک از سایت‌های پشتیبانی‌شده نیست.',
  notImplemented: 'دانلود از YouTube و Instagram روی Cloudflare Workers هنوز پیاده‌سازی نشده است.',
  rateLimited: `تعداد درخواست‌های شما زیاد است. حداکثر ${RATE_LIMIT_PER_MINUTE} درخواست در دقیقه مجاز است.`,
  processing: 'در حال پردازش…',
  done: 'ارسال شد.',
};

export async function handleUpdate(update: TelegramUpdate, deps: Deps): Promise<void> {
  const message = update.message;
  if (!message || !message.from || message.from.is_bot) return;
  const chatId = message.chat.id;
  const text = (message.text ?? '').trim();

  if (text === '/start' || text.startsWith('/start ')) return deps.sendText(chatId, TEXT.start);
  if (text === '/help' || text.startsWith('/help@')) return deps.sendText(chatId, TEXT.help);

  const rawUrl = extractFirstUrl(text);
  if (!rawUrl) return deps.sendText(chatId, TEXT.noUrl);

  const classified = classifyUrl(rawUrl);
  if (!classified) return deps.sendText(chatId, TEXT.unsupportedUrl);
  if (UNSUPPORTED_PLATFORMS.has(classified.platform) || !classified.supported) {
    return deps.sendText(chatId, TEXT.notImplemented);
  }

  const telegramId = message.from.id;
  await deps.store.upsertUser(telegramId, message.from.username ?? null);

  const since = new Date(deps.now().getTime() - 60_000).toISOString();
  if ((await deps.store.countRecentJobs(telegramId, since)) >= RATE_LIMIT_PER_MINUTE) {
    return deps.sendText(chatId, TEXT.rateLimited);
  }

  const host = new URL(classified.url).hostname;
  const jobId = await deps.store.createJob({ telegramId, chatId, platform: classified.platform, host });
  // The progress message is best effort. A failure must not leave the job stuck in 'pending'.
  await deps.sendText(chatId, TEXT.processing).catch(() => deps.log('send_failed', { step: 'processing' }));

  let media: MediaStream | null = null;
  try {
    const info = await deps.resolve(classified);
    media = await deps.open(info);
    await deps.sendVideo(chatId, media, info);
    await deps.store.finishJob(jobId, 'done', null);
    deps.log('download_ok', { platform: classified.platform });
  } catch (error) {
    const code = error instanceof BotError ? error.code : media?.exceededLimit() ? 'file_too_large' : 'internal';
    await deps.store.finishJob(jobId, 'failed', code);
    deps.log('download_failed', { platform: classified.platform, code });
    await deps.sendText(chatId, ERROR_MESSAGES_FA[code]);
  }
}

/** Production wiring: real D1 store and Telegram API. */
export function productionDeps(token: string, store: Store): Deps {
  return {
    store,
    sendText: async (chatId, text) => {
      await tgSendMessage(token, chatId, text);
    },
    resolve: (info) => resolveMedia(info.platform, info.url),
    open: (info) => openMedia(info.videoUrl, info.referer),
    sendVideo: async (chatId, media, info) => {
      try {
        await sendVideoStream(
          token,
          chatId,
          { name: `${info.platform}-${Date.now()}.mp4`, contentType: media.contentType, body: media.body },
          info.title,
        );
      } catch (error) {
        if (media.exceededLimit()) throw new BotError('file_too_large');
        if (error instanceof BotError) throw error;
        throw new BotError('telegram_error');
      }
    },
    now: () => new Date(),
    log: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
  };
}
