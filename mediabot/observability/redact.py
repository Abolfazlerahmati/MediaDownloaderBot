"""Redaction helpers: strip tokens, secrets, credentials and sensitive URL parts.

Used on every string that leaves the process (logs, diagnostics, API responses).
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from urllib.parse import urlsplit, urlunsplit

# Telegram bot token: <numeric id>:<35-char secret>
_TOKEN_RE = re.compile(r"\b\d{5,12}:[A-Za-z0-9_-]{25,}\b")
# Telegram API URLs embed the token in the path: /bot<token>/method
_BOT_PATH_RE = re.compile(r"/bot\d{5,12}:[A-Za-z0-9_-]+")
_URL_RE = re.compile(r"https?://[^\s'\"<>]+", re.IGNORECASE)
_KV_SECRET_RE = re.compile(
    r"(?i)\b(password|passwd|secret|token|api[_-]?key|session|cookie|authorization|csrf)"
    r"(\s*[=:]\s*)([^\s,;&'\"]+)"
)
_IPV4_LOCAL_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
REDACTED = "[redacted]"


def redact_url(url: str) -> str:
    """Keep scheme, host and path; drop userinfo, query string and fragment."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return REDACTED
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    path = _BOT_PATH_RE.sub("/bot" + REDACTED, parts.path)
    return urlunsplit((parts.scheme, host, path, "", ""))


def redact(text: str | None, secrets: Iterable[str] = ()) -> str:
    """Return ``text`` with secrets and sensitive URL components removed."""
    if not text:
        return ""
    out = str(text)
    for secret in secrets:
        if secret and len(secret) >= 6:
            out = out.replace(secret, REDACTED)
    out = _URL_RE.sub(lambda m: redact_url(m.group(0)), out)
    out = _TOKEN_RE.sub(REDACTED, out)
    out = _KV_SECRET_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{REDACTED}", out)
    return out


def short_hash(value: str, length: int = 10) -> str:
    """Stable, non-reversible correlation id for URLs / keys in logs."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]
