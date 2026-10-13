# Backup and recovery

## What is stored
Everything persistent lives in `DATA_DIR` (default `./data`, `/data` in Docker):
- `app.db`: SQLite database (administrators, sessions, settings, platform configuration, per-user
  language preferences in minimal mode, operational logs).
- `tmp/`: temporary download files. Safe to delete at any time; they are normally removed after each job.

**Losing `APP_SECRET_KEY` makes the stored bot token and per-user preference keys unreadable.**
Back up the key separately from the database (password manager or secret store).

## Backup
Stop the service or use SQLite's online backup, then copy the file:
```bash
python -c "import sqlite3; s=sqlite3.connect('data/app.db'); d=sqlite3.connect('backup/app-backup.db'); s.backup(d)"   # consistent online copy (no sqlite3 CLI needed)
```
Or with the service stopped: `cp data/app.db backup/`. Also keep your `.env` (or the secret) in a
secure location.

## Recovery
1. Stop the service.
2. Restore `app.db` into `DATA_DIR` (remove any `app.db-wal` / `app.db-shm` files first).
3. Restore the same `APP_SECRET_KEY`.
4. Run `python -m mediabot check` and `python -m mediabot migrate`.
5. Start the service and confirm Bot & health shows healthy checks.

If the secret was lost: the bot token must be re-entered in the panel (or set as `BOT_TOKEN`), and
per-user language preferences reset to the default.

## Retention
- Temporary media: removed after each job and swept after `temp_retention_minutes` (default 60).
- Language preferences (minimal mode): removed after `preference_retention_days` (default 30).
- Operational logs: removed after `log_retention_days` (default 14) and trimmed to `log_max_rows`.
- Downloaded media is never stored permanently, and there is no download history.
