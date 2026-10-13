"""Assembles the dashboard, diagnostics and downloadable (redacted) report."""

from __future__ import annotations

import platform
import sys
import time
from typing import TYPE_CHECKING, Any

from mediabot import __version__
from mediabot.health.diagnostics import explain
from mediabot.observability.redact import redact

if TYPE_CHECKING:  # pragma: no cover
    from mediabot.app import Runtime

RECENT_WINDOW = 24 * 3600


def resources(rt: Runtime) -> dict[str, Any]:
    result: dict[str, Any] = {"cpu_percent": None, "memory": None, "disk": None, "temp": None}
    try:
        import psutil

        result["cpu_percent"] = rt.cpu.cpu_percent
        mem = psutil.virtual_memory()
        result["memory"] = {"used_mb": int(mem.used / 2**20), "total_mb": int(mem.total / 2**20),
                            "percent": round(mem.percent, 1)}
        disk = psutil.disk_usage(str(rt.config.resolved_data_dir))
        result["disk"] = {"used_gb": round(disk.used / 2**30, 2), "total_gb": round(disk.total / 2**30, 2),
                          "percent": round(disk.percent, 1)}
    except Exception:  # noqa: BLE001 - metrics are optional; report them as unavailable
        pass
    usage = rt.temp.usage_bytes()
    if usage is not None:
        result["temp"] = {"used_mb": round(usage / 2**20, 2), "path": "temporary directory"}
    return result


def recent_problems(rt: Runtime, limit: int = 10) -> list[dict[str, Any]]:
    rows, _ = rt.log_repo.query(
        levels=["WARNING", "ERROR"], since=time.time() - RECENT_WINDOW, limit=limit, offset=0
    )
    return [
        {
            "timestamp": r["ts"],
            "severity": r["level"],
            "component": r["component"],
            "category": r["category"],
            "message": r["message"],
            "explanation": explain(r["category"]).title,
        }
        for r in rows
    ]


def dashboard(rt: Runtime) -> dict[str, Any]:
    from mediabot.health.checks import CheckResult  # noqa: F401 - type reference
    from mediabot.platforms.ytdlp import ytdlp_version

    jobs = rt.jobs.snapshot()
    info = rt.controller.info()
    health = {c["check_id"]: c for c in rt.health.snapshot()}
    telegram = health.get("telegram_api")
    platforms = rt.platforms.records()
    enabled = [p for p in platforms if p.enabled]
    return {
        "app": {
            "version": __version__,
            "uptime_seconds": rt.uptime_seconds(),
            "started_at": rt.started_at,
            "python": sys.version.split()[0],
            "platform": platform.system(),
            "ytdlp_version": ytdlp_version(),
            "persistence_mode": rt.config.persistence_mode,
        },
        "web": {"status": "healthy", "message": "Admin panel is serving requests."},
        "bot": {
            "status": info.status.value,
            "username": info.username,
            "message": info.last_error or ("Polling Telegram." if info.status.value == "running" else None),
            "started_at": info.started_at,
            "last_api_ok_at": info.last_api_ok_at,
        },
        "telegram_api": {
            "status": telegram["status"] if telegram else "unknown",
            "message": telegram["message"] if telegram else "Not checked yet. Run the health checks.",
            "last_successful_test_at": telegram["last_success_at"] if telegram else None,
            "checked_at": telegram["checked_at"] if telegram else None,
        },
        "workers": {
            "status": "healthy" if jobs["running"] and jobs["workers_alive"] >= jobs["workers_configured"] else (
                "failed" if jobs["running"] else "warning"),
            "alive": jobs["workers_alive"],
            "configured": jobs["workers_configured"],
            "completed": jobs["completed"],
            "failed": jobs["failed"],
        },
        "queue": {"queued": jobs["queued"], "limit": jobs["max_queue_length"]},
        "active_downloads": [{"job_id": a["job_id"], "platform": a["platform"], "stage": a["stage"],
                              "running_seconds": a["running_seconds"]} for a in jobs["active"]],
        "platforms": {
            "total": len(platforms),
            "enabled": len(enabled),
            "verified": sum(1 for p in enabled if p.last_test_status == "healthy"),
            "items": [{"key": p.key, "name": p.name, "enabled": p.enabled, "status": p.last_test_status}
                      for p in platforms],
        },
        "resources": resources(rt),
        "recent_errors": recent_problems(rt),
        "generated_at": time.time(),
    }


def diagnostics(rt: Runtime) -> dict[str, Any]:
    checks = rt.health.snapshot()
    failing = [c for c in checks if c["status"] in {"failed", "warning"}]
    issues: dict[str, dict[str, Any]] = {}
    rows, _ = rt.log_repo.query(levels=["WARNING", "ERROR"], since=time.time() - RECENT_WINDOW, limit=500)
    for row in rows:
        entry = issues.setdefault(row["category"], {"category": row["category"], "count": 0,
                                                    "last_seen": row["ts"], "examples": []})
        entry["count"] += 1
        if len(entry["examples"]) < 3:
            entry["examples"].append({"message": row["message"], "timestamp": row["ts"],
                                      "severity": row["level"]})
    issue_list = []
    for item in issues.values():
        exp = explain(item["category"])
        issue_list.append({**item, "title": exp.title, "explanation": exp.explanation,
                           "steps": list(exp.steps), "severity": exp.severity})
    issue_list.sort(key=lambda i: (i["severity"] != "error", -i["count"]))
    check_items = []
    for item in failing:
        exp = explain(_check_category(item["check_id"]))
        check_items.append({**item, "steps": list(exp.steps), "title_hint": exp.title})
    return {"checks_needing_attention": check_items, "recent_issues": issue_list,
            "window_hours": RECENT_WINDOW // 3600}


def _check_category(check_id: str) -> str:
    from mediabot.health.service import _category_for_check

    return _category_for_check(check_id)


def text_report(rt: Runtime) -> str:
    from mediabot.platforms.ytdlp import ytdlp_version

    lines = [
        "MediaDownloaderBot diagnostic report",
        f"generated: {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC",
        f"version: {__version__}",
        f"python: {sys.version.split()[0]} on {platform.system()} {platform.machine()}",
        f"yt-dlp: {ytdlp_version() or 'not installed'}",
        f"uptime_seconds: {rt.uptime_seconds()}",
        f"persistence_mode: {rt.config.persistence_mode}",
        f"bot_status: {rt.controller.info().status.value}",
        "",
        "Checks:",
    ]
    for item in rt.health.snapshot():
        lines.append(f"  [{item['status']}] {item['title']}: {item['message']}")
    lines.append("")
    lines.append("Recent issues (last 24h, by category):")
    summary = diagnostics(rt)
    if not summary["recent_issues"]:
        lines.append("  none")
    for issue in summary["recent_issues"]:
        lines.append(f"  {issue['category']} x{issue['count']}: {issue['title']}")
    lines.append("")
    lines.append("Settings (non-secret):")
    for key, value in rt.settings.values_for_api().items():
        if key == "error_message_overrides":
            value = "<configured>" if value else "<none>"
        lines.append(f"  {key} = {value}")
    lines.append("")
    lines.append("This report contains no tokens, passwords, cookies or user identifiers.")
    return redact("\n".join(lines))
