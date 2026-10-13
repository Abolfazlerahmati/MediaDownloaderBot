"""Thumbnail preparation for Telegram (JPEG, <=320px, <=200 KB).

Two sources only, both belonging to the same media item:
  * the item's own embedded cover (audio),
  * the item's own thumbnail URL reported by the platform (video), fetched with SSRF checks.
If neither exists, no thumbnail is sent. A thumbnail is never taken from another item.
"""

from __future__ import annotations

import io
import logging

from mediabot.security.ssrf import safe_fetch

logger = logging.getLogger("mediabot.media.thumbnails")
TELEGRAM_THUMB_MAX_BYTES = 200 * 1024
TELEGRAM_THUMB_SIDE = 320
SOURCE_MAX_BYTES = 5 * 1024 * 1024
ALLOWED_TYPES = ("image/jpeg", "image/png", "image/webp")


def to_telegram_jpeg(data: bytes) -> bytes | None:
    """Convert image bytes to a Telegram-compatible JPEG thumbnail. Returns None on failure."""
    try:
        from PIL import Image

        Image.MAX_IMAGE_PIXELS = 40_000_000
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            image = image.convert("RGB")
            image.thumbnail((TELEGRAM_THUMB_SIDE, TELEGRAM_THUMB_SIDE))
            for quality in (85, 75, 60, 45):
                buffer = io.BytesIO()
                image.save(buffer, format="JPEG", quality=quality, optimize=True)
                if buffer.tell() <= TELEGRAM_THUMB_MAX_BYTES:
                    return buffer.getvalue()
    except Exception:
        logger.info("thumbnail could not be converted", extra={"category": "thumbnail"})
    return None


async def fetch_item_thumbnail(url: str, *, timeout_seconds: float, allow_private: bool = False) -> bytes | None:
    try:
        body, _ = await safe_fetch(
            url,
            max_bytes=SOURCE_MAX_BYTES,
            timeout_seconds=timeout_seconds,
            allowed_content_types=ALLOWED_TYPES,
            allow_private=allow_private,
        )
    except Exception:
        logger.info("item thumbnail unavailable", extra={"category": "thumbnail"})
        return None
    return to_telegram_jpeg(body)
