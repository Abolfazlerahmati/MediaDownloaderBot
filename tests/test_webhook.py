"""Webhook mode: configuration rules, HTTP secret check and update dispatch (no network)."""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient
from telegram import Bot

from mediabot.app import Runtime
from mediabot.bot.controller import BotStatus
from mediabot.config import AppConfig
from mediabot.web.app import create_web_app

from .conftest import TEST_SECRET, VALID_TOKEN

WEBHOOK_URL = "https://mediabot.example.workers.dev/telegram/webhook"
HOOK_SECRET = "s" * 40


def test_webhook_mode_requires_public_https_url(tmp_path):
    base = dict(app_secret_key=TEST_SECRET, data_dir=tmp_path, enable_bot=True, enable_web=True,
                bot_mode="webhook")
    assert any("https" in p for p in AppConfig(**base, webhook_base_url=None).validation_problems())
    assert any("https" in p for p in AppConfig(**base, webhook_base_url="http://x.example").validation_problems())
    assert AppConfig(**base, webhook_base_url="https://x.example").validation_problems() == []


def test_webhook_mode_needs_the_web_process(tmp_path):
    cfg = AppConfig(app_secret_key=TEST_SECRET, data_dir=tmp_path, enable_bot=True, enable_web=False,
                    bot_mode="webhook", webhook_base_url="https://x.example")
    assert any("ENABLE_WEB" in p for p in cfg.validation_problems())


def _runtime(app_config, webhook: bool) -> Runtime:
    if webhook:
        cfg = app_config.model_copy(update={"bot_mode": "webhook", "webhook_base_url": "https://x.example",
                                            "enable_bot": True})
    else:
        cfg = app_config
    rt = Runtime(cfg)
    rt.controller._webhook_url = WEBHOOK_URL if webhook else None
    rt.controller._webhook_secret = HOOK_SECRET
    return rt


def test_route_is_hidden_when_polling(app_config):
    rt = _runtime(app_config, webhook=False)
    try:
        client = TestClient(create_web_app(rt))
        assert client.post("/telegram/webhook", json={"update_id": 1}).status_code == 404
    finally:
        rt.close()


def test_route_rejects_missing_or_wrong_secret(app_config):
    rt = _runtime(app_config, webhook=True)
    try:
        client = TestClient(create_web_app(rt))
        assert client.post("/telegram/webhook", json={"update_id": 1}).status_code == 403
        bad = client.post("/telegram/webhook", json={"update_id": 1},
                          headers={"X-Telegram-Bot-Api-Secret-Token": "nope"})
        assert bad.status_code == 403
    finally:
        rt.close()


def test_route_returns_503_while_bot_is_not_running(app_config):
    rt = _runtime(app_config, webhook=True)
    try:
        client = TestClient(create_web_app(rt))
        ok_header = {"X-Telegram-Bot-Api-Secret-Token": HOOK_SECRET}
        assert client.post("/telegram/webhook", json={"update_id": 1}, headers=ok_header).status_code == 503
    finally:
        rt.close()


def test_route_is_exempt_from_panel_csrf(app_config):
    rt = _runtime(app_config, webhook=True)
    try:
        client = TestClient(create_web_app(rt))
        # No Origin and no CSRF token: the panel would answer "session form expired".
        response = client.post("/telegram/webhook", json={"update_id": 1})
        assert response.status_code == 403  # refused by the secret check instead
        assert "session form expired" not in response.text
    finally:
        rt.close()


async def test_accepted_update_is_dispatched_to_the_handler(app_config):
    rt = _runtime(app_config, webhook=True)
    seen = []

    async def recorder(update):
        seen.append(update.update_id)

    class FakeApp:
        bot = Bot(VALID_TOKEN)

    try:
        rt.controller._handler = recorder
        rt.controller._app = FakeApp()  # type: ignore[assignment]
        rt.controller._info.status = BotStatus.RUNNING
        payload = {"update_id": 42, "message": {"message_id": 1, "date": 0, "chat": {"id": 7, "type": "private"},
                                                  "from": {"id": 7, "is_bot": False, "first_name": "t"},
                                                  "text": "hi"}}
        assert rt.controller.accept_webhook_update(payload) is True
        await asyncio.sleep(0.05)
        assert seen == [42]
        assert rt.controller.verify_webhook_secret(HOOK_SECRET)
        assert not rt.controller.verify_webhook_secret(HOOK_SECRET + "x")
        assert not rt.controller.verify_webhook_secret(None)
    finally:
        rt.controller._app = None
        rt.close()
