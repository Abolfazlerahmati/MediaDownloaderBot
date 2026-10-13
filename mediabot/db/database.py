"""SQLite access layer with versioned, transactional migrations.

A single connection is shared by the process and guarded by a re-entrant lock.
The workload is small (settings, a handful of admins, logs), so SQLite in WAL mode
is sufficient and avoids an external database server.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger("mediabot.storage")
MIGRATIONS_DIR = Path(__file__).parent / "migrations"


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            str(path),
            check_same_thread=False,
            isolation_level=None,  # explicit transactions only
            timeout=10,
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA busy_timeout = 5000")
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA synchronous = NORMAL")

    # ----- basic operations ----------------------------------------------
    def query(self, sql: str, params: Sequence[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchall()

    def query_one(self, sql: str, params: Sequence[Any] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchone()

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        """Run a single write statement (autocommit). Returns lastrowid."""
        with self._lock:
            cursor = self._conn.execute(sql, tuple(params))
            return int(cursor.lastrowid or 0)

    def write(self, sql: str, params: Sequence[Any] = ()) -> int:
        """Run a single write statement (autocommit). Returns the number of affected rows."""
        with self._lock:
            cursor = self._conn.execute(sql, tuple(params))
            return int(cursor.rowcount or 0)

    def executemany(self, sql: str, rows: Sequence[Sequence[Any]]) -> None:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                self._conn.executemany(sql, rows)
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def ping(self) -> int:
        """Return the schema version; raises if the database is unusable."""
        row = self.query_one("SELECT 1 AS ok")
        if row is None or row["ok"] != 1:
            raise RuntimeError("database ping returned an unexpected result")
        return self.schema_version()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ----- migrations ----------------------------------------------------
    def schema_version(self) -> int:
        exists = self.query_one(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
        )
        if exists is None:
            return 0
        row = self.query_one("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
        return int(row["v"]) if row else 0

    def migrate(self) -> list[str]:
        """Apply pending migrations in order. Returns the names applied."""
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at REAL NOT NULL)"
            )
        current = self.schema_version()
        applied: list[str] = []
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            version = int(path.name.split("_", 1)[0])
            if version <= current:
                continue
            sql = path.read_text(encoding="utf-8")
            with self._lock:
                try:
                    self._conn.executescript(
                        "BEGIN;\n" + sql + "\n"
                        f"INSERT INTO schema_migrations(version, name, applied_at) "
                        f"VALUES ({version}, '{path.stem}', {time.time()});\nCOMMIT;"
                    )
                except Exception:
                    try:
                        self._conn.execute("ROLLBACK")
                    except sqlite3.Error:
                        pass
                    logger.error("migration %s failed", path.name, extra={"category": "migration_failed"})
                    raise
            applied.append(path.stem)
            logger.info("applied migration %s", path.stem, extra={"category": "migration"})
        return applied
