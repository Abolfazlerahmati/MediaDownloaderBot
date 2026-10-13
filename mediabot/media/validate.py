"""File integrity checks performed before anything is uploaded to Telegram.

1. The file exists, is non-empty, and is within the size limit.
2. The leading bytes match the container declared by the extension (magic numbers).
3. The file is readable: images are verified with Pillow; audio/video are checked with
   ``ffmpeg -c copy -f null`` which reads every packet without re-encoding.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from mediabot.errors import ErrorCode, MediaError
from mediabot.observability.redact import redact
from mediabot.platforms.base import MediaType

logger = logging.getLogger("mediabot.media.validate")


def _signature_ok(ext: str, head: bytes) -> bool:
    if ext in {"mp4", "m4a", "m4v", "mov", "3gp"}:
        return len(head) >= 12 and head[4:8] == b"ftyp"
    if ext in {"webm", "mkv"}:
        return head[:4] == b"\x1aE\xdf\xa3"
    if ext == "mp3":
        return head[:3] == b"ID3" or (len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)
    if ext in {"ogg", "opus"}:
        return head[:4] == b"OggS"
    if ext == "flac":
        return head[:4] == b"fLaC"
    if ext == "wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if ext == "aac":
        return len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xF6) == 0xF0
    if ext in {"jpg", "jpeg"}:
        return head[:3] == b"\xff\xd8\xff"
    if ext == "png":
        return head[:8] == b"\x89PNG\r\n\x1a\n"
    if ext == "webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext == "gif":
        return head[:4] == b"GIF8"
    return False


KNOWN_EXTENSIONS = frozenset({
    "mp4", "m4a", "m4v", "mov", "3gp", "webm", "mkv", "mp3", "ogg", "opus", "flac", "wav", "aac",
    "jpg", "jpeg", "png", "webp", "gif",
})


@dataclass(frozen=True)
class ValidationResult:
    size: int
    checked_with_ffmpeg: bool


async def _ffmpeg_readable(ffmpeg: Path, path: Path, timeout: float) -> bool:
    process = await asyncio.create_subprocess_exec(
        str(ffmpeg), "-v", "error", "-xerror", "-nostdin", "-i", str(path),
        "-c", "copy", "-f", "null", "-",
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except TimeoutError:
        try:
            process.kill()
        except ProcessLookupError:
            pass
        await process.wait()
        raise MediaError(ErrorCode.TIMEOUT, "integrity check timed out")
    if process.returncode != 0:
        logger.info("ffmpeg integrity check failed: %s", redact(stderr.decode("utf-8", "replace"))[-300:],
                    extra={"category": "validation_failed"})
        return False
    return True


async def validate_media_file(
    path: Path,
    *,
    ext: str,
    media_type: MediaType,
    max_bytes: int,
    ffmpeg_path: Path | None,
    use_ffmpeg: bool,
    timeout_seconds: float = 180,
) -> ValidationResult:
    ext = ext.lower()
    if ext not in KNOWN_EXTENSIONS:
        raise MediaError(ErrorCode.VALIDATION_FAILED, f"unknown extension {ext!r}")
    if not path.is_file():
        raise MediaError(ErrorCode.VALIDATION_FAILED, "file missing")
    size = path.stat().st_size
    if size <= 0:
        raise MediaError(ErrorCode.VALIDATION_FAILED, "empty file")
    if size > max_bytes:
        raise MediaError(ErrorCode.TOO_LARGE, f"{size} bytes")
    with path.open("rb") as handle:
        head = handle.read(64)
    if not _signature_ok(ext, head):
        raise MediaError(ErrorCode.VALIDATION_FAILED, f"signature does not match .{ext}")

    if media_type == MediaType.IMAGE:
        try:
            from PIL import Image

            with Image.open(path) as image:
                image.verify()
        except Exception as exc:
            raise MediaError(ErrorCode.VALIDATION_FAILED, f"image unreadable: {type(exc).__name__}") from exc
        return ValidationResult(size=size, checked_with_ffmpeg=False)

    if use_ffmpeg and ffmpeg_path is not None:
        if not await _ffmpeg_readable(ffmpeg_path, path, timeout_seconds):
            raise MediaError(ErrorCode.VALIDATION_FAILED, "media stream unreadable")
        return ValidationResult(size=size, checked_with_ffmpeg=True)
    return ValidationResult(size=size, checked_with_ffmpeg=False)
