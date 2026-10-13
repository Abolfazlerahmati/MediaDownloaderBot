"""Lifecycle of the Telegram polling client: start, stop, restart, API test, retry.

The controller is the only place that touches python-telegram-bot's Application. The
rest of the bot works through the TelegramGateway interface and the BotService.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any

from telegram import BotCommand, Update
from telegram.error import InvalidToken, NetworkError, TimedOut
from telegram.ext import Application, CallbackQueryHandler, MessageHandler, filters

from mediabot.bot.types import IncomingCallback, IncomingMessage
from mediabot.observability.redact import redact
from mediabot.urls.detect import MessageEntity

logger = logging.getLogger("mediabot.bot.controller")
UpdateHandler = Callable[[Any], Awaitable[None]]


class BotStatus(str, Enum):
    NOT_CONFIGURED = "not_configured"
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    ERROR = "error"


@dataclass
class BotInfo:
    status: BotStatus = BotStatus.STOPPED
    username: str | None = None
    last_error: str | None = None
    last_error_at: float | None = None
    started_at: float | None = None
    last_api_ok_at: float | None = None


def to_incoming_message(update: Update) -> IncomingMessage | None:
    message = update.message
    if message is None:
        return None
    user = message.from_user
    text = message.text or message.caption or ""
    raw_entities = message.entities if message.text is not None else message.caption_entities
    entities = tuple(
        MessageEntity(type=e.type, offset=e.offset, length=e.length, url=e.url)
        for e in (raw_entities or ())
    )
    return IncomingMessage(
        update_id=update.update_id,
        chat_id=message.chat_id,
        chat_type=message.chat.type,
        message_id=message.message_id,
        user_id=user.id if user else None,
        is_bot=bool(user and user.is_bot),
        text=text,
        entities=entities,
    )


def to_incoming_callback(update: Update) -> IncomingCallback | None:
    query = update.callback_query
    if query is None:
        return None
    message = query.message
    return IncomingCallback(
        update_id=update.update_id,
        callback_id=query.id,
        chat_id=message.chat_id if message else None,
        chat_type=message.chat.type if message else None,
        message_id=message.message_id if message else None,
        user_id=query.from_user.id if query.from_user else None,
        data=query.data or "",
    )


COMMANDS = [
    BotCommand("start", "Start the bot / choose language"),
    BotCommand("help", "How to use this bot"),
    BotCommand("language", "Change language"),
]


class BotController:
    def __init__(self, token_provider: Callable[[], str | None], handler: Callable[[Update], Awaitable[None]],
                 drop_pending_updates: Callable[[], bool], retry_seconds: float = 60.0) -> None:
        self._token_provider = token_provider
        self._handler = handler
        self._drop_pending = drop_pending_updates
        self._app: Application | None = None
        self._info = BotInfo()
        self._retry_seconds = retry_seconds
        self._supervisor: asyncio.Task | None = None
        self._want_running = False
        self._lock = asyncio.Lock()

    # ----- accessors ---------------------------------------------------------
    @property
    def bot(self):  # type: ignore[no-untyped-def]
        if self._app is not None and self._info.status == BotStatus.RUNNING:
            return self._app.bot
        return None

    @property
    def username(self) -> str | None:
        return self._info.username

    def info(self) -> BotInfo:
        return self._info

    def has_token(self) -> bool:
        return bool(self._token_provider())

    # ----- lifecycle ----------------------------------------------------------
    async def start(self) -> None:
        async with self._lock:
            self._want_running = True
            await self._start_locked()

    async def _start_locked(self) -> None:
        token = self._token_provider()
        if not token:
            self._info.status = BotStatus.NOT_CONFIGURED
            self._info.last_error = "No bot token is configured. Set BOT_TOKEN or save a token in the panel."
            return
        if self._app is not None:
            await self._stop_locked()
        self._info.status = BotStatus.STARTING
        app = (
            Application.builder()
            .token(token)
            .concurrent_updates(True)
            .connect_timeout(15)
            .read_timeout(30)
            .write_timeout(60)
            .pool_timeout(15)
            .get_updates_connect_timeout(15)
            .get_updates_read_timeout(40)
            .build()
        )
        app.add_handler(MessageHandler(filters.UpdateType.MESSAGE, self._dispatch))
        app.add_handler(CallbackQueryHandler(self._dispatch))
        try:
            await app.initialize()
            me = await app.bot.get_me()
            self._info.username = me.username
            self._info.last_api_ok_at = time.time()
            try:
                await app.bot.set_my_commands(COMMANDS)
            except (NetworkError, TimedOut):
                logger.warning("could not register bot commands", extra={"category": "telegram_api"})
            await app.start()
            await app.updater.start_polling(  # type: ignore[union-attr]
                allowed_updates=["message", "callback_query"],
                drop_pending_updates=self._drop_pending(),
                error_callback=self._on_polling_error,
            )
        except InvalidToken:
            await self._abort(app)
            self._set_error("Telegram rejected the bot token. Check BOT_TOKEN or the token saved in the panel.",
                            retry=False)
            return
        except (NetworkError, TimedOut):
            await self._abort(app)
            self._set_error("Could not reach the Telegram API. Check outbound HTTPS access.", retry=True)
            return
        except Exception as exc:  # noqa: BLE001 - reported to the admin, never to users
            await self._abort(app)
            self._set_error(f"Bot failed to start ({exc.__class__.__name__}).", retry=True)
            logger.error("bot failed to start: %s", redact(str(exc))[:200], extra={"category": "bot_start_failed"})
            return
        self._app = app
        self._info.status = BotStatus.RUNNING
        self._info.last_error = None
        self._info.started_at = time.time()
        logger.info("Telegram polling started as @%s", self._info.username, extra={"category": "bot_started"})

    async def _abort(self, app: Application) -> None:
        try:
            await app.shutdown()
        except Exception:  # noqa: BLE001
            pass

    def _set_error(self, message: str, *, retry: bool) -> None:
        self._info.status = BotStatus.ERROR
        self._info.last_error = message
        self._info.last_error_at = time.time()
        logger.error(message, extra={"category": "telegram_api"})
        if retry and self._want_running and self._supervisor is None:
            self._supervisor = asyncio.create_task(self._retry_loop(), name="bot-retry")

    async def _retry_loop(self) -> None:
        delay = self._retry_seconds
        try:
            while self._want_running and self._info.status == BotStatus.ERROR:
                await asyncio.sleep(delay)
                async with self._lock:
                    if not self._want_running:
                        break
                    await self._start_locked()
                delay = min(delay * 2, 600)
        finally:
            self._supervisor = None

    async def stop(self) -> None:
        async with self._lock:
            self._want_running = False
            if self._supervisor is not None:
                self._supervisor.cancel()
                self._supervisor = None
            await self._stop_locked()

    async def _stop_locked(self) -> None:
        app = self._app
        if app is None:
            if self._info.status not in {BotStatus.ERROR, BotStatus.NOT_CONFIGURED}:
                self._info.status = BotStatus.STOPPED
            return
        self._info.status = BotStatus.STOPPING
        try:
            if app.updater and app.updater.running:
                await app.updater.stop()
            await app.stop()
            await app.shutdown()
        except Exception:  # noqa: BLE001
            logger.warning("bot shutdown was not clean", extra={"category": "bot_stop"})
        finally:
            self._app = None
            self._info.status = BotStatus.STOPPED

    async def restart(self) -> None:
        async with self._lock:
            self._want_running = True
            await self._stop_locked()
            await self._start_locked()

    async def close(self) -> None:
        await self.stop()

    # ----- connectivity test (works even when polling is stopped) -------------------
    async def test_api(self) -> tuple[bool, str]:
        token = self._token_provider()
        if not token:
            return False, "No bot token is configured."
        from telegram import Bot

        try:
            async with Bot(token=token) as bot:
                me = await asyncio.wait_for(bot.get_me(), timeout=20)
        except InvalidToken:
            return False, "Telegram rejected the bot token."
        except (TimeoutError, NetworkError, TimedOut):
            return False, "Could not reach the Telegram API within 20 seconds."
        except Exception as exc:  # noqa: BLE001
            return False, f"Telegram test failed ({exc.__class__.__name__})."
        self._info.last_api_ok_at = time.time()
        if self._info.username is None:
            self._info.username = me.username
        return True, f"Connected as @{me.username}."

    # ----- internals -----------------------------------------------------------
    async def _dispatch(self, update: Update, context: Any) -> None:
        try:
            await self._handler(update)
        except Exception:
            logger.error("update handler failed", extra={"category": "handler_error"}, exc_info=True)

    async def _on_polling_error(self, error: Exception) -> None:
        logger.warning("polling error: %s", redact(str(error))[:200], extra={"category": "telegram_polling"})
        self._info.last_error = "Temporary polling error; retrying."
        self._info.last_error_at = time.time()
