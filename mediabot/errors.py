"""Error taxonomy shared by adapters, the download pipeline and the bot.

``ErrorCode`` values are *internal* categories. The user-facing text for each code
lives in the i18n catalogue (see ``mediabot.i18n``). Internal ``detail`` strings
are for logs only and must never be shown to Telegram users.
"""

from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    UNSUPPORTED_LINK = "unsupported_link"          # URL not recognised by the adapter
    INACCESSIBLE = "inaccessible"                  # private / removed / region-locked / login-only
    TOO_LARGE = "too_large"                        # exceeds configured or Telegram size limit
    TOO_LONG = "too_long"                          # exceeds configured duration limit
    UNSUPPORTED_MEDIA = "unsupported_media"        # media type disabled, or no usable format
    MULTIPLE_ITEMS = "multiple_items"              # playlist / carousel - not supported
    LIVE_UNSUPPORTED = "live_unsupported"          # live stream and live is disabled
    TEMPORARY = "temporary"                        # transient upstream failure (retryable)
    TIMEOUT = "timeout"                            # subprocess / network timeout (retryable)
    DOWNLOAD_FAILED = "download_failed"            # generic failure
    UPSTREAM_CHANGED = "upstream_changed"          # extractor failed to parse the site
    DEPENDENCY_MISSING = "dependency_missing"      # ffmpeg / yt-dlp missing or broken
    VALIDATION_FAILED = "validation_failed"        # downloaded file failed integrity checks
    STORAGE_ERROR = "storage_error"                # disk full / permission problems
    UPLOAD_FAILED = "upload_failed"                # Telegram rejected the upload
    RATE_LIMITED = "rate_limited"
    QUEUE_FULL = "queue_full"
    MAINTENANCE = "maintenance"
    SERVICE_UNAVAILABLE = "service_unavailable"    # bot not running / Telegram unreachable
    CANCELLED = "cancelled"


RETRYABLE_CODES = frozenset({ErrorCode.TEMPORARY, ErrorCode.TIMEOUT})


class MediaError(Exception):
    """A classified, user-presentable failure in the media pipeline."""

    def __init__(self, code: ErrorCode, detail: str = "", *, retryable: bool | None = None) -> None:
        super().__init__(f"{code.value}: {detail}" if detail else code.value)
        self.code = code
        self.detail = detail
        self.retryable = (code in RETRYABLE_CODES) if retryable is None else retryable


class UnsafeDestinationError(MediaError):
    """Raised when a URL resolves to a non-public network destination."""

    def __init__(self, detail: str = "destination is not public") -> None:
        super().__init__(ErrorCode.UNSUPPORTED_LINK, detail, retryable=False)
