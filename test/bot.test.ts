import { describe, expect, it } from 'vitest';
import { BotError, ERROR_MESSAGES_FA } from '../src/errors';
import { handleUpdate, TEXT, type Deps, type TelegramUpdate } from '../src/bot';
import type { Store } from '../src/db';
import { RATE_LIMIT_PER_MINUTE } from '../src/limits';
import type { MediaStream } from '../src/media';

function memoryStore(recent = 0) {
  const jobs: Array<{ id: number; status?: string; error?: string | null; platform: string }> = [];
  const store: Store = {
    upsertUser: async () => undefined,
    countRecentJobs: async () => recent,
    createJob: async (job) => {
      jobs.push({ id: jobs.length + 1, platform: job.platform });
      return jobs.length;
    },
    finishJob: async (id, status, error) => {
      const job = jobs.find((j) => j.id === id);
      if (job) Object.assign(job, { status, error });
    },
  };
  return { store, jobs };
}

function fakeMedia(exceeded = false): MediaStream {
  return { body: new ReadableStream(), size: 1, contentType: 'video/mp4', exceededLimit: () => exceeded };
}

function harness(opts: { recent?: number; resolve?: Deps['resolve']; sendVideo?: Deps['sendVideo']; open?: Deps['open'] } = {}) {
  const { store, jobs } = memoryStore(opts.recent ?? 0);
  const sent: string[] = [];
  const videos: number[] = [];
  const deps: Deps = {
    store,
    sendText: async (_chat, text) => {
      sent.push(text);
    },
    resolve:
      opts.resolve ??
      (async (info) => ({ platform: info.platform, videoUrl: 'https://cdn.example/a.mp4', referer: 'https://ref.example/' })),
    open: opts.open ?? (async () => fakeMedia()),
    sendVideo:
      opts.sendVideo ??
      (async (chatId) => {
        videos.push(chatId);
      }),
    now: () => new Date('2026-10-14T10:00:00Z'),
    log: () => undefined,
  };
  return { deps, sent, videos, jobs };
}

const update = (text: string, from = { id: 7, username: 'u' }): TelegramUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: 99, type: 'private' }, from, text },
});

describe('handleUpdate', () => {
  it('answers /start and /help without touching downloads', async () => {
    const h = harness();
    await handleUpdate(update('/start'), h.deps);
    await handleUpdate(update('/help'), h.deps);
    expect(h.sent).toEqual([TEXT.start, TEXT.help]);
    expect(h.jobs).toHaveLength(0);
  });

  it('asks for a link when there is none, and rejects unknown hosts', async () => {
    const h = harness();
    await handleUpdate(update('hello'), h.deps);
    await handleUpdate(update('https://example.com/x'), h.deps);
    expect(h.sent).toEqual([TEXT.noUrl, TEXT.unsupportedUrl]);
  });

  it('shows the not-implemented message for YouTube and Instagram', async () => {
    const h = harness();
    await handleUpdate(update('https://youtu.be/abc'), h.deps);
    await handleUpdate(update('https://www.instagram.com/reel/abc/'), h.deps);
    expect(h.sent).toEqual([TEXT.notImplemented, TEXT.notImplemented]);
    expect(h.jobs).toHaveLength(0);
  });

  it('delivers a TikTok video and marks the job done', async () => {
    const h = harness();
    await handleUpdate(update('https://www.tiktok.com/@a/video/1'), h.deps);
    expect(h.videos).toEqual([99]);
    expect(h.sent).toEqual([TEXT.processing]);
    expect(h.jobs[0]).toMatchObject({ status: 'done', error: null, platform: 'tiktok' });
  });

  it('shows the file_too_large message and records the code when the file is over the limit', async () => {
    const h = harness({
      open: async () => fakeMedia(true),
      sendVideo: async () => {
        throw new Error('stream aborted');
      },
    });
    await handleUpdate(update('https://pin.it/abc'), h.deps);
    expect(h.sent.at(-1)).toBe(ERROR_MESSAGES_FA.file_too_large);
    expect(h.jobs[0]).toMatchObject({ status: 'failed', error: 'file_too_large' });
  });

  it('maps extractor errors to their user message', async () => {
    const h = harness({
      resolve: async () => {
        throw new BotError('no_media');
      },
    });
    await handleUpdate(update('https://www.tiktok.com/@a/video/1'), h.deps);
    expect(h.sent.at(-1)).toBe(ERROR_MESSAGES_FA.no_media);
    expect(h.jobs[0]).toMatchObject({ status: 'failed', error: 'no_media' });
  });

  it('shows a generic internal message for unexpected errors (no internal details)', async () => {
    const h = harness({
      resolve: async () => {
        throw new Error('secret internal detail');
      },
    });
    await handleUpdate(update('https://www.tiktok.com/@a/video/1'), h.deps);
    expect(h.sent.at(-1)).toBe(ERROR_MESSAGES_FA.internal);
    expect(h.sent.join('\n')).not.toContain('secret internal detail');
  });

  it('applies the per-minute rate limit before starting a job', async () => {
    const h = harness({ recent: RATE_LIMIT_PER_MINUTE });
    await handleUpdate(update('https://www.tiktok.com/@a/video/1'), h.deps);
    expect(h.sent).toEqual([TEXT.rateLimited]);
    expect(h.jobs).toHaveLength(0);
  });

  it('still completes the job when the progress message cannot be sent', async () => {
    const h = harness();
    const base = h.deps.sendText;
    h.deps.sendText = async (chat, text) => {
      if (text === TEXT.processing) throw new Error('telegram down');
      return base(chat, text);
    };
    await handleUpdate(update('https://www.tiktok.com/@a/video/1'), h.deps);
    expect(h.videos).toEqual([99]);
    expect(h.jobs[0]).toMatchObject({ status: 'done' });
  });

  it('ignores bot senders and updates without messages', async () => {
    const h = harness();
    await handleUpdate(update('/start', { id: 1, username: 'bot', is_bot: true } as never), h.deps);
    await handleUpdate({ update_id: 2 }, h.deps);
    expect(h.sent).toHaveLength(0);
  });
});
