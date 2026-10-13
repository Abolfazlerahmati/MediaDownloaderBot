"""Authentication dependencies for API routes and HTML pages."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Request

from mediabot.web.security import SESSION_COOKIE


@dataclass(frozen=True)
class CurrentAdmin:
    id: int
    username: str
    session_hash: str
    appearance: dict


class PageRedirect(Exception):
    def __init__(self, location: str) -> None:
        super().__init__(location)
        self.location = location


def _runtime(request: Request):  # type: ignore[no-untyped-def]
    return request.app.state.rt


def resolve_admin(request: Request) -> CurrentAdmin | None:
    rt = _runtime(request)
    token = request.cookies.get(SESSION_COOKIE)
    if not token or len(token) > 200:
        return None
    token_hash = rt.secret_box.session_hash(token)
    row = rt.sessions.get_valid(token_hash)
    if row is None or not row["is_active"]:
        return None
    admin = rt.admins.get_by_id(row["admin_id"])
    if admin is None:
        return None
    return CurrentAdmin(id=admin.id, username=admin.username, session_hash=token_hash,
                        appearance=admin.appearance)


def require_api_admin(request: Request) -> CurrentAdmin:
    admin = resolve_admin(request)
    if admin is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    request.state.admin = admin
    return admin


def require_page_admin(request: Request) -> CurrentAdmin:
    admin = resolve_admin(request)
    if admin is None:
        target = request.url.path
        raise PageRedirect(f"/login?next={target}" if target not in {"/", "/login"} else "/login")
    request.state.admin = admin
    return admin
