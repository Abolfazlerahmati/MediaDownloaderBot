// HTTP helpers: JSON and HTML responses, security headers, cookies, and bounded body parsing.
import { MAX_PANEL_BODY_BYTES, SESSION_TTL_MS } from '../limits';

export const SESSION_COOKIE = 'mb_session';

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cache-control': 'no-store',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });
}

export function apiError(status: number, error: string, detail: string, fields?: Record<string, string>): Response {
  return json({ ok: false, error, detail, ...(fields ? { fields } : {}) }, status);
}

export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });
}

export function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { location, ...SECURITY_HEADERS, ...extra } });
}

export function asset(body: string, type: string): Response {
  return new Response(body, {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': SECURITY_HEADERS['content-security-policy'],
    },
  });
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export function sessionSetCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export class BodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Reads a JSON body up to MAX_PANEL_BODY_BYTES. An empty body is treated as an empty object. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PANEL_BODY_BYTES) throw new BodyError(413, 'payload_too_large');
  const text = await request.text();
  if (text.length > MAX_PANEL_BODY_BYTES) throw new BodyError(413, 'payload_too_large');
  if (text.trim() === '') return {};
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BodyError(400, 'bad_json');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BodyError) throw error;
    throw new BodyError(400, 'bad_json');
  }
}
