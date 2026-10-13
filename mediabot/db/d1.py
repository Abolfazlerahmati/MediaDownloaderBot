"""Cloudflare D1 backend. Same interface as ``Database``, but every statement is sent to the
Worker's bridge route (``POST /internal/db``), which runs it with the D1 binding.

Bridge protocol (implemented by ``src/index.ts`` in the Worker):

  request  header  x-mediabot-db-token: <hex HMAC of APP_SECRET_KEY>
           body    {"atomic": bool, "statements": [{"sql": str, "params": [str|int|float|null, ...]}]}
  response 200     {"results": [{"rows": [{col: value}], "changes": int, "last_row_id": int}, ...]}
           4xx/5xx  {"error": "<code>"}

``atomic=true`` runs all statements in one D1 batch (all-or-nothing). D1 does not accept SQL
``BEGIN``/``COMMIT``, so ``transaction()`` is not offered; the repositories do not need it.
Every call is synchronous and blocks the calling thread for one HTTPS round trip.
"""

from __future__ import annotations

import hmac
import hashlib
import logging
import sqlite3
import threading
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("mediabot.storage")
MIGRATIONS_DIR = Path(__file__).parent / "migrations"
TOKEN_CONTEXT = b"mediabot-db-bridge-v1"
MAX_STATEMENTS_PER_CALL = 200


class DatabaseUnavailable(RuntimeError):
    """The bridge could not run the statements. The message never contains SQL or parameters."""


class Row(dict):
    """Row that supports both ``row["column"]`` and ``row[0]``, like ``sqlite3.Row``."""

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def bridge_token(app_secret: str) -> str:
    """Token shared by the Worker and the container. Derived from APP_SECRET_KEY, never stored."""
    return hmac.new(app_secret.encode("utf-8"), TOKEN_CONTEXT, hashlib.sha256).hexdigest()


def split_sql(script: str) -> list[str]:
    """Split a migration script into single statements (D1 runs one statement per call)."""
    statements: list[str] = []
    buffer = ""
    for line in script.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            statements.append(buffer.strip())
            buffer = ""
    leftover = [ln.strip() for ln in buffer.splitlines() if ln.strip() and not ln.strip().startswith("--")]
    if leftover:
        raise ValueError("migration ends with an incomplete statement")
    return [s for s in statements if s]


def _normalize(params: Sequence[Any]) -> list[Any]:
    out: list[Any] = []
    for value in params:
        if isinstance(value, bool):
            out.append(int(value))
        elif value is None or isinstance(value, (int, float, str)):
            out.append(value)
        else:
            raise TypeError(f"unsupported parameter type for D1: {type(value).__name__}")
    return out


class D1Database:
    def __init__(self, bridge_url: str, token: str, *, timeout: float = 20.0,
                 transport: httpx.BaseTransport | None = None) -> None:
        if not bridge_url:
            raise ValueError("bridge_url is required for the D1 backend")
        self._url = bridge_url
        self._token = token
        self._lock = threading.RLock()
        self._client = httpx.Client(timeout=timeout, transport=transport)

    # ----- transport -------------------------------------------------------
    def _call(self, statements: list[dict[str, Any]], *, atomic: bool) -> list[dict[str, Any]]:
        if not statements or len(statements) > MAX_STATEMENTS_PER_CALL:
            raise ValueError("invalid number of statements in one call")
        payload = {"atomic": atomic, "statements": statements}
        try:
            with self._lock:
                response = self._client.post(
                    self._url, json=payload,
                    headers={"x-mediabot-db-token": self._token, "content-type": "application/json"},
                )
        except httpx.HTTPError as exc:
            logger.error("database bridge unreachable (%s)", exc.__class__.__name__,
                         extra={"category": "storage_error"})
            raise DatabaseUnavailable("The database bridge is unreachable.") from None
        if response.status_code != 200:
            code = "unknown"
            try:
                code = str(response.json().get("error", code))[:40]
            except ValueError:
                pass
            logger.error("database bridge returned %s (%s)", response.status_code, code,
                         extra={"category": "storage_error"})
            raise DatabaseUnavailable(f"The database bridge refused the request ({code}).")
        return response.json()["results"]

    def _statement(self, sql: str, params: Sequence[Any]) -> dict[str, Any]:
        return {"sql": sql, "params": _normalize(params)}

    # ----- basic operations (same signatures as Database) -----------------
    def query(self, sql: str, params: Sequence[Any] = ()) -> list[Row]:
        results = self._call([self._statement(sql, params)], atomic=False)
        return [Row(r) for r in results[0]["rows"]]

    def query_one(self, sql: str, params: Sequence[Any] = ()) -> Row | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        """Run one write. Returns last_row_id."""
        results = self._call([self._statement(sql, params)], atomic=False)
        return int(results[0].get("last_row_id") or 0)

    def write(self, sql: str, params: Sequence[Any] = ()) -> int:
        """Run one write. Returns the number of changed rows."""
        results = self._call([self._statement(sql, params)], atomic=False)
        return int(results[0].get("changes") or 0)

    def executemany(self, sql: str, rows: Sequence[Sequence[Any]]) -> None:
        statements = [self._statement(sql, row) for row in rows]
        for start in range(0, len(statements), MAX_STATEMENTS_PER_CALL):
            self._call(statements[start:start + MAX_STATEMENTS_PER_CALL], atomic=True)

    def transaction(self) -> Iterator[None]:  # pragma: no cover - interface guard
        raise NotImplementedError("interactive transactions are not available on D1; use executemany()")

    def close(self) -> None:
        self._client.close()

    # ----- migrations ------------------------------------------------------
    def schema_version(self) -> int:
        row = self.query_one(
            "SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations"
            " WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')"
        )
        return int(row["v"]) if row else 0

    def migrate(self) -> list[str]:
        import time

        self._call([self._statement(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at REAL NOT NULL)", ())],
            atomic=False)
        current = self.schema_version()
        applied: list[str] = []
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            version = int(path.name.split("_", 1)[0])
            if version <= current:
                continue
            statements = [self._statement(s, ()) for s in split_sql(path.read_text(encoding="utf-8"))]
            statements.append(self._statement(
                "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
                (version, path.stem, time.time())))
            try:
                # One atomic batch: the schema change and its version marker commit together.
                self._call(statements, atomic=True)
            except DatabaseUnavailable:
                logger.error("migration %s failed", path.name, extra={"category": "migration_failed"})
                raise
            applied.append(path.stem)
            logger.info("applied migration %s", path.stem, extra={"category": "migration"})
        return applied

    def ping(self) -> int:
        row = self.query_one("SELECT 1 AS ok")
        if row is None or row["ok"] != 1:
            raise RuntimeError("database ping returned an unexpected result")
        return self.schema_version()
