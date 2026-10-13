"""Live check of the Worker's D1 bridge. Skipped unless MEDIABOT_D1_BRIDGE_URL and MEDIABOT_D1_SECRET are set.

Example (local Worker with the D1 emulator):
  npx wrangler dev --config tests/d1-dev/wrangler.toml --port 8787
  MEDIABOT_D1_BRIDGE_URL=http://127.0.0.1:8787/internal/db MEDIABOT_D1_SECRET=<value of .dev.vars> pytest tests/test_d1_live.py
"""

from __future__ import annotations

import os
import time

import pytest

from mediabot.db.d1 import D1Database, DatabaseUnavailable, bridge_token
from mediabot.db.repositories import LogRepo, SettingsRepo

URL = os.environ.get("MEDIABOT_D1_BRIDGE_URL")
SECRET = os.environ.get("MEDIABOT_D1_SECRET")

pytestmark = pytest.mark.skipif(not (URL and SECRET), reason="D1 bridge not configured")


@pytest.fixture
def live():
    db = D1Database(URL, bridge_token(SECRET))
    yield db
    db.close()


def test_migrate_and_round_trip_through_real_d1(live):
    live.migrate()
    assert live.schema_version() == 1
    SettingsRepo(live).set("live-check", str(time.time()))
    assert SettingsRepo(live).get("live-check") is not None
    LogRepo(live).insert({"ts": time.time(), "level": "INFO", "component": "live", "category": "t",
                          "message": "live d1 probe", "details": None})


def test_bad_token_is_refused_by_the_worker(live):
    bad = D1Database(URL, "0" * 64)
    with pytest.raises(DatabaseUnavailable):
        bad.query("SELECT 1")
    bad.close()


def test_sql_errors_return_generic_message(live):
    with pytest.raises(DatabaseUnavailable) as info:
        live.query("SELECT * FROM table_that_does_not_exist")
    assert "table_that_does_not_exist" not in str(info.value)
