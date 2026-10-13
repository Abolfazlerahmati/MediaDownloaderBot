"""Typed repositories over the SQLite database. No business rules live here."""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any

from mediabot.db.database import Database


# ----------------------------------------------------------------------------- settings
class SettingsRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def get(self, key: str) -> str | None:
        row = self._db.query_one("SELECT value FROM settings WHERE key = ?", (key,))
        return row["value"] if row else None

    def set(self, key: str, value: str) -> None:
        self._db.execute(
            "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, value, time.time()),
        )

    def delete(self, key: str) -> None:
        self._db.execute("DELETE FROM settings WHERE key = ?", (key,))


# ----------------------------------------------------------------------------- admins
@dataclass(frozen=True)
class Admin:
    id: int
    username: str
    password_hash: str
    appearance: dict[str, Any]
    created_at: float
    last_login_at: float | None
    is_active: bool
    must_change_password: bool = False


def _admin(row: sqlite3.Row) -> Admin:
    return Admin(
        id=row["id"],
        username=row["username"],
        password_hash=row["password_hash"],
        appearance=json.loads(row["appearance"] or "{}"),
        created_at=row["created_at"],
        last_login_at=row["last_login_at"],
        is_active=bool(row["is_active"]),
        must_change_password=bool(row["must_change_password"]),
    )


class AdminRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def count(self) -> int:
        return int(self._db.query_one("SELECT COUNT(*) AS c FROM admins")["c"])

    def create(self, username: str, password_hash: str, *, must_change: bool = False) -> int:
        return self._db.execute(
            "INSERT INTO admins(username, password_hash, created_at, must_change_password) VALUES (?, ?, ?, ?)",
            (username, password_hash, time.time(), 1 if must_change else 0),
        )

    def get_by_username(self, username: str) -> Admin | None:
        row = self._db.query_one("SELECT * FROM admins WHERE username = ?", (username,))
        return _admin(row) if row else None

    def get_by_id(self, admin_id: int) -> Admin | None:
        row = self._db.query_one("SELECT * FROM admins WHERE id = ?", (admin_id,))
        return _admin(row) if row else None

    def list_all(self) -> list[Admin]:
        return [_admin(r) for r in self._db.query("SELECT * FROM admins ORDER BY id")]

    def update_password(self, admin_id: int, password_hash: str) -> None:
        # Choosing a password always clears the forced-change flag.
        self._db.execute(
            "UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?",
            (password_hash, admin_id))

    def update_appearance(self, admin_id: int, appearance: dict[str, Any]) -> None:
        self._db.execute(
            "UPDATE admins SET appearance = ? WHERE id = ?", (json.dumps(appearance), admin_id)
        )

    def touch_login(self, admin_id: int) -> None:
        self._db.execute("UPDATE admins SET last_login_at = ? WHERE id = ?", (time.time(), admin_id))


# ----------------------------------------------------------------------------- sessions
class SessionRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def create(self, token_hash: str, admin_id: int, csrf_token: str, ttl_seconds: int) -> None:
        now = time.time()
        self._db.execute(
            "INSERT INTO admin_sessions(token_hash, admin_id, csrf_token, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (token_hash, admin_id, csrf_token, now, now + ttl_seconds),
        )

    def get_valid(self, token_hash: str) -> sqlite3.Row | None:
        return self._db.query_one(
            "SELECT s.token_hash, s.admin_id, s.csrf_token, s.expires_at, a.is_active "
            "FROM admin_sessions s JOIN admins a ON a.id = s.admin_id "
            "WHERE s.token_hash = ? AND s.expires_at > ?",
            (token_hash, time.time()),
        )

    def delete(self, token_hash: str) -> None:
        self._db.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))

    def delete_for_admin(self, admin_id: int, keep_hash: str | None = None) -> None:
        if keep_hash:
            self._db.execute(
                "DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash != ?", (admin_id, keep_hash)
            )
        else:
            self._db.execute("DELETE FROM admin_sessions WHERE admin_id = ?", (admin_id,))

    def purge_expired(self) -> int:
        return self._db.write("DELETE FROM admin_sessions WHERE expires_at <= ?", (time.time(),))


# ----------------------------------------------------------------------------- platforms
@dataclass(frozen=True)
class PlatformRecord:
    id: int
    key: str
    name: str
    adapter: str
    enabled: bool
    domains: list[str]
    url_patterns: list[str]
    allowed_media_types: list[str]
    max_file_size_mb: int | None
    max_duration_seconds: int | None
    max_height: int | None
    format_selector: str | None
    thumbnails_enabled: bool
    options: dict[str, Any]
    test_url: str | None
    last_test_status: str
    last_test_message: str | None
    last_test_at: float | None
    created_at: float
    updated_at: float
    extra: dict[str, Any] = field(default_factory=dict)


def _platform(row: sqlite3.Row) -> PlatformRecord:
    return PlatformRecord(
        id=row["id"],
        key=row["key"],
        name=row["name"],
        adapter=row["adapter"],
        enabled=bool(row["enabled"]),
        domains=json.loads(row["domains"]),
        url_patterns=json.loads(row["url_patterns"]),
        allowed_media_types=json.loads(row["allowed_media_types"]),
        max_file_size_mb=row["max_file_size_mb"],
        max_duration_seconds=row["max_duration_seconds"],
        max_height=row["max_height"],
        format_selector=row["format_selector"],
        thumbnails_enabled=bool(row["thumbnails_enabled"]),
        options=json.loads(row["options"] or "{}"),
        test_url=row["test_url"],
        last_test_status=row["last_test_status"],
        last_test_message=row["last_test_message"],
        last_test_at=row["last_test_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


PLATFORM_COLUMNS = (
    "key", "name", "adapter", "enabled", "domains", "url_patterns", "allowed_media_types",
    "max_file_size_mb", "max_duration_seconds", "max_height", "format_selector",
    "thumbnails_enabled", "options", "test_url",
)


class PlatformRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def list_all(self) -> list[PlatformRecord]:
        return [_platform(r) for r in self._db.query("SELECT * FROM platforms ORDER BY id")]

    def get(self, key: str) -> PlatformRecord | None:
        row = self._db.query_one("SELECT * FROM platforms WHERE key = ?", (key,))
        return _platform(row) if row else None

    def create(self, values: dict[str, Any]) -> None:
        now = time.time()
        row = self._encode(values)
        columns = list(row) + ["created_at", "updated_at"]
        placeholders = ",".join("?" for _ in columns)
        self._db.execute(
            f"INSERT INTO platforms({','.join(columns)}) VALUES ({placeholders})",
            [*row.values(), now, now],
        )

    def update(self, key: str, values: dict[str, Any], reset_test: bool) -> None:
        row = self._encode(values)
        assignments = [f"{c} = ?" for c in row] + ["updated_at = ?"]
        params: list[Any] = [*row.values(), time.time()]
        if reset_test:
            assignments += ["last_test_status = 'untested'", "last_test_message = NULL", "last_test_at = NULL"]
        params.append(key)
        self._db.execute(f"UPDATE platforms SET {', '.join(assignments)} WHERE key = ?", params)

    def set_enabled(self, key: str, enabled: bool) -> None:
        self._db.execute(
            "UPDATE platforms SET enabled = ?, updated_at = ? WHERE key = ?",
            (1 if enabled else 0, time.time(), key),
        )

    def set_test_result(self, key: str, status: str, message: str) -> None:
        self._db.execute(
            "UPDATE platforms SET last_test_status = ?, last_test_message = ?, last_test_at = ? WHERE key = ?",
            (status, message[:500], time.time(), key),
        )

    def delete(self, key: str) -> None:
        self._db.execute("DELETE FROM platforms WHERE key = ?", (key,))

    @staticmethod
    def _encode(values: dict[str, Any]) -> dict[str, Any]:
        encoded: dict[str, Any] = {}
        for column in PLATFORM_COLUMNS:
            if column not in values:
                continue
            value = values[column]
            if column in {"domains", "url_patterns", "allowed_media_types", "options"}:
                value = json.dumps(value)
            elif column in {"enabled", "thumbnails_enabled"}:
                value = 1 if value else 0
            encoded[column] = value
        return encoded


# ----------------------------------------------------------------------------- preferences
class PreferenceRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def get_language(self, user_hash: str) -> str | None:
        row = self._db.query_one("SELECT language FROM user_preferences WHERE user_hash = ?", (user_hash,))
        return row["language"] if row else None

    def set_language(self, user_hash: str, language: str) -> None:
        self._db.execute(
            "INSERT INTO user_preferences(user_hash, language, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_hash) DO UPDATE SET language = excluded.language, updated_at = excluded.updated_at",
            (user_hash, language, time.time()),
        )

    def purge_older_than(self, cutoff_ts: float) -> int:
        return self._db.write("DELETE FROM user_preferences WHERE updated_at < ?", (cutoff_ts,))

    def count(self) -> int:
        return int(self._db.query_one("SELECT COUNT(*) AS c FROM user_preferences")["c"])


# ----------------------------------------------------------------------------- logs
class LogRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def insert(self, entry: dict[str, Any]) -> None:
        details = entry.get("details")
        self._db.execute(
            "INSERT INTO operational_logs(ts, level, component, category, message, details) VALUES (?,?,?,?,?,?)",
            (
                entry["ts"],
                entry["level"],
                entry["component"],
                entry["category"],
                entry["message"],
                json.dumps(details, default=str) if details is not None else None,
            ),
        )

    def query(
        self,
        *,
        min_level_rank: int = 0,
        levels: list[str] | None = None,
        component: str | None = None,
        category: str | None = None,
        since: float | None = None,
        until: float | None = None,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[sqlite3.Row], int]:
        clauses: list[str] = []
        params: list[Any] = []
        if levels:
            clauses.append(f"level IN ({','.join('?' for _ in levels)})")
            params.extend(levels)
        if component:
            clauses.append("component = ?")
            params.append(component)
        if category:
            clauses.append("category = ?")
            params.append(category)
        if since is not None:
            clauses.append("ts >= ?")
            params.append(since)
        if until is not None:
            clauses.append("ts <= ?")
            params.append(until)
        if search:
            clauses.append("(message LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')")
            like = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            params.extend([like, like])
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        total = int(self._db.query_one(f"SELECT COUNT(*) AS c FROM operational_logs {where}", params)["c"])
        rows = self._db.query(
            f"SELECT * FROM operational_logs {where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        )
        return rows, total

    def purge_older_than(self, cutoff_ts: float) -> int:
        return self._db.write("DELETE FROM operational_logs WHERE ts < ?", (cutoff_ts,))

    def trim_to(self, max_rows: int) -> None:
        self._db.execute(
            "DELETE FROM operational_logs WHERE id NOT IN "
            "(SELECT id FROM operational_logs ORDER BY id DESC LIMIT ?)",
            (max_rows,),
        )

    def delete_all(self) -> int:
        return self._db.write("DELETE FROM operational_logs")
