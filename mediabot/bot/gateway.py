"""Outbound Telegram operations used by the bot logic.

``TelegramGateway`` is the only interface the handlers and the notifier depend on.
``PTBGateway`` implements it with python-telegram-bot; tests use an in-memory fake.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Protocol

from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup, InputFile
from telegram.error import BadRequest, NetworkError, RetryAfter, TelegramError, TimedOut

from mediabot.errors import ErrorCode, MediaError
from mediabot.media.delivery import DeliveryKind, OutboundMedia
from mediabot.observability.redact import redact

logger = logging.getLogger("mediabot.telegram")

Keyboard = list[list[tuple[str, str]]]  # rows of (label, callback_data)


class TelegramGateway(Protocol):
    async def send_text(self, chat_id: int, text: str, *, reply_to: int | None = None,
                        keyboard: Keyboard | None = None) -> int | None: ...
    async def edit_text(self, chat_id: int, message_id: int, text: str,
                        keyboard: Keyboard | None = None) -> bool: ...
    async def delete_message(self, chat_id: int, message_id: int) -> bool: ...
    async def answer_callback(self, callback_id: str, text: str | None = None) -> None: ...
    async def chat_action(self, chat_id: int, action: str) -> None: ...
    async def send_media(self, chat_id: int, reply_to: int | None, media: OutboundMedia) -> None: ...


def _markup(keyboard: Keyboard | None) -> InlineKeyboardMarkup | None:
    if not keyboard:
        return None
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(label, callback_data=data) for label, data in row] for row in keyboard
    ])


class PTBGateway:
    """python-telegram-bot implementation. ``bot_provider`` returns the live Bot or None."""

    RETRIES = 2

    def __init__(self, bot_provider) -> None:  # type: ignore[no-untyped-def]
        self._bot_provider = bot_provider

    def _bot(self) -> Bot:
        bot = self._bot_provider()
        if bot is None:
            raise MediaError(ErrorCode.SERVICE_UNAVAILABLE, "bot is not running")
        return bot

    async def _call(self, operation: str, func):  # type: ignore[no-untyped-def]
        attempt = 0
        while True:
            attempt += 1
            try:
                return await func()
            except RetryAfter as exc:
                delay = exc.retry_after.total_seconds() if hasattr(exc.retry_after, "total_seconds") else float(exc.retry_after)
                await asyncio.sleep(min(delay, 30))
                if attempt > self.RETRIES:
                    raise
            except (NetworkError, TimedOut):
                if attempt > self.RETRIES:
                    raise
                await asyncio.sleep(1.5 * attempt)
            except TelegramError as exc:
                logger.info("telegram %s failed: %s", operation, redact(str(exc))[:200],
                            extra={"category": "telegram_api"})
                raise

    async def send_text(self, chat_id: int, text: str, *, reply_to: int | None = None,
                        keyboard: Keyboard | None = None) -> int | None:
        bot = self._bot()
        try:
            message = await self._call("send_message", lambda: bot.send_message(
                chat_id=chat_id, text=text, reply_to_message_id=reply_to,
                allow_sending_without_reply=True, reply_markup=_markup(keyboard),
                disable_web_page_preview=True,
            ))
        except TelegramError:
            return None
        return message.message_id if message else None

    async def edit_text(self, chat_id: int, message_id: int, text: str, keyboard: Keyboard | None = None) -> bool:
        bot = self._bot()
        try:
            await self._call("edit_message", lambda: bot.edit_message_text(
                chat_id=chat_id, message_id=message_id, text=text, reply_markup=_markup(keyboard),
                disable_web_page_preview=True,
            ))
            return True
        except BadRequest as exc:
            if "not modified" not in str(exc).lower():
                logger.info("edit skipped: %s", redact(str(exc))[:120], extra={"category": "telegram_api"})
            return False
        except TelegramError:
            return False

    async def delete_message(self, chat_id: int, message_id: int) -> bool:
        bot = self._bot()
        try:
            await self._call("delete_message", lambda: bot.delete_message(chat_id=chat_id, message_id=message_id))
            return True
        except TelegramError:
            return False

    async def answer_callback(self, callback_id: str, text: str | None = None) -> None:
        bot = self._bot()
        try:
            await bot.answer_callback_query(callback_id=callback_id, text=text, show_alert=False)
        except TelegramError:
            pass

    async def chat_action(self, chat_id: int, action: str) -> None:
        bot = self._bot()
        try:
            await bot.send_chat_action(chat_id=chat_id, action=action)
        except TelegramError:
            pass

    async def send_media(self, chat_id: int, reply_to: int | None, media: OutboundMedia) -> None:
        bot = self._bot()
        thumb = _input(media.thumbnail_path, "thumb.jpg") if media.thumbnail_path else None

        async def send() -> object:
            with media.path.open("rb") as handle:
                payload = InputFile(handle, filename=media.display_name)
                common = dict(
                    chat_id=chat_id,
                    caption=media.caption,
                    reply_to_message_id=reply_to,
                    allow_sending_without_reply=True,
                    read_timeout=120, write_timeout=300, connect_timeout=30,
                )
                if media.kind == DeliveryKind.VIDEO:
                    return await bot.send_video(
                        video=payload, duration=media.duration, width=media.width, height=media.height,
                        supports_streaming=media.supports_streaming, thumbnail=thumb, **common)
                if media.kind == DeliveryKind.AUDIO:
                    return await bot.send_audio(
                        audio=payload, duration=media.duration, title=media.title,
                        performer=media.performer, thumbnail=thumb, **common)
                return await bot.send_document(document=payload, **common)

        try:
            await self._call("send_media", send)
        except BadRequest as exc:
            text = str(exc).lower()
            if "too large" in text or "entity" in text:
                raise MediaError(ErrorCode.TOO_LARGE, "Telegram rejected file size") from exc
            raise MediaError(ErrorCode.UPLOAD_FAILED, "Telegram rejected upload") from exc
        except (TelegramError, OSError) as exc:
            raise MediaError(ErrorCode.UPLOAD_FAILED, type(exc).__name__) from exc


def _input(path: Path, name: str) -> InputFile:
    return InputFile(path.read_bytes(), filename=name)
