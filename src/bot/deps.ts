// Production wiring for the bot: D1 store, Telegram API, and the media pipeline.
import { BotError } from '../errors';
import type { Env } from '../env';
import type { Db } from '../db/schema';
import {
  acquireJobSlot,
  addRateEvent,
  claimDedupeKey,
  countRateEvents,
  getLanguage,
  getPlatform,
  getSettings,
  releaseJobSlot,
  setLanguage,
  writeLog,
} from '../db/store';
import { resolveMedia } from '../extractors';
import { fetchPage } from '../extractors/page';
import { postPlayer } from '../extractors/youtube';
import { openMedia, type MediaStream } from '../media/stream';
import { fileNameFor } from '../media/validate';
import { sha256Hex } from '../security/crypto';
import { getBotUsername, requireToken } from '../web/bot-admin';
import { answerCallbackQuery, sendMessage, sendVideoStream, TelegramError } from '../telegram';
import type { BotDeps, PlatformState } from './handler';
import type { Settings, Language } from '../settings';

const DAY_MS = 86_400_000;
/** Telegram may redeliver an update for up to a day, so each update_id is remembered that long. */
const UPDATE_WINDOW_MS = DAY_MS;

export function productionBotDeps(env: Env, db: Db): BotDeps {
  const token = requireToken(env) ?? '';
  const secret = env.WEBHOOK_SECRET ?? '';
  let cachedSettings: Settings | null = null;
  const now = () => Date.now();
  const settings = async (): Promise<Settings> => (cachedSettings ??= await getSettings(db));

  return {
    now,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    claimUpdate: async (updateId: number) =>
      claimDedupeKey(db, await sha256Hex(`update:${updateId}:${secret}`), now(), UPDATE_WINDOW_MS),
    settings,
    botUsername: () => getBotUsername(db, token, now()),
    // With store_language off, the stored choice is ignored and nothing new is written (temporary mode).
    language: async (telegramId: number, fallback: Language) =>
      (await settings()).store_language ? getLanguage(db, telegramId, fallback) : fallback,
    setLanguage: async (telegramId: number, lang: Language) => {
      if ((await settings()).store_language) await setLanguage(db, telegramId, lang, now());
    },
    platform: async (key: string): Promise<PlatformState | null> => {
      const row = await getPlatform(db, key);
      return row ? { enabled: row.enabled === 1, implemented: row.implemented === 1 } : null;
    },
    hashUser: (telegramId: number) => sha256Hex(`user:${telegramId}:${secret}`),
    hashKey: (value: string) => sha256Hex(`key:${value}:${secret}`),
    countRate: (userHash: string, sinceMs: number) => countRateEvents(db, userHash, sinceMs),
    addRate: (userHash: string) => addRateEvent(db, userHash, now()),
    claimDedupe: (keyHash: string, windowMs: number) => claimDedupeKey(db, keyHash, now(), windowMs),
    acquireJob: (jobId: string, s: Settings) =>
      acquireJobSlot(db, jobId, now(), s.max_concurrent_jobs, s.download_timeout_seconds * 1000 + 60_000),
    releaseJob: (jobId: string) => releaseJobSlot(db, jobId),
    sendText: async (chatId, text, options) => {
      await sendMessage(token, chatId, text, { markup: options?.markup, replyTo: options?.replyTo });
    },
    answerCallback: async (callbackId, text) => {
      await answerCallbackQuery(token, callbackId, text);
    },
    resolve: (info, signal) =>
      resolveMedia(info.platform, info.url, {
        page: (url) => fetchPage(url, signal),
        youtubePlayer: (videoId, client) => postPlayer(videoId, client, signal),
      }),
    open: (info, maxBytes, signal) => openMedia(info.videoUrl, info.referer, maxBytes, signal),
    sendVideo: async (chatId, media: MediaStream, info, job) => {
      try {
        await sendVideoStream(
          token,
          chatId,
          { name: fileNameFor(info.title, info.platform), contentType: media.contentType, body: media.body },
          info.title,
          { replyTo: job.replyTo, signal: job.signal },
        );
      } catch (error) {
        if (job.signal.aborted) throw new BotError('timeout', 'upload timed out');
        if (media.exceededLimit()) throw new BotError('file_too_large');
        if (error instanceof BotError) throw error;
        if (error instanceof TelegramError) throw new BotError('telegram_error');
        throw new BotError('upstream_error', 'media stream failed');
      }
    },
    log: (severity, event, platform, detail) => writeLog(db, now(), severity, event, platform, detail),
  };
}
