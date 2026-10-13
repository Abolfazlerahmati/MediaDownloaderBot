"""Per-user language preference storage.

* ``minimal`` mode: the preference is stored in ``user_preferences`` under a keyed hash
  of the Telegram user id, and expires after the configured retention.
* ``temporary`` mode: the preference lives in memory only and is lost on restart.

Either way, no username, name, chat content or other profile data is stored.
"""

from __future__ import annotations

import threading
from collections import OrderedDict

from mediabot.db.repositories import PreferenceRepo
from mediabot.security.secrets_box import SecretBox

MEMORY_LIMIT = 100_000


class PreferenceStore:
    def __init__(self, mode: str, keyer: SecretBox, repo: PreferenceRepo | None) -> None:
        if mode not in {"minimal", "temporary"}:
            raise ValueError("unknown persistence mode")
        self.mode = mode
        self._keyer = keyer
        self._repo = repo if mode == "minimal" else None
        self._memory: OrderedDict[str, str] = OrderedDict()
        self._lock = threading.Lock()

    @property
    def persistent(self) -> bool:
        return self._repo is not None

    def get(self, telegram_user_id: int | None) -> str | None:
        if telegram_user_id is None:
            return None
        key = self._keyer.user_key(telegram_user_id)
        if self._repo is not None:
            return self._repo.get_language(key)
        with self._lock:
            return self._memory.get(key)

    def set(self, telegram_user_id: int, language: str) -> None:
        key = self._keyer.user_key(telegram_user_id)
        if self._repo is not None:
            self._repo.set_language(key, language)
            return
        with self._lock:
            self._memory[key] = language
            self._memory.move_to_end(key)
            while len(self._memory) > MEMORY_LIMIT:
                self._memory.popitem(last=False)

    def purge_expired(self, retention_days: int, now: float) -> int:
        if self._repo is None:
            return 0
        return self._repo.purge_older_than(now - retention_days * 86400)
