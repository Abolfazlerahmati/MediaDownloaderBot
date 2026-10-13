"""Bot token resolution.

Precedence: ``BOT_TOKEN`` environment variable (read-only in the panel), then a token saved
from the admin panel, stored encrypted with a key derived from APP_SECRET_KEY.
"""

from __future__ import annotations

import re
from typing import Literal

from mediabot.db.repositories import SettingsRepo
from mediabot.security.secrets_box import SecretBox

TOKEN_RE = re.compile(r"^\d{5,12}:[A-Za-z0-9_-]{25,}$")
STORED_KEY = "bot_token_encrypted"
TokenSource = Literal["environment", "panel", "none"]


class BotTokenStore:
    def __init__(self, repo: SettingsRepo, env_token: str | None, box: SecretBox) -> None:
        self._repo = repo
        self._env = env_token
        self._box = box
        self._cache: str | None = None
        self._cache_loaded = False

    def source(self) -> TokenSource:
        if self._env:
            return "environment"
        if self._repo.get(STORED_KEY):
            return "panel"
        return "none"

    def get_token(self) -> str | None:
        if self._env:
            return self._env
        if not self._cache_loaded:
            encrypted = self._repo.get(STORED_KEY)
            try:
                self._cache = self._box.decrypt(encrypted) if encrypted else None
            except ValueError:
                self._cache = None
            self._cache_loaded = True
        return self._cache

    def masked(self) -> str | None:
        token = self.get_token()
        if not token:
            return None
        return f"{token[:4]}••••••••{token[-4:]}"

    def set_token(self, token: str) -> None:
        token = token.strip()
        if not TOKEN_RE.match(token):
            raise ValueError("The token format is invalid. Copy it exactly from @BotFather.")
        self._repo.set(STORED_KEY, self._box.encrypt(token))
        self._cache = token
        self._cache_loaded = True

    def clear(self) -> None:
        self._repo.delete(STORED_KEY)
        self._cache = None
        self._cache_loaded = True
