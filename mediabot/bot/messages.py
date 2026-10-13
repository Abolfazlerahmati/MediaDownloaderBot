"""Mapping from internal error codes to user-facing, localised text."""

from __future__ import annotations

from mediabot.errors import ErrorCode
from mediabot.i18n import Translator
from mediabot.services.settings import RuntimeSettings

ERROR_KEYS: dict[ErrorCode, str] = {
    ErrorCode.UNSUPPORTED_LINK: "unsupported_link",
    ErrorCode.INACCESSIBLE: "inaccessible",
    ErrorCode.TOO_LARGE: "too_large",
    ErrorCode.TOO_LONG: "too_long",
    ErrorCode.UNSUPPORTED_MEDIA: "unsupported_media",
    ErrorCode.MULTIPLE_ITEMS: "multiple_items",
    ErrorCode.LIVE_UNSUPPORTED: "live_unsupported",
    ErrorCode.TIMEOUT: "timeout",
    ErrorCode.TEMPORARY: "download_failed",
    ErrorCode.DOWNLOAD_FAILED: "download_failed",
    ErrorCode.UPSTREAM_CHANGED: "download_failed",
    ErrorCode.VALIDATION_FAILED: "download_failed",
    ErrorCode.DEPENDENCY_MISSING: "service_unavailable",
    ErrorCode.STORAGE_ERROR: "service_unavailable",
    ErrorCode.SERVICE_UNAVAILABLE: "service_unavailable",
    ErrorCode.UPLOAD_FAILED: "upload_failed",
    ErrorCode.RATE_LIMITED: "rate_limited",
    ErrorCode.QUEUE_FULL: "queue_full",
    ErrorCode.MAINTENANCE: "maintenance",
    ErrorCode.CANCELLED: "cancelled",
}


def error_text(translator: Translator, settings: RuntimeSettings, language: str, code: ErrorCode) -> str:
    """Localised error text, honouring administrator overrides (per language and key)."""
    key = ERROR_KEYS.get(code, "download_failed")
    override = settings.error_message_overrides.get(language, {}).get(key)
    if override:
        return override
    return translator.t(language, key, limit=settings.max_file_size_mb)
