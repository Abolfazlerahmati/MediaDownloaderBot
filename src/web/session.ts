// Panel sessions: random token in an HttpOnly cookie, stored only as a SHA-256 hash.
// Each session also has a CSRF token that the page embeds and the client sends as a header.
import { SESSION_TTL_MS } from '../limits';
import { findSession, getUserById, insertSession, type PanelUser } from '../db/store';
import type { Db } from '../db/schema';
import { constantTimeEqual, randomToken, sha256Hex } from '../security/crypto';
import { parseCookies, SESSION_COOKIE } from './http';

export interface AuthContext {
  user: PanelUser;
  tokenHash: string;
  csrf: string;
}

export async function createSession(db: Db, userId: number, now: number): Promise<{ token: string; tokenHash: string }> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await insertSession(db, tokenHash, userId, randomToken(32), now, now + SESSION_TTL_MS);
  return { token, tokenHash };
}

export async function currentAuth(db: Db, request: Request, now: number): Promise<AuthContext | null> {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token || token.length > 200) return null;
  const tokenHash = await sha256Hex(token);
  const session = await findSession(db, tokenHash, now);
  if (!session) return null;
  const user = await getUserById(db, session.user_id);
  if (!user) return null;
  return { user, tokenHash, csrf: session.csrf_token };
}

export function csrfMatches(auth: AuthContext, header: string | null): boolean {
  return !!header && constantTimeEqual(header, auth.csrf);
}

/** Origin must match the host that served the request. Browsers always send Origin on fetch POST. */
export function originMatches(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
}
