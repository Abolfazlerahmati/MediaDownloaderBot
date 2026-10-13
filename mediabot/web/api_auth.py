"""Login, logout, session and account endpoints."""

from __future__ import annotations

import json
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from mediabot.security.passwords import hash_password, password_problem, verify_password
from mediabot.web.auth import CurrentAdmin, require_api_admin
from mediabot.web.schemas import AppearanceBody, LoginBody, PasswordBody
from mediabot.web.security import (
    APPEARANCE_COOKIE,
    LoginThrottle,
    clear_session_cookies,
    set_session_cookies,
)

logger = logging.getLogger("mediabot.web.auth")
router = APIRouter(prefix="/api")
APPEARANCE_DEFAULT = {"theme": "merchant", "mode": "system"}


def _client_key(request: Request) -> str:
    return "ip:" + (request.client.host if request.client else "unknown")


def _secure(request: Request) -> bool:
    return request.app.state.rt.config.admin_cookie_secure


def appearance_for(rt, admin_appearance: dict) -> dict:  # type: ignore[no-untyped-def]
    value = {**APPEARANCE_DEFAULT, **admin_appearance}
    if value.get("theme") not in {"merchant", "ios"} or value.get("mode") not in {"light", "dark", "system"}:
        return dict(APPEARANCE_DEFAULT)
    return {"theme": value["theme"], "mode": value["mode"]}


@router.post("/auth/login")
async def login(body: LoginBody, request: Request) -> JSONResponse:
    rt = request.app.state.rt
    throttle: LoginThrottle = request.app.state.login_throttle
    username = body.username.strip().lower()
    keys = [_client_key(request), f"user:{username}"]
    wait = throttle.blocked_for(keys)
    if wait > 0:
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.",
                            headers={"Retry-After": str(int(wait) + 1)})
    admin = rt.admins.get_by_username(username)
    ok = admin is not None and admin.is_active and verify_password(admin.password_hash, body.password)
    if not ok:
        throttle.record_failure(keys)
        logger.warning("failed admin login", extra={"category": "auth_failed"})
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    throttle.reset(keys)
    old_token = request.cookies.get("mb_session")
    if old_token:
        rt.sessions.delete(rt.secret_box.session_hash(old_token))
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    ttl = rt.config.session_ttl_hours * 3600
    rt.sessions.create(rt.secret_box.session_hash(token), admin.id, csrf, ttl)
    rt.admins.touch_login(admin.id)
    appearance = appearance_for(rt, admin.appearance)
    response = JSONResponse({"username": admin.username, "appearance": appearance})
    set_session_cookies(response, token, csrf, secure=_secure(request), max_age=ttl)
    response.set_cookie(APPEARANCE_COOKIE, json.dumps(appearance), max_age=365 * 86400, samesite="strict",
                        secure=_secure(request), httponly=False, path="/")
    logger.info("admin signed in", extra={"category": "auth"})
    return response


@router.post("/auth/logout")
async def logout(request: Request) -> JSONResponse:
    rt = request.app.state.rt
    token = request.cookies.get("mb_session")
    if token:
        rt.sessions.delete(rt.secret_box.session_hash(token))
    response = JSONResponse({"ok": True})
    clear_session_cookies(response, secure=_secure(request))
    return response


@router.get("/auth/me")
async def me(request: Request, admin: CurrentAdmin = Depends(require_api_admin)) -> dict:
    rt = request.app.state.rt
    return {"username": admin.username, "appearance": appearance_for(rt, admin.appearance)}


@router.post("/auth/password")
async def change_password(body: PasswordBody, request: Request,
                          admin: CurrentAdmin = Depends(require_api_admin)) -> dict:
    rt = request.app.state.rt
    record = rt.admins.get_by_id(admin.id)
    if record is None or not verify_password(record.password_hash, body.current_password):
        raise HTTPException(status_code=400, detail="The current password is incorrect.")
    problem = password_problem(body.new_password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    rt.admins.update_password(admin.id, hash_password(body.new_password))
    rt.sessions.delete_for_admin(admin.id, keep_hash=admin.session_hash)
    return {"ok": True, "message": "Password changed. Other sessions were signed out."}


@router.put("/account/appearance")
async def set_appearance(body: AppearanceBody, request: Request,
                         admin: CurrentAdmin = Depends(require_api_admin)) -> JSONResponse:
    rt = request.app.state.rt
    value = {"theme": body.theme, "mode": body.mode}
    rt.admins.update_appearance(admin.id, value)
    response = JSONResponse({"appearance": value})
    response.set_cookie(APPEARANCE_COOKIE, json.dumps(value), max_age=365 * 86400, samesite="strict",
                        secure=_secure(request), httponly=False, path="/")
    return response
