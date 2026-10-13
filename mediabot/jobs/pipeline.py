"""Download pipeline: the ordered, testable sequence behind every supported link.

    probe -> limit checks -> download -> integrity check -> metadata -> thumbnail
          -> deliver (via Notifier) -> cleanup

Retries apply only to transient failures (temporary/timeouts) with exponential backoff.
Permanent failures end the job at once. A failed job never falls back to another file.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from mediabot.db.repositories import PlatformRecord
from mediabot.errors import ErrorCode, MediaError
from mediabot.jobs.models import JobRequest
from mediabot.jobs.tempfiles import TempStore
from mediabot.media.delivery import DeliveryKind, OutboundMedia, choose_delivery
from mediabot.media.embedded import read_embedded
from mediabot.media.filenames import build_display_name
from mediabot.media.thumbnails import fetch_item_thumbnail, to_telegram_jpeg
from mediabot.media.validate import validate_media_file
from mediabot.observability.redact import short_hash
from mediabot.platforms.base import (
    AdapterContext,
    MediaInfo,
    MediaType,
    PlatformAdapter,
)
from mediabot.services.settings import RuntimeSettings

logger = logging.getLogger("mediabot.worker")
CAPTION_MAX = 900


class Notifier(Protocol):
    async def on_stage(self, job: JobRequest, stage: str) -> None: ...
    async def on_media(self, job: JobRequest, media: OutboundMedia) -> None: ...
    async def on_error(self, job: JobRequest, code: ErrorCode) -> None: ...


AdapterFactory = Callable[[PlatformRecord, AdapterContext], PlatformAdapter]


@dataclass
class PipelineDeps:
    settings: Callable[[], RuntimeSettings]
    temp: TempStore
    ffmpeg_path: Path | None
    adapter_factory: AdapterFactory
    notifier: Notifier
    allow_private_network: bool = False


def _backoff(base: int, attempt: int) -> float:
    return base * (2 ** (attempt - 1)) * (0.8 + random.random() * 0.4)


def _limits(settings: RuntimeSettings, record: PlatformRecord) -> tuple[int, int | None]:
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    if record.max_file_size_mb:
        max_bytes = min(max_bytes, record.max_file_size_mb * 1024 * 1024)
    max_seconds: int | None = None
    if settings.max_duration_minutes:
        max_seconds = settings.max_duration_minutes * 60
    if record.max_duration_seconds:
        max_seconds = min(max_seconds, record.max_duration_seconds) if max_seconds else record.max_duration_seconds
    return max_bytes, max_seconds


class DownloadPipeline:
    def __init__(self, deps: PipelineDeps) -> None:
        self._deps = deps

    @property
    def notifier(self) -> Notifier:
        return self._deps.notifier

    async def run(self, job: JobRequest) -> None:
        """Process one job end to end. Never raises for expected failures."""
        started = time.monotonic()
        settings = self._deps.settings()
        url_id = short_hash(job.url)
        workdir: Path | None = None
        try:
            if self._deps.temp.free_bytes() < settings.min_free_disk_mb * 1024 * 1024:
                raise MediaError(ErrorCode.STORAGE_ERROR, "low free disk space")
            media, workdir = await self._with_retries(job, settings)
            await self._deps.notifier.on_media(job, media)
            logger.info(
                "job completed platform=%s url=%s kind=%s size_kb=%d duration_ms=%d",
                job.platform.key, url_id, media.kind.value,
                media.path.stat().st_size // 1024, int((time.monotonic() - started) * 1000),
                extra={"category": "job_completed"},
            )
        except MediaError as exc:
            await self._fail(job, exc.code, exc.detail, url_id, started)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # unexpected: never leak internals to users
            logger.error("unexpected pipeline error platform=%s url=%s error=%s", job.platform.key, url_id,
                         exc.__class__.__name__, extra={"category": "worker_error"}, exc_info=exc)
            await self._fail(job, ErrorCode.DOWNLOAD_FAILED, exc.__class__.__name__, url_id, started, log=False)
        finally:
            # Media is removed only after delivery (or failure) has finished.
            if workdir is not None:
                self._deps.temp.remove(workdir)

    async def _fail(self, job: JobRequest, code: ErrorCode, detail: str, url_id: str, started: float,
                    log: bool = True) -> None:
        if log:
            # Failures caused by the link or the user's limits are expected (INFO); failures on the
            # platform or server side need an operator's attention (WARNING).
            level = logging.INFO if code in EXPECTED_FAILURES else logging.WARNING
            logger.log(
                level,
                "job failed platform=%s url=%s code=%s attempts=%d duration_ms=%d detail=%s",
                job.platform.key, url_id, code.value, job.attempt,
                int((time.monotonic() - started) * 1000), detail[:300],
                extra={"category": _category_for(code)},
            )
        try:
            await self._deps.notifier.on_error(job, code)
        except Exception:
            logger.warning("could not deliver error notice", extra={"category": "upload_failed"})

    async def _with_retries(self, job: JobRequest, settings: RuntimeSettings) -> tuple[OutboundMedia, Path]:
        attempts_allowed = settings.retry_max_attempts + 1
        while True:
            job.attempt += 1
            try:
                return await self._attempt(job, settings)
            except MediaError as exc:
                if not exc.retryable or job.attempt >= attempts_allowed:
                    raise
                delay = _backoff(settings.retry_base_delay_seconds, job.attempt)
                logger.info("retrying platform=%s after %s (attempt %d)", job.platform.key,
                            exc.code.value, job.attempt, extra={"category": "retry"})
                await self._deps.notifier.on_stage(job, "retrying")
                await asyncio.sleep(delay)

    async def _attempt(self, job: JobRequest, settings: RuntimeSettings) -> tuple[OutboundMedia, Path]:
        record = job.platform
        max_bytes, max_seconds = _limits(settings, record)
        ctx = AdapterContext(
            ffmpeg_path=self._deps.ffmpeg_path,
            probe_timeout_seconds=settings.probe_timeout_seconds,
            download_timeout_seconds=settings.download_timeout_seconds,
            max_file_bytes=max_bytes,
            memory_limit_mb=settings.subprocess_memory_limit_mb,
            allow_private_network=self._deps.allow_private_network,
            embed_metadata=settings.metadata_embed_tags,
            embed_audio_artwork=settings.metadata_embed_audio_artwork,
            preferred_video_container=settings.preferred_video_container,
            preferred_audio_container=settings.preferred_audio_container,
        )
        adapter = self._deps.adapter_factory(record, ctx)
        workdir = self._deps.temp.new_job_dir()
        try:
            await self._deps.notifier.on_stage(job, "probing")
            info = await adapter.probe(job.url, workdir)
            self._check_limits(info, record, max_bytes, max_seconds)

            await self._deps.notifier.on_stage(job, "downloading")
            downloaded = await adapter.download(job.url, info, workdir)
            await validate_media_file(
                downloaded.path,
                ext=downloaded.ext,
                media_type=info.media_type,
                max_bytes=max_bytes,
                ffmpeg_path=self._deps.ffmpeg_path,
                use_ffmpeg=settings.validate_with_ffmpeg,
            )
            media = await self._prepare_outbound(job, info, downloaded, workdir, settings)
            return media, workdir
        except BaseException:
            self._deps.temp.remove(workdir)
            raise

    def _check_limits(self, info: MediaInfo, record: PlatformRecord, max_bytes: int, max_seconds: int | None) -> None:
        if info.media_type.value not in record.allowed_media_types:
            raise MediaError(ErrorCode.UNSUPPORTED_MEDIA, f"{info.media_type.value} disabled for {record.key}")
        if max_seconds and info.duration and info.duration > max_seconds:
            raise MediaError(ErrorCode.TOO_LONG, f"{int(info.duration)}s > {max_seconds}s")
        if info.filesize and info.filesize > max_bytes:
            raise MediaError(ErrorCode.TOO_LARGE, f"estimated {info.filesize} bytes")

    async def _prepare_outbound(self, job, info: MediaInfo, downloaded, workdir: Path,
                                settings: RuntimeSettings) -> OutboundMedia:
        record = job.platform
        kind = choose_delivery(info.media_type, downloaded.ext)
        display = build_display_name(
            info.title,
            downloaded.ext,
            fallback_stem=f"{record.key}-{info.source_id or 'item'}",
        )
        caption = None
        if info.title:
            caption = " ".join(info.title.split())[:CAPTION_MAX] or None

        title = info.track or info.title
        performer = info.artist
        duration = int(info.duration) if info.duration else None
        thumbnail: Path | None = None
        wants_thumb = settings.thumbnails_enabled and record.thumbnails_enabled
        if info.media_type == MediaType.AUDIO:
            embedded = read_embedded(downloaded.path)
            title = title or embedded.title
            performer = performer or embedded.artist
            duration = duration or (int(embedded.duration) if embedded.duration else None)
            if wants_thumb and embedded.cover:
                jpeg = to_telegram_jpeg(embedded.cover)
                thumbnail = _write_thumb(workdir, jpeg)
        elif info.media_type == MediaType.VIDEO and wants_thumb and info.thumbnail_url:
            jpeg = await fetch_item_thumbnail(
                info.thumbnail_url, timeout_seconds=20, allow_private=self._deps.allow_private_network
            )
            thumbnail = _write_thumb(workdir, jpeg)

        return OutboundMedia(
            kind=kind,
            path=downloaded.path,
            display_name=display,
            caption=caption,
            thumbnail_path=thumbnail,
            duration=duration if kind != DeliveryKind.DOCUMENT else None,
            width=info.width if kind == DeliveryKind.VIDEO else None,
            height=info.height if kind == DeliveryKind.VIDEO else None,
            title=title if kind == DeliveryKind.AUDIO else None,
            performer=performer if kind == DeliveryKind.AUDIO else None,
            supports_streaming=settings.preferred_video_container == "mp4",
        )


def _write_thumb(workdir: Path, jpeg: bytes | None) -> Path | None:
    if not jpeg:
        return None
    path = workdir / "thumb.jpg"
    path.write_bytes(jpeg)
    return path


EXPECTED_FAILURES = frozenset({
    ErrorCode.UNSUPPORTED_LINK, ErrorCode.INACCESSIBLE, ErrorCode.TOO_LARGE, ErrorCode.TOO_LONG,
    ErrorCode.UNSUPPORTED_MEDIA, ErrorCode.MULTIPLE_ITEMS, ErrorCode.LIVE_UNSUPPORTED,
    ErrorCode.CANCELLED, ErrorCode.RATE_LIMITED, ErrorCode.QUEUE_FULL, ErrorCode.MAINTENANCE,
})


def _category_for(code: ErrorCode) -> str:
    return {
        ErrorCode.TIMEOUT: "download_timeout",
        ErrorCode.TEMPORARY: "platform_temporary",
        ErrorCode.INACCESSIBLE: "platform_inaccessible",
        ErrorCode.UPSTREAM_CHANGED: "extractor_changed",
        ErrorCode.DEPENDENCY_MISSING: "dependency_missing",
        ErrorCode.STORAGE_ERROR: "storage_error",
        ErrorCode.VALIDATION_FAILED: "validation_failed",
        ErrorCode.UPLOAD_FAILED: "upload_failed",
        ErrorCode.TOO_LARGE: "limit_exceeded",
        ErrorCode.TOO_LONG: "limit_exceeded",
    }.get(code, "download_failed")
