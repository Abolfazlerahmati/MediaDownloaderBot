"""Job-scoped temporary storage with automatic cleanup.

Every job gets its own directory under ``<temp>/jobs/<job id>``. The directory is removed
when the job ends (success or failure) and leftovers are swept after the configured
retention. Internal filenames never leak to users - see ``media.filenames``.
"""

from __future__ import annotations

import logging
import os
import secrets
import shutil
import time
from pathlib import Path

logger = logging.getLogger("mediabot.storage.temp")


class TempStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.jobs_dir = root / "jobs"

    def ensure(self) -> None:
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)
        os.chmod(self.jobs_dir, 0o700)

    def new_job_dir(self) -> Path:
        path = self.jobs_dir / secrets.token_hex(12)
        path.mkdir(mode=0o700, parents=True, exist_ok=False)
        return path

    def remove(self, path: Path) -> None:
        try:
            shutil.rmtree(path)
        except FileNotFoundError:
            pass
        except OSError:
            logger.error("could not remove temporary directory", extra={"category": "storage_error"})

    def sweep(self, retention_seconds: float) -> int:
        """Remove job directories older than the retention. Returns number removed."""
        if not self.jobs_dir.exists():
            return 0
        cutoff = time.time() - retention_seconds
        removed = 0
        for child in self.jobs_dir.iterdir():
            try:
                if child.stat().st_mtime < cutoff:
                    shutil.rmtree(child) if child.is_dir() else child.unlink()
                    removed += 1
            except OSError:
                continue
        if removed:
            logger.info("swept %d expired temporary entries", removed, extra={"category": "storage_cleanup"})
        return removed

    def free_bytes(self) -> int:
        self.ensure()
        return shutil.disk_usage(self.root).free

    def usage_bytes(self, limit_entries: int = 5000) -> int | None:
        if not self.root.exists():
            return 0
        total = 0
        count = 0
        try:
            for dirpath, _, filenames in os.walk(self.root):
                for name in filenames:
                    count += 1
                    if count > limit_entries:
                        return None
                    try:
                        total += os.path.getsize(os.path.join(dirpath, name))
                    except OSError:
                        continue
        except OSError:
            return None
        return total

    def self_check(self) -> tuple[bool, str]:
        """Write, read back and delete a probe file. Returns (ok, message)."""
        try:
            self.ensure()
            probe = self.root / f".healthcheck-{secrets.token_hex(4)}"
            payload = secrets.token_bytes(32)
            probe.write_bytes(payload)
            ok = probe.read_bytes() == payload
            probe.unlink()
            return ok, "Write, read and delete succeeded." if ok else "Read-back did not match what was written."
        except PermissionError:
            return False, "Permission denied in the temporary directory."
        except OSError as exc:
            return False, "Temporary directory is not usable." + (" Disk may be full." if getattr(exc, "errno", None) == 28 else "")
