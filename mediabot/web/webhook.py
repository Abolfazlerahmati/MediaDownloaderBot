"""Telegram webhook endpoint. Telegram authenticates with the secret token header, not with
browser sessions, so this route is exempt from the panel's CSRF and Origin checks."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("mediabot.web")
router = APIRouter()

WEBHOOK_PATH = "/telegram/webhook"
MAX_UPDATE_BYTES = 1_000_000  # Telegram updates are far smaller; cap to avoid abuse


@router.post(WEBHOOK_PATH)
async def telegram_webhook(request: Request) -> JSONResponse:
    rt: Any = request.app.state.rt
    if not rt.controller.webhook_mode:
        return JSONResponse({"detail": "Not found"}, status_code=404)
    if not rt.controller.verify_webhook_secret(request.headers.get("x-telegram-bot-api-secret-token")):
        return JSONResponse({"detail": "Forbidden"}, status_code=403)
    raw = await request.body()
    if len(raw) > MAX_UPDATE_BYTES:
        return JSONResponse({"detail": "Payload too large"}, status_code=413)
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        return JSONResponse({"detail": "Invalid JSON"}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"detail": "Invalid update"}, status_code=400)
    accepted = rt.controller.accept_webhook_update(payload)
    if not accepted:
        # 503 makes Telegram keep the update and retry later (bot not running yet).
        return JSONResponse({"detail": "Bot is not running"}, status_code=503)
    return JSONResponse({"ok": True})
