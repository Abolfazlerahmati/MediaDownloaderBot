# MediaDownloaderBot

A Telegram bot that downloads **publicly accessible** media from YouTube, TikTok, Instagram and
Pinterest (plus admin-defined yt-dlp platforms), delivered in the chat as video, audio or documents,
with a secure web administration panel.

- **Bot:** private chats and groups, English and Persian, per-user language, configurable limits,
  dedupe, no message deletion, no unsolicited replies.
- **Media integrity:** original titles and Unicode filenames are preserved (ZWNJ included), real
  extensions are used, files are validated before upload, no unrelated thumbnails, stream copy over
  transcoding, and clear reporting of Telegram limits.
- **Admin panel:** Argon2 passwords, sessions, CSRF, Origin checks, login throttling, server-side
  authorization, validated settings with masked secrets, platform management with live tests,
  real health checks, redacted diagnostics, searchable logs with retention, and two themes with
  dark/light/system modes.
- **Privacy:** no user-profile database, no usernames or message text stored, temporary files removed,
  no download history, and an optional temporary persistence mode.

> Status summary, limitations and untested parts: [docs/features-and-limitations.md](docs/features-and-limitations.md).

## Quick start (local)
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # set APP_SECRET_KEY (python -m mediabot gen-secret)
python -m mediabot check
python -m mediabot create-admin --username admin --password-stdin
python -m mediabot run          # panel at http://127.0.0.1:8080
```
Then follow [docs/telegram-setup.md](docs/telegram-setup.md) and
[docs/group-privacy-mode.md](docs/group-privacy-mode.md).

## Documentation
| Guide | File |
| --- | --- |
| Local development and tests | [docs/local-development.md](docs/local-development.md) |
| Deployment (Docker, systemd, reverse proxy) | [docs/deployment.md](docs/deployment.md) |
| Cloudflare Workers + Containers + D1 (Workers Paid plan; not deployed) | [docs/cloudflare.md](docs/cloudflare.md) |
| Free Cloudflare account: own machine + Cloudflare Tunnel + webhook (not run live) | [docs/cloudflare-free.md](docs/cloudflare-free.md) |
| Telegram bot setup | [docs/telegram-setup.md](docs/telegram-setup.md) |
| Group privacy mode | [docs/group-privacy-mode.md](docs/group-privacy-mode.md) |
| Administrator setup | [docs/admin-setup.md](docs/admin-setup.md) |
| Backup and recovery | [docs/backup-recovery.md](docs/backup-recovery.md) |
| Troubleshooting | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Security and privacy | [docs/security-privacy.md](docs/security-privacy.md) |
| Features and limitations | [docs/features-and-limitations.md](docs/features-and-limitations.md) |

## Configuration
All settings come from environment variables or `.env` (see `.env.example`). Operational limits
(file size, duration, concurrency, rate limits, retention, languages, etc.) are editable in the panel
and validated on the server. Restart-required settings are flagged in the panel.

## Project tree
```
MediaDownloaderBot/
├── Dockerfile                    # container image (not built in the authoring sandbox)
├── docker-compose.yml            # local-only port binding, read-only FS, non-root
├── .dockerignore
├── .env.example                  # placeholder values only
├── .gitignore
├── pyproject.toml                # package metadata and package data
├── requirements.txt              # pinned runtime dependencies
├── requirements-dev.txt          # pytest and pytest-asyncio
├── README.md
├── docs/                         # deployment, setup, security, troubleshooting, limitations
├── tests/                        # 84 offline tests (see below)
└── mediabot/
    ├── __init__.py, __main__.py  # `python -m mediabot`
    ├── app.py                    # Runtime wiring, serve loop, restart exit code 75
    ├── cli.py                    # run, gen-secret, check, migrate, create-admin, reset-password
    ├── config.py                 # AppConfig (bootstrap environment settings)
    ├── errors.py                 # ErrorCode catalogue
    ├── bot/                      # Telegram: gateway, service rules, keyboards, controller, dispatch
    ├── db/
    │   ├── database.py           # SQLite wrapper, migrations runner, backend factory
    │   ├── d1.py                 # Cloudflare D1 client (through the Worker bridge)
    │   ├── repositories.py       # settings, admins, sessions, platforms, preferences, logs
    │   └── migrations/0001_init.sql
    ├── health/                   # checks, health service, diagnostics catalogue, reports
    ├── i18n/                     # Translator and locales/en.json, locales/fa.json
    ├── jobs/                     # pipeline, job manager, queue, temp files, TTL cache, limiter
    ├── media/                    # ffmpeg locator, filenames, validation, metadata, thumbnails, delivery
    ├── observability/            # logging setup, operational log service, redaction
    ├── platforms/                # adapter interface, yt-dlp adapters, registry, validation, process runner
    ├── security/                 # Argon2 passwords, SecretBox, SSRF guard
    ├── services/                 # runtime settings, preferences, encrypted token store
    ├── urls/                     # link detection (entities, UTF-16 offsets, canonical URLs)
    └── web/                      # admin panel
        ├── app.py, security.py, auth.py, schemas.py
        ├── api_auth.py, api_config.py, api_ops.py   # JSON API under /api
        ├── pages.py                                 # server-rendered shells
        ├── templates/            # shell.html, login.html (no inline script or style)
        └── static/
            ├── css/tokens.css, base.css
            ├── css/themes/merchant.css, ios.css
            └── js/common.js, js/pages/*.js
```

## Phases: implemented and tested

| Phase | Implemented | Verified how |
| --- | --- | --- |
| 1. Foundation | Packaging, config, SQLite + SQL migration, repositories, redaction, Argon2, SecretBox, SSRF guard, i18n | Unit tests; CLI `check`, `migrate`, `create-admin`, `reset-password` |
| 2. Platforms and media | Adapter interface, yt-dlp adapters (YouTube, TikTok, Instagram, Pinterest, generic), validation, subprocess runner, filename integrity, magic-byte and ffmpeg validation, metadata, thumbnails, delivery kinds | Tests with fake adapters and synthetic files; the platform live test is implemented but needs a public sample URL and network access |
| 3. Jobs | Pipeline with retries for temporary failures only, job manager with bounded queue, workers, cancellation, in-flight dedupe, temp-file cleanup | Pipeline and job-manager tests |
| 4. Telegram bot | Link detection, group addressing rules, one status reply per accepted link, rate limits, dedupe of retries, language buttons (per user), gateway retries, token store | Bot-service tests with a fake gateway. **Not tested against live Telegram** (no network from the sandbox) |
| 5. Admin panel | Login, CSRF, Origin check, throttling, sessions, password change, settings API with full validation, platform CRUD and live tests, bot control, health, diagnostics, logs with retention, appearance persistence | HTTP tests through the real FastAPI app; live curl session against a running panel |
| 6. UI | Shells, login, dashboard, platforms, settings, bot and health, diagnostics, logs, account. Two themes, dark/light/system. No inline script or style | Page-rendering tests, theme-switch tests, `node --check` on all scripts. **No real-browser visual check** (no browser in sandbox) |
| 7. Packaging, docs, Docker | Dockerfile, compose file, `.dockerignore`, deployment and operations documentation | Wheel build verified (contains migrations, locales, templates, static files). **Docker image not built** (no Docker daemon) |

## Testing
```bash
python -m pytest            # 84 tests, offline
ruff check --select F,E9 mediabot tests
```

## Unfinished or unverified integrations (labelled)
- **Live Telegram API, live platform downloads and real-browser UI checks** were not possible in the
  authoring sandbox. They are covered by fakes and must be verified in your environment.
- **Docker image and compose file** are written but not built or run here.
- **Persian (fa) translations** are a first pass and need native-speaker review.
- **Merchant SEP style theme** is an original design inspired by a general payments-dashboard aesthetic.
  It is not affiliated with, endorsed by, or copied from merchant.sep.ir.

## License and responsibility
Use only for content you have the right to download, and within each platform's terms of service.
The bot does not bypass logins, private accounts, paywalls or DRM.
