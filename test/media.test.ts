import { describe, expect, it } from 'vitest';
import { isMp4Header, fileNameFor, safeTitle } from '../src/media/validate';
import { limitStream, peekHead } from '../src/media/stream';
import { MAX_UPLOAD_BYTES } from '../src/limits';

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function readAll(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = s.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

const MP4_HEAD = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

describe('MP4 validation', () => {
  it('accepts the ftyp box at offset 4', () => {
    expect(isMp4Header(MP4_HEAD)).toBe(true);
  });

  it('rejects HTML, short input, and a WebM header', () => {
    expect(isMp4Header(new TextEncoder().encode('<!doctype html>'))).toBe(false);
    expect(isMp4Header(new Uint8Array([0, 0, 0]))).toBe(false);
    expect(isMp4Header(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe('file names', () => {
  it('keeps Persian titles and strips path and header breaking characters', () => {
    expect(safeTitle('سلام/دنیا: "تست"', 'x')).toBe('سلام دنیا تست');
    expect(fileNameFor('a\r\nb', 'tiktok')).toBe('a b.mp4');
  });

  it('falls back to the platform name when the title is empty', () => {
    expect(fileNameFor('   ', 'pinterest')).toBe('pinterest.mp4');
    expect(fileNameFor(undefined, 'tiktok')).toBe('tiktok.mp4');
  });

  it('caps the title at 100 characters', () => {
    expect([...fileNameFor('ا'.repeat(300), 'tiktok')].length).toBeLessThanOrEqual(104);
  });
});

describe('stream helpers', () => {
  it('peekHead returns the head and a rest stream with every byte exactly once', async () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([6, 7, 8, 9, 10, 11]);
    const { head, rest } = await peekHead(streamOf(a, b), 4);
    expect(Array.from(head)).toEqual([1, 2, 3, 4]);
    expect(Array.from(await readAll(rest))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('peekHead handles a source shorter than the requested head', async () => {
    const { head, rest } = await peekHead(streamOf(new Uint8Array([9, 9])), 12);
    expect(head.length).toBe(2);
    expect(Array.from(await readAll(rest))).toEqual([9, 9]);
  });

  it('limitStream passes bytes through and errors once the cap is passed', async () => {
    const state = { exceeded: false };
    const limited = limitStream(streamOf(new Uint8Array(6), new Uint8Array(6)), 10, state);
    await expect(readAll(limited)).rejects.toThrow();
    expect(state.exceeded).toBe(true);
  });

  it('limitStream lets a stream exactly at the cap finish', async () => {
    const state = { exceeded: false };
    const out = await readAll(limitStream(streamOf(new Uint8Array(5), new Uint8Array(5)), 10, state));
    expect(out.length).toBe(10);
    expect(state.exceeded).toBe(false);
  });
});

describe('size cap', () => {
  it('is 50 MB, the Telegram Bot API upload limit used by this project', () => {
    expect(MAX_UPLOAD_BYTES).toBe(50_000_000);
  });
});
