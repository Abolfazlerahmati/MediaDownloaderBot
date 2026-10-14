import { describe, expect, it } from 'vitest';
import { handleUpdate, type BotDeps } from '../src/bot/handler';
import { BotError } from '../src/errors';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import type { MediaInfo } from '../src/extractors/types';
import type { MediaStream } from '../src/media/stream';

interface Sent {
  chatId: number;
  text: string;
  replyTo?: number;
}

interface Fake {
  deps: BotDeps;
  sent: Sent[];
  resolved: string[];
  opened: number;
  videos: Array<{ url: string; replyTo: number }>;
  logs: Array<{ severity: string; event: string; detail: string }>;
  languages: Map<number, 'en' | 'fa'>;
  rate: number;
  dedupeFresh: boolean;
  updates: Set<number>;
  jobsAcquired: number;
  jobsReleased: number;
  jobsAllowed: boolean;
  callbacks: string[];
  sleeps: number[];
  failResolveTimes: number;
}

function fake(overrides: Partial<Settings> = {}, extra: Partial<BotDeps> = {}): Fake {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...overrides };
  const f: Fake = {
    sent: [],
    resolved: [],
    opened: 0,
    videos: [],
    logs: [],
    languages: new Map(),
    rate: 0,
    dedupeFresh: true,
    updates: new Set(),
    jobsAcquired: 0,
    jobsReleased: 0,
    jobsAllowed: true,
    callbacks: [],
    sleeps: [],
    failResolveTimes: 0,
    deps: undefined as unknown as BotDeps,
  };
  f.deps = {
    now: () => 1_000_000,
    sleep: async (ms) => {
      f.sleeps.push(ms);
    },
    claimUpdate: async (id) => {
      if (f.updates.has(id)) return false;
      f.updates.add(id);
      return true;
    },
    settings: async () => settings,
    botUsername: async () => 'MediaBot',
    language: async (id, fallback) => f.languages.get(id) ?? fallback,
    setLanguage: async (id, lang) => {
      f.languages.set(id, lang);
    },
    platform: async (key) => (key === 'youtube' ? { enabled: true, implemented: false } : { enabled: true, implemented: true }),
    hashUser: async (id) => `u${id}`,
    hashKey: async (v) => `k${v}`,
    countRate: async () => f.rate,
    addRate: async () => undefined,
    claimDedupe: async () => f.dedupeFresh,
    acquireJob: async () => {
      f.jobsAcquired++;
      return f.jobsAllowed;
    },
    releaseJob: async () => {
      f.jobsReleased++;
    },
    sendText: async (chatId, text, options) => {
      f.sent.push({ chatId, text, replyTo: options?.replyTo });
    },
    answerCallback: async (id) => {
      f.callbacks.push(id);
    },
    resolve: async (info): Promise<MediaInfo> => {
      f.resolved.push(info.url);
      if (f.failResolveTimes > 0) {
        f.failResolveTimes--;
        throw new BotError('upstream_error', 'flaky');
      }
      return { platform: 'tiktok', title: 'clip', referer: 'https://www.tiktok.com/', videoUrl: `https://cdn.example/${f.resolved.length}.mp4` } as MediaInfo;
    },
    open: async (): Promise<MediaStream> => {
      f.opened++;
      return { body: new ReadableStream(), size: 10, contentType: 'video/mp4', exceededLimit: () => false };
    },
    sendVideo: async (chatId, media, info, job) => {
      f.videos.push({ url: info.videoUrl, replyTo: job.replyTo });
      void chatId;
    },
    log: async (severity, event, _platform, detail) => {
      f.logs.push({ severity, event, detail });
    },
    ...extra,
  };
  return f;
}

const privateMsg = (text: string, id = 7, messageId = 11) => ({
  update_id: 1000 + messageId,
  message: { message_id: messageId, chat: { id: 100, type: 'private' }, from: { id, username: 'someone' }, text },
});

const groupMsg = (text: string, messageId = 21) => ({
  update_id: 2000 + messageId,
  message: { message_id: messageId, chat: { id: -5, type: 'group' }, from: { id: 3 }, text },
});

const TT = (n: number) => `https://www.tiktok.com/@a/video/${n}`;

describe('commands', () => {
  it('answers /start in a private chat without quoting the user', async () => {
    const f = fake();
    await handleUpdate(privateMsg('/start'), f.deps);
    expect(f.sent[0].text).toContain('TikTok');
    expect(f.sent[0].replyTo).toBeUndefined();
  });

  it('answers /start in a group when addressed, quoting the command message', async () => {
    const f = fake();
    await handleUpdate(groupMsg('/start@MediaBot'), f.deps);
    expect(f.sent[0].replyTo).toBe(21);
  });

  it('stays silent for /start in a group when the bot is not addressed', async () => {
    const f = fake();
    await handleUpdate(groupMsg('/start'), f.deps);
    expect(f.sent).toHaveLength(0);
  });

  it('adds the group mention hint to /help in groups only', async () => {
    const g = fake();
    await handleUpdate(groupMsg('@MediaBot /help'), g.deps);
    expect(g.sent.map((s) => s.text).join('\n')).toContain('@MediaBot https://');
    const p = fake();
    await handleUpdate(privateMsg('/help'), p.deps);
    expect(p.sent).toHaveLength(1);
  });

  it('shows the language keyboard for /language', async () => {
    const f = fake();
    await handleUpdate(privateMsg('/language'), f.deps);
    expect(f.sent[0].text).toMatch(/language/i);
  });
});

describe('link handling', () => {
  it('asks for a link when a private message has none, and says nothing for plain text in groups', async () => {
    const f = fake();
    await handleUpdate(privateMsg('hello there'), f.deps);
    expect(f.sent[0].text).toBe('Please send a link.');
    expect(f.resolved).toHaveLength(0);
    const g = fake();
    await handleUpdate(groupMsg('just chatting with friends'), g.deps);
    expect(g.sent).toHaveLength(0);
  });

  it('stays silent in groups unless the bot is addressed', async () => {
    const f = fake();
    await handleUpdate(groupMsg(TT(1)), f.deps);
    expect(f.sent).toHaveLength(0);
    expect(f.resolved).toHaveLength(0);
  });

  it('replies to the link message in groups and in private chats', async () => {
    const f = fake();
    await handleUpdate(groupMsg(`@MediaBot ${TT(1)}`, 55), f.deps);
    expect(f.videos).toEqual([{ url: 'https://cdn.example/1.mp4', replyTo: 55 }]);
    expect(f.sent.every((s) => s.replyTo === 55)).toBe(true);
    const p = fake();
    await handleUpdate(privateMsg(TT(2), 7, 66), p.deps);
    expect(p.videos[0].replyTo).toBe(66);
  });

  it('processes several links in order and skips the rest with one notice', async () => {
    const f = fake({ max_links_per_message: 2 });
    const text = `${TT(1)} ${TT(2)} ${TT(3)}`;
    await handleUpdate(privateMsg(text), f.deps);
    expect(f.resolved).toEqual([TT(1), TT(2)]);
    expect(f.videos).toHaveLength(2);
    const notices = f.sent.filter((s) => s.text.includes('first 2'));
    expect(notices).toHaveLength(1);
  });

  it('ignores unrecognized links next to a supported one', async () => {
    const f = fake();
    await handleUpdate(privateMsg(`https://example.com/x ${TT(4)}`), f.deps);
    expect(f.resolved).toEqual([TT(4)]);
    expect(f.sent.some((s) => s.text.includes('not from a supported site'))).toBe(false);
  });

  it('answers once when no link is recognized', async () => {
    const f = fake();
    await handleUpdate(privateMsg('https://example.com/a https://example.org/b'), f.deps);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].text).toMatch(/supported site/);
  });

  it('enforces the per-minute rate limit before downloading', async () => {
    const f = fake({ rate_limit_per_minute: 2 });
    f.rate = 2;
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.sent.at(-1)?.text).toMatch(/2/);
    expect(f.resolved).toHaveLength(0);
  });

  it('drops duplicate links inside the dedupe window and does not count them', async () => {
    const f = fake();
    f.dedupeFresh = false;
    let added = 0;
    f.deps = { ...f.deps, addRate: async () => { added++; } };
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.sent.at(-1)?.text).toMatch(/already/i);
    expect(f.resolved).toHaveLength(0);
    expect(added).toBe(0);
  });

  it('reports busy when no job slot is free, and does not download', async () => {
    const f = fake();
    f.jobsAllowed = false;
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.sent.at(-1)?.text).toMatch(/Too many downloads/);
    expect(f.resolved).toHaveLength(0);
    expect(f.jobsReleased).toBe(0);
  });

  it('releases the job slot after success and after failure', async () => {
    const ok = fake();
    await handleUpdate(privateMsg(TT(1)), ok.deps);
    expect(ok.jobsAcquired).toBe(1);
    expect(ok.jobsReleased).toBe(1);
    const bad = fake({}, { resolve: async () => { throw new BotError('not_found'); } });
    await handleUpdate(privateMsg(TT(2)), bad.deps);
    expect(bad.jobsReleased).toBe(1);
  });

  it('marks unimplemented platforms without calling the extractor', async () => {
    const f = fake();
    await handleUpdate(privateMsg('https://www.youtube.com/watch?v=abcdefghijk'), f.deps);
    expect(f.sent.at(-1)?.text).toMatch(/not implemented/i);
    expect(f.resolved).toHaveLength(0);
  });
});

describe('retries, timeouts, and errors', () => {
  it('retries a transient source failure with backoff and then succeeds', async () => {
    const f = fake({ retry_attempts: 3 });
    f.failResolveTimes = 2;
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.resolved).toHaveLength(3);
    expect(f.sleeps).toEqual([500, 1000]);
    expect(f.videos).toHaveLength(1);
  });

  it('does not retry permanent failures', async () => {
    const f = fake({ retry_attempts: 3 }, { resolve: async () => { throw new BotError('no_media'); } });
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.sleeps).toHaveLength(0);
    expect(f.sent.at(-1)?.text).toMatch(/No downloadable video/);
  });

  it('maps a timed-out download to the timeout message and does not retry it', async () => {
    const f = fake({ retry_attempts: 3 }, { resolve: async () => { throw new BotError('timeout'); } });
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.sleeps).toHaveLength(0);
    expect(f.sent.at(-1)?.text).toMatch(/took too long/);
    expect(f.logs.find((l) => l.event === 'download_failed')?.detail).toBe('timeout');
  });

  it('adds the source status to the log for a YouTube block, without any link', async () => {
    const f = fake({}, { resolve: async () => { throw new BotError('blocked', 'youtube playability LOGIN_REQUIRED'); } });
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.logs.find((l) => l.event === 'download_failed')?.detail).toBe('blocked · youtube playability LOGIN_REQUIRED');
  });

  it('logs the reason of each YouTube client in order', async () => {
    const f = fake({}, { resolve: async () => { throw new BotError('no_media', 'youtube playability LOGIN_REQUIRED, HTTP_403, ERROR'); } });
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.logs.find((l) => l.event === 'download_failed')?.detail).toBe('no_media · youtube playability LOGIN_REQUIRED, HTTP_403, ERROR');
  });

  it('adds an HTTP status but drops free text that could contain a link', async () => {
    const f = fake({}, { resolve: async () => { throw new BotError('blocked', 'youtube status 403'); } });
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.logs.find((l) => l.event === 'download_failed')?.detail).toBe('blocked · youtube status 403');
    const g = fake({}, { open: async () => { throw new BotError('blocked', 'see https://x.example/?t=1'); } });
    await handleUpdate(privateMsg(TT(1)), g.deps);
    expect(g.logs.find((l) => l.event === 'download_failed')?.detail).toBe('blocked');
  });

  it('logs only the error code, never the detail or URL', async () => {
    const f = fake({}, { open: async () => { throw new BotError('file_too_large', 'declared 90000000 bytes https://secret.example/?token=abc'); } });
    await handleUpdate(privateMsg(TT(1)), f.deps);
    const failed = f.logs.find((l) => l.event === 'download_failed');
    expect(failed?.detail).toBe('file_too_large');
    expect(f.sent.at(-1)?.text).toContain('50');
  });

  it('reports a file that exceeded the cap while streaming', async () => {
    const f = fake({}, {
      open: async () => ({ body: new ReadableStream(), size: null, contentType: 'video/mp4', exceededLimit: () => true }),
      sendVideo: async () => { throw new BotError('telegram_error'); },
    });
    await handleUpdate(privateMsg(TT(1)), f.deps);
    expect(f.logs.find((l) => l.event === 'download_failed')?.detail).toBe('telegram_error');
  });
});

describe('updates and languages', () => {
  it('handles each update_id once, even when Telegram redelivers it', async () => {
    const f = fake();
    const update = privateMsg(TT(1), 7, 90);
    await handleUpdate(update, f.deps);
    await handleUpdate(update, f.deps);
    expect(f.resolved).toHaveLength(1);
  });

  it('saves the language chosen from the inline keyboard and replies in it', async () => {
    const f = fake();
    await handleUpdate({ update_id: 6, callback_query: { id: 'cb1', from: { id: 9 }, data: 'lang:fa', message: { chat: { id: 9, type: 'private' } } } }, f.deps);
    expect(f.languages.get(9)).toBe('fa');
    expect(f.callbacks).toEqual(['cb1']);
    expect(f.sent.at(-1)?.text).toContain('فارسی');
  });

  it('uses the chosen language for later replies to that user only', async () => {
    const f = fake();
    f.languages.set(7, 'fa');
    await handleUpdate(privateMsg('/start', 7), f.deps);
    await handleUpdate(privateMsg('/start', 8, 12), f.deps);
    expect(f.sent[0].text).toContain('ویدیو');
    expect(f.sent[1].text).toContain('Send a public');
  });

  it('ignores messages from bots', async () => {
    const f = fake();
    await handleUpdate({ update_id: 7, message: { message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: true }, text: '/start' } }, f.deps);
    expect(f.sent).toHaveLength(0);
  });
});
