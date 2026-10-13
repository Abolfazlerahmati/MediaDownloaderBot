"""Platform adapter contract.

An adapter knows how to:
  * recognise and canonicalise URLs for its platform (``canonicalize``),
  * extract metadata without downloading (``probe``),
  * download the selected media into a job-private directory (``download``),
  * classify failures into ``ErrorCode`` values (``classify_error``),
  * run its connectivity / dependency self-test (``self_test``).

Adapters never talk to Telegram and never decide limits - the download pipeline does.
Adding a platform means adding one class here and registering it in ``registry.py``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, ClassVar

from mediabot.db.repositories import PlatformRecord
from mediabot.errors import ErrorCode, MediaError
from mediabot.security.ssrf import SplitUrl


class MediaType(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"
    IMAGE = "image"


class HealthState(str, Enum):
    HEALTHY = "healthy"
    WARNING = "warning"
    FAILED = "failed"
    NOT_CONFIGURED = "not_configured"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class OptionSpec:
    key: str
    label: str
    kind: str  # "bool" | "choice"
    default: Any
    choices: tuple[str, ...] = ()
    help: str = ""


@dataclass(frozen=True)
class MediaInfo:
    platform_key: str
    media_type: MediaType
    source_id: str | None
    title: str | None
    ext: str | None
    duration: float | None
    width: int | None
    height: int | None
    filesize: int | None
    is_live: bool
    thumbnail_url: str | None
    artist: str | None
    track: str | None
    extractor: str | None
    has_video: bool
    has_audio: bool
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DownloadedFile:
    path: Path
    ext: str
    size: int


@dataclass(frozen=True)
class AdapterHealth:
    state: HealthState
    message: str


@dataclass(frozen=True)
class AdapterContext:
    """Per-job, immutable inputs provided by the orchestrator."""

    ffmpeg_path: Path | None
    probe_timeout_seconds: int
    download_timeout_seconds: int
    max_file_bytes: int
    memory_limit_mb: int
    allow_private_network: bool
    embed_metadata: bool
    embed_audio_artwork: bool
    preferred_video_container: str
    preferred_audio_container: str


class PlatformAdapter(ABC):
    adapter_key: ClassVar[str]
    display_name: ClassVar[str]
    description: ClassVar[str]
    default_domains: ClassVar[tuple[str, ...]] = ()
    default_url_patterns: ClassVar[tuple[str, ...]] = ()
    options_spec: ClassVar[tuple[OptionSpec, ...]] = (
        OptionSpec("allow_live", "Allow live streams", "bool", False,
                   help="Live streams cannot be saved as finished files; disabled by default."),
    )

    def __init__(self, record: PlatformRecord, context: AdapterContext) -> None:
        self.record = record
        self.context = context

    # ----- URL handling --------------------------------------------------
    @classmethod
    @abstractmethod
    def canonicalize(cls, url: SplitUrl, record: PlatformRecord) -> str | None:
        """Return the canonical URL if the path is a supported shape, otherwise None."""

    # ----- execution -----------------------------------------------------
    @abstractmethod
    async def probe(self, url: str, workdir: Path) -> MediaInfo:
        """Extract metadata without downloading media. Raises MediaError."""

    @abstractmethod
    async def download(self, url: str, info: MediaInfo, workdir: Path) -> DownloadedFile:
        """Download the selected media into ``workdir``. Raises MediaError."""

    @abstractmethod
    def classify_error(self, output: str) -> ErrorCode:
        """Map upstream tool output to an internal error category."""

    @abstractmethod
    async def self_test(self, workdir: Path) -> AdapterHealth:
        """Dependency and (if configured) live connectivity test."""

    def format_selector(self, media_type: MediaType) -> str:
        return "b"

    # ----- helpers ---------------------------------------------------------
    def option(self, key: str) -> Any:
        spec = {o.key: o for o in self.options_spec}.get(key)
        default = spec.default if spec else None
        return self.record.options.get(key, default)

    @classmethod
    def describe(cls) -> dict[str, Any]:
        return {
            "adapter": cls.adapter_key,
            "display_name": cls.display_name,
            "description": cls.description,
            "default_domains": list(cls.default_domains),
            "default_url_patterns": list(cls.default_url_patterns),
            "options": [
                {"key": o.key, "label": o.label, "kind": o.kind, "default": o.default,
                 "choices": list(o.choices), "help": o.help}
                for o in cls.options_spec
            ],
        }


def unsupported(detail: str) -> MediaError:
    return MediaError(ErrorCode.UNSUPPORTED_LINK, detail)
