// YouTube via the public player API (the same endpoint mobile clients use). Only progressive MP4 streams
// (audio and video in one file) are used, because merging separate streams needs ffmpeg, which Workers cannot run.
// The player API may refuse datacenter IPs or change without notice. Treat failures as expected.
import { BotError } from '../errors';
import type { MediaInfo } from './types';

export const PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const CLIENT_VERSION = '20.10.38';
export const YOUTUBE_CLIENT_UA = `com.google.android.youtube/${CLIENT_VERSION} (Linux; U; Android 11) gzip`;

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Accepts watch, youtu.be, shorts, embed, live, and m. hosts. Returns the 11-character video id or null. */
export function youtubeVideoId(pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1] ?? null;
  }
  return id && ID_RE.test(id) ? id : null;
}

export async function postPlayer(videoId: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(PLAYER_ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'user-agent': YOUTUBE_CLIENT_UA,
      'x-youtube-client-name': '3',
      'x-youtube-client-version': CLIENT_VERSION,
    },
    body: JSON.stringify({
      context: {
        client: { clientName: 'ANDROID', clientVersion: CLIENT_VERSION, androidSdkVersion: 30, osName: 'Android', osVersion: '11', hl: 'en', gl: 'US' },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  }).catch(() => {
    if (signal?.aborted) throw new BotError('timeout', 'youtube request timed out');
    throw new BotError('upstream_error', 'youtube player request failed');
  });
  if (res.status === 403 || res.status === 429) throw new BotError('blocked', `youtube status ${res.status}`);
  if (!res.ok) throw new BotError('upstream_error', `youtube status ${res.status}`);
  return res.json().catch(() => {
    throw new BotError('upstream_error', 'youtube response was not JSON');
  });
}

interface Format {
  url?: unknown;
  mimeType?: unknown;
  height?: unknown;
  signatureCipher?: unknown;
  cipher?: unknown;
}

/** Turns a player API response into one progressive MP4. Throws BotError for every other outcome. */
export function extractYouTube(player: unknown): MediaInfo {
  const data = (player ?? {}) as Record<string, any>;
  const status = data.playabilityStatus?.status;
  if (status === 'LOGIN_REQUIRED' || status === 'AGE_VERIFICATION_REQUIRED') {
    throw new BotError('blocked', `youtube playability ${status}`);
  }
  if (status !== 'OK') throw new BotError('no_media', `youtube playability ${String(status)}`);

  const formats: Format[] = Array.isArray(data.streamingData?.formats) ? data.streamingData.formats : [];
  const candidates = formats
    .filter((f) => typeof f.url === 'string' && f.url.startsWith('https://') && !f.signatureCipher && !f.cipher)
    .filter((f) => typeof f.mimeType === 'string' && f.mimeType.startsWith('video/mp4'))
    .sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0));
  const best = candidates[0];
  if (!best) throw new BotError('no_media', 'youtube: no progressive mp4 without a cipher');

  const title = typeof data.videoDetails?.title === 'string' ? data.videoDetails.title : undefined;
  return { platform: 'youtube', videoUrl: best.url as string, referer: 'https://www.youtube.com/', title };
}

export async function resolveYouTube(
  pageUrl: string,
  player: (videoId: string) => Promise<unknown> = postPlayer,
): Promise<MediaInfo> {
  const id = youtubeVideoId(pageUrl);
  if (!id) throw new BotError('not_found', 'youtube: no video id in link');
  return extractYouTube(await player(id));
}
