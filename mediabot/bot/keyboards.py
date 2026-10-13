"""Inline keyboards for the language selector."""

from __future__ import annotations

from collections.abc import Iterable

from mediabot.bot.gateway import Keyboard
from mediabot.i18n import Translator

LANG_CALLBACK_PREFIX = "lang:"


def language_keyboard(translator: Translator, languages: Iterable[str], current: str) -> Keyboard:
    row: list[tuple[str, str]] = []
    for code in languages:
        label = translator.native_name(code)
        if code == current:
            label = f"✓ {label}"
        row.append((label, f"{LANG_CALLBACK_PREFIX}{code}"))
    return [row]


def parse_language_callback(data: str) -> str | None:
    if not data.startswith(LANG_CALLBACK_PREFIX):
        return None
    code = data[len(LANG_CALLBACK_PREFIX):]
    return code if code and len(code) <= 10 else None
