-- MediaDownloaderBot schema, version 1 (Cloudflare D1).
-- Generated from src/db/schema.ts (MIGRATIONS). The Worker applies this itself on first request,
-- so no console command is needed. This file is for reference and for `wrangler d1 migrations`.
-- Only the minimal data is stored: panel accounts, settings, platform flags, language per Telegram user,
-- and short-lived rate, dedupe, and login-throttle rows. No usernames, no download history.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  appearance_theme TEXT NOT NULL DEFAULT 'merchant',
  appearance_mode TEXT NOT NULL DEFAULT 'system',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS panel_sessions_user ON panel_sessions (user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts (key_hash, created_at);

CREATE TABLE IF NOT EXISTS media_platforms (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  implemented INTEGER NOT NULL DEFAULT 0,
  sample_url TEXT NOT NULL DEFAULT '',
  last_test_at INTEGER,
  last_test_ok INTEGER,
  last_test_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_prefs (
  telegram_id INTEGER PRIMARY KEY,
  language TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_events_user ON rate_events (user_hash, created_at);

CREATE TABLE IF NOT EXISTS dedupe_keys (
  key_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  severity TEXT NOT NULL,
  event TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS app_logs_created ON app_logs (created_at);

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
