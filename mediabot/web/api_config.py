"""Settings and platform configuration endpoints."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from mediabot.db.repositories import PlatformRecord
from mediabot.errors import UnsafeDestinationError
from mediabot.platforms.registry import adapter_catalog, adapter_class
from mediabot.platforms.service import domain_matches
from mediabot.platforms.validation import (
    FieldErrors,
    validate_platform,
)
from mediabot.security.ssrf import split_and_validate_syntax
from mediabot.services.settings import SettingsValidationError, settings_schema
from mediabot.urls.detect import extract_candidates
from mediabot.web.auth import CurrentAdmin, require_api_admin
from mediabot.web.schemas import EnableBody, SettingsBody, UrlCheckBody

logger = logging.getLogger("mediabot.web.config")
router = APIRouter(prefix="/api")


def _rt(request: Request):  # type: ignore[no-untyped-def]
    return request.app.state.rt


# ----------------------------------------------------------------------------- settings
@router.get("/settings")
async def get_settings(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    return {
        "values": rt.settings.values_for_api(),
        "schema": settings_schema(),
        "pending_restart": rt.settings.pending_restart(),
        "persistence_mode": rt.config.persistence_mode,
        "languages": [
            {"code": code, "name": rt.translator.native_name(code)} for code in rt.translator.supported()
        ],
        "webhook_supported": False,
    }


@router.put("/settings")
async def put_settings(body: SettingsBody, request: Request, admin: CurrentAdmin = Depends(require_api_admin)) -> dict:
    rt = _rt(request)
    try:
        changed, pending = rt.settings.update(body.changes)
    except SettingsValidationError as exc:
        raise HTTPException(status_code=422, detail={"message": "Some values are invalid.", "fields": exc.errors})
    if changed:
        logger.info("settings updated: %s", ", ".join(sorted(changed)), extra={"category": "admin_action"})
    return {"changed": changed, "pending_restart": pending, "values": rt.settings.values_for_api()}


# ----------------------------------------------------------------------------- platforms
def _record_view(rt, record: PlatformRecord) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    cls = adapter_class(record.adapter)
    status = record.last_test_status
    if record.enabled and status != "healthy":
        status = "enabled_unverified"
    return {
        "key": record.key,
        "name": record.name,
        "adapter": record.adapter,
        "adapter_name": cls.display_name if cls else record.adapter,
        "enabled": record.enabled,
        "domains": record.domains,
        "url_patterns": record.url_patterns,
        "allowed_media_types": record.allowed_media_types,
        "max_file_size_mb": record.max_file_size_mb,
        "max_duration_seconds": record.max_duration_seconds,
        "max_height": record.max_height,
        "format_selector": record.format_selector,
        "thumbnails_enabled": record.thumbnails_enabled,
        "options": record.options,
        "test_url": record.test_url,
        "last_test_status": record.last_test_status,
        "last_test_message": record.last_test_message,
        "last_test_at": record.last_test_at,
        "integration_status": status,
        "updated_at": record.updated_at,
    }


def _field_error(exc: FieldErrors) -> HTTPException:
    return HTTPException(status_code=422, detail={"message": "Please correct the highlighted fields.", "fields": exc.errors})


@router.get("/platforms/catalog")
async def platform_catalog(_: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    return {"adapters": adapter_catalog(), "media_types": ["video", "audio", "image"]}


@router.get("/platforms")
async def list_platforms(request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    return {"items": [_record_view(rt, r) for r in rt.platform_repo.list_all()]}


@router.get("/platforms/{key}")
async def get_platform(key: str, request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    record = rt.platform_repo.get(key)
    if record is None:
        raise HTTPException(status_code=404, detail="Platform not found.")
    return _record_view(rt, record)


@router.post("/platforms", status_code=201)
async def create_platform(payload: dict[str, Any], request: Request,
                          admin: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    existing = {r.key for r in rt.platform_repo.list_all()}
    try:
        values = validate_platform(payload, creating=True, existing_keys=existing)
    except FieldErrors as exc:
        raise _field_error(exc)
    values["enabled"] = False
    rt.platform_repo.create(values)
    logger.info("platform created: %s", values["key"], extra={"category": "admin_action"})
    return _record_view(rt, rt.platform_repo.get(values["key"]))  # type: ignore[arg-type]


@router.put("/platforms/{key}")
async def update_platform(key: str, payload: dict[str, Any], request: Request,
                          admin: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    record = rt.platform_repo.get(key)
    if record is None:
        raise HTTPException(status_code=404, detail="Platform not found.")
    try:
        values = validate_platform(payload, creating=False, existing_key=key)
    except FieldErrors as exc:
        raise _field_error(exc)
    comparable = {
        "name": record.name, "adapter": record.adapter, "domains": record.domains,
        "url_patterns": record.url_patterns, "allowed_media_types": record.allowed_media_types,
        "max_file_size_mb": record.max_file_size_mb, "max_duration_seconds": record.max_duration_seconds,
        "max_height": record.max_height, "format_selector": record.format_selector,
        "thumbnails_enabled": record.thumbnails_enabled, "options": record.options,
        "test_url": record.test_url,
    }
    changed = any(values.get(k) != v for k, v in comparable.items())
    values.pop("key", None)
    if changed:
        # Any configuration change invalidates the previous live test and disables the platform.
        values["enabled"] = False
    rt.platform_repo.update(key, values, reset_test=changed)
    if changed:
        logger.info("platform configuration changed (disabled until retested): %s", key,
                    extra={"category": "admin_action"})
    return _record_view(rt, rt.platform_repo.get(key))  # type: ignore[arg-type]


@router.delete("/platforms/{key}")
async def delete_platform(key: str, request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict:
    rt = _rt(request)
    if rt.platform_repo.get(key) is None:
        raise HTTPException(status_code=404, detail="Platform not found.")
    rt.platform_repo.delete(key)
    logger.info("platform removed: %s", key, extra={"category": "admin_action"})
    return {"ok": True}


@router.post("/platforms/{key}/enable")
async def set_platform_enabled(key: str, body: EnableBody, request: Request,
                               _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    record = rt.platform_repo.get(key)
    if record is None:
        raise HTTPException(status_code=404, detail="Platform not found.")
    if body.enabled and record.last_test_status != "healthy":
        raise HTTPException(status_code=409,
                            detail="Run a successful live test before enabling this platform.")
    rt.platform_repo.set_enabled(key, body.enabled)
    logger.info("platform %s: %s", "enabled" if body.enabled else "disabled", key, extra={"category": "admin_action"})
    return _record_view(rt, rt.platform_repo.get(key))  # type: ignore[arg-type]


@router.post("/platforms/{key}/test")
async def test_platform(key: str, request: Request, _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    rt = _rt(request)
    try:
        result = await rt.health.test_platform(key)
    except KeyError:
        raise HTTPException(status_code=404, detail="Platform not found.")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    record = rt.platform_repo.get(key)
    return {"result": result, "platform": _record_view(rt, record) if record else None}  # type: ignore[arg-type]


@router.post("/platforms/{key}/check-url")
async def check_url(key: str, body: UrlCheckBody, request: Request,
                    _: CurrentAdmin = Depends(require_api_admin)) -> dict[str, Any]:
    """Explain how a URL is classified by this platform's configuration (no network access)."""
    rt = _rt(request)
    record = rt.platform_repo.get(key)
    if record is None:
        raise HTTPException(status_code=404, detail="Platform not found.")
    candidates = extract_candidates(body.url)
    if not candidates:
        return {"recognized": False, "reason": "No URL found in the text."}
    raw = candidates[0]
    try:
        split = split_and_validate_syntax(raw)
    except UnsafeDestinationError as exc:
        return {"recognized": False, "reason": f"Rejected: {exc.detail}."}
    if not domain_matches(split.host, record.domains):
        return {"recognized": False, "reason": f"'{split.host}' is not one of this platform's domains."}
    cls = adapter_class(record.adapter)
    canonical = cls.canonicalize(split, record) if cls else None
    if canonical is None:
        return {"recognized": False, "reason": "The URL path is not a supported shape for this adapter."}
    import re

    for pattern in record.url_patterns:
        try:
            if not re.search(pattern, canonical):
                return {"recognized": False, "reason": f"Does not match URL pattern {pattern!r}.",
                        "canonical": canonical}
        except re.error:
            return {"recognized": False, "reason": "A configured URL pattern is invalid."}
    return {"recognized": True, "canonical": canonical, "enabled": record.enabled,
            "reason": "Would be processed" + ("" if record.enabled else " once the platform is enabled.")}
