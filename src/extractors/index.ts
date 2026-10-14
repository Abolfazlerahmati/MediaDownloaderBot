import { BotError } from '../errors';
import { extractPinterest } from './pinterest';
import { fetchPage } from './page';
import { extractTikTok } from './tiktok';
import { resolveYouTube, type PlayerClient } from './youtube';
import { resolveInstagram } from './instagram';
import type { MediaInfo, Platform } from './types';

export type { MediaInfo, Platform } from './types';

export interface ExtractorIO {
  page?: (url: string) => Promise<{ html: string; finalUrl: string }>;
  youtubePlayer?: (videoId: string, client: PlayerClient) => Promise<unknown>;
}

/**
 * Resolves a public page URL to a downloadable video. Throws BotError for every failure.
 * Each platform uses only the public endpoints described in its module.
 */
export async function resolveMedia(platform: Platform, pageUrl: string, io: ExtractorIO = {}): Promise<MediaInfo> {
  const page = io.page ?? fetchPage;
  switch (platform) {
    case 'pinterest': {
      const { html, finalUrl } = await page(pageUrl);
      return extractPinterest(html, finalUrl);
    }
    case 'tiktok': {
      const { html, finalUrl } = await page(pageUrl);
      return extractTikTok(html, finalUrl);
    }
    case 'youtube':
      return resolveYouTube(pageUrl, io.youtubePlayer);
    case 'instagram':
      return resolveInstagram(pageUrl, page);
    default:
      throw new BotError('internal', `no extractor for ${String(platform)}`);
  }
}
