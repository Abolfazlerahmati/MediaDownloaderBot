"""Runs health checks on demand and periodically, and keeps the latest results in memory.

Live platform tests perform a real metadata extraction against the platform's configured
test URL. A platform whose live test FAILS while enabled is disabled automatically so the
bot does not keep accepting links it cannot serve.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from mediabot.health.checks import CHEAP_CHECKS, CheckResult, run_check
from mediabot.platforms.base import AdapterContext, AdapterHealth, HealthState
from mediabot.platforms.registry import adapter_class

if TYPE_CHECKING:  # pragma: no cover
    from mediabot.app import Runtime

logger = logging.getLogger("mediabot.health")


class HealthService:
    def __init__(self, rt: Runtime) -> None:
        self._rt = rt
        self._results: dict[str, CheckResult] = {}
        self._last_success: dict[str, float] = {}
        self._platform_running: set[str] = set()

    # ----- cheap checks ----------------------------------------------------------
    async def run_all(self) -> list[dict[str, Any]]:
        for check_id in CHEAP_CHECKS:
            await self.run_one(check_id)
        for record in self._rt.platforms.records():
            self._record_platform_state(record)
        return self.snapshot()

    async def run_one(self, check_id: str) -> CheckResult:
        result = await run_check(self._rt, check_id)
        if result.status == HealthState.HEALTHY.value:
            self._last_success[check_id] = result.checked_at
        result.last_success_at = self._last_success.get(check_id)
        self._results[check_id] = result
        if result.status == HealthState.FAILED.value:
            logger.warning("health check %s failed: %s", check_id, result.message,
                           extra={"category": _category_for_check(check_id)})
        return result

    # ----- platform state -------------------------------------------------------------
    def _record_platform_state(self, record) -> None:  # type: ignore[no-untyped-def]
        check_id = f"platform:{record.key}"
        if record.last_test_status == "healthy":
            state = HealthState.HEALTHY if record.enabled else HealthState.NOT_CONFIGURED
            message = "Live test passed." if record.enabled else "Live test passed. Platform is disabled."
        elif record.last_test_status == "failed":
            state = HealthState.FAILED
            message = record.last_test_message or "Live test failed."
        elif record.last_test_status == "warning":
            state = HealthState.WARNING
            message = record.last_test_message or "Live test returned a warning."
        else:
            state = HealthState.UNKNOWN
            message = "Not tested yet. Run the live test before enabling this platform."
        if record.enabled and record.last_test_status != "healthy":
            message = f"Enabled but not verified: {message}"
        now = time.time()
        self._results[check_id] = CheckResult(
            check_id=check_id,
            title=f"Platform: {record.name}",
            group="Platforms",
            status=state.value,
            message=message,
            checked_at=record.last_test_at or now,
            duration_ms=0,
            last_success_at=record.last_test_at if record.last_test_status == "healthy" else None,
            details={"enabled": record.enabled, "adapter": record.adapter, "key": record.key},
        )

    async def test_platform(self, key: str) -> dict[str, Any]:
        """Run the adapter's live self-test and persist the outcome."""
        if key in self._platform_running:
            raise RuntimeError("A test for this platform is already running.")
        record = self._rt.platform_repo.get(key)
        if record is None:
            raise KeyError(key)
        cls = adapter_class(record.adapter)
        self._platform_running.add(key)
        workdir = None
        try:
            if cls is None:
                health = AdapterHealth(HealthState.FAILED, "Unknown adapter type.")
            else:
                settings = self._rt.settings.current()
                ctx = AdapterContext(
                    ffmpeg_path=self._rt.ffmpeg_path,
                    probe_timeout_seconds=settings.probe_timeout_seconds,
                    download_timeout_seconds=settings.download_timeout_seconds,
                    max_file_bytes=settings.max_file_size_mb * 1024 * 1024,
                    memory_limit_mb=settings.subprocess_memory_limit_mb,
                    allow_private_network=False,
                    embed_metadata=settings.metadata_embed_tags,
                    embed_audio_artwork=settings.metadata_embed_audio_artwork,
                    preferred_video_container=settings.preferred_video_container,
                    preferred_audio_container=settings.preferred_audio_container,
                )
                adapter = cls(record, ctx)
                workdir = self._rt.temp.new_job_dir()
                try:
                    health = await asyncio.wait_for(adapter.self_test(workdir), timeout=settings.probe_timeout_seconds + 30)
                except TimeoutError:
                    health = AdapterHealth(HealthState.WARNING, "The live test timed out. Try again later.")
                except Exception as exc:  # noqa: BLE001
                    logger.error("platform test error: %s", exc.__class__.__name__, extra={"category": "platform_test"})
                    health = AdapterHealth(HealthState.FAILED, f"Live test error ({exc.__class__.__name__}).")
        finally:
            if workdir is not None:
                self._rt.temp.remove(workdir)
            self._platform_running.discard(key)

        self._rt.platform_repo.set_test_result(key, health.state.value, health.message)
        if health.state == HealthState.FAILED and record.enabled:
            self._rt.platform_repo.set_enabled(key, False)
            logger.warning("platform %s disabled after a failed live test", key, extra={"category": "platform_test"})
        refreshed = self._rt.platform_repo.get(key)
        if refreshed is not None:
            self._record_platform_state(refreshed)
        return {"key": key, "status": health.state.value, "message": health.message}

    # ----- periodic loop ---------------------------------------------------------------
    async def loop(self, stop: asyncio.Event) -> None:
        last_platform_run = 0.0
        while not stop.is_set():
            settings = self._rt.settings.current()
            try:
                await self.run_all()
                interval_min = settings.platform_check_interval_minutes
                if interval_min and time.time() - last_platform_run >= interval_min * 60:
                    last_platform_run = time.time()
                    for record in self._rt.platforms.enabled():
                        await self.test_platform(record.key)
            except Exception:
                logger.error("periodic health run failed", extra={"category": "health_loop"}, exc_info=True)
            try:
                await asyncio.wait_for(stop.wait(), timeout=settings.health_check_interval_seconds)
            except TimeoutError:
                pass

    def snapshot(self) -> list[dict[str, Any]]:
        return [r.as_dict() for r in sorted(self._results.values(), key=lambda r: (r.group, r.check_id))]


def _category_for_check(check_id: str) -> str:
    if check_id.startswith("platform:"):
        return "platform_test"
    return {
        "telegram_api": "telegram_api",
        "bot_process": "bot_start_failed",
        "temp_storage": "storage_error",
        "dep_ffmpeg": "dependency_missing",
        "dep_ytdlp": "dependency_missing",
        "database": "migration_failed",
        "workers": "worker_crash",
        "queue": "queue",
    }.get(check_id, "health")

