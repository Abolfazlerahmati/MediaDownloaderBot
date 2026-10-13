// Production wiring for the bot: D1 store, Telegram API, and the media pipeline.
import { BotError } from '../errors';
import type { Env } from '../env';
import type { Db } from '../db/schema';
import {
  addRateEvent,
  claimDedupeKey,
  countRateEvents,
  getLanguage,
  getPlatform,
  getSettings,
  setLanguage,
  writeLog,
} from '../db/store';
import { resolveMedia } from '../extractors';
import { openMedia, type MediaStream } from '../media/stream';
import { fileNameFor } from '../media/validate';
import { sha256Hex } from '../security/crypto';
import { getBotUsername, requireToken } from '../web/bot-admin';
import { answerCallbackQuery, sendMessage, sendVideoStream, TelegramError } from '../telegram';
import type { BotDeps, PlatformState } from './handler';
import type { Settings, Language } from '../settings';

export function productionBotDeps(env: Env, db: Db): BotDeps {
  const token = requireToken(env) ?? '';
  const secret = env.WEBHOOK_SECRET ?? '';
  let cachedSettings: Settings | null = null;
  const now = () => Date.now();

  return {
    now,
    settings: async () => (cachedSettings ??= await getSettings(db)),
    botUsername: () => getBotUsername(db, token, now()),
    language: (telegramId: number, fallback: Language) => getLanguage(db, telegramId, fallback),
    setLanguage: (telegramId: number, lang: Language) => setLanguage(db, telegramId, lang, now()),
    platform: async (key: string): Promise<PlatformState | null> => {
      const row = await getPlatform(db, key);
      return row ? { enabled: row.enabled === 1, implemented: row.implemented === 1 } : null;
    },
    hashUser: (telegramId: number) => sha256Hex(`user:${telegramId}:${secret}`),
    hashKey: (value: string) => sha256Hex(`key:${value}:${secret}`),
    countRate: (userHash: string, sinceMs: number) => countRateEvents(db, userHash, sinceMs),
    addRate: (userHash: string) => addRateEvent(db, userHash, now()),
    claimDedupe: (keyHash: string, windowMs: number) => claimDedupeKey(db, keyHash, now(), windowMs),
    sendText: async (chatId, text, markup) => {
      await sendMessage(token, chatId, text, markup);
    },
    answerCallback: async (callbackId, text) => {
      await answerCallbackQuery(token, callbackId, text);
    },
    resolve: (info) => resolveMedia(info.platform, info.url),
    open: (info, maxBytes) => openMedia(info.videoUrl, info.referer, maxBytes),
    sendVideo: async (chatId, media: MediaStream, info) => {
      try {
        await sendVideoStream(
          token,
          chatId,
          { name: fileNameFor(info.title, info.platform), contentType: media.contentType, body: media.body },
          info.title,
        );
      } catch (error) {
        if (media.exceededLimit()) throw new BotError('file_too_large');
        if (error instanceof BotError) throw error;
        if (error instanceof TelegramError) throw new BotError('telegram_error');
        throw new BotError('upstream_error', 'media stream failed');
      }
    },
    log: (severity, event, platform, detail) => writeLog(db, now(), severity, event, platform, detail),
  };
}
