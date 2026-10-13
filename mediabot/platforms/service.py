"""Matches candidate URLs against enabled platform configurations."""

from __future__ import annotations

import functools
import hashlib
import re
from dataclasses import dataclass

from mediabot.db.repositories import PlatformRecord, PlatformRepo
from mediabot.platforms.registry import adapter_class
from mediabot.security.ssrf import SplitUrl


@dataclass(frozen=True)
class PlatformMatch:
    record: PlatformRecord
    canonical_url: str
    url_key: str  # stable identifier of the canonical URL (for dedupe), never logged raw


@functools.lru_cache(maxsize=512)
def _compiled(pattern: str) -> re.Pattern[str] | None:
    try:
        return re.compile(pattern)
    except re.error:
        return None


def domain_matches(host: str, domains: list[str]) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains)


class PlatformService:
    def __init__(self, repo: PlatformRepo) -> None:
        self._repo = repo

    def records(self) -> list[PlatformRecord]:
        return self._repo.list_all()

    def enabled(self) -> list[PlatformRecord]:
        return [r for r in self._repo.list_all() if r.enabled]

    def match(self, split: SplitUrl) -> PlatformMatch | None:
        """Return the first enabled platform whose domain, adapter and patterns accept the URL."""
        for record in self.enabled():
            if not domain_matches(split.host, record.domains):
                continue
            cls = adapter_class(record.adapter)
            if cls is None:
                continue
            canonical = cls.canonicalize(split, record)
            if canonical is None:
                continue
            if record.url_patterns and not any(
                (compiled := _compiled(p)) is not None and compiled.search(canonical)
                for p in record.url_patterns
            ):
                continue
            key = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]
            return PlatformMatch(record=record, canonical_url=canonical, url_key=key)
        return None

    def display_name(self, key: str) -> str:
        record = self._repo.get(key)
        return record.name if record else key


DEFAULT_MEDIA_TYPES: dict[str, list[str]] = {
    "youtube": ["video", "audio"],
    "tiktok": ["video", "audio"],
    "instagram": ["video", "audio", "image"],
    "pinterest": ["video", "image"],
}


def seed_default_platforms(repo) -> list[str]:  # type: ignore[no-untyped-def]
    """Create disabled, untested entries for the built-in adapters on first start.

    Seeded platforms never accept links until an administrator sets a public test URL,
    runs the live test successfully and enables them. Existing entries are left alone.
    """
    from mediabot.platforms.adapters import ADAPTER_CLASSES

    existing = {record.key for record in repo.list_all()}
    created: list[str] = []
    for key, cls in ADAPTER_CLASSES.items():
        if not cls.default_domains or key in existing:
            continue
        repo.create({
            "key": key,
            "name": cls.display_name,
            "adapter": key,
            "enabled": False,
            "domains": list(cls.default_domains),
            "url_patterns": [],
            "allowed_media_types": DEFAULT_MEDIA_TYPES.get(key, ["video"]),
            "max_file_size_mb": 50,
            "max_duration_seconds": None,
            "max_height": None,
            "format_selector": None,
            "thumbnails_enabled": True,
            "options": {spec.key: spec.default for spec in cls.options_spec},
            "test_url": None,
        })
        created.append(key)
    return created
