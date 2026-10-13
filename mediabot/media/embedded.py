"""Read embedded tags and cover art with mutagen (read-only).

Used to (a) fill Telegram's title/performer/duration fields when the source did not
provide them, and (b) obtain the item's OWN embedded cover as the Telegram thumbnail.
Nothing here modifies the file.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("mediabot.media.embedded")
MAX_COVER_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class EmbeddedInfo:
    title: str | None
    artist: str | None
    duration: float | None
    cover: bytes | None


def read_embedded(path: Path) -> EmbeddedInfo:
    try:
        import mutagen
    except ImportError:  # pragma: no cover
        return EmbeddedInfo(None, None, None, None)
    try:
        audio = mutagen.File(path)
    except Exception:
        logger.info("mutagen could not read tags", extra={"category": "metadata"})
        return EmbeddedInfo(None, None, None, None)
    if audio is None:
        return EmbeddedInfo(None, None, None, None)

    title = _first(audio, ("title", "TIT2", "\xa9nam"))
    artist = _first(audio, ("artist", "TPE1", "\xa9ART"))
    duration = float(audio.info.length) if getattr(audio, "info", None) and getattr(audio.info, "length", None) else None
    return EmbeddedInfo(title=title, artist=artist, duration=duration, cover=_cover(audio))


def _first(audio, keys: tuple[str, ...]) -> str | None:
    tags = getattr(audio, "tags", None)
    if not tags:
        return None
    for key in keys:
        try:
            value = tags.get(key)
        except Exception:
            value = None
        if value is None:
            continue
        if isinstance(value, list) and value:
            value = value[0]
        text = str(getattr(value, "text", value) or "").strip()
        if text:
            return text[:256]
    return None


def _cover(audio) -> bytes | None:
    tags = getattr(audio, "tags", None)
    if tags is None:
        return None
    # ID3 (mp3 and friends)
    try:
        pictures = tags.getall("APIC") if hasattr(tags, "getall") else []
    except Exception:
        pictures = []
    for pic in pictures:
        if pic.data and len(pic.data) <= MAX_COVER_BYTES:
            return bytes(pic.data)
    # MP4 / M4A
    covr = tags.get("covr") if hasattr(tags, "get") else None
    if covr:
        data = bytes(covr[0])
        if data and len(data) <= MAX_COVER_BYTES:
            return data
    # FLAC / Ogg pictures
    for pic in getattr(audio, "pictures", []) or []:
        if pic.data and len(pic.data) <= MAX_COVER_BYTES:
            return bytes(pic.data)
    return None

