// Telegram update handling. All side effects go through `BotDeps`, so tests can replace them.
import { BotError, type ErrorCode } from '../errors';
import { errorKey, t, type Lang, type MessageKey } from '../i18n';
import { classifyUrl, extractUrls, type ClassifiedUrl } from '../platforms';
import type { MediaInfo } from '../extractors/types';
import type { MediaStream } from '../media/stream';
import { withRetry } from '../media/retry';
import type { Settings, Language } from '../settings';
import { isAddressedInGroup } from './groups';
import type { TgCallbackQuery, TgMessage, TgUpdate } from './types';
import type { InlineKeyboard } from '../telegram';

export interface PlatformState {
  enabled: boolean;
  implemented: boolean;
}

/** Per-link job context: where the result goes and the time budget for the whole job. */
export interface JobContext {
  replyTo: number;
  signal: AbortSignal;
}

export interface BotDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** True the first time an update_id is seen inside the redelivery window. */
  claimUpdate(updateId: number): Promise<boolean>;
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
  acquireJob(jobId: string, settings: Settings): Promise<boolean>;
  releaseJob(jobId: string): Promise<void>;
  sendText(chatId: number, text: string, options?: { markup?: InlineKeyboard; replyTo?: number }): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  resolve(info: ClassifiedUrl, signal: AbortSignal): Promise<MediaInfo>;
  open(info: MediaInfo, maxBytes: number, signal: AbortSignal): Promise<MediaStream>;
  sendVideo(chatId: number, media: MediaStream, info: MediaInfo, job: JobContext): Promise<void>;
  log(severity: 'info' | 'warning' | 'error', event: string, platform: string, detail: string): Promise<void>;
}

const LANG_KEYBOARD: InlineKeyboard = {
  inline_keyboard: [[
    { text: 'English', callback_data: 'lang:en' },
    { text: 'فارسی', callback_data: 'lang:fa' },
  ]],
};

const MIN_IN_MS = 60_000;
const RETRY_BASE_MS = 500;

export async function handleUpdate(update: TgUpdate, deps: BotDeps): Promise<void> {
  // Telegram redelivers an update when it does not get a 2xx answer quickly. Each update is handled once.
  if (typeof update.update_id === 'number' && !(await deps.claimUpdate(update.update_id))) return;
  if (update.callback_query) return handleCallback(update.callback_query, deps);
  const message = update.message;
  if (!message || !message.from || message.from.is_bot) return;

  const settings = await deps.settings();
  const isPrivate = message.chat.type === 'private';

  let text = (message.text ?? '').trim();
  if (!isPrivate) {
    if (settings.group_mode === 'off') return;
    const username = await deps.botUsername();
    if (!isAddressedInGroup(message, username)) return;
    // Remove our own @mention so "@ThisBot /help" is read as the /help command.
    if (username) text = text.replace(new RegExp(`@${username}\\b`, 'gi'), ' ').trim();
  }

  const telegramId = message.from.id;
  const lang = await deps.language(telegramId, settings.default_language);
  const chatId = message.chat.id;
  // Command replies quote the user's message only in groups, where it shows what the reply is about.
  const replyTo = isPrivate ? undefined : message.message_id;
  const reply = (key: MessageKey, extra: Record<string, string | number> = {}) =>
    deps.sendText(chatId, t(lang, key, { max: settings.max_file_mb, links: settings.max_links_per_message, ...extra }), { replyTo });

  if (!settings.bot_enabled) {
    if (isPrivate) await deps.sendText(chatId, settings.maintenance_message || t(lang, 'maintenance'));
    return;
  }

  const command = text.split(/\s|@/)[0].toLowerCase();
  if (command === '/start') return reply('start');
  if (command === '/help') {
    await reply('help');
    if (!isPrivate) await reply('groupHelp', { bot: (await deps.botUsername()) ?? '' });
    return;
  }
  if (command === '/language') {
    return deps.sendText(chatId, t(lang, 'languagePrompt'), { markup: LANG_KEYBOARD, replyTo });
  }

  const urls = extractUrls(text);
  if (urls.length === 0) return reply('noUrl');
  // Unrecognized links in the same message are ignored. If none is recognized, the user gets one answer.
  const recognized = urls.map((u) => classifyUrl(u)).filter((c): c is ClassifiedUrl => c !== null);
  if (recognized.length === 0) return reply('unsupportedUrl');

  const batch = recognized.slice(0, settings.max_links_per_message);
  if (recognized.length > batch.length) {
    await deps.sendText(chatId, t(lang, 'linksSkipped', { limit: batch.length }), { replyTo: message.message_id });
  }
  // Links are handled one after another, so one message never holds more than one job slot at a time.
  for (const info of batch) {
    await processLink(message, info, lang, settings, deps);
  }
}

async function processLink(
  message: TgMessage,
  classified: ClassifiedUrl,
  lang: Lang,
  settings: Settings,
  deps: BotDeps,
): Promise<void> {
  const chatId = message.chat.id;
  const replyTo = message.message_id;
  const reply = (key: MessageKey, extra: Record<string, string | number> = {}) =>
    deps.sendText(chatId, t(lang, key, { max: settings.max_file_mb, ...extra }), { replyTo });

  const state = await deps.platform(classified.platform);
  if (!state || !state.enabled) return reply('platformDisabled');
  if (!state.implemented) return reply('notImplemented');

  const userHash = await deps.hashUser(message.from!.id);
  const now = deps.now();
  if ((await deps.countRate(userHash, now - MIN_IN_MS)) >= settings.rate_limit_per_minute) {
    return reply('rateLimited', { limit: settings.rate_limit_per_minute });
  }
  // Duplicates are not counted toward the rate limit. Only a link that actually starts is.
  const dedupeKey = await deps.hashKey(`${chatId}|${classified.url}`);
  if (!(await deps.claimDedupe(dedupeKey, settings.dedupe_seconds * 1000))) return reply('duplicate');
  await deps.addRate(userHash);

  const jobId = crypto.randomUUID();
  if (!(await deps.acquireJob(jobId, settings))) return reply('busy');
  try {
    await runJob(classified, chatId, replyTo, lang, settings, deps);
  } finally {
    await deps.releaseJob(jobId).catch(() => deps.log('warning', 'job_release_failed', classified.platform, ''));
  }
}

async function runJob(
  classified: ClassifiedUrl,
  chatId: number,
  replyTo: number,
  lang: Lang,
  settings: Settings,
  deps: BotDeps,
): Promise<void> {
  const reply = (key: MessageKey, extra: Record<string, string | number> = {}) =>
    deps.sendText(chatId, t(lang, key, { max: settings.max_file_mb, ...extra }), { replyTo });
  const signal = AbortSignal.timeout(settings.download_timeout_seconds * 1000);
  const retry = { attempts: settings.retry_attempts, baseDelayMs: RETRY_BASE_MS, sleep: deps.sleep };

  // Progress is best effort. A failed status message must not stop the download.
  await reply('processing').catch(() => deps.log('warning', 'send_failed', classified.platform, 'processing'));

  const maxBytes = Math.min(settings.max_file_mb, 50) * 1_000_000;
  let media: MediaStream | null = null;
  try {
    const info = await withRetry(() => deps.resolve(classified, signal), retry);
    media = await withRetry(() => deps.open(info, maxBytes, signal), retry);
    await deps.sendVideo(chatId, media, info, { replyTo, signal });
    await deps.log('info', 'download_ok', classified.platform, '');
  } catch (error) {
    const code = codeOf(error, media, signal);
    await deps.log('error', 'download_failed', classified.platform, code);
    await reply(errorKey(code) as MessageKey).catch(() => deps.log('warning', 'send_failed', classified.platform, 'error_message'));
  }
}

function codeOf(error: unknown, media: MediaStream | null, signal: AbortSignal): ErrorCode {
  if (signal.aborted) return 'timeout';
  if (error instanceof BotError) return error.code;
  if (media?.exceededLimit()) return 'file_too_large';
  return 'internal';
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
