import { describe, expect, it } from 'vitest';
import { handleUpdate, type BotDeps } from '../src/bot/handler';
import { BotError } from '../src/errors';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import type { MediaInfo } from '../src/extractors/types';
import type { MediaStream } from '../src/media/stream';

interface Fake {
  deps: BotDeps;
  sent: Array<{ chatId: number; text: string }>;
  resolved: number;
  opened: number;
  videos: number;
  logs: Array<{ severity: string; event: string }>;
  languages: Map<number, 'en' | 'fa'>;
  rate: number;
  dedupeFresh: boolean;
  callbacks: string[];
}

function fake(overrides: Partial<Settings> = {}, extra: Partial<BotDeps> = {}): Fake {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...overrides };
  const f: Fake = {
    sent: [],
    resolved: 0,
    opened: 0,
    videos: 0,
    logs: [],
    languages: new Map(),
    rate: 0,
    dedupeFresh: true,
    callbacks: [],
    deps: undefined as unknown as BotDeps,
  };
  f.deps = {
    now: () => 1_000_000,
    settings: async () => settings,
    botUsername: async () => 'MediaBot',
    language: async (id, fallback) => f.languages.get(id) ?? fallback,
    setLanguage: async (id, lang) => {
      f.languages.set(id, lang);
    },
    platform: async (key) => (key === 'tiktok' ? { enabled: true, implemented: true } : { enabled: true, implemented: false }),
    hashUser: async (id) => `u${id}`,
    hashKey: async (v) => `k${v}`,
    countRate: async () => f.rate,
    addRate: async () => undefined,
    claimDedupe: async () => f.dedupeFresh,
    sendText: async (chatId, text) => {
      f.sent.push({ chatId, text });
    },
    answerCallback: async (id) => {
      f.callbacks.push(id);
    },
    resolve: async (): Promise<MediaInfo> => {
      f.resolved++;
      return { platform: 'tiktok', title: 'clip', referer: 'https://www.tiktok.com/', videoUrl: 'https://cdn.example/v.mp4' } as MediaInfo;
    },
    open: async (): Promise<MediaStream> => {
      f.opened++;
      return { body: new ReadableStream(), size: 10, contentType: 'video/mp4', exceededLimit: () => false };
    },
    sendVideo: async () => {
      f.videos++;
    },
    log: async (severity, event) => {
      f.logs.push({ severity, event });
    },
    ...extra,
  };
  return f;
}

const privateMsg = (text: string, id = 7) => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: 100, type: 'private' }, from: { id, username: 'someone' }, text },
});

describe('bot update handling', () => {
  it('answers /start in a private chat', async () => {
    const f = fake();
    await handleUpdate(privateMsg('/start'), f.deps);
    expect(f.sent[0].text).toContain('TikTok');
  });

  it('asks for a link when a private message has none', async () => {
    const f = fake();
    await handleUpdate(privateMsg('hello there'), f.deps);
    expect(f.sent[0].text).toBe('Please send a link.');
    expect(f.resolved).toBe(0);
  });

  it('stays silent in groups unless the bot is addressed', async () => {
    const f = fake();
    await handleUpdate(
      { update_id: 2, message: { message_id: 2, chat: { id: -5, type: 'group' }, from: { id: 3 }, text: 'https://www.tiktok.com/@a/video/1' } },
      f.deps,
    );
    expect(f.sent).toHaveLength(0);
    expect(f.resolved).toBe(0);
  });

  it('answers in groups when addressed by @name', async () => {
    const f = fake();
    await handleUpdate(
      { update_id: 3, message: { message_id: 3, chat: { id: -5, type: 'group' }, from: { id: 3 }, text: '@MediaBot https://www.tiktok.com/@a/video/1' } },
      f.deps,
    );
    expect(f.resolved).toBe(1);
    expect(f.videos).toBe(1);
  });

  it('never replies in groups when group_mode is off', async () => {
    const f = fake({ group_mode: 'off' });
    await handleUpdate(
      { update_id: 4, message: { message_id: 4, chat: { id: -5, type: 'group' }, from: { id: 3 }, text: '@MediaBot /start' } },
      f.deps,
    );
    expect(f.sent).toHaveLength(0);
  });

  it('sends a maintenance reply in private chats only when the bot is paused', async () => {
    const f = fake({ bot_enabled: false });
    await handleUpdate(privateMsg('/start'), f.deps);
    expect(f.sent[0].text).toMatch(/paused/);
    const g = fake({ bot_enabled: false });
    await handleUpdate(
      { update_id: 5, message: { message_id: 5, chat: { id: -5, type: 'group' }, from: { id: 3 }, text: '@MediaBot hi' } },
      g.deps,
    );
    expect(g.sent).toHaveLength(0);
  });

  it('enforces the per-minute rate limit before downloading', async () => {
    const f = fake({ rate_limit_per_minute: 2 });
    f.rate = 2;
    await handleUpdate(privateMsg('https://www.tiktok.com/@a/video/1'), f.deps);
    expect(f.sent.at(-1)?.text).toMatch(/2/);
    expect(f.resolved).toBe(0);
  });

  it('drops duplicate links inside the dedupe window', async () => {
    const f = fake();
    f.dedupeFresh = false;
    await handleUpdate(privateMsg('https://www.tiktok.com/@a/video/1'), f.deps);
    expect(f.sent.at(-1)?.text).toMatch(/already|recently|duplicate/i);
    expect(f.resolved).toBe(0);
  });

  it('reports file_too_large with the configured cap and logs only the code', async () => {
    const f = fake({}, { open: async () => { throw new BotError('file_too_large', 'declared 90000000 bytes'); } });
    await handleUpdate(privateMsg('https://www.tiktok.com/@a/video/1'), f.deps);
    expect(f.sent.at(-1)?.text).toContain('50');
    const failed = f.logs.find((l) => l.event === 'download_failed');
    expect(failed).toBeTruthy();
  });

  it('marks unimplemented platforms without calling the extractor', async () => {
    const f = fake();
    await handleUpdate(privateMsg('https://www.youtube.com/watch?v=abcdefghijk'), f.deps);
    expect(f.sent.at(-1)?.text).toMatch(/not implemented/i);
    expect(f.resolved).toBe(0);
  });

  it('saves the language chosen from the inline keyboard', async () => {
    const f = fake();
    await handleUpdate({ update_id: 6, callback_query: { id: 'cb1', from: { id: 9 }, data: 'lang:fa', message: { chat: { id: 9, type: 'private' } } } }, f.deps);
    expect(f.languages.get(9)).toBe('fa');
    expect(f.callbacks).toEqual(['cb1']);
    expect(f.sent.at(-1)?.text).toContain('فارسی');
  });

  it('ignores messages from bots', async () => {
    const f = fake();
    await handleUpdate({ update_id: 7, message: { message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: true }, text: '/start' } }, f.deps);
    expect(f.sent).toHaveLength(0);
  });
});
