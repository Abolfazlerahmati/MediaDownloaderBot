"""Web security controls: security headers, CSRF (double-submit + Origin check),
login throttling and cookie helpers."""

from __future__ import annotations

import hmac
import threading
import time
from collections import defaultdict, deque
from urllib.parse import urlsplit

from starlette.requests import Request
from starlette.responses import Response

SESSION_COOKIE = "mb_session"
CSRF_COOKIE = "mb_csrf"
APPEARANCE_COOKIE = "mb_appearance"
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'"
)


def apply_security_headers(request: Request, response: Response) -> None:
    headers = response.headers
    headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    headers["X-Content-Type-Options"] = "nosniff"
    headers["X-Frame-Options"] = "DENY"
    headers["Referrer-Policy"] = "no-referrer"
    headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    headers["Cross-Origin-Opener-Policy"] = "same-origin"
    if request.url.path.startswith("/api/") or request.url.path in {"/login"}:
        headers["Cache-Control"] = "no-store"


def origin_matches_host(request: Request) -> bool:
    origin = request.headers.get("origin")
    if origin is None:
        return True  # non-browser clients; CSRF token is still required below
    host = request.headers.get("host", "")
    try:
        parts = urlsplit(origin)
    except ValueError:
        return False
    return bool(parts.netloc) and parts.netloc.lower() == host.lower()


def csrf_ok(request: Request) -> bool:
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get("x-csrf-token", "")
    return bool(cookie) and len(cookie) >= 20 and hmac.compare_digest(cookie, header)


def set_session_cookies(response: Response, token: str, csrf: str, *, secure: bool, max_age: int) -> None:
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=secure,
                        samesite="strict", path="/")
    response.set_cookie(CSRF_COOKIE, csrf, max_age=max_age, httponly=False, secure=secure,
                        samesite="strict", path="/")


def clear_session_cookies(response: Response, *, secure: bool) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=secure, httponly=True, samesite="strict")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=secure, httponly=False, samesite="strict")


class LoginThrottle:
    """Sliding-window throttle for failed logins, per client address and per username.

    Kept in memory (single process). Restarting the service resets the counters.
    """

    def __init__(self, max_failures: int = 5, window_seconds: float = 900.0, clock=time.monotonic) -> None:  # type: ignore[no-untyped-def]
        self._max = max_failures
        self._window = window_seconds
        self._clock = clock
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        bucket = self._failures[key]
        while bucket and now - bucket[0] > self._window:
            bucket.popleft()
        return bucket

    def blocked_for(self, keys: list[str]) -> float:
        """Seconds until the next attempt is allowed (0 when allowed)."""
        now = self._clock()
        with self._lock:
            worst = 0.0
            for key in keys:
                bucket = self._prune(key, now)
                if len(bucket) >= self._max:
                    worst = max(worst, self._window - (now - bucket[0]))
            return worst

    def record_failure(self, keys: list[str]) -> None:
        now = self._clock()
        with self._lock:
            for key in keys:
                self._prune(key, now).append(now)

    def reset(self, keys: list[str]) -> None:
        with self._lock:
            for key in keys:
                self._failures.pop(key, None)
