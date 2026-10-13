"""Library-independent representations of the Telegram updates the bot reacts to."""

from __future__ import annotations

from dataclasses import dataclass

from mediabot.urls.detect import MessageEntity


@dataclass(frozen=True)
class IncomingMessage:
    update_id: int
    chat_id: int
    chat_type: str
    message_id: int
    user_id: int | None
    is_bot: bool
    text: str
    entities: tuple[MessageEntity, ...]


@dataclass(frozen=True)
class IncomingCallback:
    update_id: int
    callback_id: str
    chat_id: int | None
    chat_type: str | None
    message_id: int | None
    user_id: int | None
    data: str
