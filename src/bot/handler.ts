// Telegram update handling. All side effects go through `BotDeps`, so tests can replace them.
import { BotError, type ErrorCode } from '../errors';
import { errorKey, t, type Lang, type MessageKey } from '../i18n';
import { classifyUrl, extractFirstUrl, type ClassifiedUrl } from '../platforms';
import type { MediaInfo } from '../extractors/types';
import type { MediaStream } from '../media/stream';
import type { Settings, Language } from '../settings';
import { isAddressedInGroup } from './groups';
import type { TgCallbackQuery, TgMessage, TgUpdate } from './types';
import type { InlineKeyboard } from '../telegram';

export interface PlatformState {
  enabled: boolean;
  implemented: boolean;
}

export interface BotDeps {
  now(): number;
  settings(): Promise<Settings>;
  botUsername(): Promise<string | null>;
  language(telegramId: number, fallback: Language): Promise<Language>;
  setLanguage(telegramId: number, lang: Language): Promise<void>;
  platform(key: string): Promise<PlatformState | null>;
  hashUser(telegramId: number): Promise<string>;
  hashKey(value: string): Promise<string>;
  countRate(userHash: string, sinceMs: number): Promise<number>;
  addRate(userHash: string): Promise<void>;
  claimDedupe(keyHash: string, windowMs: number): Promise<boolean>;
  sendText(chatId: number, text: string, markup?: InlineKeyboard): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  resolve(info: ClassifiedUrl): Promise<MediaInfo>;
  open(info: MediaInfo, maxBytes: number): Promise<MediaStream>;
  sendVideo(chatId: number, media: MediaStream, info: MediaInfo): Promise<void>;
  log(severity: 'info' | 'warning' | 'error', event: string, platform: string, detail: string): Promise<void>;
}

const LANG_KEYBOARD: InlineKeyboard = {
  inline_keyboard: [[
    { text: 'English', callback_data: 'lang:en' },
    { text: 'فارسی', callback_data: 'lang:fa' },
  ]],
};

export async function handleUpdate(update: TgUpdate, deps: BotDeps): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query, deps);
  const message = update.message;
  if (!message || !message.from || message.from.is_bot) return;

  const settings = await deps.settings();
  const isPrivate = message.chat.type === 'private';
  const text = (message.text ?? '').trim();

  if (!isPrivate) {
    if (settings.group_mode === 'off') return;
    if (!isAddressedInGroup(message, await deps.botUsername())) return;
  }

  const telegramId = message.from.id;
  const lang = await deps.language(telegramId, settings.default_language);
  const chatId = message.chat.id;
  const reply = (key: MessageKey, vars: Record<string, string | number> = {}, markup?: InlineKeyboard) =>
    deps.sendText(chatId, t(lang, key, { max: settings.max_file_mb, ...vars }), markup);

  if (!settings.bot_enabled) {
    if (isPrivate && settings.maintenance_message) await deps.sendText(chatId, settings.maintenance_message);
    else if (isPrivate) await reply('maintenance');
    return;
  }

  const command = text.split(/\s|@/)[0].toLowerCase();
  if (command === '/start') return reply('start');
  if (command === '/help') return reply('help');
  if (command === '/language') return deps.sendText(chatId, t(lang, 'languagePrompt'), LANG_KEYBOARD);

  const rawUrl = extractFirstUrl(text);
  if (!rawUrl) return reply('noUrl');
  return processLink(message, rawUrl, lang, settings, deps);
}

async function processLink(
  message: TgMessage,
  rawUrl: string,
  lang: Lang,
  settings: Settings,
  deps: BotDeps,
): Promise<void> {
  const chatId = message.chat.id;
  const from = message.from!;
  const reply = (key: MessageKey, vars: Record<string, string | number> = {}) =>
    deps.sendText(chatId, t(lang, key, { max: settings.max_file_mb, ...vars }));

  const classified = classifyUrl(rawUrl);
  if (!classified) return reply('unsupportedUrl');

  const state = await deps.platform(classified.platform);
  if (!state || !state.enabled) return reply('platformDisabled');
  if (!state.implemented) return reply('notImplemented');

  const userHash = await deps.hashUser(from.id);
  const now = deps.now();
  const used = await deps.countRate(userHash, now - 60_000);
  if (used >= settings.rate_limit_per_minute) {
    return reply('rateLimited', { limit: settings.rate_limit_per_minute });
  }
  await deps.addRate(userHash);

  const dedupeKey = await deps.hashKey(`${chatId}|${classified.url}`);
  if (!(await deps.claimDedupe(dedupeKey, settings.dedupe_seconds * 1000))) return reply('duplicate');

  // Progress is best effort. A failed status message must not stop the download.
  await deps.sendText(chatId, t(lang, 'processing')).catch(() => deps.log('warning', 'send_failed', classified.platform, 'processing'));

  const maxBytes = Math.min(settings.max_file_mb, 50) * 1_000_000;
  let media: MediaStream | null = null;
  try {
    const info = await deps.resolve(classified);
    media = await deps.open(info, maxBytes);
    await deps.sendVideo(chatId, media, info);
    await deps.log('info', 'download_ok', classified.platform, '');
  } catch (error) {
    const code: ErrorCode = error instanceof BotError ? error.code : media?.exceededLimit() ? 'file_too_large' : 'internal';
    await deps.log('error', 'download_failed', classified.platform, code);
    await deps.sendText(chatId, t(lang, errorKey(code), { max: settings.max_file_mb })).catch(() =>
      deps.log('warning', 'send_failed', classified.platform, 'error_message'),
    );
  }
}

async function handleCallback(query: TgCallbackQuery, deps: BotDeps): Promise<void> {
  const data = query.data ?? '';
  const match = data.match(/^lang:(en|fa)$/);
  if (!match) {
    await deps.answerCallback(query.id);
    return;
  }
  const lang = match[1] as Language;
  await deps.setLanguage(query.from.id, lang);
  await deps.answerCallback(query.id);
  const chatId = query.message?.chat.id;
  if (chatId !== undefined) await deps.sendText(chatId, t(lang, 'languageSet'));
}
