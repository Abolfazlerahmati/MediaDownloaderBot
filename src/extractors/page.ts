import { BotError } from '../errors';
import { BROWSER_USER_AGENT, MAX_PAGE_BYTES } from '../limits';

/** Downloads a public page with browser-like headers. Maps HTTP failures to BotError codes. */
export async function fetchPage(url: string, signal?: AbortSignal): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, {
    signal,
    headers: {
      'user-agent': BROWSER_USER_AGENT,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.8',
    },
    redirect: 'follow',
  }).catch(() => {
    if (signal?.aborted) throw new BotError('timeout', 'page request timed out');
    throw new BotError('upstream_error', 'page request failed');
  });
  if (res.status === 404 || res.status === 410) throw new BotError('not_found', `page status ${res.status}`);
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new BotError('blocked', `page status ${res.status}`);
  }
  if (!res.ok) throw new BotError('upstream_error', `page status ${res.status}`);

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) {
    throw new BotError('upstream_error', 'page too large');
  }
  const html = await res.text();
  if (html.length > MAX_PAGE_BYTES) throw new BotError('upstream_error', 'page too large');
  return { html, finalUrl: res.url || url };
}
