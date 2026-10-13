"""Turns pipeline events into Telegram messages.

One status message per link is edited through the phases (queued -> downloading) and is
deleted when the result is sent, so a successful job leaves exactly one reply (the media)
and a failed job leaves one reply (the error). Chat actions show upload progress without
extra messages.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from mediabot.bot.gateway import TelegramGateway
from mediabot.bot.messages import error_text
from mediabot.errors import ErrorCode
from mediabot.i18n import Translator
from mediabot.jobs.models import JobRequest
from mediabot.media.delivery import DeliveryKind, OutboundMedia
from mediabot.services.settings import RuntimeSettings

logger = logging.getLogger("mediabot.bot.notifier")

_UPLOAD_ACTION = {
    DeliveryKind.VIDEO: "upload_video",
    DeliveryKind.AUDIO: "upload_voice",
    DeliveryKind.DOCUMENT: "upload_document",
}
_STAGE_TEXT = {"probing": "status_downloading", "downloading": "status_downloading", "retrying": "status_downloading"}


class JobNotifier:
    def __init__(self, gateway: TelegramGateway, translator: Translator,
                 settings: Callable[[], RuntimeSettings]) -> None:
        self._gateway = gateway
        self._translator = translator
        self._settings = settings
        self._last_stage_text: dict[str, str] = {}

    async def on_stage(self, job: JobRequest, stage: str) -> None:
        job.stage = stage
        key = _STAGE_TEXT.get(stage)
        if key is None or job.status_message_id is None:
            return
        text = self._translator.t(job.language, key)
        if self._last_stage_text.get(job.job_id) == text:
            return  # never send the same progress text twice
        self._last_stage_text[job.job_id] = text
        await self._gateway.chat_action(job.chat_id, "typing")
        await self._gateway.edit_text(job.chat_id, job.status_message_id, text)

    async def on_media(self, job: JobRequest, media: OutboundMedia) -> None:
        self._last_stage_text.pop(job.job_id, None)
        await self._gateway.chat_action(job.chat_id, _UPLOAD_ACTION[media.kind])
        await self._gateway.send_media(job.chat_id, job.reply_to_message_id, media)
        if job.status_message_id is not None:
            await self._gateway.delete_message(job.chat_id, job.status_message_id)

    async def on_error(self, job: JobRequest, code: ErrorCode) -> None:
        self._last_stage_text.pop(job.job_id, None)
        text = error_text(self._translator, self._settings(), job.language, code)
        if job.status_message_id is not None and await self._gateway.edit_text(
                job.chat_id, job.status_message_id, text):
            return
        await self._gateway.send_text(job.chat_id, text, reply_to=job.reply_to_message_id)

