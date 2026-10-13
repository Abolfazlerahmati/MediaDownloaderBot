"""Keyed hashing and symmetric encryption derived from APP_SECRET_KEY.

* ``user_key`` produces a keyed hash (HMAC-SHA256) of a Telegram user id. The raw id is
  never stored or logged; without the secret the mapping cannot be recomputed.
* ``SecretBox`` encrypts values that must be stored (e.g. the bot token set from the panel).
"""

from __future__ import annotations

import base64
import hashlib
import hmac

from cryptography.fernet import Fernet, InvalidToken


class SecretBox:
    def __init__(self, secret: str) -> None:
        if not secret:
            raise ValueError("secret is required")
        self._secret = secret.encode("utf-8")
        derived = hashlib.sha256(b"mediabot-fernet-v1|" + self._secret).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(derived))
        self._hmac_key = hashlib.sha256(b"mediabot-hmac-v1|" + self._secret).digest()

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except (InvalidToken, UnicodeError) as exc:
            raise ValueError("stored secret cannot be decrypted; APP_SECRET_KEY may have changed") from exc

    def keyed_hash(self, namespace: str, value: str | int) -> str:
        digest = hmac.new(self._hmac_key, f"{namespace}:{value}".encode(), hashlib.sha256)
        return digest.hexdigest()[:40]

    def user_key(self, telegram_user_id: int) -> str:
        return self.keyed_hash("user", telegram_user_id)

    def chat_key(self, chat_id: int) -> str:
        return self.keyed_hash("chat", chat_id)

    def session_hash(self, token: str) -> str:
        return hmac.new(self._hmac_key, b"session:" + token.encode("utf-8"), hashlib.sha256).hexdigest()

