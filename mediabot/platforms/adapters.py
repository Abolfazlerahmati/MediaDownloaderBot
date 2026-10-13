"""Concrete platform adapters. Each one only encodes its platform's URL shapes;
download mechanics are shared through :class:`YtDlpAdapter`.

Only publicly accessible content is supported. Adapters never attempt to bypass
logins, paywalls, private-account restrictions or age/region gates.
"""

from __future__ import annotations

import re
from typing import ClassVar
from urllib.parse import parse_qs

from mediabot.db.repositories import PlatformRecord
from mediabot.platforms.base import OptionSpec
from mediabot.platforms.ytdlp import COMMON_OPTIONS, YtDlpAdapter
from mediabot.security.ssrf import SplitUrl

_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_TIKTOK_VIDEO = re.compile(r"^/@[A-Za-z0-9._]{1,64}/(?:video|photo)/\d{5,25}/?$")
_TIKTOK_SHORT = re.compile(r"^/[A-Za-z0-9]{5,20}/?$")
_TIKTOK_T = re.compile(r"^/t/[A-Za-z0-9]{5,20}/?$")
_INSTAGRAM_MEDIA = re.compile(r"^(?:/[A-Za-z0-9._]{1,30})?/(p|reel|reels|tv)/([A-Za-z0-9_-]{5,20})/?$")
_PINTEREST_PIN = re.compile(r"^/pin/(\d{3,25})/?$")
_PINTEREST_SHORT = re.compile(r"^/([A-Za-z0-9]{4,20})/?$")


def _is_youtube_host(host: str) -> bool:
    return host == "youtube.com" or host.endswith(".youtube.com") or host == "youtu.be"


class YouTubeAdapter(YtDlpAdapter):
    adapter_key = "youtube"
    display_name = "YouTube"
    description = "Public YouTube videos, Shorts, live replays and embeds (single items only)."
    default_domains = ("youtube.com", "youtu.be")
    default_url_patterns: ClassVar[tuple[str, ...]] = ()

    @classmethod
    def canonicalize(cls, url: SplitUrl, record: PlatformRecord) -> str | None:
        if not _is_youtube_host(url.host):
            return None
        video_id: str | None = None
        if url.host == "youtu.be":
            segment = url.path.strip("/").split("/")[0]
            video_id = segment
        elif url.path.rstrip("/") == "/watch":
            values = parse_qs(url.query).get("v") or []
            video_id = values[0] if values else None
        else:
            parts = url.path.strip("/").split("/")
            if len(parts) == 2 and parts[0] in {"shorts", "live", "embed"}:
                video_id = parts[1]
        if not video_id or not _YOUTUBE_ID.match(video_id):
            return None
        return f"https://www.youtube.com/watch?v={video_id}"


class TikTokAdapter(YtDlpAdapter):
    adapter_key = "tiktok"
    display_name = "TikTok"
    description = "Public TikTok video links (full links, vm./vt. short links and /t/ links)."
    default_domains = ("tiktok.com",)
    default_url_patterns: ClassVar[tuple[str, ...]] = ()

    @classmethod
    def canonicalize(cls, url: SplitUrl, record: PlatformRecord) -> str | None:
        host = url.host
        if not (host == "tiktok.com" or host.endswith(".tiktok.com")):
            return None
        if host in {"vm.tiktok.com", "vt.tiktok.com"} and _TIKTOK_SHORT.match(url.path):
            return f"https://{host}{url.path.rstrip('/')}/"
        if _TIKTOK_VIDEO.match(url.path):
            return f"https://www.tiktok.com{url.path.rstrip('/')}/"
        if _TIKTOK_T.match(url.path):
            return f"https://www.tiktok.com{url.path.rstrip('/')}/"
        return None


class InstagramAdapter(YtDlpAdapter):
    adapter_key = "instagram"
    display_name = "Instagram"
    description = "Public Instagram posts, Reels and IGTV videos. Stories and private accounts are not supported."
    default_domains = ("instagram.com", "instagr.am")
    default_url_patterns: ClassVar[tuple[str, ...]] = ()

    @classmethod
    def canonicalize(cls, url: SplitUrl, record: PlatformRecord) -> str | None:
        host = url.host
        if not (host in {"instagram.com", "instagr.am"} or host.endswith(".instagram.com")):
            return None
        match = _INSTAGRAM_MEDIA.match(url.path)
        if not match:
            return None
        kind = {"p": "p", "reel": "reel", "reels": "reel", "tv": "tv"}[match.group(1)]
        return f"https://www.instagram.com/{kind}/{match.group(2)}/"


class PinterestAdapter(YtDlpAdapter):
    adapter_key = "pinterest"
    display_name = "Pinterest"
    description = "Public Pinterest pins (video pins; image pins depend on extractor support) and pin.it short links."
    default_domains = ("pinterest.com", "pin.it")
    default_url_patterns: ClassVar[tuple[str, ...]] = ()

    @classmethod
    def canonicalize(cls, url: SplitUrl, record: PlatformRecord) -> str | None:
        host = url.host
        if host == "pin.it":
            if _PINTEREST_SHORT.match(url.path):
                return f"https://pin.it{url.path.rstrip('/')}"
            return None
        if not (host == "pinterest.com" or host.endswith(".pinterest.com") or re.match(r"^(?:[a-z]{2}\.)?pinterest\.[a-z.]+$", host)):
            return None
        match = _PINTEREST_PIN.match(url.path)
        if not match:
            return None
        return f"https://www.pinterest.com/pin/{match.group(1)}/"


class GenericYtDlpAdapter(YtDlpAdapter):
    """Admin-defined domain served by yt-dlp's extractors. Use with care: the platform is
    only as safe as the extractors yt-dlp provides for that domain."""

    adapter_key = "generic_ytdlp"
    display_name = "Generic (yt-dlp)"
    description = "Any admin-approved public domain supported by yt-dlp's built-in extractors."
    default_domains = ()
    default_url_patterns: ClassVar[tuple[str, ...]] = ()
    options_spec = COMMON_OPTIONS + (
        OptionSpec("keep_query", "Keep URL query string", "bool", False,
                   help="Query strings are dropped by default to avoid storing tokens or tracking parameters."),
    )

    @classmethod
    def canonicalize(cls, url: SplitUrl, record: PlatformRecord) -> str | None:
        if not any(url.host == d or url.host.endswith("." + d) for d in record.domains):
            return None
        query = f"?{url.query}" if (record.options.get("keep_query") and url.query) else ""
        return f"https://{url.host}{url.path or '/'}{query}"


ADAPTER_CLASSES: dict[str, type[YtDlpAdapter]] = {
    cls.adapter_key: cls
    for cls in (YouTubeAdapter, TikTokAdapter, InstagramAdapter, PinterestAdapter, GenericYtDlpAdapter)
}
