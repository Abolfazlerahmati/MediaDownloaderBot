import { BotError } from './errors';
import { BROWSER_USER_AGENT, MAX_UPLOAD_BYTES } from './limits';

export interface MediaStream {
  body: ReadableStream<Uint8Array>;
  /** Size from Content-Length, or null when the source did not declare one. */
  size: number | null;
  contentType: string;
  /** True if the stream was cut off because it went over MAX_UPLOAD_BYTES. */
  exceededLimit(): boolean;
}

/**
 * Opens a streaming download of the video. The body is never buffered whole, because a Worker has
 * 128 MB of memory. Oversize files are rejected from Content-Length when possible, and otherwise
 * while streaming.
 */
export async function openMedia(videoUrl: string, referer: string): Promise<MediaStream> {
  const res = await fetch(videoUrl, {
    headers: {
      'user-agent': BROWSER_USER_AGENT,
      referer,
      accept: 'video/mp4,video/*;q=0.9,*/*;q=0.5',
    },
    redirect: 'follow',
  }).catch(() => {
    throw new BotError('upstream_error', 'media request failed');
  });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new BotError('blocked', `media status ${res.status}`);
  }
  if (!res.ok || !res.body) throw new BotError('upstream_error', `media status ${res.status}`);

  const declared = Number(res.headers.get('content-length'));
  const size = Number.isFinite(declared) && declared > 0 ? declared : null;
  if (size !== null && size > MAX_UPLOAD_BYTES) {
    await res.body.cancel();
    throw new BotError('file_too_large', `declared ${size} bytes`);
  }

  const state = { exceeded: false };
  return {
    body: limitStream(res.body, MAX_UPLOAD_BYTES, state),
    size,
    contentType: res.headers.get('content-type') ?? 'video/mp4',
    exceededLimit: () => state.exceeded,
  };
}

/** Passes chunks through and errors the stream as soon as the running total passes `max`. */
export function limitStream(
  source: ReadableStream<Uint8Array>,
  max: number,
  state: { exceeded: boolean },
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > max) {
        state.exceeded = true;
        await reader.cancel().catch(() => undefined);
        controller.error(new BotError('file_too_large', `over ${max} bytes`));
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}
