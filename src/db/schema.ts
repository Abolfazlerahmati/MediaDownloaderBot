// Schema and seed data. The Worker applies migrations itself on first use (no console commands).
// Table names avoid the old Python-era tables that may still exist in the same D1 database.
import { hashPassword } from '../security/crypto';
import { MEDIA_PLATFORM_SEEDS } from './seeds';

interface Migration {
  version: number;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS app_settings (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS panel_users (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         username TEXT NOT NULL UNIQUE,
         password_hash TEXT NOT NULL,
         must_change_password INTEGER NOT NULL DEFAULT 0,
         appearance_theme TEXT NOT NULL DEFAULT 'merchant',
         appearance_mode TEXT NOT NULL DEFAULT 'system',
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS panel_sessions (
         token_hash TEXT PRIMARY KEY,
         user_id INTEGER NOT NULL,
         csrf_token TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL
       )`,
      'CREATE INDEX IF NOT EXISTS panel_sessions_user ON panel_sessions (user_id)',
      `CREATE TABLE IF NOT EXISTS login_attempts (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         key_hash TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
      'CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts (key_hash, created_at)',
      `CREATE TABLE IF NOT EXISTS media_platforms (
         key TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         enabled INTEGER NOT NULL DEFAULT 0,
         implemented INTEGER NOT NULL DEFAULT 0,
         sample_url TEXT NOT NULL DEFAULT '',
         last_test_at INTEGER,
         last_test_ok INTEGER,
         last_test_message TEXT NOT NULL DEFAULT ''
       )`,
      `CREATE TABLE IF NOT EXISTS user_prefs (
         telegram_id INTEGER PRIMARY KEY,
         language TEXT NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS rate_events (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_hash TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
      'CREATE INDEX IF NOT EXISTS rate_events_user ON rate_events (user_hash, created_at)',
      `CREATE TABLE IF NOT EXISTS dedupe_keys (
         key_hash TEXT PRIMARY KEY,
         created_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS app_logs (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         created_at INTEGER NOT NULL,
         severity TEXT NOT NULL,
         event TEXT NOT NULL,
         platform TEXT NOT NULL DEFAULT '',
         detail TEXT NOT NULL DEFAULT ''
       )`,
      'CREATE INDEX IF NOT EXISTS app_logs_created ON app_logs (created_at)',
      `CREATE TABLE IF NOT EXISTS bot_state (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS active_jobs (
         id TEXT PRIMARY KEY,
         started_at INTEGER NOT NULL
       )`,
    ],
  },
  {
    // Panel language is per admin account. It is separate from the bot's default_language setting.
    version: 3,
    statements: ["ALTER TABLE panel_users ADD COLUMN appearance_lang TEXT NOT NULL DEFAULT 'en'"],
  },
];

export const DEFAULT_ADMIN_USERNAME = 'admin';
/** Public default password. The first login must change it (see docs/security.md). */
export const DEFAULT_ADMIN_PASSWORD = '12345678';

/** Minimal D1 surface used here. D1Database satisfies it, and so does the node:sqlite test adapter. */
export interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface Db {
  prepare(sql: string): Stmt;
  batch(statements: unknown[]): Promise<unknown>;
}

let ready: Promise<void> | null = null;

/** Runs once per isolate. Safe to call on every request. */
export function ensureSchema(db: Db, now: number = Date.now()): Promise<void> {
  if (!ready) {
    ready = applySchema(db, now).catch((error: unknown) => {
      ready = null; // retry on the next request
      throw error;
    });
  }
  return ready;
}

export function resetSchemaCacheForTests(): void {
  ready = null;
}

async function applySchema(db: Db, now: number): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`),
  ]);
  for (const migration of MIGRATIONS) {
    const applied = await db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .bind(migration.version)
      .first();
    if (applied) continue;
    // D1 batches run as one transaction, so a partly applied migration cannot be left behind.
    await db.batch([
      ...migration.statements.map((sql) => db.prepare(sql)),
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').bind(migration.version, now),
    ]);
  }
  await seedDefaults(db, now);
}

async function seedDefaults(db: Db, now: number): Promise<void> {
  for (const p of MEDIA_PLATFORM_SEEDS) {
    await db
      .prepare(
        `INSERT INTO media_platforms (key, name, enabled, implemented) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET name = excluded.name, implemented = excluded.implemented`,
      )
      .bind(p.key, p.name, p.enabled ? 1 : 0, p.implemented ? 1 : 0)
      .run();
  }
  const admins = await db.prepare('SELECT COUNT(*) AS n FROM panel_users').first<{ n: number }>();
  if ((admins?.n ?? 0) === 0) {
    const hash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
    await db
      .prepare(
        `INSERT INTO panel_users (username, password_hash, must_change_password, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`,
      )
      .bind(DEFAULT_ADMIN_USERNAME, hash, now, now)
      .run();
  }
}
