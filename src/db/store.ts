// Data access. Every query uses bound parameters. Times are integer milliseconds since the epoch.
import type { Db } from './schema';
import { DEFAULT_SETTINGS, parseStoredSettings, type Language, type Settings } from '../settings';

export interface PanelUser {
  id: number;
  username: string;
  password_hash: string;
  must_change_password: number;
  appearance_theme: string;
  appearance_mode: string;
}

export interface PlatformRow {
  key: string;
  name: string;
  enabled: number;
  implemented: number;
  sample_url: string;
  last_test_at: number | null;
  last_test_ok: number | null;
  last_test_message: string;
}

export interface LogRow {
  id: number;
  created_at: number;
  severity: string;
  event: string;
  platform: string;
  detail: string;
}

export interface Store {
  db: Db;
}

// ---- settings ----
export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.prepare('SELECT key, value FROM app_settings').all<{ key: string; value: string }>();
  return parseStoredSettings(rows.results);
}

export async function saveSettings(db: Db, values: Partial<Settings>, now: number): Promise<void> {
  const statements = Object.entries(values).map(([key, value]) =>
    db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, JSON.stringify(value), now),
  );
  if (statements.length > 0) await db.batch(statements);
}

// ---- platforms ----
export async function listPlatforms(db: Db): Promise<PlatformRow[]> {
  return (await db.prepare('SELECT * FROM media_platforms ORDER BY key').all<PlatformRow>()).results;
}

export async function getPlatform(db: Db, key: string): Promise<PlatformRow | null> {
  return db.prepare('SELECT * FROM media_platforms WHERE key = ?').bind(key).first<PlatformRow>();
}

export async function setPlatformEnabled(db: Db, key: string, enabled: boolean): Promise<void> {
  await db.prepare('UPDATE media_platforms SET enabled = ? WHERE key = ?').bind(enabled ? 1 : 0, key).run();
}

export async function setPlatformSample(db: Db, key: string, sampleUrl: string): Promise<void> {
  await db.prepare('UPDATE media_platforms SET sample_url = ? WHERE key = ?').bind(sampleUrl, key).run();
}

export async function recordPlatformTest(db: Db, key: string, ok: boolean, message: string, now: number): Promise<void> {
  await db
    .prepare('UPDATE media_platforms SET last_test_at = ?, last_test_ok = ?, last_test_message = ? WHERE key = ?')
    .bind(now, ok ? 1 : 0, message.slice(0, 300), key)
    .run();
}

// ---- panel users and sessions ----
export async function getUserByName(db: Db, username: string): Promise<PanelUser | null> {
  return db
    .prepare('SELECT * FROM panel_users WHERE username = ?')
    .bind(username.toLowerCase())
    .first<PanelUser>();
}

export async function getUserById(db: Db, id: number): Promise<PanelUser | null> {
  return db.prepare('SELECT * FROM panel_users WHERE id = ?').bind(id).first<PanelUser>();
}

export async function updatePassword(db: Db, userId: number, hash: string, now: number): Promise<void> {
  await db
    .prepare('UPDATE panel_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
    .bind(hash, now, userId)
    .run();
}

export async function setAppearance(db: Db, userId: number, theme: string, mode: string, now: number): Promise<void> {
  await db
    .prepare('UPDATE panel_users SET appearance_theme = ?, appearance_mode = ?, updated_at = ? WHERE id = ?')
    .bind(theme, mode, now, userId)
    .run();
}

export async function insertSession(
  db: Db,
  tokenHash: string,
  userId: number,
  csrf: string,
  now: number,
  expiresAt: number,
): Promise<void> {
  await db
    .prepare('INSERT INTO panel_sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(tokenHash, userId, csrf, now, expiresAt)
    .run();
}

export interface SessionRow {
  token_hash: string;
  csrf_token: string;
  expires_at: number;
  user_id: number;
}

export async function findSession(db: Db, tokenHash: string, now: number): Promise<SessionRow | null> {
  return db
    .prepare('SELECT token_hash, csrf_token, expires_at, user_id FROM panel_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(tokenHash, now)
    .first<SessionRow>();
}

export async function deleteSession(db: Db, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM panel_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function deleteOtherSessions(db: Db, userId: number, keepTokenHash: string): Promise<void> {
  await db
    .prepare('DELETE FROM panel_sessions WHERE user_id = ? AND token_hash != ?')
    .bind(userId, keepTokenHash)
    .run();
}

// ---- login throttling ----
export async function countLoginFailures(db: Db, keyHash: string, since: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key_hash = ? AND created_at >= ?')
    .bind(keyHash, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function addLoginFailure(db: Db, keyHash: string, now: number): Promise<void> {
  await db.prepare('INSERT INTO login_attempts (key_hash, created_at) VALUES (?, ?)').bind(keyHash, now).run();
}

export async function clearLoginFailures(db: Db, keyHash: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE key_hash = ?').bind(keyHash).run();
}

// ---- bot rate limit, dedupe, preferences ----
export async function countRateEvents(db: Db, userHash: string, since: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM rate_events WHERE user_hash = ? AND created_at >= ?')
    .bind(userHash, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function addRateEvent(db: Db, userHash: string, now: number): Promise<void> {
  await db.prepare('INSERT INTO rate_events (user_hash, created_at) VALUES (?, ?)').bind(userHash, now).run();
}

/** Returns true when the key was free and is now claimed for `windowMs`. */
/**
 * Claims a key for `windowMs`. One statement decides, so two redeliveries that arrive together
 * cannot both win: the row is only replaced when the old claim is older than the window.
 */
export async function claimDedupeKey(db: Db, keyHash: string, now: number, windowMs: number): Promise<boolean> {
  if (windowMs <= 0) return true;
  const row = await db
    .prepare(
      `INSERT INTO dedupe_keys (key_hash, created_at) VALUES (?, ?)
       ON CONFLICT(key_hash) DO UPDATE SET created_at = excluded.created_at
       WHERE dedupe_keys.created_at <= ?
       RETURNING key_hash`,
    )
    .bind(keyHash, now, now - windowMs)
    .first<{ key_hash: string }>();
  return row !== null;
}

/**
 * Takes one of the limited job slots. Slots left behind by a crashed job expire after `staleMs`.
 * The count check and the insert are one statement, so the limit holds even under parallel updates.
 */
export async function acquireJobSlot(db: Db, jobId: string, now: number, max: number, staleMs: number): Promise<boolean> {
  await db.prepare('DELETE FROM active_jobs WHERE started_at < ?').bind(now - staleMs).run();
  // One statement: the count check and the insert happen together, so two updates cannot both take the last slot.
  const result = await db
    .prepare(
      `INSERT INTO active_jobs (id, started_at)
       SELECT ?, ? WHERE (SELECT COUNT(*) FROM active_jobs) < ?`,
    )
    .bind(jobId, now, max)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function releaseJobSlot(db: Db, jobId: string): Promise<void> {
  await db.prepare('DELETE FROM active_jobs WHERE id = ?').bind(jobId).run();
}

export async function getLanguage(db: Db, telegramId: number, fallback: Language): Promise<Language> {
  const row = await db
    .prepare('SELECT language FROM user_prefs WHERE telegram_id = ?')
    .bind(telegramId)
    .first<{ language: string }>();
  return row?.language === 'fa' || row?.language === 'en' ? row.language : fallback;
}

export async function setLanguage(db: Db, telegramId: number, language: Language, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_prefs (telegram_id, language, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET language = excluded.language, updated_at = excluded.updated_at`,
    )
    .bind(telegramId, language, now)
    .run();
}

// ---- bot state (bot username, webhook bookkeeping) ----
export async function getState(db: Db, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM bot_state WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setState(db: Db, key: string, value: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO bot_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run();
}

// ---- operational logs (no user identifiers, no URLs, no tokens) ----
export async function writeLog(
  db: Db,
  now: number,
  severity: 'info' | 'warning' | 'error',
  event: string,
  platform: string,
  detail: string,
): Promise<void> {
  await db
    .prepare('INSERT INTO app_logs (created_at, severity, event, platform, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(now, severity, event, platform, detail.slice(0, 300))
    .run();
}

export interface LogFilter {
  severity?: string;
  event?: string;
  q?: string;
  limit: number;
  offset: number;
}

export async function searchLogs(db: Db, f: LogFilter): Promise<LogRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.severity) {
    where.push('severity = ?');
    params.push(f.severity);
  }
  if (f.event) {
    where.push('event = ?');
    params.push(f.event);
  }
  if (f.q) {
    where.push('(detail LIKE ? OR platform LIKE ? OR event LIKE ?)');
    const like = `%${f.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(f.limit, f.offset);
  return (
    await db
      .prepare(`SELECT * FROM app_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .bind(...params)
      .all<LogRow>()
  ).results;
}

export async function countEventsSince(db: Db, event: string, since: number, platform?: string): Promise<number> {
  const row = platform
    ? await db
        .prepare('SELECT COUNT(*) AS n FROM app_logs WHERE event = ? AND platform = ? AND created_at >= ?')
        .bind(event, platform, since)
        .first<{ n: number }>()
    : await db
        .prepare('SELECT COUNT(*) AS n FROM app_logs WHERE event = ? AND created_at >= ?')
        .bind(event, since)
        .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Cleanup run by the scheduled handler. Only short-lived tables are pruned here. */
export async function pruneOldRows(
  db: Db,
  now: number,
  s: Pick<Settings, 'log_retention_days' | 'language_retention_days' | 'store_language'>,
): Promise<void> {
  const logCutoff = now - s.log_retention_days * 86_400_000;
  const languageCutoff = s.store_language ? now - s.language_retention_days * 86_400_000 : now + 1;
  await db.batch([
    db.prepare('DELETE FROM rate_events WHERE created_at < ?').bind(now - 3_600_000),
    db.prepare('DELETE FROM dedupe_keys WHERE created_at < ?').bind(now - 86_400_000),
    db.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(now - 86_400_000),
    db.prepare('DELETE FROM active_jobs WHERE started_at < ?').bind(now - 3_600_000),
    db.prepare('DELETE FROM panel_sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM app_logs WHERE created_at < ?').bind(logCutoff),
    // With store_language off, no language rows are kept (the cutoff is in the future).
    db.prepare('DELETE FROM user_prefs WHERE updated_at < ?').bind(languageCutoff),
  ]);
}

export { DEFAULT_SETTINGS };

export async function anyUserMustChangePassword(db: Db): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM panel_users WHERE must_change_password = 1')
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

export async function countLogsBySeveritySince(db: Db, since: number): Promise<Record<string, number>> {
  const rows = await db
    .prepare('SELECT severity, COUNT(*) AS n FROM app_logs WHERE created_at >= ? GROUP BY severity')
    .bind(since)
    .all<{ severity: string; n: number }>();
  const out: Record<string, number> = { info: 0, warning: 0, error: 0 };
  for (const row of rows.results) out[row.severity] = row.n;
  return out;
}

export async function schemaVersion(db: Db): Promise<number> {
  const row = await db.prepare('SELECT MAX(version) AS v FROM schema_migrations').first<{ v: number | null }>();
  return row?.v ?? 0;
}
