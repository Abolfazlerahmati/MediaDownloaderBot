# Local development

## Requirements
- Python 3.11 or newer (the Docker image uses 3.12).
- `ffmpeg` on `PATH` is recommended. If it is missing, the bundled `imageio-ffmpeg` binary is used
  for validation and stream copy, but it does not ship `ffprobe`, so some checks degrade.
- Network access to the platforms you want to test (YouTube, TikTok, Instagram, Pinterest).

## Setup
```bash
python3 -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-dev.txt   # tests only
cp .env.example .env
python -m mediabot gen-secret         # paste the output into APP_SECRET_KEY in .env
python -m mediabot check              # validates configuration and dependencies
python -m mediabot create-admin --username admin --password-stdin
python -m mediabot run
```
The admin panel is then at http://127.0.0.1:8080. Set `ADMIN_COOKIE_SECURE=false` in `.env` only if
you browse over plain HTTP on localhost; otherwise sessions use `Secure` cookies.

## Running the tests
```bash
python -m pytest
```
The suite (84 tests) uses no network, no Telegram, and no real platform. It covers filename
integrity, redaction, URL detection, SSRF guards, passwords, the pipeline (with fake adapters),
job-manager concurrency, Telegram behaviour rules (with a fake gateway), the admin HTTP API through
the real FastAPI app, page rendering, and CLI commands.

Lint gate used during development:
```bash
pip install ruff==0.17.0
ruff check --select F,E9 mediabot tests
```

## Project layout
See the project tree in `README.md`.

## Useful environment variables for development
| Variable | Purpose |
| --- | --- |
| `DATA_DIR` | Where `app.db` and `tmp/` live (default `./data`). |
| `ENABLE_BOT=false` | Run only the admin panel (no Telegram polling). |
| `ENABLE_WEB=false` | Run only the bot. |
| `ADMIN_PORT` | Panel port (default 8080). |
