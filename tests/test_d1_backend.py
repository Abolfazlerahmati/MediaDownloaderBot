"""D1 backend tested against an in-process fake of the Worker bridge (sqlite3 behind httpx.MockTransport).
The real Worker route is exercised separately by tests/test_d1_live.py when a bridge URL is provided."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import time
from pathlib import Path

import httpx
import pytest

from mediabot.config import AppConfig
from mediabot.db.d1 import MIGRATIONS_DIR, D1Database, DatabaseUnavailable, bridge_token, split_sql
from mediabot.db.database import open_database
from mediabot.db.repositories import AdminRepo, LogRepo, PlatformRepo, SettingsRepo
from mediabot.platforms.service import seed_default_platforms

from .conftest import TEST_SECRET

BRIDGE_URL = "https://mediabot.example.workers.dev/internal/db"
TOKEN = bridge_token(TEST_SECRET)


class FakeBridge:
    """Mirrors the Worker bridge: token check, statement batches, all-or-nothing when atomic."""

    def __init__(self, path: Path) -> None:
        self.conn = sqlite3.connect(str(path), isolation_level=None)
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.calls = 0

    def _run(self, statement: dict) -> dict:
        cur = self.conn.execute(statement["sql"], tuple(statement["params"]))
        rows = []
        if cur.description:
            names = [d[0] for d in cur.description]
            rows = [dict(zip(names, r)) for r in cur.fetchall()]
        return {"rows": rows, "changes": max(cur.rowcount, 0), "last_row_id": cur.lastrowid or 0}

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if request.headers.get("x-mediabot-db-token") != TOKEN:
            return httpx.Response(401, json={"error": "unauthorized"})
        body = json.loads(request.content)
        try:
            if body["atomic"]:
                self.conn.execute("BEGIN")
                try:
                    results = [self._run(s) for s in body["statements"]]
                    self.conn.execute("COMMIT")
                except Exception:
                    self.conn.execute("ROLLBACK")
                    raise
            else:
                results = [self._run(s) for s in body["statements"]]
        except sqlite3.Error:
            return httpx.Response(500, json={"error": "database_error"})
        return httpx.Response(200, json={"results": results})


@pytest.fixture
def bridge(tmp_path):
    return FakeBridge(tmp_path / "fake-d1.sqlite")


@pytest.fixture
def d1(bridge):
    db = D1Database(BRIDGE_URL, TOKEN, transport=httpx.MockTransport(bridge.handle))
    yield db
    db.close()


def test_token_is_hmac_of_secret_and_never_the_secret_itself():
    expected = hmac.new(TEST_SECRET.encode(), b"mediabot-db-bridge-v1", hashlib.sha256).hexdigest()
    assert bridge_token(TEST_SECRET) == expected
    assert TEST_SECRET not in expected


def test_migrations_apply_once_and_are_recorded(d1):
    assert d1.migrate() == ["0001_init"]
    assert d1.schema_version() == 1
    assert d1.migrate() == []


def test_split_sql_yields_complete_statements_and_ignores_comments():
    script = "-- header\nCREATE TABLE a(x INTEGER);\n-- note\nCREATE INDEX i ON a(x);\n-- trailing\n"
    assert split_sql(script) == ["-- header\nCREATE TABLE a(x INTEGER);", "-- note\nCREATE INDEX i ON a(x);"]
    real = split_sql((MIGRATIONS_DIR / "0001_init.sql").read_text(encoding="utf-8"))
    assert len(real) >= 8 and all(sqlite3.complete_statement(s) for s in real)


def test_repositories_work_through_d1(d1):
    d1.migrate()
    settings = SettingsRepo(d1)
    settings.set("k", "v")
    assert settings.get("k") == "v"

    admins = AdminRepo(d1)
    admin_id = admins.create("owner", "hash-value")
    assert admin_id >= 1
    assert admins.get_by_username("owner").id == admin_id

    platforms = PlatformRepo(d1)
    seed_default_platforms(platforms)
    keys = {p.key for p in platforms.list_all()}
    assert {"youtube", "tiktok", "instagram", "pinterest"} <= keys

    logs = LogRepo(d1)
    logs.insert({"ts": time.time(), "level": "WARNING", "component": "web", "category": "t",
                 "message": "hello d1", "details": {"a": 1}})
    rows, total = logs.query(levels=None, component=None, category=None, since=None, until=None,
                             search="hello", limit=10, offset=0)
    assert total == 1 and rows[0]["message"] == "hello d1"


def test_bool_params_are_sent_as_integers_and_bad_types_rejected(d1, bridge):
    d1.migrate()
    d1.write("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)", ("flag", "1", 1.0))
    sent = []
    original = bridge.handle

    def spy(request):
        sent.append(json.loads(request.content))
        return original(request)

    d1._client = httpx.Client(transport=httpx.MockTransport(spy))
    d1.query("SELECT ? AS b", (True,))
    assert sent[-1]["statements"][0]["params"] == [1]
    with pytest.raises(TypeError):
        d1.query("SELECT ?", (object(),))


def test_executemany_is_all_or_nothing(d1):
    d1.migrate()
    rows = [("a", "1", 1.0), ("b", "2", 1.0), ("a", "dup", 1.0)]  # third violates the primary key
    with pytest.raises(DatabaseUnavailable):
        d1.executemany("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)", rows)
    assert d1.query_one("SELECT COUNT(*) AS n FROM settings")["n"] == 0


def test_wrong_token_is_refused_without_echoing_it(bridge):
    db = D1Database(BRIDGE_URL, "x" * 64, transport=httpx.MockTransport(bridge.handle))
    with pytest.raises(DatabaseUnavailable) as info:
        db.query("SELECT 1")
    assert "x" * 64 not in str(info.value)
    assert "unauthorized" in str(info.value)


def test_unreachable_bridge_raises_a_clean_error():
    def down(request):
        raise httpx.ConnectError("boom: https://secret.example/internal/db?t=abc")

    db = D1Database(BRIDGE_URL, TOKEN, transport=httpx.MockTransport(down))
    with pytest.raises(DatabaseUnavailable) as info:
        db.query("SELECT 1")
    assert "secret.example" not in str(info.value) and "abc" not in str(info.value)


def test_open_database_selects_backend(tmp_path):
    local = AppConfig(app_secret_key=TEST_SECRET, data_dir=tmp_path)
    assert type(open_database(local)).__name__ == "Database"
    remote = AppConfig(app_secret_key=TEST_SECRET, data_dir=tmp_path, db_backend="d1",
                       db_bridge_url=BRIDGE_URL, db_bridge_token=TOKEN)
    db = open_database(remote)
    assert isinstance(db, D1Database)
    db.close()


def test_d1_configuration_rules(tmp_path):
    base = dict(app_secret_key=TEST_SECRET, data_dir=tmp_path, db_backend="d1")
    assert any("DB_BRIDGE_URL" in p for p in AppConfig(**base).validation_problems())
    assert any("DB_BRIDGE_URL" in p for p in AppConfig(**base, db_bridge_url="http://evil.example",
                                                       db_bridge_token=TOKEN).validation_problems())
    assert any("DB_BRIDGE_TOKEN" in p for p in AppConfig(**base, db_bridge_url=BRIDGE_URL).validation_problems())
    assert AppConfig(**base, db_bridge_url=BRIDGE_URL, db_bridge_token=TOKEN).validation_problems() == []
    assert AppConfig(**base, db_bridge_url="http://127.0.0.1:8787/internal/db",
                     db_bridge_token=TOKEN).validation_problems() == []
