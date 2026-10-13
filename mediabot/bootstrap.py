"""First-run bootstrap: a default administrator so a fresh installation can be signed in to.

The account is created only when there are no administrators at all. Its password is known to anyone who
reads this file, so the server forces a password change at the first sign-in (see web/auth.py).
"""

from __future__ import annotations

from collections.abc import Callable

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "12345678"


class _AdminStore:  # pragma: no cover - typing helper only
    def count(self) -> int: ...
    def create(self, username: str, password_hash: str, *, must_change: bool = False) -> int: ...


def ensure_default_admin(admins: _AdminStore, *, enabled: bool, hash_password: Callable[[str], str]) -> bool:
    """Create the default administrator if none exists. Returns True when it was created."""
    if not enabled or admins.count() > 0:
        return False
    admins.create(DEFAULT_ADMIN_USERNAME, hash_password(DEFAULT_ADMIN_PASSWORD), must_change=True)
    return True
