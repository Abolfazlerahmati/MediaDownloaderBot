"""FastAPI application factory for the admin panel."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from mediabot.web import api_auth, api_config, api_ops, pages
from mediabot.web.auth import PageRedirect
from mediabot.web.security import (
    UNSAFE_METHODS,
    LoginThrottle,
    apply_security_headers,
    csrf_ok,
    origin_matches_host,
)

if TYPE_CHECKING:  # pragma: no cover
    from mediabot.app import Runtime

STATIC_DIR = Path(__file__).parent / "static"


def create_web_app(rt: Runtime) -> FastAPI:
    app = FastAPI(title="MediaDownloaderBot admin", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.rt = rt
    app.state.login_throttle = LoginThrottle(max_failures=5, window_seconds=900)

    @app.middleware("http")
    async def protect(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.method in UNSAFE_METHODS:
            if not origin_matches_host(request) or not csrf_ok(request):
                response = JSONResponse({"detail": "Your session form expired. Reload the page and try again."},
                                        status_code=403)
                apply_security_headers(request, response)
                return response
        response = await call_next(request)
        apply_security_headers(request, response)
        return response

    @app.exception_handler(PageRedirect)
    async def page_redirect(request: Request, exc: PageRedirect) -> RedirectResponse:
        return RedirectResponse(exc.location, status_code=303)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if request.url.path.startswith("/api/"):
            payload: dict = {"detail": exc.detail}
            return JSONResponse(payload, status_code=exc.status_code, headers=exc.headers)
        if exc.status_code == 404:
            from fastapi.responses import HTMLResponse

            return HTMLResponse("<h1>Not found</h1>", status_code=404)
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = {}
        for err in exc.errors():
            loc = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
            fields[".".join(loc) or "request"] = "Invalid value."
        return JSONResponse({"detail": {"message": "Invalid request.", "fields": fields}}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        import logging

        logging.getLogger("mediabot.web").error("unhandled web error: %s", exc.__class__.__name__,
                                                extra={"category": "web_error"}, exc_info=False)
        return JSONResponse({"detail": "Unexpected server error. See the logs."}, status_code=500)

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    app.include_router(api_auth.router)
    app.include_router(api_config.router)
    app.include_router(api_ops.router)
    app.include_router(pages.router)
    return app
