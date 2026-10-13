// Decides which platform a link belongs to and whether the Workers build supports it.
// Only public links are handled. Login-only content is not supported.
import type { Platform } from './extractors/types';

export interface ClassifiedUrl {
  platform: Platform;
  supported: boolean;
  url: string;
}

const RULES: Array<{ platform: Platform; supported: boolean; host: RegExp }> = [
  { platform: 'tiktok', supported: true, host: /(^|\.)tiktok\.com$/ },
  { platform: 'pinterest', supported: true, host: /(^|\.)pinterest\.[a-z.]+$|^pin\.it$/ },
  { platform: 'youtube', supported: true, host: /(^|\.)youtube\.com$|^youtu\.be$/ },
  { platform: 'instagram', supported: true, host: /(^|\.)instagram\.com$|^instagr\.am$/ },
];

/** Returns the first http(s) URL in a message, without trailing punctuation. */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)\]]+$/, '');
}

/** Returns every http(s) URL in a message, in order, without duplicates. */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const cleaned = found.map((u) => u.replace(/[.,;:!?)\]]+$/, ''));
  return [...new Set(cleaned)];
}

export function classifyUrl(raw: string): ClassifiedUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  for (const rule of RULES) {
    if (rule.host.test(host)) {
      return { platform: rule.platform, supported: rule.supported, url: parsed.toString() };
    }
  }
  return null;
}
