-- MediaDownloaderBot schema (Cloudflare D1). Applied with: wrangler d1 migrations apply mediabot --remote
-- Only the host of a link is stored, not the full URL, to keep history minimal.

CREATE TABLE IF NOT EXISTS bot_users (
  telegram_id   INTEGER PRIMARY KEY,
  username      TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  request_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS download_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  chat_id     INTEGER NOT NULL,
  platform    TEXT NOT NULL,
  url_host    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
  error_code  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_download_jobs_user_created ON download_jobs (telegram_id, created_at);
