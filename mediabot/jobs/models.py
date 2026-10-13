"""Job data structures. A job lives only in memory for the duration of processing."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field

from mediabot.db.repositories import PlatformRecord


@dataclass
class JobRequest:
    chat_id: int
    reply_to_message_id: int
    chat_type: str
    url: str
    url_key: str
    platform: PlatformRecord
    language: str
    dedupe_key: str
    job_id: str = field(default_factory=lambda: secrets.token_hex(6))
    status_message_id: int | None = None
    created_at: float = field(default_factory=time.time)
    stage: str = "queued"
    attempt: int = 0
    started_at: float | None = None


class SubmitResult:
    ACCEPTED = "accepted"
    DUPLICATE = "duplicate"
    QUEUE_FULL = "queue_full"
    NOT_RUNNING = "not_running"
