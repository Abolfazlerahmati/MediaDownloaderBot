import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotError } from '../src/errors';
import { openMedia, limitStream } from '../src/media';
import { buildMultipart, safeFilename } from '../src/telegram';

afterEach(() => vi.unstubAllGlobals());

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

describe('limitStream', () => {
  it('passes data through when under the limit', async () => {
    const state = { exceeded: false };
    const out = await readAll(limitStream(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), 10, state));
    expect([...out]).toEqual([1, 2, 3]);
    expect(state.exceeded).toBe(false);
  });

  it('errors with file_too_large once the total passes the limit', async () => {
    const state = { exceeded: false };
    const stream = limitStream(streamOf([new Uint8Array(6), new Uint8Array(6)]), 10, state);
    await expect(readAll(stream)).rejects.toBeInstanceOf(BotError);
    expect(state.exceeded).toBe(true);
  });
});

describe('openMedia', () => {
  it('rejects a declared size over the limit before reading the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(4), { headers: { 'content-length': '60000000' } })),
    );
    await expect(openMedia('https://cdn.example/a.mp4', 'https://www.tiktok.com/')).rejects.toMatchObject({
      code: 'file_too_large',
    });
  });

  it('streams a small file and sends the referer header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(new Uint8Array([9, 9, 9]), { headers: { 'content-length': '3', 'content-type': 'video/mp4' } }));
    vi.stubGlobal('fetch', fetchMock);
    const media = await openMedia('https://cdn.example/a.mp4', 'https://www.tiktok.com/');
    expect(media.size).toBe(3);
    expect(media.contentType).toBe('video/mp4');
    expect([...(await readAll(media.body))]).toEqual([9, 9, 9]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).referer).toBe('https://www.tiktok.com/');
  });

  it('maps a network failure to upstream_error, not internal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(openMedia('https://cdn.example/a.mp4', 'https://x/')).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('maps 403 to blocked and other failures to upstream_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    await expect(openMedia('https://cdn.example/a.mp4', 'https://x/')).rejects.toMatchObject({ code: 'blocked' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(openMedia('https://cdn.example/a.mp4', 'https://x/')).rejects.toMatchObject({ code: 'upstream_error' });
  });
});

describe('buildMultipart', () => {
  it('wraps fields and the streamed file in valid multipart framing', async () => {
    const plan = buildMultipart({ chat_id: '42', caption: 'hello' }, {
      name: 'clip.mp4',
      contentType: 'video/mp4',
      body: streamOf([new Uint8Array([0xde, 0xad]), new Uint8Array([0xbe, 0xef])]),
    });
    const text = new TextDecoder('latin1').decode(await readAll(plan.body));
    const b = plan.boundary;
    expect(text.startsWith(`--${b}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n42\r\n`)).toBe(true);
    expect(text).toContain('name="caption"\r\n\r\nhello\r\n');
    expect(text).toContain('name="video"; filename="clip.mp4"');
    expect(text).toContain('Content-Type: video/mp4');
    expect(text.endsWith(`\r\n--${b}--\r\n`)).toBe(true);
    expect(text).toContain('\xde\xad\xbe\xef');
  });

  it('sanitises filenames that could break headers', () => {
    expect(safeFilename('a"b\r\nc.mp4')).toBe('a_b__c.mp4');
    expect(safeFilename('')).toBe('video.mp4');
  });
});
