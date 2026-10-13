"""Presentation filenames for downloaded media.

The file on disk always has an internal name (``media.<ext>``). The name shown to the
user is built here from the original title, keeping Unicode (Persian, Latin, spaces,
punctuation) and the real extension. Only characters that are dangerous on common
filesystems are replaced, and only with an underscore.
"""

from __future__ import annotations

import re
import unicodedata

MAX_NAME_BYTES = 200  # leaves room for the extension and Telegram's own limits
# ASCII control characters, path separators and characters forbidden on Windows/macOS.
_FORBIDDEN_RE = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')
# Bidirectional override/isolate controls can disguise file extensions. ZWNJ/ZWJ are
# kept because they are part of correct Persian text.
_BIDI_OVERRIDE_RE = re.compile("[\u202a-\u202e\u2066-\u2069]")
_RESERVED = frozenset({"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))})
_SAFE_EXT_RE = re.compile(r"^[a-z0-9]{1,8}$")


def _truncate_utf8(text: str, max_bytes: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    trimmed = encoded[:max_bytes].decode("utf-8", errors="ignore")
    return trimmed.rstrip(" ._-")


def sanitize_stem(title: str, max_bytes: int = MAX_NAME_BYTES) -> str:
    text = unicodedata.normalize("NFC", title or "")
    text = _BIDI_OVERRIDE_RE.sub("", text)
    text = _FORBIDDEN_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.strip(". ")  # no hidden files and no trailing dots/spaces
    text = _truncate_utf8(text, max_bytes)
    if not text:
        return ""
    if text.upper().split(".")[0] in _RESERVED:
        text = "_" + text
    return text


def build_display_name(
    title: str | None,
    ext: str,
    *,
    fallback_stem: str,
) -> str:
    """Return ``<sanitised title>.<ext>``. ``fallback_stem`` (e.g. "youtube-abc123") is only
    used when the platform provides no usable title."""
    safe_ext = ext.lower().lstrip(".")
    if not _SAFE_EXT_RE.match(safe_ext):
        raise ValueError("unsafe file extension")
    # The cap applies to the complete file name, extension included.
    budget = MAX_NAME_BYTES - len(safe_ext.encode("ascii")) - 1
    stem = sanitize_stem(title or "", budget) or sanitize_stem(fallback_stem, budget) or "media"
    return f"{stem}.{safe_ext}"
