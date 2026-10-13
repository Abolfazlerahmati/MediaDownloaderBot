-- Initial schema. Only data that the application genuinely needs is stored here:
--   admins / admin_sessions : panel authentication
--   settings                : runtime configuration (JSON values)
--   platforms               : platform adapter configuration
--   user_preferences        : OPTIONAL language preference, keyed by a keyed hash (HMAC)
--                             of the Telegram user id - never the raw id, username or name.
--   operational_logs        : redacted service logs with retention.
-- Media binaries, download history, message content and user profiles are never stored.

CREATE TABLE admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    appearance TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL,
    last_login_at REAL,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    adapter TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    domains TEXT NOT NULL DEFAULT '[]',
    url_patterns TEXT NOT NULL DEFAULT '[]',
    allowed_media_types TEXT NOT NULL DEFAULT '["video","audio"]',
    max_file_size_mb INTEGER,
    max_duration_seconds INTEGER,
    max_height INTEGER,
    format_selector TEXT,
    thumbnails_enabled INTEGER NOT NULL DEFAULT 1,
    options TEXT NOT NULL DEFAULT '{}',
    test_url TEXT,
    last_test_status TEXT NOT NULL DEFAULT 'untested',
    last_test_message TEXT,
    last_test_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE user_preferences (
    user_hash TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX idx_user_preferences_updated ON user_preferences(updated_at);

CREATE TABLE operational_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    level TEXT NOT NULL,
    component TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT
);
CREATE INDEX idx_logs_ts ON operational_logs(ts);
CREATE INDEX idx_logs_level ON operational_logs(level);
CREATE INDEX idx_logs_component ON operational_logs(component);
