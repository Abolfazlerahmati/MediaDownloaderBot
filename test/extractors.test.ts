import { describe, expect, it } from 'vitest';
import { BotError } from '../src/errors';
import { decodeEntities, metaContent, unescapeJsonString } from '../src/extractors/html';
import { extractPinterest } from '../src/extractors/pinterest';
import { extractTikTok } from '../src/extractors/tiktok';
import { resolveMedia } from '../src/extractors';
import { extractYouTube, youtubeVideoId, resolveYouTube } from '../src/extractors/youtube';
import { extractInstagram, instagramEmbedUrl, resolveInstagram } from '../src/extractors/instagram';

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

describe('YouTube', () => {
  it('reads the video id from watch, short, shorts, and embed links', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtubeVideoId('https://www.youtube.com/channel/abc')).toBeNull();
  });

  it('picks the highest progressive mp4 and never a ciphered URL', () => {
    const info = extractYouTube({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Clip' },
      streamingData: {
        formats: [
          { itag: 18, mimeType: 'video/mp4; codecs="avc1, mp4a"', height: 360, url: 'https://rr.googlevideo.com/a' },
          { itag: 22, mimeType: 'video/mp4; codecs="avc1, mp4a"', height: 720, url: 'https://rr.googlevideo.com/b' },
          { itag: 96, mimeType: 'video/mp4', height: 1080, signatureCipher: 's=abc&url=https%3A%2F%2Fx' },
          { itag: 43, mimeType: 'video/webm', height: 720, url: 'https://rr.googlevideo.com/c' },
        ],
      },
    });
    expect(info.videoUrl).toBe('https://rr.googlevideo.com/b');
    expect(info.title).toBe('Clip');
    expect(info.platform).toBe('youtube');
  });

  it('reports only adaptive streams as no_media (no ffmpeg on Workers)', () => {
    expect(() =>
      extractYouTube({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: [{ url: 'https://x.test/a' }] } }),
    ).toThrow(BotError);
  });

  it('maps login walls to blocked and other failures to no_media', () => {
    expect(() => extractYouTube({ playabilityStatus: { status: 'LOGIN_REQUIRED' } })).toThrow(expect.objectContaining({ code: 'blocked' }));
    expect(() => extractYouTube({ playabilityStatus: { status: 'ERROR' } })).toThrow(expect.objectContaining({ code: 'no_media' }));
  });

  it('uses the injected player function', async () => {
    const info = await resolveYouTube('https://youtu.be/dQw4w9WgXcQ', async (id) => {
      expect(id).toBe('dQw4w9WgXcQ');
      return { playabilityStatus: { status: 'OK' }, streamingData: { formats: [{ mimeType: 'video/mp4', url: 'https://r.googlevideo.com/x' }] } };
    });
    expect(info.videoUrl).toBe('https://r.googlevideo.com/x');
  });
});

describe('Instagram', () => {
  it('builds the embed URL for posts, reels, and TV links only', () => {
    expect(instagramEmbedUrl('https://www.instagram.com/p/CabcdeF_12/')).toBe('https://www.instagram.com/p/CabcdeF_12/embed/captioned/');
    expect(instagramEmbedUrl('https://instagram.com/someone/reels/CabcdeF_12/')).toBe('https://www.instagram.com/reel/CabcdeF_12/embed/captioned/');
    expect(instagramEmbedUrl('https://www.instagram.com/someone/')).toBeNull();
  });

  it('reads video_url from escaped embed JSON, then falls back to og:video', () => {
    const json = '<script>{"video_url":"https:\\/\\/scontent.cdninstagram.com\\/v.mp4?a=1\\u0026b=2"}</script>';
    expect(extractInstagram(json).videoUrl).toBe('https://scontent.cdninstagram.com/v.mp4?a=1&b=2');
    const og = '<meta property="og:video" content="https://scontent.cdninstagram.com/og.mp4?x=1&amp;y=2">';
    expect(extractInstagram(og).videoUrl).toBe('https://scontent.cdninstagram.com/og.mp4?x=1&y=2');
  });

  it('reports no_media for a page without a video', () => {
    expect(() => extractInstagram('<html>login</html>')).toThrow(expect.objectContaining({ code: 'no_media' }));
  });

  it('fetches only the embed URL', async () => {
    let asked = '';
    const info = await resolveInstagram('https://www.instagram.com/p/CabcdeF_12/', async (url) => {
      asked = url;
      return { html: '{"video_url":"https:\\/\\/cdn.test\\/v.mp4"}', finalUrl: url };
    });
    expect(asked).toBe('https://www.instagram.com/p/CabcdeF_12/embed/captioned/');
    expect(info.referer).toBe('https://www.instagram.com/');
  });
});

describe('resolveMedia', () => {
  it('routes YouTube through the injected player, not the page fetcher', async () => {
    let pageCalls = 0;
    const info = await resolveMedia('youtube', 'https://youtu.be/dQw4w9WgXcQ', {
      page: async () => {
        pageCalls++;
        return { html: '', finalUrl: '' };
      },
      youtubePlayer: async () => ({ playabilityStatus: { status: 'OK' }, streamingData: { formats: [{ mimeType: 'video/mp4', url: 'https://r.googlevideo.com/y' }] } }),
    });
    expect(info.platform).toBe('youtube');
    expect(pageCalls).toBe(0);
  });

  it('uses the injected page fetcher for Pinterest', async () => {
    const info = await resolveMedia('pinterest', 'https://pin.it/x', {
      page: async () => ({
        html: '<meta property="og:video" content="https://v1.pinimg.com/videos/mc/480p/a.mp4">',
        finalUrl: 'https://www.pinterest.com/pin/1/',
      }),
    });
    expect(info.platform).toBe('pinterest');
  });
});
