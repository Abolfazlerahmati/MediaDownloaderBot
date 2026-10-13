"""Extract candidate URLs from Telegram message text and entities.

Telegram entity offsets are measured in UTF-16 code units, so they are converted
carefully. Only printable ASCII is accepted inside a URL, which keeps adjacent
Persian text out of the match.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from mediabot.errors import UnsafeDestinationError
from mediabot.security.ssrf import SplitUrl, split_and_validate_syntax

# Scheme optional: users often paste "youtu.be/xyz". The host must look like a DNS name.
_CANDIDATE_RE = re.compile(
    r"(?<![\w@/.\-])"
    r"((?:https?://)?(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}"
    r"(?::\d{1,5})?(?:[/?#][!-~]*)?)"
)
_TRAILING_PUNCT = ".,;:!?)]}>\"'`*"
MAX_CANDIDATE_LENGTH = 2048


@dataclass(frozen=True)
class MessageEntity:
    type: str
    offset: int  # UTF-16 code units
    length: int  # UTF-16 code units
    url: str | None = None


def _utf16_slice(text: str, offset: int, length: int) -> str:
    encoded = text.encode("utf-16-le")
    return encoded[offset * 2 : (offset + length) * 2].decode("utf-16-le", errors="ignore")


def _clean(candidate: str) -> str:
    candidate = candidate.strip()
    while candidate and candidate[-1] in _TRAILING_PUNCT:
        candidate = candidate[:-1]
    return candidate


def extract_candidates(text: str | None, entities: Iterable[MessageEntity] = ()) -> list[str]:
    """Return raw URL candidates in order of appearance, without duplicates."""
    if not text:
        return []
    found: list[tuple[int, str]] = []
    for entity in entities:
        if entity.type == "text_link" and entity.url:
            found.append((entity.offset, entity.url))
        elif entity.type == "url":
            found.append((entity.offset, _utf16_slice(text, entity.offset, entity.length)))
    for match in _CANDIDATE_RE.finditer(text):
        raw = match.group(1)
        start = match.start(1)
        # Skip regex matches already represented by an explicit entity.
        if any(abs(start - o) < 2 for o, _ in found):
            continue
        found.append((start, raw))
    ordered: list[str] = []
    seen: set[str] = set()
    for _, raw in sorted(found, key=lambda item: item[0]):
        cleaned = _clean(raw)
        if not cleaned or len(cleaned) > MAX_CANDIDATE_LENGTH:
            continue
        if not re.match(r"^https?://", cleaned, re.IGNORECASE):
            cleaned = "https://" + cleaned
        if cleaned not in seen:
            seen.add(cleaned)
            ordered.append(cleaned)
    return ordered


def parse_candidate(raw: str) -> SplitUrl | None:
    """Syntactic validation only (no DNS). Returns None for anything unsafe or malformed."""
    try:
        return split_and_validate_syntax(raw)
    except UnsafeDestinationError:
        return None
