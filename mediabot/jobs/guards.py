"""In-memory guards: duplicate suppression and sliding-window rate limits.

Nothing here is persisted. Keys are keyed hashes (see SecretBox), never raw user ids.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable


class TTLCache:
    """Remembers keys for ``ttl`` seconds. Bounded by ``maxsize`` (oldest evicted first)."""

    def __init__(self, maxsize: int = 50_000, clock: Callable[[], float] = time.monotonic) -> None:
        self._data: OrderedDict[str, float] = OrderedDict()
        self._maxsize = maxsize
        self._clock = clock
        self._lock = threading.Lock()

    def seen_or_add(self, key: str, ttl: float) -> bool:
        """Return True if ``key`` was already recorded within ``ttl``; otherwise record it."""
        now = self._clock()
        with self._lock:
            expiry = self._data.get(key)
            if expiry is not None and expiry > now:
                return True
            self._data[key] = now + ttl
            self._data.move_to_end(key)
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)
            return False

    def purge_expired(self) -> None:
        now = self._clock()
        with self._lock:
            for key in [k for k, exp in self._data.items() if exp <= now]:
                del self._data[key]

    def __len__(self) -> int:
        return len(self._data)


class SlidingWindowLimiter:
    def __init__(self, maxsize: int = 100_000, clock: Callable[[], float] = time.monotonic) -> None:
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._maxsize = maxsize
        self._clock = clock
        self._lock = threading.Lock()

    def try_acquire(self, checks: list[tuple[str, int]], window_seconds: float = 60.0) -> bool:
        """Atomically record one hit for every key if none of them is over its limit."""
        now = self._clock()
        with self._lock:
            windows: list[deque[float]] = []
            for key, limit in checks:
                bucket = self._hits.get(key)
                if bucket is None:
                    bucket = deque()
                    self._hits[key] = bucket
                self._hits.move_to_end(key)
                while bucket and now - bucket[0] > window_seconds:
                    bucket.popleft()
                if len(bucket) >= limit:
                    return False
                windows.append(bucket)
            for bucket in windows:
                bucket.append(now)
            while len(self._hits) > self._maxsize:
                self._hits.popitem(last=False)
            return True

    def purge_idle(self, window_seconds: float = 60.0) -> None:
        now = self._clock()
        with self._lock:
            for key in list(self._hits):
                bucket = self._hits[key]
                while bucket and now - bucket[0] > window_seconds:
                    bucket.popleft()
                if not bucket:
                    del self._hits[key]
