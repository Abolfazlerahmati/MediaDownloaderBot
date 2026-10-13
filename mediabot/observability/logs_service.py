"""Operational log access for the panel and retention enforcement."""

from __future__ import annotations

import json
import time
from typing import Any

from mediabot.db.repositories import LogRepo
from mediabot.observability.redact import redact

LEVEL_RANK = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40}


class OperationalLogs:
    def __init__(self, repo: LogRepo) -> None:
        self._repo = repo

    def write(self, entry: dict[str, Any]) -> None:
        """Store one entry. Every free-text field is redacted here, not only at the logging
        handler, so no caller can persist a secret by bypassing the handler."""
        clean = dict(entry)
        for key in ("message", "component", "category"):
            if isinstance(clean.get(key), str):
                clean[key] = redact(clean[key])
        if clean.get("details") is not None:
            clean["details"] = json.loads(redact(json.dumps(clean["details"], default=str)))
        self._repo.insert(clean)

    def query(self, *, levels: list[str] | None, component: str | None, category: str | None,
              since: float | None, until: float | None, search: str | None,
              limit: int, offset: int) -> dict[str, Any]:
        rows, total = self._repo.query(
            levels=[lv for lv in (levels or []) if lv in LEVEL_RANK] or None,
            component=component or None,
            category=category or None,
            since=since,
            until=until,
            search=(search or "")[:120] or None,
            limit=min(max(limit, 1), 500),
            offset=max(offset, 0),
        )
        items = []
        for row in rows:
            details = json.loads(row["details"]) if row["details"] else None
            items.append({
                "id": row["id"],
                "timestamp": row["ts"],
                "severity": row["level"],
                "component": row["component"],
                "category": row["category"],
                "message": row["message"],
                "details": details,
            })
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    def enforce_retention(self, retention_days: int, max_rows: int) -> dict[str, int]:
        cutoff = time.time() - retention_days * 86400
        removed_age = self._repo.purge_older_than(cutoff)
        self._repo.trim_to(max_rows)
        return {"removed_by_age": removed_age}
