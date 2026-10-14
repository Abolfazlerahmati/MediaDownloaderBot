// Instagram public posts and reels via the embed page. Login-only and private content is not available.
// Instagram changes its pages often, so an empty result is a normal outcome and is reported as no_media.
import { BotError } from '../errors';
import { decodeEntities, metaContent } from './html';
import type { MediaInfo } from './types';

const PATH_RE = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,20})\/?$/;

export function instagramEmbedUrl(pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!(host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am')) return null;
  const match = url.pathname.match(PATH_RE);
  if (!match) return null;
  const kind = match[1] === 'reels' ? 'reel' : match[1];
  return `https://www.instagram.com/${kind}/${match[2]}/embed/captioned/`;
}

/** Finds the video URL in the embed page: first the escaped JSON key, then the Open Graph tag. */
export function extractInstagram(html: string): MediaInfo {
  const jsonMatch = html.match(/"video_url"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (jsonMatch) {
    let url: string | null = null;
    try {
      url = JSON.parse(`"${jsonMatch[1]}"`) as string;
    } catch {
      url = null;
    }
    if (url && url.startsWith('https://')) return toInfo(url, titleFrom(html));
  }
  const og = metaContent(html, 'og:video:secure_url') ?? metaContent(html, 'og:video');
  if (og && og.startsWith('https://')) return toInfo(decodeEntities(og), titleFrom(html));
  throw new BotError('no_media', 'instagram: no video found on the public page');
}

function titleFrom(html: string): string | undefined {
  const title = metaContent(html, 'og:title');
  return title ? title.slice(0, 200) : undefined;
}

function toInfo(videoUrl: string, title: string | undefined): MediaInfo {
  return { platform: 'instagram', videoUrl, referer: 'https://www.instagram.com/', title };
}

export async function resolveInstagram(
  pageUrl: string,
  fetcher: (url: string) => Promise<{ html: string; finalUrl: string }>,
): Promise<MediaInfo> {
  const embed = instagramEmbedUrl(pageUrl);
  if (!embed) throw new BotError('not_found', 'instagram: not a post or reel link');
  const { html } = await fetcher(embed);
  return extractInstagram(html);
}
