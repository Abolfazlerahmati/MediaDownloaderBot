// Minimal Telegram Bot API client. Errors never include the token.
import { buildMultipart } from './media/multipart';

const API_BASE = 'https://api.telegram.org';

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly description: string,
  ) {
    super(`telegram ${method} failed: ${status} ${description}`);
    this.name = 'TelegramError';
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function parseEnvelope<T>(method: string, res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !data?.ok) throw new TelegramError(method, res.status, (data?.description ?? 'no response body').slice(0, 300));
  return data.result as T;
}

export async function callTelegram<T>(token: string, method: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  }).catch(() => {
    throw new TelegramError(method, 0, 'network error');
  });
  return parseEnvelope<T>(method, res);
}

export interface BotInfo {
  id: number;
  username?: string;
  first_name?: string;
}

export function getMe(token: string): Promise<BotInfo> {
  return callTelegram<BotInfo>(token, 'getMe', {});
}

export interface WebhookInfo {
  url: string;
  pending_update_count?: number;
  last_error_message?: string;
  last_error_date?: number;
}

export function getWebhookInfo(token: string): Promise<WebhookInfo> {
  return callTelegram<WebhookInfo>(token, 'getWebhookInfo', {});
}

export function setWebhook(token: string, url: string, secret: string): Promise<boolean> {
  return callTelegram<boolean>(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
}

export function deleteWebhook(token: string): Promise<boolean> {
  return callTelegram<boolean>(token, 'deleteWebhook', { drop_pending_updates: false });
}

export interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/** reply_parameters keeps the reply even if the original message was deleted meanwhile. */
export function replyParameters(messageId: number | undefined): { reply_parameters: { message_id: number; allow_sending_without_reply: true } } | {} {
  return messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {};
}

export function sendMessage(
  token: string,
  chatId: number,
  text: string,
  options: { markup?: InlineKeyboard; replyTo?: number } = {},
): Promise<unknown> {
  return callTelegram(token, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(options.markup ? { reply_markup: options.markup } : {}),
    ...replyParameters(options.replyTo),
  });
}

export function answerCallbackQuery(token: string, callbackId: string, text?: string): Promise<unknown> {
  return callTelegram(token, 'answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

/** Streams the video as multipart. Telegram receives the bytes as they arrive from the source. */
export async function sendVideoStream(
  token: string,
  chatId: number,
  file: { name: string; contentType: string; body: ReadableStream<Uint8Array> },
  caption?: string,
  options: { replyTo?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const fields: Record<string, string> = { chat_id: String(chatId), supports_streaming: 'true' };
  if (caption) fields.caption = caption.slice(0, 1024);
  if (options.replyTo) {
    fields.reply_parameters = JSON.stringify({ message_id: options.replyTo, allow_sending_without_reply: true });
  }
  const plan = buildMultipart(fields, { fieldName: 'video', ...file });
  const res = await fetch(`${API_BASE}/bot${token}/sendVideo`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${plan.boundary}` },
    body: plan.body,
    signal: options.signal,
  }).catch(() => {
    throw new TelegramError('sendVideo', 0, 'network error');
  });
  await parseEnvelope('sendVideo', res);
}
