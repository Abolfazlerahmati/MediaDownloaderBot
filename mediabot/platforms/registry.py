"""Adapter registry. Administrators choose an adapter *type* from this list; they can
never supply code. Unknown keys are rejected by the platform validator."""

from __future__ import annotations

from mediabot.platforms.adapters import ADAPTER_CLASSES
from mediabot.platforms.base import PlatformAdapter


def adapter_class(key: str) -> type[PlatformAdapter] | None:
    return ADAPTER_CLASSES.get(key)


def adapter_catalog() -> list[dict]:
    return [cls.describe() for cls in ADAPTER_CLASSES.values()]


def adapter_keys() -> list[str]:
    return list(ADAPTER_CLASSES)
