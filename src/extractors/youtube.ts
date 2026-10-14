// YouTube via the public player API (the same endpoint mobile clients use). Only progressive MP4 streams
// (audio and video in one file) are used, because merging separate streams needs ffmpeg, which Workers cannot run.
// The player API may refuse datacenter IPs or change without notice. Treat failures as expected.
import { BotError } from '../errors';
import type { MediaInfo } from './types';

export const PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
export interface PlayerClient {
  name: string;
  /** Numeric id sent in the x-youtube-client-name header. */
  nameId: string;
  version: string;
  userAgent: string;
  context: Record<string, string | number>;
  thirdParty?: { embedUrl: string };
}

const ANDROID_VERSION = '20.10.38';
export const YOUTUBE_CLIENT_UA = `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 11) gzip`;

/**
 * Player clients tried in order. The next one is used only when a client is refused (login required, 403/429)
 * or returns no progressive MP4. Values follow the public client definitions and were not tested live from Workers.
 */
export const PLAYER_CLIENTS: PlayerClient[] = [
  {
    name: 'ANDROID',
    nameId: '3',
    version: ANDROID_VERSION,
    userAgent: YOUTUBE_CLIENT_UA,
    context: { androidSdkVersion: 30, osName: 'Android', osVersion: '11' },
  },
  {
    name: 'IOS',
    nameId: '5',
    version: '20.10.4',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    context: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
  },
  {
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    nameId: '85',
    version: '2.0',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    context: {},
    thirdParty: { embedUrl: 'https://www.youtube.com/' },
  },
];

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

export async function postPlayer(videoId: string, client: PlayerClient = PLAYER_CLIENTS[0], signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(PLAYER_ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'user-agent': client.userAgent,
      'x-youtube-client-name': client.nameId,
      'x-youtube-client-version': client.version,
    },
    body: JSON.stringify({
      context: {
        client: { clientName: client.name, clientVersion: client.version, hl: 'en', gl: 'US', ...client.context },
        ...(client.thirdParty ? { thirdParty: client.thirdParty } : {}),
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

/**
 * Tries each player client in turn. Moves on only when a client is refused or gives no usable MP4.
 * Other failures (timeout, upstream error, not found) stop at once. If every client fails, the last reason is thrown.
 */
export async function resolveYouTube(
  pageUrl: string,
  player: (videoId: string, client: PlayerClient) => Promise<unknown> = (id, client) => postPlayer(id, client),
): Promise<MediaInfo> {
  const id = youtubeVideoId(pageUrl);
  if (!id) throw new BotError('not_found', 'youtube: no video id in link');
  let lastError: BotError | null = null;
  for (const client of PLAYER_CLIENTS) {
    try {
      return extractYouTube(await player(id, client));
    } catch (error) {
      if (!(error instanceof BotError) || (error.code !== 'blocked' && error.code !== 'no_media')) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new BotError('blocked', 'youtube: no client accepted the request');
}
