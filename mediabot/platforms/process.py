"""Isolated subprocess execution with timeouts, output caps and resource limits.

Commands are always passed as argument lists (never through a shell). The child runs
in its own session so the whole process group can be killed on timeout or cancel.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("mediabot.platform.process")

MAX_STDOUT_BYTES = 64 * 1024 * 1024
MAX_STDERR_BYTES = 256 * 1024


@dataclass(frozen=True)
class ProcessResult:
    returncode: int | None
    stdout: bytes
    stderr: str
    timed_out: bool


def _limits_preexec(memory_limit_mb: int):  # pragma: no cover - runs in child process
    def apply() -> None:
        try:
            import resource

            if memory_limit_mb > 0:
                limit = memory_limit_mb * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        except (ImportError, ValueError, OSError):
            pass

    return apply


def minimal_environment(home: Path) -> dict[str, str]:
    """Environment for child processes. Deliberately excludes bot and app secrets."""
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONIOENCODING": "utf-8",
        "HOME": str(home),
        "TMPDIR": str(home),
    }
    return env


async def _drain(stream: asyncio.StreamReader | None, cap: int) -> bytes:
    if stream is None:
        return b""
    buffer = bytearray()
    while True:
        chunk = await stream.read(65536)
        if not chunk:
            break
        if len(buffer) < cap:
            buffer.extend(chunk[: cap - len(buffer)])
    return bytes(buffer)


def _kill_group(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    try:
        if sys.platform != "win32":
            os.killpg(process.pid, signal.SIGKILL)
        else:  # pragma: no cover
            process.kill()
    except (ProcessLookupError, PermissionError):
        pass


async def run_process(
    argv: list[str],
    *,
    timeout: float,
    cwd: Path,
    env: Mapping[str, str],
    memory_limit_mb: int = 0,
) -> ProcessResult:
    preexec = _limits_preexec(memory_limit_mb) if os.name == "posix" else None
    process = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(cwd),
        env=dict(env),
        start_new_session=True,
        preexec_fn=preexec,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            asyncio.gather(
                _drain(process.stdout, MAX_STDOUT_BYTES),
                _drain(process.stderr, MAX_STDERR_BYTES),
            ),
            timeout=timeout,
        )
        await process.wait()
        return ProcessResult(
            returncode=process.returncode,
            stdout=stdout,
            stderr=stderr.decode("utf-8", errors="replace"),
            timed_out=False,
        )
    except TimeoutError:
        _kill_group(process)
        await process.wait()
        return ProcessResult(returncode=None, stdout=b"", stderr="", timed_out=True)
    except asyncio.CancelledError:
        _kill_group(process)
        await process.wait()
        raise
    finally:
        _kill_group(process)
