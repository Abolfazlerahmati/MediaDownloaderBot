# Troubleshooting

Start with **Diagnostics** in the panel. It runs the checks, explains each finding, and offers a
redacted plain-text report to download.

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Panel says "Your session form expired" | CSRF cookie missing or stale | Reload the page. Check that cookies are enabled for the panel host. |
| Login says "Too many failed attempts. Try again later." | Login throttle (5 failures / 15 min per IP or username) | Wait 15 minutes, or reset the password with `reset-password`. |
| Browser drops the session over plain HTTP | `ADMIN_COOKIE_SECURE=true` over HTTP | Use HTTPS, or for localhost testing set `ADMIN_COOKIE_SECURE=false`. |
| Bot shows "not_configured" | No token | Set `BOT_TOKEN` or save one in the panel. |
| Bot shows "disabled in this process" | `ENABLE_BOT=false` | Expected when running the panel alone. |
| Telegram API check fails with unauthorized | Wrong or revoked token | Re-create the token with @BotFather (`/revoke`) and save it. |
| Bot ignores links in a group | Privacy mode on | See `group-privacy-mode.md`. |
| Platform "Platform live test needs attention" | Test failed or no sample URL | Open the platform, set a public sample URL, run the live test. An enabled platform is disabled automatically when its test fails. |
| Platform test fails for YouTube/TikTok/etc. | Extractor outdated or site blocked the server IP | Update yt-dlp (`pip install -U -r requirements.txt` with a new pin), then re-test. |
| "File too large" | Over `max_file_size_mb` or Telegram's 50 MB upload limit | Lower the target, or raise the setting up to 50. Telegram refuses larger uploads. |
| "Too long" | Over `max_duration_minutes` | Raise the limit in Settings if appropriate. |
| "dependency_missing" for ffmpeg | ffmpeg not installed | Install ffmpeg (`apt install ffmpeg`) or set `FFMPEG_PATH`. |
| Workers "stopped unexpectedly" | Internal error | Check Logs (category `worker_crash`). Restart the service. |
| Restart button does nothing | Not supervised | Set `RESTART_SUPERVISED=true` and run under systemd/Docker with exit code 75 handling. |
| Two instances behave strangely | Two processes sharing one `DATA_DIR` | Run exactly one instance per data directory. |

## Command-line checks
```bash
python -m mediabot check        # configuration and dependencies
python -m mediabot migrate      # apply pending migrations
ffmpeg -version                 # confirm ffmpeg
python -m yt_dlp --version      # confirm yt-dlp
```

## Where to look
- Panel → Logs: searchable and filterable by level, component, and category.
- Console output (stdout) mirrors WARNING and above, with secrets redacted.
