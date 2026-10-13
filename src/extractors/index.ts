import { BotError } from '../errors';
import { extractPinterest } from './pinterest';
import { fetchPage } from './page';
import { extractTikTok } from './tiktok';
import type { MediaInfo, Platform } from './types';

export type { MediaInfo, Platform } from './types';

/** Platforms whose extraction is not implemented on Workers yet. */
export const UNSUPPORTED_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>(['youtube', 'instagram']);

/**
 * Resolves a public page URL to a downloadable video. Throws BotError for every failure.
 * Unsupported platforms throw 'internal'; callers must check UNSUPPORTED_PLATFORMS first.
 */
export async function resolveMedia(
  platform: Platform,
  pageUrl: string,
  fetcher: (url: string) => Promise<{ html: string; finalUrl: string }> = fetchPage,
): Promise<MediaInfo> {
  if (UNSUPPORTED_PLATFORMS.has(platform)) {
    throw new BotError('internal', `${platform} is not implemented on Workers`);
  }
  const { html, finalUrl } = await fetcher(pageUrl);
  switch (platform) {
    case 'pinterest':
      return extractPinterest(html, finalUrl);
    case 'tiktok':
      return extractTikTok(html, finalUrl);
    default:
      throw new BotError('internal', `no extractor for ${platform}`);
  }
}
