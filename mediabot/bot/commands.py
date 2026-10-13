"""Command parsing with explicit group addressing (``/start@BotName``)."""

from __future__ import annotations

import re
from dataclasses import dataclass

_COMMAND_RE = re.compile(r"^/([A-Za-z][A-Za-z0-9_]{0,31})(?:@([A-Za-z][A-Za-z0-9_]{3,64}))?(?=\s|$)")
KNOWN_COMMANDS = frozenset({"start", "help", "language"})


@dataclass(frozen=True)
class ParsedCommand:
    name: str
    addressed_to: str | None  # bot username given after '@', lower-cased


def parse_command(text: str) -> ParsedCommand | None:
    match = _COMMAND_RE.match(text.lstrip())
    if not match:
        return None
    name = match.group(1).lower()
    if name not in KNOWN_COMMANDS:
        return None
    target = match.group(2).lower() if match.group(2) else None
    return ParsedCommand(name=name, addressed_to=target)
