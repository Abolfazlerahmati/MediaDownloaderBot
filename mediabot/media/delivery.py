"""Decide how each file is delivered to Telegram.

* mp4 video            -> sendVideo (streamable)
* mp3 / m4a audio      -> sendAudio (with title/performer/duration when known)
* everything else      -> sendDocument (byte-for-byte, original filename, no recompression)

Images are always sent as documents so Telegram does not recompress them.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from mediabot.platforms.base import MediaType


class DeliveryKind(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"
    DOCUMENT = "document"


@dataclass(frozen=True)
class OutboundMedia:
    kind: DeliveryKind
    path: Path
    display_name: str
    caption: str | None = None
    thumbnail_path: Path | None = None
    duration: int | None = None
    width: int | None = None
    height: int | None = None
    title: str | None = None
    performer: str | None = None
    supports_streaming: bool = True


def choose_delivery(media_type: MediaType, ext: str) -> DeliveryKind:
    ext = ext.lower()
    if media_type == MediaType.VIDEO and ext == "mp4":
        return DeliveryKind.VIDEO
    if media_type == MediaType.AUDIO and ext in {"mp3", "m4a"}:
        return DeliveryKind.AUDIO
    return DeliveryKind.DOCUMENT
