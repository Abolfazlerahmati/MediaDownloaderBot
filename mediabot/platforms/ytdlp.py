"""Shared yt-dlp based implementation for platform adapters.

yt-dlp is the third-party extractor used for YouTube, TikTok, Instagram and Pinterest
public content. It runs as a separate process (``python -m yt_dlp``) with an argument
list, no shell, no user configuration files, ``--no-exec`` and a minimal environment.
Its output is parsed and validated here; nothing it reports is trusted to choose
filenames on disk or paths outside the job directory.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path
from typing import Any, ClassVar

from mediabot.errors import ErrorCode, MediaError
from mediabot.observability.redact import redact
from mediabot.platforms.base import (
    AdapterHealth,
    DownloadedFile,
    HealthState,
    MediaInfo,
    MediaType,
    OptionSpec,
    PlatformAdapter,
)
from mediabot.platforms.process import minimal_environment, run_process

logger = logging.getLogger("mediabot.platform.ytdlp")

IMAGE_EXTS = frozenset({"jpg", "jpeg", "png", "webp", "gif"})
AUDIO_EXTS = frozenset({"m4a", "mp3", "opus", "ogg", "aac", "flac", "wav"})
VIDEO_EXTS = frozenset({"mp4", "webm", "mkv", "mov", "m4v", "3gp", "flv"})
THUMBNAIL_EXTS = frozenset({"jpg", "jpeg", "png", "webp"})
PARTIAL_SUFFIXES = (".part", ".ytdl", ".temp")

# Ordered classification rules applied to yt-dlp stderr. First match wins.
DEFAULT_RULES: tuple[tuple[re.Pattern[str], ErrorCode], ...] = tuple(
    (re.compile(pattern, re.IGNORECASE), code)
    for pattern, code in (
        (r"Unsupported URL", ErrorCode.UNSUPPORTED_LINK),
        (r"File is larger than max-filesize|larger than max-filesize", ErrorCode.TOO_LARGE),
        (r"ffmpeg.*not (found|installed)|ffprobe.*not found|No such file or directory: '?ffmpeg", ErrorCode.DEPENDENCY_MISSING),
        (r"Requested format is not available|No video formats found|No formats found|requested format", ErrorCode.UNSUPPORTED_MEDIA),
        (r"Private video|This video is private|members[- ]only|Sign in to confirm|login required|log in|"
         r"requires? (an? )?account|This (post|account|content) is (private|unavailable)|age[- ]restricted|"
         r"confirm your age|cookies", ErrorCode.INACCESSIBLE),
        (r"not available in your country|geo.?restrict|blocked in your country|from your country", ErrorCode.INACCESSIBLE),
        (r"Video unavailable|has been removed|no longer available|has been deleted|does not exist|"
         r"Page not found|HTTP Error (404|410|403)|This video is unavailable|unavailable", ErrorCode.INACCESSIBLE),
        (r"HTTP Error 429|Too Many Requests|rate.?limit", ErrorCode.TEMPORARY),
        (r"HTTP Error 5\d\d|timed out|timeout|Connection (reset|refused|aborted)|Temporary failure|"
         r"Name or service not known|Network is unreachable|EOF occurred|Remote end closed|"
         r"Unable to download webpage|IncompleteRead|Read timed out", ErrorCode.TEMPORARY),
        (r"Unable to extract|extractor|please report this issue|Unsupported", ErrorCode.UPSTREAM_CHANGED),
        (r"No space left on device|Errno 28", ErrorCode.STORAGE_ERROR),
        (r"Permission denied|Errno 13", ErrorCode.STORAGE_ERROR),
    )
)

COMMON_OPTIONS: tuple[OptionSpec, ...] = (
    OptionSpec("allow_live", "Allow live streams", "bool", False,
               help="Live streams cannot be saved as finished files; keep disabled unless you know the source."),
    OptionSpec("embed_audio_artwork", "Embed the item's own cover into audio files", "bool", True,
               help="Only the cover of the same item is embedded, by remuxing (no re-encoding of audio)."),
)


def ytdlp_version() -> str | None:
    try:
        import yt_dlp.version

        return str(yt_dlp.version.__version__)
    except Exception:
        return None


def _last_json_object(stdout: bytes) -> dict[str, Any]:
    text = stdout.decode("utf-8", errors="replace")
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(data, dict):
                return data
    raise MediaError(ErrorCode.UPSTREAM_CHANGED, "extractor returned no metadata")


def _codec_present(value: Any) -> bool:
    return value not in (None, "none", "")


def detect_media_type(obj: dict[str, Any]) -> MediaType | None:
    ext = str(obj.get("ext") or "").lower()
    has_video = _codec_present(obj.get("vcodec"))
    has_audio = _codec_present(obj.get("acodec"))
    if ext in IMAGE_EXTS and not has_video:
        return MediaType.IMAGE
    if has_video:
        return MediaType.VIDEO
    if has_audio:
        return MediaType.AUDIO
    formats = obj.get("formats") or []
    if any(_codec_present(f.get("vcodec")) for f in formats if isinstance(f, dict)):
        return MediaType.VIDEO
    if any(_codec_present(f.get("acodec")) for f in formats if isinstance(f, dict)):
        return MediaType.AUDIO
    if ext in VIDEO_EXTS:
        return MediaType.VIDEO
    if ext in AUDIO_EXTS:
        return MediaType.AUDIO
    return None


def _as_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _filesize(obj: dict[str, Any]) -> int | None:
    direct = _as_int(obj.get("filesize") or obj.get("filesize_approx"))
    if direct:
        return direct
    parts = obj.get("requested_formats")
    if isinstance(parts, list) and parts:
        sizes = [_as_int(p.get("filesize") or p.get("filesize_approx")) for p in parts if isinstance(p, dict)]
        if all(sizes):
            return sum(s for s in sizes if s)
    return None


def _thumbnail(obj: dict[str, Any]) -> str | None:
    thumb = obj.get("thumbnail")
    if isinstance(thumb, str) and thumb.startswith(("http://", "https://")):
        return thumb
    thumbs = obj.get("thumbnails")
    if isinstance(thumbs, list):
        candidates = [t for t in thumbs if isinstance(t, dict) and str(t.get("url", "")).startswith("https://")]
        if candidates:
            return str(candidates[-1]["url"])
    return None


class YtDlpAdapter(PlatformAdapter):
    """Base class: subclasses implement ``canonicalize`` and may add error rules."""

    options_spec: ClassVar[tuple[OptionSpec, ...]] = COMMON_OPTIONS
    extra_rules: ClassVar[tuple[tuple[re.Pattern[str], ErrorCode], ...]] = ()

    # ----- command construction -----------------------------------------
    def _base_argv(self) -> list[str]:
        argv = [
            sys.executable, "-m", "yt_dlp",
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-exec",
            "--no-update",
            "--no-cache-dir",
            "--no-progress",
            "--no-colors",
            "--socket-timeout", "20",
            "--retries", "2",
        ]
        if self.context.ffmpeg_path is not None:
            argv += ["--ffmpeg-location", str(self.context.ffmpeg_path)]
        return argv

    def _env(self, workdir: Path) -> dict[str, str]:
        return minimal_environment(workdir)

    # ----- format selection ------------------------------------------------
    def format_selector(self, media_type: MediaType) -> str:
        if self.record.format_selector:
            return self.record.format_selector
        height = self.record.max_height
        h = f"[height<={height}]" if height else ""
        if media_type == MediaType.VIDEO:
            mp4 = "[ext=mp4]" if self.context.preferred_video_container == "mp4" else ""
            return (
                f"bv*{mp4}{h}+ba[ext=m4a]/b{mp4}{h}/bv*{h}+ba/b{h}/b"
            )
        if media_type == MediaType.AUDIO:
            pref = self.context.preferred_audio_container
            if pref == "m4a":
                return "ba[ext=m4a]/ba[ext=aac]/ba/b"
            if pref == "mp3":
                return "ba[ext=mp3]/ba/b"
            return "ba/b"
        return "b"

    # ----- probing -------------------------------------------------------
    async def probe(self, url: str, workdir: Path) -> MediaInfo:
        argv = self._base_argv() + [
            "--no-playlist", "--skip-download", "--dump-single-json", "--", url,
        ]
        result = await run_process(
            argv,
            timeout=self.context.probe_timeout_seconds,
            cwd=workdir,
            env=self._env(workdir),
            memory_limit_mb=self.context.memory_limit_mb,
        )
        if result.timed_out:
            raise MediaError(ErrorCode.TIMEOUT, "metadata probe timed out")
        if result.returncode != 0:
            raise self._error_from_output(result.stderr, result.returncode)
        obj = _last_json_object(result.stdout)
        return self._info_from_json(obj)

    def _info_from_json(self, obj: dict[str, Any]) -> MediaInfo:
        kind = str(obj.get("_type") or "video")
        if kind in {"playlist", "multi_video"} or isinstance(obj.get("entries"), list):
            raise MediaError(ErrorCode.MULTIPLE_ITEMS, "playlist or multi-item post")
        media_type = detect_media_type(obj)
        if media_type is None:
            raise MediaError(ErrorCode.UNSUPPORTED_MEDIA, "no downloadable video, audio or image stream")
        is_live = bool(obj.get("is_live")) or obj.get("live_status") in {"is_live", "is_upcoming", "post_live"}
        if is_live and not self.option("allow_live"):
            raise MediaError(ErrorCode.LIVE_UNSUPPORTED, "live content")
        return MediaInfo(
            platform_key=self.record.key,
            media_type=media_type,
            source_id=str(obj.get("id")) if obj.get("id") is not None else None,
            title=(str(obj.get("title")).strip() or None) if obj.get("title") else None,
            ext=str(obj.get("ext")).lower() if obj.get("ext") else None,
            duration=_as_float(obj.get("duration")),
            width=_as_int(obj.get("width")),
            height=_as_int(obj.get("height")),
            filesize=_filesize(obj),
            is_live=is_live,
            thumbnail_url=_thumbnail(obj),
            artist=(str(obj.get("artist") or obj.get("creator") or obj.get("uploader") or "").strip() or None),
            track=(str(obj.get("track") or "").strip() or None),
            extractor=str(obj.get("extractor_key") or obj.get("extractor") or "") or None,
            has_video=_codec_present(obj.get("vcodec")),
            has_audio=_codec_present(obj.get("acodec")),
        )

    # ----- downloading ----------------------------------------------------
    async def download(self, url: str, info: MediaInfo, workdir: Path) -> DownloadedFile:
        argv = self._base_argv() + [
            "--no-playlist",
            "--no-part",
            "--no-mtime",
            "--no-overwrites",
            "--fragment-retries", "3",
            "-P", f"home:{workdir}",
            "-o", "media.%(ext)s",
            "-f", self.format_selector(info.media_type),
            "--max-filesize", str(self.context.max_file_bytes),
        ]
        if info.media_type == MediaType.VIDEO:
            argv += ["--merge-output-format", self.context.preferred_video_container]
        if self.context.embed_metadata:
            argv.append("--embed-metadata")
        if info.media_type == MediaType.AUDIO and self.option("embed_audio_artwork") and self.record.thumbnails_enabled:
            argv.append("--embed-thumbnail")
        argv += ["--", url]

        result = await run_process(
            argv,
            timeout=self.context.download_timeout_seconds,
            cwd=workdir,
            env=self._env(workdir),
            memory_limit_mb=self.context.memory_limit_mb,
        )
        if result.timed_out:
            raise MediaError(ErrorCode.TIMEOUT, "download timed out")
        output = self._find_output(workdir, info.media_type)
        if result.returncode != 0 and output is None:
            raise self._error_from_output(result.stderr, result.returncode)
        if output is None:
            raise MediaError(ErrorCode.DOWNLOAD_FAILED, "no output file produced")
        return output

    def _find_output(self, workdir: Path, media_type: MediaType) -> DownloadedFile | None:
        candidates: list[Path] = []
        for path in workdir.iterdir():
            if not path.is_file() or not path.name.startswith("media."):
                continue
            ext = path.suffix.lstrip(".").lower()
            if path.name.endswith(PARTIAL_SUFFIXES):
                continue
            if media_type != MediaType.IMAGE and ext in THUMBNAIL_EXTS:
                continue  # sidecar thumbnail, never the media itself
            candidates.append(path)
        if not candidates:
            return None
        if len(candidates) > 1:
            raise MediaError(ErrorCode.DOWNLOAD_FAILED, "unexpected multiple output files")
        path = candidates[0]
        size = path.stat().st_size
        if size > self.context.max_file_bytes:
            path.unlink(missing_ok=True)
            raise MediaError(ErrorCode.TOO_LARGE, f"output is {size} bytes")
        return DownloadedFile(path=path, ext=path.suffix.lstrip(".").lower(), size=size)

    # ----- error handling ------------------------------------------------
    def classify_error(self, output: str) -> ErrorCode:
        for pattern, code in (*self.extra_rules, *DEFAULT_RULES):
            if pattern.search(output or ""):
                return code
        return ErrorCode.DOWNLOAD_FAILED

    def _error_from_output(self, stderr: str, returncode: int | None) -> MediaError:
        code = self.classify_error(stderr)
        tail = redact(" | ".join(stderr.strip().splitlines()[-3:]))[:400]
        return MediaError(code, f"yt-dlp exit {returncode}: {tail}")

    # ----- self test ------------------------------------------------------
    async def self_test(self, workdir: Path) -> AdapterHealth:
        version = ytdlp_version()
        if version is None:
            return AdapterHealth(HealthState.FAILED, "yt-dlp is not installed in this environment.")
        if self.context.ffmpeg_path is None:
            return AdapterHealth(HealthState.FAILED,
                                 "ffmpeg was not found. Install ffmpeg or set FFMPEG_PATH.")
        test_url = self.record.test_url
        if not test_url:
            return AdapterHealth(
                HealthState.WARNING,
                "Configuration is valid, but no live test URL is set. Add a public sample URL and run the test before enabling.",
            )
        from mediabot.errors import UnsafeDestinationError
        from mediabot.security.ssrf import split_and_validate_syntax

        try:
            split = split_and_validate_syntax(test_url)
        except UnsafeDestinationError:
            return AdapterHealth(HealthState.FAILED, "The test URL is malformed or not allowed.")
        canonical = type(self).canonicalize(split, self.record)
        if canonical is None:
            return AdapterHealth(HealthState.FAILED,
                                 "The test URL is not a recognised URL for this platform.")
        try:
            info = await self.probe(canonical, workdir)
        except MediaError as exc:
            if exc.code in {ErrorCode.TEMPORARY, ErrorCode.TIMEOUT}:
                return AdapterHealth(HealthState.WARNING, "Live test hit a temporary failure. Try again later.")
            if exc.code in {ErrorCode.INACCESSIBLE, ErrorCode.UNSUPPORTED_LINK}:
                return AdapterHealth(HealthState.FAILED,
                                     "The test URL is not accessible publicly. Choose another public sample.")
            if exc.code == ErrorCode.UPSTREAM_CHANGED:
                return AdapterHealth(HealthState.FAILED,
                                     f"The extractor could not parse the page. Update yt-dlp (current {version}).")
            if exc.code == ErrorCode.DEPENDENCY_MISSING:
                return AdapterHealth(HealthState.FAILED, "A required dependency is missing (ffmpeg).")
            return AdapterHealth(HealthState.FAILED, f"Live test failed ({exc.code.value}).")
        return AdapterHealth(
            HealthState.HEALTHY,
            f"Live test passed: metadata extracted with yt-dlp {version} ({info.media_type.value}).",
        )
