"""Bot control, health, diagnostics, logs, dashboard and system endpoints."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from mediabot.health import report
from mediabot.web.auth import CurrentAdmin, require_api_admin
from mediabot.web.schemas import ConfirmBody, TokenBody

logger = logging.getLogger("mediabot.web.ops")
router = APIRouter(prefix="/api")


def _rt(request: Request):  # type: ignore[no-untyped-def]
    return request.app.state.rt


# ----------------------------------------------------------------------------- dashboard
@router.get("/dashboard")
async def get_dashboard(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    return report.dashboard(_rt(request))


# ----------------------------------------------------------------------------- bot
@router.get("/bot/status")
async def bot_status(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    info = rt.controller.info()
    return {
        "status": info.status.value,
        "username": info.username,
        "last_error": info.last_error,
        "last_error_at": info.last_error_at,
        "started_at": info.started_at,
        "last_api_ok_at": info.last_api_ok_at,
        "token": {
            "configured": rt.tokens.get_token() is not None,
            "source": rt.tokens.source(),
            "masked": rt.tokens.masked(),
            "editable": rt.tokens.source() != "environment",
        },
        "jobs": rt.jobs.snapshot(),
        "enable_bot": rt.config.enable_bot,
        "restart_supervised": rt.config.restart_supervised,
    }


@router.post("/bot/start")
async def bot_start(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    await rt.controller.start()
    return await bot_status(request)


@router.post("/bot/stop")
async def bot_stop(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    await rt.controller.stop()
    logger.info("bot stopped by administrator", extra={"category": "admin_action"})
    return await bot_status(request)


@router.post("/bot/restart")
async def bot_restart(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    await rt.controller.restart()
    logger.info("bot restarted by administrator", extra={"category": "admin_action"})
    return await bot_status(request)


@router.put("/bot/token")
async def set_token(body: TokenBody, request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    if rt.tokens.source() == "environment":
        raise HTTPException(status_code=409, detail="The token is set through BOT_TOKEN. Change the environment variable and restart.")
    try:
        rt.tokens.set_token(body.token)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    logger.info("bot token updated from panel", extra={"category": "admin_action"})
    await rt.controller.restart()
    return await bot_status(request)


@router.delete("/bot/token")
async def clear_token(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    if rt.tokens.source() == "environment":
        raise HTTPException(status_code=409, detail="The token is set through BOT_TOKEN and cannot be removed here.")
    rt.tokens.clear()
    await rt.controller.stop()
    logger.info("bot token removed from panel", extra={"category": "admin_action"})
    return await bot_status(request)


@router.post("/bot/test-api")
async def test_api(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    result = await rt.health.run_one("telegram_api")
    return {"check": result.as_dict()}


@router.get("/bot/jobs")
async def list_jobs(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    return _rt(request).jobs.snapshot()


@router.post("/bot/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    if not job_id.isalnum() or len(job_id) > 32:
        raise HTTPException(status_code=422, detail="Invalid job id.")
    ok = await _rt(request).jobs.cancel(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail="That job is no longer active.")
    return {"ok": True}


# ----------------------------------------------------------------------------- health
@router.get("/health")
async def get_health(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    checks = rt.health.snapshot()
    counts: dict[str, int] = {}
    for c in checks:
        counts[c["status"]] = counts.get(c["status"], 0) + 1
    return {"checks": checks, "counts": counts, "generated_at": time.time()}


@router.post("/health/run")
async def run_health(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    await rt.health.run_all()
    return await get_health(request, _)


@router.post("/health/{check_id}/run")
async def run_one_check(check_id: str, request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    from mediabot.health.checks import CHEAP_CHECKS

    rt = _rt(request)
    if check_id not in CHEAP_CHECKS:
        raise HTTPException(status_code=404, detail="Unknown check.")
    result = await rt.health.run_one(check_id)
    return {"check": result.as_dict()}


# ----------------------------------------------------------------------------- diagnostics
@router.get("/diagnostics")
async def get_diagnostics(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    return report.diagnostics(_rt(request))


@router.get("/diagnostics/report", response_class=PlainTextResponse)
async def download_report(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> PlainTextResponse:
    text = report.text_report(_rt(request))
    return PlainTextResponse(
        text,
        headers={"Content-Disposition": 'attachment; filename="mediabot-diagnostics.txt"',
                 "Cache-Control": "no-store"},
    )


# ----------------------------------------------------------------------------- logs
@router.get("/logs")
async def get_logs(
    request: Request,
    _: CurrentAdmin = Depends(require_api_admin),
    level: str | None = None,
    component: str | None = None,
    category: str | None = None,
    since: float | None = None,
    until: float | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    rt = _rt(request)
    levels = [lv.upper() for lv in level.split(",")] if level else None
    return rt.op_logs.query(levels=levels, component=component, category=category, since=since,
                            until=until, search=q, limit=limit, offset=offset)


@router.delete("/logs")
async def purge_logs(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    removed = rt.log_repo.delete_all()
    logger.info("operational logs cleared by administrator (%d entries)", removed, extra={"category": "admin_action"})
    return {"removed": removed}


# ----------------------------------------------------------------------------- system
@router.post("/system/restart")
async def restart_service(body: ConfirmBody, request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> JSONResponse:
    rt = _rt(request)
    if body.confirm != "RESTART":
        raise HTTPException(status_code=422, detail="Type RESTART to confirm.")
    loop = asyncio.get_running_loop()
    loop.call_later(1.0, rt.request_stop, True)
    logger.warning("service restart requested by administrator", extra={"category": "admin_action"})
    return JSONResponse({
        "accepted": True,
        "supervised": rt.config.restart_supervised,
        "message": ("The service is restarting. The supervisor will bring it back up."
                    if rt.config.restart_supervised else
                    "The service is stopping. Without a supervisor (Docker restart policy or systemd) "
                    "it will not start again automatically; start it manually."),
    })
