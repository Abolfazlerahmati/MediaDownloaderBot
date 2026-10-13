// Minimal Telegram Bot API client. It uses only the methods this bot needs.
const API_BASE = 'https://api.telegram.org';

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly description: string,
  ) {
    // Never include the token. Only the method name and Telegram's description are kept.
    super(`telegram ${method} failed: ${status} ${description}`);
    this.name = 'TelegramError';
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export async function callTelegram<T>(token: string, method: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !data?.ok) {
    throw new TelegramError(method, res.status, data?.description ?? 'no response body');
  }
  return data.result as T;
}

export function sendMessage(token: string, chatId: number, text: string): Promise<unknown> {
  return callTelegram(token, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
}

export interface MultipartPlan {
  body: ReadableStream<Uint8Array>;
  boundary: string;
}

const encoder = new TextEncoder();

/** Removes characters that would break the Content-Disposition header. */
export function safeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, '_').slice(0, 120) || 'video.mp4';
}

/**
 * Builds a multipart/form-data body that streams `file` without buffering it.
 * Telegram accepts the request without a Content-Length header, so the length is not declared.
 */
export function buildMultipart(
  fields: Record<string, string>,
  file: { name: string; contentType: string; body: ReadableStream<Uint8Array> },
): MultipartPlan {
  const boundary = `----mediabot${crypto.randomUUID().replace(/-/g, '')}`;
  let head = '';
  for (const [key, value] of Object.entries(fields)) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
  }
  head += `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${safeFilename(file.name)}"\r\n`;
  head += `Content-Type: ${file.contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;

  const reader = file.body.getReader();
  const headBytes = encoder.encode(head);
  const tailBytes = encoder.encode(tail);
  let sentHead = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentHead) {
        sentHead = true;
        controller.enqueue(headBytes);
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(tailBytes);
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return { body, boundary };
}

export async function sendVideoStream(
  token: string,
  chatId: number,
  file: { name: string; contentType: string; body: ReadableStream<Uint8Array> },
  caption?: string,
): Promise<void> {
  const fields: Record<string, string> = { chat_id: String(chatId), supports_streaming: 'true' };
  if (caption) fields.caption = caption.slice(0, 1024);
  const plan = buildMultipart(fields, file);
  const res = await fetch(`${API_BASE}/bot${token}/sendVideo`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${plan.boundary}` },
    body: plan.body,
  });
  const data = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
  if (!res.ok || !data?.ok) {
    throw new TelegramError('sendVideo', res.status, data?.description ?? 'no response body');
  }
}
