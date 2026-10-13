"""Application runtime: wires configuration, storage, adapters, the bot, workers, the
health monitor and the admin panel into one asyncio process.

Process layout (single process, shared memory):
  * uvicorn serves the FastAPI admin panel,
  * python-telegram-bot polls Telegram (no webhook),
  * download workers consume the in-memory job queue,
  * background tasks handle health checks, retention and cleanup.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import time
from pathlib import Path
from typing import Any

from mediabot import __version__
from mediabot.bot.controller import BotController
from mediabot.bot.dispatch import make_update_handler
from mediabot.bot.gateway import PTBGateway
from mediabot.bot.notifier import JobNotifier
from mediabot.bot.service import BotDependencies, BotService
from mediabot.config import AppConfig
from mediabot.db.database import Database
from mediabot.db.repositories import (
    AdminRepo,
    LogRepo,
    PlatformRepo,
    PreferenceRepo,
    SessionRepo,
    SettingsRepo,
)
from mediabot.health.service import HealthService
from mediabot.i18n import get_translator
from mediabot.jobs.guards import SlidingWindowLimiter, TTLCache
from mediabot.jobs.manager import JobManager
from mediabot.jobs.pipeline import DownloadPipeline, PipelineDeps
from mediabot.jobs.tempfiles import TempStore
from mediabot.media.ffmpeg import locate_ffmpeg
from mediabot.observability.logging_setup import attach_operational_log, set_levels
from mediabot.observability.logs_service import OperationalLogs
from mediabot.platforms.base import PlatformAdapter
from mediabot.platforms.registry import adapter_class
from mediabot.platforms.service import PlatformService, seed_default_platforms
from mediabot.security.secrets_box import SecretBox
from mediabot.services.preferences import PreferenceStore
from mediabot.services.settings import SettingsService
from mediabot.services.token_store import BotTokenStore

logger = logging.getLogger("mediabot.app")
EXIT_OK = 0
EXIT_RESTART = 75  # EX_TEMPFAIL: supervisors restart the process on this code
MAINTENANCE_INTERVAL = 300


def _make_adapter(record, context) -> PlatformAdapter:  # type: ignore[no-untyped-def]
    cls = adapter_class(record.adapter)
    if cls is None:  # pragma: no cover - validated at configuration time
        raise RuntimeError("unknown adapter")
    return cls(record, context)


class CpuSampler:
    def __init__(self) -> None:
        self.cpu_percent: float | None = None
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        try:
            import psutil

            psutil.cpu_percent(interval=None)
        except Exception:
            return
        self._task = asyncio.create_task(self._loop(), name="cpu-sampler")

    async def _loop(self) -> None:
        import psutil

        while True:
            self.cpu_percent = psutil.cpu_percent(interval=None)
            await asyncio.sleep(5)

    def stop(self) -> None:
        if self._task:
            self._task.cancel()


class Runtime:
    def __init__(self, config: AppConfig) -> None:
        config.require_valid()
        self.config = config
        self.version = __version__
        self.started_at = time.time()
        self.db = Database(config.resolved_database_path)
        self.migrations_applied = self.db.migrate()
        self.translator = get_translator()
        self.secret_box = SecretBox(config.app_secret_key or "")

        self.settings_repo = SettingsRepo(self.db)
        self.settings = SettingsService(self.settings_repo, self.translator)
        self.tokens = BotTokenStore(self.settings_repo, config.bot_token, self.secret_box)
        self.platform_repo = PlatformRepo(self.db)
        self.platforms = PlatformService(self.platform_repo)
        seeded = seed_default_platforms(self.platform_repo)
        if seeded:
            logger.info("seeded default platforms (disabled, untested): %s", ", ".join(seeded),
                        extra={"category": "startup"})
        self.admins = AdminRepo(self.db)
        self.sessions = SessionRepo(self.db)
        self.log_repo = LogRepo(self.db)
        self.op_logs = OperationalLogs(self.log_repo)
        self.prefs = PreferenceStore(config.persistence_mode, self.secret_box, PreferenceRepo(self.db))

        current = self.settings.current()
        temp_root = Path(current.temp_directory) if current.temp_directory else config.resolved_temp_dir
        self.temp = TempStore(temp_root)
        self.ffmpeg_path = locate_ffmpeg(config.ffmpeg_path)

        self.dedupe = TTLCache()
        self.limiter = SlidingWindowLimiter()
        self.controller = BotController(
            token_provider=self.tokens.get_token,
            handler=self._dispatch_update,
            drop_pending_updates=lambda: self.settings.current().drop_pending_updates_on_start,
            webhook_url=(config.webhook_base_url.rstrip("/") + "/telegram/webhook")
            if config.bot_mode == "webhook" and config.webhook_base_url else None,
            webhook_secret=self.secret_box.keyed_hash("telegram-webhook-secret", "v1"),
        )
        self.gateway = PTBGateway(lambda: self.controller.bot)
        notifier = JobNotifier(self.gateway, self.translator, self.settings.current)
        pipeline = DownloadPipeline(PipelineDeps(
            settings=self.settings.current,
            temp=self.temp,
            ffmpeg_path=self.ffmpeg_path,
            adapter_factory=_make_adapter,
            notifier=notifier,
        ))
        self.jobs = JobManager(pipeline, lambda: self.settings.current().max_queue_length)
        self.bot_service = BotService(BotDependencies(
            translator=self.translator,
            settings=self.settings.current,
            platforms=self.platforms,
            preferences=self.prefs,
            jobs=self.jobs,
            keyer=self.secret_box,
            gateway=self.gateway,
            username=lambda: self.controller.username,
            dedupe=self.dedupe,
            limiter=self.limiter,
        ))
        self._update_handler = make_update_handler(self.bot_service)
        self.health = HealthService(self)
        self.cpu = CpuSampler()
        self.restart_requested = False
        self._stop: asyncio.Event | None = None
        self._log_handler = attach_operational_log(self.op_logs.write, current.log_level)
        set_levels(current.log_level)

    # ----- wiring helpers ---------------------------------------------------------
    async def _dispatch_update(self, update: Any) -> None:
        await self._update_handler(update)

    def secrets(self) -> list[str]:
        values = [self.config.app_secret_key or ""]
        token = self.tokens.get_token()
        if token:
            values.append(token)
        return values

    def close(self) -> None:
        """Release handlers and the database connection (idempotent)."""
        root = logging.getLogger()
        if self._log_handler in root.handlers:
            root.removeHandler(self._log_handler)
        self.db.close()

    def request_stop(self, restart: bool = False) -> None:
        self.restart_requested = self.restart_requested or restart
        if self._stop is not None:
            self._stop.set()

    def uptime_seconds(self) -> int:
        return int(time.time() - self.started_at)

    # ----- background maintenance ------------------------------------------------
    async def _maintenance(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                current = self.settings.current()
                self.temp.sweep(max(
                    current.temp_retention_minutes * 60,
                    current.download_timeout_seconds + current.probe_timeout_seconds + 300,
                ))
                self.op_logs.enforce_retention(current.log_retention_days, current.log_max_rows)
                if self.config.persistence_mode == "minimal":
                    self.prefs.purge_expired(current.preference_retention_days, time.time())
                self.sessions.purge_expired()
                self.dedupe.purge_expired()
                self.limiter.purge_idle()
                set_levels(current.log_level)
            except Exception:
                logger.error("maintenance task failed", extra={"category": "maintenance_failed"}, exc_info=True)
            try:
                await asyncio.wait_for(stop.wait(), timeout=MAINTENANCE_INTERVAL)
            except TimeoutError:
                pass


async def serve(rt: Runtime) -> int:
    """Run until a stop signal or a panel-requested stop. Returns the process exit code."""
    stop = asyncio.Event()
    rt._stop = stop
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):  # pragma: no cover - non-main thread / Windows
            pass

    rt.temp.ensure()
    rt.temp.sweep(rt.settings.current().temp_retention_minutes * 60)
    logger.info("mediabot %s starting (schema %s, persistence=%s)", __version__,
                rt.db.schema_version(), rt.config.persistence_mode, extra={"category": "startup"})
    if rt.migrations_applied:
        logger.info("applied migrations: %s", ", ".join(rt.migrations_applied), extra={"category": "migration"})

    rt.cpu.start()
    await rt.jobs.start(rt.settings.current().max_concurrent_downloads)
    if rt.config.enable_bot:
        await rt.controller.start()
    else:
        logger.info("bot disabled by ENABLE_BOT=false", extra={"category": "startup"})

    background = [
        asyncio.create_task(rt._maintenance(stop), name="maintenance"),
        asyncio.create_task(rt.health.loop(stop), name="health"),
    ]
    server_task: asyncio.Task | None = None
    server = None
    if rt.config.enable_web:
        import uvicorn

        from mediabot.web.app import create_web_app

        uv_config = uvicorn.Config(
            create_web_app(rt),
            host=rt.config.admin_host,
            port=rt.config.admin_port,
            log_level="warning",
            access_log=False,
            proxy_headers=False,
            server_header=False,
            date_header=False,
        )
        server = uvicorn.Server(uv_config)
        server_task = asyncio.create_task(server.serve(), name="admin-panel")
        logger.info("admin panel listening on %s:%s", rt.config.admin_host, rt.config.admin_port,
                    extra={"category": "startup"})

    try:
        await stop.wait()
    finally:
        logger.info("shutting down", extra={"category": "shutdown"})
        await rt.controller.stop()
        await rt.jobs.stop(grace_seconds=20)
        if server is not None:
            server.should_exit = True
        if server_task is not None:
            try:
                await asyncio.wait_for(server_task, timeout=10)
            except (TimeoutError, Exception):  # noqa: BLE001
                server_task.cancel()
        for task in background:
            task.cancel()
        await asyncio.gather(*background, return_exceptions=True)
        rt.cpu.stop()
        rt.close()
    return EXIT_RESTART if rt.restart_requested else EXIT_OK


def run(config: AppConfig | None = None) -> int:
    from mediabot.config import load_config
    from mediabot.observability.logging_setup import configure_logging

    cfg = config or load_config()
    problems = cfg.validation_problems()
    if problems:
        print("MediaDownloaderBot cannot start because configuration is incomplete:\n")
        for problem in problems:
            print(f"  - {problem}")
        print("\nSee .env.example and docs/DEPLOYMENT.md.")
        return 2
    configure_logging("INFO")
    rt = Runtime(cfg)
    configure_logging(rt.settings.current().log_level, rt.secrets)
    attach_secrets_filter(rt)
    try:
        return asyncio.run(serve(rt))
    except KeyboardInterrupt:  # pragma: no cover
        return EXIT_OK


def attach_secrets_filter(rt: Runtime) -> None:
    """Ensure the console formatter redacts the current secrets (tokens may change at runtime)."""
    from mediabot.observability.logging_setup import RedactingFilter

    for handler in logging.getLogger().handlers:
        if not any(isinstance(f, RedactingFilter) for f in handler.filters):
            handler.addFilter(RedactingFilter(rt.secrets))
