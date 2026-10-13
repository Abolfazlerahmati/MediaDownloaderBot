// Streaming download with a size cap and an MP4 header check. The body is never buffered whole,
// because a Worker has 128 MB of memory.
import { BotError } from '../errors';
import { BROWSER_USER_AGENT } from '../limits';
import { isMp4Header } from './validate';

export interface MediaStream {
  body: ReadableStream<Uint8Array>;
  /** Size from Content-Length, or null when the source did not declare one. */
  size: number | null;
  contentType: string;
  /** True if the stream was cut off because it went over the cap. */
  exceededLimit(): boolean;
}

export async function openMedia(videoUrl: string, referer: string, maxBytes: number): Promise<MediaStream> {
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
  if (size !== null && size > maxBytes) {
    await res.body.cancel().catch(() => undefined);
    throw new BotError('file_too_large', `declared ${size} bytes`);
  }

  const { head, rest } = await peekHead(res.body, 12);
  if (!isMp4Header(head)) {
    await rest.cancel().catch(() => undefined);
    throw new BotError('invalid_media', 'not an mp4 container');
  }

  const state = { exceeded: false };
  return {
    body: limitStream(rest, maxBytes, state),
    size,
    contentType: 'video/mp4',
    exceededLimit: () => state.exceeded,
  };
}

/**
 * Reads at least `n` bytes, then returns them and a stream that yields every byte from the start.
 * Nothing is duplicated and nothing is lost.
 */
export async function peekHead(
  source: ReadableStream<Uint8Array>,
  n: number,
): Promise<{ head: Uint8Array; rest: ReadableStream<Uint8Array> }> {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  while (total < n) {
    const { done, value } = await reader.read();
    if (done) {
      finished = true;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const buffered = concat(chunks);
  const head = buffered.subarray(0, Math.min(n, buffered.byteLength));
  let pending: Uint8Array | null = buffered.byteLength > 0 ? buffered : null;

  const rest = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (pending) {
          const first = pending;
          pending = null;
          controller.enqueue(first);
          return;
        }
        if (finished) {
          controller.close();
          return;
        }
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => undefined);
      },
    },
    { highWaterMark: 0 },
  );
  return { head, rest };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
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
