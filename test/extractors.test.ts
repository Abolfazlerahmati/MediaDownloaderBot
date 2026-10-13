import { describe, expect, it } from 'vitest';
import { BotError } from '../src/errors';
import { decodeEntities, metaContent, unescapeJsonString } from '../src/extractors/html';
import { extractPinterest } from '../src/extractors/pinterest';
import { extractTikTok } from '../src/extractors/tiktok';
import { resolveMedia, UNSUPPORTED_PLATFORMS } from '../src/extractors';

// Synthetic fixtures: they check parsing logic only. They are not copies of live pages.

describe('html helpers', () => {
  it('decodes entities and numeric references', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#39; &#x41;')).toBe("a & b <c> 'd' A");
  });

  it('reads meta content in either attribute order', () => {
    const html = '<meta content="https://x.test/v.mp4?a=1&amp;b=2" property="og:video"><meta property="og:title" content="Hi">';
    expect(metaContent(html, 'og:video')).toBe('https://x.test/v.mp4?a=1&b=2');
    expect(metaContent(html, 'og:title')).toBe('Hi');
    expect(metaContent(html, 'og:missing')).toBeNull();
  });

  it('unescapes JSON-style slashes', () => {
    expect(unescapeJsonString('https:\\/\\/cdn.test\\/a.mp4')).toBe('https://cdn.test/a.mp4');
  });
});

describe('extractPinterest', () => {
  it('uses og:video when it is an mp4', () => {
    const html = '<meta property="og:video" content="https://v1.pinimg.com/videos/mc/720p/abc.mp4"><meta property="og:title" content="Cat">';
    const info = extractPinterest(html, 'https://www.pinterest.com/pin/1/');
    expect(info.videoUrl).toBe('https://v1.pinimg.com/videos/mc/720p/abc.mp4');
    expect(info.referer).toBe('https://www.pinterest.com/');
    expect(info.title).toBe('Cat');
  });

  it('picks the highest quality from embedded pinimg URLs', () => {
    const html =
      '{"a":"https:\\/\\/v1.pinimg.com\\/videos\\/mc\\/360p\\/low.mp4","b":"https://v2.pinimg.com/videos/mc/720p/high.mp4"}';
    expect(extractPinterest(html, 'https://www.pinterest.com/pin/1/').videoUrl).toBe(
      'https://v2.pinimg.com/videos/mc/720p/high.mp4',
    );
  });

  it('throws no_media for a pin without video', () => {
    const html = '<meta property="og:image" content="https://i.pinimg.com/x.jpg">';
    expect(() => extractPinterest(html, 'https://www.pinterest.com/pin/1/')).toThrow(BotError);
    try {
      extractPinterest(html, 'https://www.pinterest.com/pin/1/');
    } catch (e) {
      expect((e as BotError).code).toBe('no_media');
    }
  });
});

describe('extractTikTok', () => {
  const page = (data: unknown) =>
    `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></html>`;

  it('finds playAddr deep in the rehydration JSON', () => {
    const html = page({
      __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { video: { playAddr: 'https://v16.tiktokcdn.com/play.mp4', downloadAddr: 'https://wm.example/x.mp4' } } } } },
    });
    const info = extractTikTok(html, 'https://www.tiktok.com/@a/video/1');
    expect(info.videoUrl).toBe('https://v16.tiktokcdn.com/play.mp4');
    expect(info.referer).toBe('https://www.tiktok.com/');
  });

  it('falls back to downloadAddr, then to a urlList', () => {
    const onlyDownload = page({ video: { downloadAddr: 'https://wm.example/x.mp4' } });
    expect(extractTikTok(onlyDownload, 'https://www.tiktok.com/x').videoUrl).toBe('https://wm.example/x.mp4');
    const list = page({ video: { playAddr: { urlList: ['http://no.example', 'https://ok.example/a.mp4'] } } });
    expect(extractTikTok(list, 'https://www.tiktok.com/x').videoUrl).toBe('https://ok.example/a.mp4');
  });

  it('uses og:video when the data script is missing', () => {
    const html = '<meta property="og:video" content="https://v.example/a.mp4">';
    expect(extractTikTok(html, 'https://www.tiktok.com/x').videoUrl).toBe('https://v.example/a.mp4');
  });

  it('throws no_media when nothing playable exists, and tolerates broken JSON', () => {
    const broken = '<script id="SIGI_STATE">{not json</script>';
    expect(() => extractTikTok(broken, 'https://www.tiktok.com/x')).toThrow(BotError);
  });
});

describe('resolveMedia', () => {
  it('refuses YouTube and Instagram without fetching anything', async () => {
    expect(UNSUPPORTED_PLATFORMS.has('youtube')).toBe(true);
    expect(UNSUPPORTED_PLATFORMS.has('instagram')).toBe(true);
    let fetched = false;
    await expect(
      resolveMedia('youtube', 'https://youtu.be/x', async () => {
        fetched = true;
        return { html: '', finalUrl: '' };
      }),
    ).rejects.toBeInstanceOf(BotError);
    expect(fetched).toBe(false);
  });

  it('uses the injected fetcher for TikTok and Pinterest', async () => {
    const info = await resolveMedia('pinterest', 'https://pin.it/x', async () => ({
      html: '<meta property="og:video" content="https://v1.pinimg.com/videos/mc/480p/a.mp4">',
      finalUrl: 'https://www.pinterest.com/pin/1/',
    }));
    expect(info.platform).toBe('pinterest');
  });
});
