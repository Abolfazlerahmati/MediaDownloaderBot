"""Centralised internationalisation.

All bot-generated text is looked up through :class:`Translator`. To add a language,
drop a JSON file into ``locales/`` with the same keys as ``en.json`` and a
``language_name`` entry (its native name), then add its code to the
``available_languages`` runtime setting. Missing keys fall back to English.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger("mediabot.i18n")
LOCALES_DIR = Path(__file__).parent / "locales"
DEFAULT_LANGUAGE = "en"
RTL_LANGUAGES = frozenset({"fa", "ar", "he", "ur"})


class Translator:
    def __init__(self, locales_dir: Path = LOCALES_DIR, default: str = DEFAULT_LANGUAGE) -> None:
        self._default = default
        self._catalogs: dict[str, dict[str, str]] = {}
        for path in sorted(locales_dir.glob("*.json")):
            with path.open("r", encoding="utf-8") as handle:
                self._catalogs[path.stem] = json.load(handle)
        if default not in self._catalogs:
            raise RuntimeError(f"default locale '{default}' is missing")

    @property
    def default_language(self) -> str:
        return self._default

    def supported(self) -> list[str]:
        return sorted(self._catalogs)

    def is_supported(self, language: str) -> bool:
        return language in self._catalogs

    def native_name(self, language: str) -> str:
        catalog = self._catalogs.get(language) or self._catalogs[self._default]
        return catalog.get("language_name", language)

    def direction(self, language: str) -> str:
        return "rtl" if language in RTL_LANGUAGES else "ltr"

    def keys(self) -> set[str]:
        return set(self._catalogs[self._default])

    def missing_keys(self, language: str) -> set[str]:
        """Keys present in the default catalogue but absent from ``language``."""
        return set(self._catalogs[self._default]) - set(self._catalogs.get(language, {}))

    def t(self, language: str | None, key: str, **params: Any) -> str:
        catalog = self._catalogs.get(language or self._default, {})
        template = catalog.get(key)
        if template is None:
            template = self._catalogs[self._default].get(key)
        if template is None:
            logger.warning("missing translation key %s", key, extra={"category": "i18n"})
            return key
        try:
            return template.format(**params)
        except (KeyError, IndexError, ValueError):
            return template


@lru_cache(maxsize=1)
def get_translator() -> Translator:
    return Translator()
