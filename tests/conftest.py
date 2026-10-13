"""Shared fixtures. Nothing here touches the network: platforms, Telegram and ffmpeg are faked
or exercised only through local files."""

from __future__ import annotations

import pytest

from mediabot.config import AppConfig
from mediabot.db.database import Database
from mediabot.db.repositories import PlatformRecord

TEST_SECRET = "test-secret-key-0123456789abcdefghijklmnop"
VALID_TOKEN = "123456789:" + "A" * 35


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "test.db")
    database.migrate()
    yield database
    database.close()


def make_record(**overrides) -> PlatformRecord:
    values = dict(
        id=1,
        key="youtube",
        name="YouTube",
        adapter="youtube",
        enabled=True,
        domains=["youtube.com", "youtu.be"],
        url_patterns=[],
        allowed_media_types=["video", "audio"],
        max_file_size_mb=50,
        max_duration_seconds=None,
        max_height=None,
        format_selector=None,
        thumbnails_enabled=True,
        options={"allow_live": False, "embed_audio_artwork": True},
        test_url=None,
        last_test_status="healthy",
        last_test_message=None,
        last_test_at=None,
        created_at=0.0,
        updated_at=0.0,
    )
    values.update(overrides)
    return PlatformRecord(**values)


@pytest.fixture
def app_config(tmp_path) -> AppConfig:
    return AppConfig(
        app_secret_key=TEST_SECRET,
        data_dir=tmp_path / "data",
        temp_dir=tmp_path / "tmp",
        enable_bot=False,
        enable_web=True,
        admin_cookie_secure=False,
    )
