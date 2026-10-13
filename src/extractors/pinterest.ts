import { BotError } from '../errors';
import { decodeEntities, isHttpsUrl, metaContent, unescapeJsonString } from './html';
import type { MediaInfo } from './types';

const PIN_VIDEO_RE = /https:\/\/v\d*\.pinimg\.com\/videos\/[^"'\s\\<>]+?\.mp4/g;

/** Higher number = larger file, judged from a "720p" style segment in the path. */
function qualityOf(url: string): number {
  const match = url.match(/(\d{3,4})p/);
  return match ? Number(match[1]) : 0;
}

/**
 * Finds the best mp4 for a Pinterest pin. Sources, in order:
 * 1. og:video / og:video:secure_url meta tags (video pins)
 * 2. v*.pinimg.com/videos/... .mp4 URLs embedded in the page data
 * The highest quality found wins.
 */
export function extractPinterest(html: string, _pageUrl: string): MediaInfo {
  const candidates = new Set<string>();

  for (const key of ['og:video:secure_url', 'og:video']) {
    const value = metaContent(html, key);
    if (isHttpsUrl(value) && value.split('?')[0].endsWith('.mp4')) candidates.add(value);
  }

  for (const match of html.matchAll(PIN_VIDEO_RE)) {
    candidates.add(unescapeJsonString(decodeEntities(match[0])));
  }

  if (candidates.size === 0) {
    throw new BotError('no_media', 'pinterest: no mp4 found');
  }

  const videoUrl = [...candidates].sort((a, b) => qualityOf(b) - qualityOf(a))[0];
  return {
    platform: 'pinterest',
    videoUrl,
    referer: 'https://www.pinterest.com/',
    title: metaContent(html, 'og:title') ?? undefined,
  };
}
