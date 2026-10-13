"""Logging configuration: console output + privacy-conscious operational log table.

* Every record is passed through ``redact`` before it is printed or stored.
* Third-party libraries that log full request URLs (httpx, Telegram) are capped
  at WARNING so bot tokens do not end up in logs.
* ``category`` may be attached via ``extra={"category": "..."}``; the component is
  derived from the logger name (``mediabot.<component>``).
"""

from __future__ import annotations

import logging
import sys
import threading
from collections.abc import Callable

from mediabot.observability.redact import redact

LOG_LEVELS = {"DEBUG": logging.DEBUG, "INFO": logging.INFO, "WARNING": logging.WARNING, "ERROR": logging.ERROR}
_NOISY_LOGGERS = ("httpx", "httpcore", "telegram", "uvicorn.access", "hpack", "asyncio")


class RedactingFilter(logging.Filter):
    def __init__(self, secrets_provider: Callable[[], list[str]] | None = None) -> None:
        super().__init__()
        self._secrets_provider = secrets_provider or (list)

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # malformed format args must never break logging
            message = str(record.msg)
        record.msg = redact(message, self._secrets_provider())
        record.args = ()
        if record.exc_info:
            # Exception text is redacted too; traceback is kept for console only.
            record.exc_text = redact(logging.Formatter().formatException(record.exc_info))
            record.exc_info = None
        return True


class OperationalLogHandler(logging.Handler):
    """Writes WARNING+ (and selected INFO) records into the operational_logs table."""

    def __init__(self, writer: Callable[[dict], None], level: int = logging.INFO) -> None:
        super().__init__(level)
        self._writer = writer
        self._lock = threading.Lock()
        self._reentrant = threading.local()

    def emit(self, record: logging.LogRecord) -> None:
        if getattr(self._reentrant, "active", False):
            return
        self._reentrant.active = True
        try:
            component = record.name.split(".")[1] if record.name.startswith("mediabot.") and "." in record.name else record.name
            entry = {
                "ts": record.created,
                "level": record.levelname,
                "component": component[:40],
                "category": str(getattr(record, "category", "general"))[:60],
                "message": record.getMessage()[:500],
                "details": getattr(record, "details", None),
            }
            with self._lock:
                self._writer(entry)
        except Exception:  # never let logging break the application
            pass
        finally:
            self._reentrant.active = False


def configure_logging(level: str, secrets_provider: Callable[[], list[str]] | None = None) -> None:
    root = logging.getLogger()
    root.setLevel(LOG_LEVELS.get(level.upper(), logging.INFO))
    for handler in list(root.handlers):
        if not isinstance(handler, OperationalLogHandler):  # keep the database handler attached
            root.removeHandler(handler)
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
    stream.addFilter(RedactingFilter(secrets_provider))
    root.addHandler(stream)
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)


def attach_operational_log(writer: Callable[[dict], None], level: str) -> OperationalLogHandler:
    handler = OperationalLogHandler(writer, LOG_LEVELS.get(level.upper(), logging.INFO))
    handler.addFilter(RedactingFilter())
    logging.getLogger().addHandler(handler)
    return handler


def set_levels(level: str) -> None:
    numeric = LOG_LEVELS.get(level.upper(), logging.INFO)
    logging.getLogger().setLevel(numeric)
    for handler in logging.getLogger().handlers:
        if isinstance(handler, OperationalLogHandler):
            handler.setLevel(numeric)

