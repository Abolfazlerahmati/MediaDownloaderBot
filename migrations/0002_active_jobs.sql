-- MediaDownloaderBot schema, version 2. Generated from src/db/schema.ts (MIGRATIONS).
-- Job slots for the concurrency limit. A slot is removed when its job ends, or expires after the timeout.

CREATE TABLE IF NOT EXISTS active_jobs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL
);
