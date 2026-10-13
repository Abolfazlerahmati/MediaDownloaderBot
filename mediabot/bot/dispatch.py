"""Adapts raw Telegram updates to BotService calls."""

from __future__ import annotations

from telegram import Update

from mediabot.bot.controller import to_incoming_callback, to_incoming_message
from mediabot.bot.service import BotService


def make_update_handler(service: BotService):  # type: ignore[no-untyped-def]
    async def handle(update: Update) -> None:
        if update.callback_query is not None:
            callback = to_incoming_callback(update)
            if callback is not None:
                await service.handle_callback(callback)
            return
        message = to_incoming_message(update)
        if message is not None:
            await service.handle_message(message)

    return handle
