"""Queue, worker tasks, in-flight duplicate protection and cancellation.

Workers are asyncio tasks in the application's event loop. Each job runs in its own
task so it can be cancelled individually (admin action or shutdown), and cancelling a
job kills the download subprocess group via ``process.run_process``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from mediabot.errors import ErrorCode
from mediabot.jobs.models import JobRequest, SubmitResult
from mediabot.jobs.pipeline import DownloadPipeline

logger = logging.getLogger("mediabot.worker")


@dataclass
class ActiveJob:
    job: JobRequest
    task: asyncio.Task
    started_at: float = field(default_factory=time.time)


class JobManager:
    def __init__(self, pipeline: DownloadPipeline, max_queue_length: Callable[[], int]) -> None:
        self._pipeline = pipeline
        self._max_queue = max_queue_length
        self._queue: asyncio.Queue[JobRequest] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []
        self._active: dict[str, ActiveJob] = {}
        self._inflight: set[str] = set()
        self._running = False
        self._configured_workers = 0
        self.completed = 0
        self.failed = 0

    # ----- lifecycle --------------------------------------------------------
    async def start(self, workers: int) -> None:
        if self._running:
            return
        self._running = True
        self._configured_workers = workers
        self._workers = [asyncio.create_task(self._worker(i), name=f"download-worker-{i}") for i in range(workers)]
        logger.info("started %d download workers", workers, extra={"category": "worker_start"})

    async def stop(self, grace_seconds: float = 20.0) -> None:
        if not self._running:
            return
        self._running = False
        deadline = time.monotonic() + grace_seconds
        while (self._active or not self._queue.empty()) and time.monotonic() < deadline:
            await asyncio.sleep(0.2)
        for item in list(self._active.values()):
            item.task.cancel()
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, *[a.task for a in self._active.values()], return_exceptions=True)
        self._workers = []
        self._active.clear()
        logger.info("download workers stopped", extra={"category": "worker_stop"})

    @property
    def running(self) -> bool:
        return self._running

    # ----- submission --------------------------------------------------------
    def submit(self, job: JobRequest) -> str:
        if not self._running:
            return SubmitResult.NOT_RUNNING
        if job.dedupe_key in self._inflight:
            return SubmitResult.DUPLICATE
        if self._queue.qsize() >= self._max_queue():
            return SubmitResult.QUEUE_FULL
        self._inflight.add(job.dedupe_key)
        self._queue.put_nowait(job)
        return SubmitResult.ACCEPTED

    # ----- introspection (no URLs, no user identifiers) -----------------------
    def snapshot(self) -> dict[str, Any]:
        active = [
            {
                "job_id": a.job.job_id,
                "platform": a.job.platform.key,
                "stage": a.job.stage,
                "attempt": a.job.attempt,
                "running_seconds": int(time.time() - a.started_at),
            }
            for a in self._active.values()
        ]
        return {
            "running": self._running,
            "queued": self._queue.qsize(),
            "max_queue_length": self._max_queue(),
            "active_count": len(active),
            "active": active,
            "workers_configured": self._configured_workers,
            "workers_alive": sum(1 for w in self._workers if not w.done()),
            "completed": self.completed,
            "failed": self.failed,
        }

    async def cancel(self, job_id: str) -> bool:
        item = self._active.get(job_id)
        if item is None:
            return False
        item.task.cancel()
        return True

    # ----- workers --------------------------------------------------------------
    async def _worker(self, index: int) -> None:
        while True:
            job = await self._queue.get()
            try:
                await self._run_one(job)
            except asyncio.CancelledError:
                if asyncio.current_task() and asyncio.current_task().cancelling():  # type: ignore[union-attr]
                    raise
            except Exception:
                logger.error("worker %d crashed while handling a job; continuing", index,
                             extra={"category": "worker_crash"}, exc_info=True)
            finally:
                self._inflight.discard(job.dedupe_key)
                self._queue.task_done()

    async def _run_one(self, job: JobRequest) -> None:
        task = asyncio.create_task(self._pipeline.run(job), name=f"job-{job.job_id}")
        self._active[job.job_id] = ActiveJob(job=job, task=task)
        try:
            await task
            self.completed += 1
        except asyncio.CancelledError:
            if task.cancelled() and not (asyncio.current_task() and asyncio.current_task().cancelling()):  # type: ignore[union-attr]
                logger.info("job cancelled by administrator", extra={"category": "job_cancelled"})
                self.failed += 1
                await self._pipeline.notifier.on_error(job, ErrorCode.CANCELLED)
                return
            raise
        finally:
            self._active.pop(job.job_id, None)
