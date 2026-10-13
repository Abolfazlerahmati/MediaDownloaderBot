import { BotError } from '../errors';
import { isHttpsUrl, metaContent, unescapeJsonString } from './html';
import type { MediaInfo } from './types';

// TikTok embeds page data as JSON in one of these script tags. The layout changes from time to time,
// so the search below looks for keys rather than fixed paths.
const DATA_SCRIPT_RE = /<script\b[^>]*\bid=["'](__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)["'][^>]*>([\s\S]*?)<\/script>/gi;
const MAX_VISITS = 20_000;

/** Depth-first search for `key` whose value is an https URL (or a { urlList: [...] } object). */
function findUrlByKey(root: unknown, key: string): string | null {
  const stack: unknown[] = [root];
  let visits = 0;
  while (stack.length > 0 && visits++ < MAX_VISITS) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
    } else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      const value = record[key];
      if (isHttpsUrl(value)) return value;
      if (value && typeof value === 'object') {
        const list = (value as { urlList?: unknown }).urlList;
        if (Array.isArray(list)) {
          const url = list.find(isHttpsUrl);
          if (url) return url;
        }
      }
      for (const child of Object.values(record)) stack.push(child);
    }
  }
  return null;
}

export function extractTikTok(html: string, _pageUrl: string): MediaInfo {
  for (const match of html.matchAll(DATA_SCRIPT_RE)) {
    let data: unknown;
    try {
      data = JSON.parse(match[2]);
    } catch {
      continue;
    }
    // playAddr is the normal video; downloadAddr usually has a watermark, so it is only a fallback.
    const url = findUrlByKey(data, 'playAddr') ?? findUrlByKey(data, 'downloadAddr');
    if (url) return toInfo(url, html);
  }

  for (const key of ['og:video:secure_url', 'og:video']) {
    const value = metaContent(html, key);
    if (isHttpsUrl(value)) return toInfo(unescapeJsonString(value), html);
  }

  throw new BotError('no_media', 'tiktok: no playable address found');
}

function toInfo(videoUrl: string, html: string): MediaInfo {
  return {
    platform: 'tiktok',
    videoUrl,
    referer: 'https://www.tiktok.com/',
    title: metaContent(html, 'og:title') ?? undefined,
  };
}
