"""Real health checks. Each check performs its test; none reports success by default.

Status vocabulary: healthy, warning, failed, not_configured, unknown.
"""

from __future__ import annotations

import asyncio
import importlib
import time
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any

from mediabot.platforms.base import HealthState

if TYPE_CHECKING:  # pragma: no cover
    from mediabot.app import Runtime


@dataclass
class CheckResult:
    check_id: str
    title: str
    group: str
    status: str
    message: str
    checked_at: float
    duration_ms: int
    last_success_at: float | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


CheckFn = Callable[["Runtime"], Awaitable[tuple[HealthState, str, dict[str, Any]]]]


async def check_config(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    problems = rt.config.validation_problems()
    if problems:
        return HealthState.FAILED, " ".join(problems), {}
    return HealthState.HEALTHY, "Required deployment settings are present and valid.", {
        "persistence_mode": rt.config.persistence_mode,
        "data_dir_writable": _writable(rt.config.resolved_data_dir),
    }


def _writable(path) -> bool:  # type: ignore[no-untyped-def]
    import os

    return os.access(path, os.W_OK) if path.exists() else False


async def check_database(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    version = await asyncio.to_thread(rt.db.ping)
    return HealthState.HEALTHY, f"Database reachable; schema version {version}.", {"schema_version": version}


async def check_temp_storage(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    ok, message = await asyncio.to_thread(rt.temp.self_check)
    free_mb = (await asyncio.to_thread(rt.temp.free_bytes)) // (1024 * 1024)
    details = {"free_mb": free_mb, "path": str(rt.temp.root)}
    if not ok:
        return HealthState.FAILED, message, details
    minimum = rt.settings.current().min_free_disk_mb
    if free_mb < minimum:
        return HealthState.FAILED, f"Only {free_mb} MB free; the minimum is {minimum} MB.", details
    if free_mb < minimum * 2:
        return HealthState.WARNING, f"{message} Free space is getting low ({free_mb} MB).", details
    return HealthState.HEALTHY, f"{message} {free_mb} MB free.", details


async def check_ytdlp(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    from mediabot.platforms.ytdlp import ytdlp_version

    version = ytdlp_version()
    if version is None:
        return HealthState.FAILED, "yt-dlp is not importable. Reinstall the requirements.", {}
    return HealthState.HEALTHY, f"yt-dlp {version} is available.", {"version": version}


async def check_ffmpeg(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    from mediabot.media.ffmpeg import ffmpeg_version

    if rt.ffmpeg_path is None:
        return HealthState.FAILED, "ffmpeg was not found. Install ffmpeg or set FFMPEG_PATH.", {}
    version = await ffmpeg_version(rt.ffmpeg_path)
    if version is None:
        return HealthState.FAILED, "ffmpeg exists but did not run correctly.", {"path": rt.ffmpeg_path.name}
    return HealthState.HEALTHY, f"ffmpeg is working ({version}).", {"path": rt.ffmpeg_path.name}


async def check_python_deps(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    missing = []
    versions: dict[str, str] = {}
    for module, label in (("PIL", "Pillow"), ("mutagen", "mutagen"), ("cryptography", "cryptography"),
                          ("argon2", "argon2-cffi"), ("telegram", "python-telegram-bot")):
        try:
            mod = importlib.import_module(module)
            versions[label] = str(getattr(mod, "__version__", "ok"))
        except ImportError:
            missing.append(label)
    if missing:
        return HealthState.FAILED, f"Missing Python packages: {', '.join(missing)}.", {"versions": versions}
    return HealthState.HEALTHY, "All Python dependencies import correctly.", {"versions": versions}


async def check_telegram_api(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    if not rt.tokens.get_token():
        return HealthState.NOT_CONFIGURED, "No bot token configured.", {}
    ok, message = await rt.controller.test_api()
    return (HealthState.HEALTHY if ok else HealthState.FAILED), message, {}


async def check_bot_process(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    from mediabot.bot.controller import BotStatus

    info = rt.controller.info()
    if info.status == BotStatus.RUNNING:
        return HealthState.HEALTHY, f"Polling as @{info.username}.", {"username": info.username}
    if not rt.config.enable_bot:
        return HealthState.NOT_CONFIGURED, "Bot is disabled in this process (ENABLE_BOT=false).", {}
    if info.status == BotStatus.NOT_CONFIGURED:
        return HealthState.NOT_CONFIGURED, info.last_error or "Not configured.", {}
    if info.status == BotStatus.ERROR:
        return HealthState.FAILED, info.last_error or "Bot is in an error state.", {}
    if info.status in {BotStatus.STARTING, BotStatus.STOPPING}:
        return HealthState.UNKNOWN, "Bot is changing state.", {}
    return HealthState.WARNING, "Bot polling is stopped.", {}


async def check_workers(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    snap = rt.jobs.snapshot()
    details = {"alive": snap["workers_alive"], "configured": snap["workers_configured"]}
    if not snap["running"]:
        return HealthState.WARNING, "Download workers are stopped.", details
    if snap["workers_alive"] < snap["workers_configured"]:
        return HealthState.FAILED, "Some download workers have stopped unexpectedly.", details
    return HealthState.HEALTHY, f"{snap['workers_alive']} of {snap['workers_configured']} workers alive.", details


async def check_queue(rt: Runtime) -> tuple[HealthState, str, dict[str, Any]]:
    snap = rt.jobs.snapshot()
    limit = max(1, snap["max_queue_length"])
    details = {"queued": snap["queued"], "limit": limit, "active": snap["active_count"]}
    if snap["queued"] >= limit * 0.8:
        return HealthState.WARNING, f"Queue is nearly full ({snap['queued']} of {limit}).", details
    return HealthState.HEALTHY, f"{snap['queued']} queued, {snap['active_count']} active (limit {limit}).", details


CHEAP_CHECKS: dict[str, tuple[str, str, CheckFn]] = {
    "config": ("Configuration validation", "Configuration", check_config),
    "database": ("Database connectivity", "Storage", check_database),
    "temp_storage": ("Temporary directory write/read test", "Storage", check_temp_storage),
    "dep_ytdlp": ("yt-dlp available", "Dependencies", check_ytdlp),
    "dep_ffmpeg": ("ffmpeg working", "Dependencies", check_ffmpeg),
    "dep_python": ("Python packages", "Dependencies", check_python_deps),
    "telegram_api": ("Telegram API connection test", "Telegram", check_telegram_api),
    "bot_process": ("Bot process status", "Telegram", check_bot_process),
    "workers": ("Download workers", "Pipeline", check_workers),
    "queue": ("Queue health", "Pipeline", check_queue),
}


def group_of(check_id: str) -> str:
    return CHEAP_CHECKS[check_id][1] if check_id in CHEAP_CHECKS else "Platforms"


async def run_check(rt: Runtime, check_id: str) -> CheckResult:
    title, group, fn = CHEAP_CHECKS[check_id]
    started = time.monotonic()
    now = time.time()
    try:
        state, message, details = await asyncio.wait_for(fn(rt), timeout=45)
    except TimeoutError:
        state, message, details = HealthState.FAILED, "The check did not finish within 45 seconds.", {}
    except Exception as exc:  # noqa: BLE001 - a failing check must not break the page
        state, message, details = HealthState.FAILED, f"Check error ({exc.__class__.__name__}).", {}
    return CheckResult(
        check_id=check_id,
        title=title,
        group=group,
        status=state.value,
        message=message,
        checked_at=now,
        duration_ms=int((time.monotonic() - started) * 1000),
        last_success_at=now if state == HealthState.HEALTHY else None,
        details=details,
    )
