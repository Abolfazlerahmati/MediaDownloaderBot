"""Telegram behaviour rules, independent of the Telegram client library.

Rules implemented here (see docs/BOT_BEHAVIOUR.md for the full list):
  * Only enabled platforms' links are processed; everything else gets no reply.
  * Commands in groups work only when addressed to this bot (/start@ThisBot).
  * Language choice is per user; in groups the shared message is never edited.
  * Updates and (message, link) pairs are processed once within the duplicate window.
  * Replies reference the message that contained the link. User messages are never deleted.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from mediabot.bot.commands import parse_command
from mediabot.bot.gateway import Keyboard, TelegramGateway
from mediabot.bot.keyboards import language_keyboard, parse_language_callback
from mediabot.bot.messages import error_text
from mediabot.bot.types import IncomingCallback, IncomingMessage
from mediabot.errors import ErrorCode
from mediabot.i18n import Translator
from mediabot.jobs.guards import SlidingWindowLimiter, TTLCache
from mediabot.jobs.manager import JobManager
from mediabot.jobs.models import JobRequest, SubmitResult
from mediabot.platforms.service import PlatformService
from mediabot.security.secrets_box import SecretBox
from mediabot.services.preferences import PreferenceStore
from mediabot.services.settings import RuntimeSettings
from mediabot.urls.detect import extract_candidates, parse_candidate

logger = logging.getLogger("mediabot.bot")
PRIVATE = "private"
GROUP_TYPES = frozenset({"group", "supergroup"})

@dataclass
class BotDependencies:
    translator: Translator
    settings: Callable[[], RuntimeSettings]
    platforms: PlatformService
    preferences: PreferenceStore
    jobs: JobManager
    keyer: SecretBox
    gateway: TelegramGateway
    username: Callable[[], str | None]
    dedupe: TTLCache
    limiter: SlidingWindowLimiter


class BotService:
    def __init__(self, deps: BotDependencies) -> None:
        self._d = deps

    # ----- helpers ---------------------------------------------------------------
    def _t(self, lang: str, key: str, **params: Any) -> str:
        return self._d.translator.t(lang, key, **params)

    def language_for(self, user_id: int | None) -> str:
        settings = self._d.settings()
        stored = self._d.preferences.get(user_id)
        if stored and stored in settings.available_languages and self._d.translator.is_supported(stored):
            return stored
        return settings.default_language

    def error_text(self, lang: str, code: ErrorCode) -> str:
        return error_text(self._d.translator, self._d.settings(), lang, code)

    def _welcome_text(self, lang: str, message_is_group: bool) -> str:
        return self._t(lang, "welcome_group" if message_is_group else "welcome")

    def _language_keyboard(self, current: str) -> Keyboard:
        return language_keyboard(self._d.translator, self._d.settings().available_languages, current)

    def _platform_list(self, lang: str) -> str:
        names = [r.name for r in self._d.platforms.enabled()]
        if not names:
            return self._t(lang, "platforms_none")
        return "\n".join(f"• {n}" for n in names)

    def _help_text(self, lang: str) -> str:
        settings = self._d.settings()
        if settings.max_duration_minutes:
            duration = self._t(lang, "duration_minutes", minutes=settings.max_duration_minutes)
        else:
            duration = self._t(lang, "duration_unlimited")
        return self._t(
            lang, "help",
            platforms=self._platform_list(lang),
            max_size=settings.max_file_size_mb,
            max_duration=duration,
            max_links=settings.max_urls_per_message,
        )

    def _addressed_to_us(self, addressed_to: str | None, chat_type: str) -> bool:
        if chat_type == PRIVATE:
            return addressed_to is None or addressed_to == (self._d.username() or "").lower()
        ours = (self._d.username() or "").lower()
        return bool(ours) and addressed_to == ours

    # ----- entry points ---------------------------------------------------------------
    async def handle_message(self, msg: IncomingMessage) -> None:
        if msg.user_id is None or msg.is_bot:
            return  # channel posts, service messages and other bots are ignored
        if self._d.dedupe.seen_or_add(f"upd:{msg.update_id}", self._settings_window()):
            return
        command = parse_command(msg.text) if msg.text.startswith("/") else None
        if command is not None:
            if not self._addressed_to_us(command.addressed_to, msg.chat_type):
                return
            await self._handle_command(msg, command.name)
            return
        if msg.chat_type != PRIVATE and msg.chat_type not in GROUP_TYPES:
            return
        await self._handle_links(msg)

    async def handle_callback(self, cb: IncomingCallback) -> None:
        if cb.user_id is None:
            await self._d.gateway.answer_callback(cb.callback_id)
            return
        if self._d.dedupe.seen_or_add(f"upd:{cb.update_id}", self._settings_window()):
            await self._d.gateway.answer_callback(cb.callback_id)
            return
        code = parse_language_callback(cb.data)
        settings = self._d.settings()
        if code is None:
            await self._d.gateway.answer_callback(cb.callback_id)
            return
        if code not in settings.available_languages or not self._d.translator.is_supported(code):
            await self._d.gateway.answer_callback(
                cb.callback_id, self._t(self.language_for(cb.user_id), "language_unavailable"))
            return
        # Only this user's preference changes - never a shared setting.
        self._d.preferences.set(cb.user_id, code)
        await self._d.gateway.answer_callback(cb.callback_id, self._t(code, "language_set"))
        if cb.chat_type == PRIVATE and cb.chat_id is not None and cb.message_id is not None:
            # Private chats are one-to-one, so the message can be updated in place.
            await self._d.gateway.edit_text(
                cb.chat_id, cb.message_id, self._welcome_text(code, False), self._language_keyboard(code))
        # Group messages are shared: they are intentionally left untouched.

    def _settings_window(self) -> float:
        return float(self._d.settings().duplicate_window_seconds)

    # ----- commands ---------------------------------------------------------------------
    async def _handle_command(self, msg: IncomingMessage, name: str) -> None:
        lang = self.language_for(msg.user_id)
        is_group = msg.chat_type in GROUP_TYPES
        reply_to = msg.message_id if is_group else None
        if name == "start":
            text = self._welcome_text(lang, is_group)
            await self._d.gateway.send_text(msg.chat_id, text, reply_to=reply_to,
                                            keyboard=self._language_keyboard(lang))
        elif name == "help":
            await self._d.gateway.send_text(msg.chat_id, self._help_text(lang), reply_to=reply_to)
        elif name == "language":
            await self._d.gateway.send_text(msg.chat_id, self._t(lang, "language_menu"), reply_to=reply_to,
                                            keyboard=self._language_keyboard(lang))

    # ----- links ----------------------------------------------------------------------------
    def _find_matches(self, msg: IncomingMessage) -> list[Any]:
        matches: list[Any] = []
        seen: set[str] = set()
        for raw in extract_candidates(msg.text, msg.entities):
            split = parse_candidate(raw)
            if split is None:
                continue
            match = self._d.platforms.match(split)  # enabled platforms only
            if match is None or match.url_key in seen:
                continue
            seen.add(match.url_key)
            matches.append(match)
        return matches

    async def _handle_links(self, msg: IncomingMessage) -> None:
        matches = self._find_matches(msg)
        if not matches:
            return  # unrelated text, unsupported or disabled platforms: stay silent
        settings = self._d.settings()
        lang = self.language_for(msg.user_id)
        if settings.maintenance_mode:
            await self._d.gateway.send_text(msg.chat_id, self._t(lang, "maintenance"), reply_to=msg.message_id)
            return

        accepted = matches[: settings.max_urls_per_message]
        extra = len(matches) - len(accepted)
        user_key = self._d.keyer.user_key(msg.user_id or 0)
        chat_key = self._d.keyer.chat_key(msg.chat_id)
        notice_key = f"rl:{user_key}"

        for index, match in enumerate(accepted):
            dedupe_key = f"{msg.chat_id}:{msg.message_id}:{match.url_key}"
            if self._d.dedupe.seen_or_add(f"link:{dedupe_key}", self._settings_window()):
                continue
            allowed = self._d.limiter.try_acquire(
                [(f"u:{user_key}", settings.rate_limit_user_per_minute),
                 (f"c:{chat_key}", settings.rate_limit_chat_per_minute)])
            if not allowed:
                if not self._d.dedupe.seen_or_add(notice_key, settings.rate_limit_notice_seconds):
                    await self._d.gateway.send_text(msg.chat_id, self._t(lang, "rate_limited"),
                                                    reply_to=msg.message_id)
                continue

            status_text = self._t(lang, "status_queued")
            if index == 0 and extra > 0:
                status_text += "\n" + self._t(lang, "notice_extra_links", count=settings.max_urls_per_message)
            status_id = await self._d.gateway.send_text(msg.chat_id, status_text, reply_to=msg.message_id)
            job = JobRequest(
                chat_id=msg.chat_id,
                reply_to_message_id=msg.message_id,
                chat_type=msg.chat_type,
                url=match.canonical_url,
                url_key=match.url_key,
                platform=match.record,
                language=lang,
                dedupe_key=dedupe_key,
                status_message_id=status_id,
            )
            result = self._d.jobs.submit(job)
            if result != SubmitResult.ACCEPTED:
                code = ErrorCode.QUEUE_FULL if result == SubmitResult.QUEUE_FULL else ErrorCode.SERVICE_UNAVAILABLE
                if status_id is not None:
                    await self._d.gateway.edit_text(msg.chat_id, status_id, self.error_text(lang, code))
                logger.info("job not accepted reason=%s", result, extra={"category": "queue"})
