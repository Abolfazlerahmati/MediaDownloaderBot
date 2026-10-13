"""Server-rendered HTML shells. Data is loaded by the page scripts through the JSON API."""

from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from mediabot import __version__
from mediabot.web.api_auth import appearance_for
from mediabot.web.auth import CurrentAdmin, require_page_admin, resolve_admin
from mediabot.web.security import APPEARANCE_COOKIE, CSRF_COOKIE

TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
router = APIRouter()

NAV = [
    ("dashboard", "/", "Dashboard"),
    ("platforms", "/platforms", "Platforms"),
    ("settings", "/settings", "Settings"),
    ("bot", "/bot", "Bot & health"),
    ("diagnostics", "/diagnostics", "Diagnostics"),
    ("logs", "/logs", "Logs"),
    ("account", "/account", "Account"),
]


def _safe_next(value: str | None) -> str:
    if value and re.fullmatch(r"/[A-Za-z0-9/_\-]{0,80}", value) and not value.startswith("//"):
        return value
    return "/"


def _appearance(request: Request, admin_appearance: dict | None = None) -> dict:
    rt = request.app.state.rt
    if admin_appearance is not None:
        return appearance_for(rt, admin_appearance)
    raw = request.cookies.get(APPEARANCE_COOKIE)
    if raw:
        try:
            return appearance_for(rt, json.loads(raw))
        except (ValueError, TypeError):
            pass
    return appearance_for(rt, {})


def _render(request: Request, template: str, *, page: str, title: str,
            admin: CurrentAdmin | None, script: str) -> HTMLResponse:
    appearance = _appearance(request, admin.appearance if admin else None)
    response = TEMPLATES.TemplateResponse(
        request,
        template,
        {
            "page": page,
            "title": title,
            "nav": NAV,
            "admin": admin,
            "script": script,
            "appearance": appearance,
            "version": __version__,
            "persistence_mode": request.app.state.rt.config.persistence_mode,
        },
    )
    if CSRF_COOKIE not in request.cookies:
        import secrets

        response.set_cookie(CSRF_COOKIE, secrets.token_urlsafe(24), httponly=False,
                            samesite="strict", secure=request.app.state.rt.config.admin_cookie_secure, path="/")
    return response


@router.get("/login", response_class=HTMLResponse, response_model=None)
async def login_page(request: Request, next: str | None = None) -> HTMLResponse | RedirectResponse:
    if resolve_admin(request) is not None:
        return RedirectResponse(_safe_next(next), status_code=303)
    return _render(request, "login.html", page="login", title="Sign in", admin=None, script="login")


@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, admin: CurrentAdmin = Depends(require_page_admin)) -> HTMLResponse:
    return _render(request, "shell.html", page="dashboard", title="Dashboard", admin=admin, script="dashboard")


@router.get("/platforms", response_class=HTMLResponse)
async def platforms(request: Request, admin: CurrentAdmin = Depends(require_page_admin)) -> HTMLResponse:
    return _render(request, "shell.html", page="platforms", title="Platforms", admin=admin, script="platforms")


@router.get("/platforms/new", response_class=HTMLResponse)
async def platform_new(request: Request, admin: CurrentAdmin = Depends(require_page_admin)) -> HTMLResponse:
    return _render(request, "shell.html", page="platforms", title="New platform", admin=admin, script="platform-edit")


@router.get("/platforms/{key}", response_class=HTMLResponse)
async def platform_edit(key: str, request: Request, admin: CurrentAdmin = Depends(require_page_admin)) -> HTMLResponse:
    return _render(request, "shell.html", page="platforms", title="Edit platform", admin=admin, script="platform-edit")


@router.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request, admin: CurrentAdmin = Depends(require_page_admin)) -> HTMLResponse:
    return _render(request, "shell.html", page="settings", title="Settings", admin=admin, script="settings")


@router.get("/bot", response_class=HTMLResponse)
async def bot_page(request: Request, admin: CurrentAdmin = Depends(require_page_admin)) -> HTMLResponse:
    return _render(request, "shell.html", page="bot", title="Bot & health", admin=admin, script="bot")


@router.get("/diagnostics", response_class=HTMLResponse)
async def diagnostics_page(request: Request, admin: CurrentAdmin = Depends(require_page_admin)) -> HTMLResponse:
    return _render(request, "shell.html", page="diagnostics", title="Diagnostics", admin=admin, script="diagnostics")


@router.get("/logs", response_class=HTMLResponse)
async def logs_page(request: Request, admin: CurrentAdmin = Depends(require_page_admin)) -> HTMLResponse:
    return _render(request, "shell.html", page="logs", title="Logs", admin=admin, script="logs")


@router.get("/account", response_class=HTMLResponse)
async def account_page(request: Request, admin: CurrentAdmin = Depends(require_page_admin)) -> HTMLResponse:
    return _render(request, "shell.html", page="account", title="Account", admin=admin, script="account")
