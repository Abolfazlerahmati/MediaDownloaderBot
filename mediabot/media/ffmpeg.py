"""Locate the ffmpeg binary used for remuxing and integrity checks."""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from mediabot.observability.redact import redact


def locate_ffmpeg(configured: str | None = None) -> Path | None:
    if configured:
        path = Path(configured).expanduser()
        return path if path.is_file() else None
    found = shutil.which("ffmpeg")
    if found:
        return Path(found)
    try:  # bundled static binary shipped with the imageio-ffmpeg wheel
        import imageio_ffmpeg

        return Path(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        return None


async def ffmpeg_version(path: Path) -> str | None:
    try:
        process = await asyncio.create_subprocess_exec(
            str(path), "-hide_banner", "-version",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(process.communicate(), timeout=10)
    except (TimeoutError, OSError):
        return None
    first = out.decode("utf-8", errors="replace").splitlines()[:1]
    return redact(first[0]) if first else None
