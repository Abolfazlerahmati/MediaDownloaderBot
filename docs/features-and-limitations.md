# Features and limitations

## Implemented
| Area | Status | Notes |
| --- | --- | --- |
| Telegram polling bot (private + groups) | Implemented, tested with fake gateway | Live Telegram was not reachable from the authoring sandbox. |
| Platform adapters: YouTube, TikTok, Instagram, Pinterest | Implemented via yt-dlp | Live downloads were not testable in the sandbox. Use the platform live test. |
| Generic yt-dlp adapter for custom platforms | Implemented | Admin-defined domains, options limited to a whitelist. |
| Multi-URL messages, dedupe, rate limits, concurrency, queue | Implemented, tested | Limits are configurable. |
| English / Persian UI, per-user switch | Implemented, tested | Centralized i18n catalogues `en.json`, `fa.json`. |
| Filename integrity (Unicode, ZWNJ, sanitization) | Implemented, tested | |
| Media validation (magic bytes, Pillow, ffmpeg decode) | Implemented, tested with synthetic files | Real-media validation depends on your ffmpeg. |
| Thumbnails | Implemented | Never reused across items. |
| Metadata embedding (mutagen) | Implemented | Best effort; failure does not block delivery. |
| Admin panel: login, CSRF, throttling, sessions | Implemented, tested through HTTP | |
| Dashboard, platforms, settings, bot & health, diagnostics, logs, account | Implemented, verified over HTTP | Browser visual check not performed (no browser in the sandbox). |
| Design themes (Merchant SEP style, iOS-inspired), light/dark/system | Implemented | The Merchant style is an original design inspired by a general payments-dashboard aesthetic. It is **not affiliated** with, and not a copy of, merchant.sep.ir. |
| CLI: run, gen-secret, check, migrate, create-admin, reset-password | Implemented, tested | |
| Docker image and compose file | Written, **not built or tested** | No Docker daemon in the authoring sandbox. |
| Backups, retention, temporary mode | Implemented and documented | |

## Limitations
- Telegram Bot API upload limit is 50 MB; the bot cannot send larger files. Larger media is reported
  clearly instead of being truncated.
- Private, login-only, age-restricted, DRM-protected, and live streams are not supported.
- yt-dlp extractors break when platforms change. Keep yt-dlp updated and use the live tests.
- Platform live tests need a public sample URL that you choose.
- Single-process design: run one instance per data directory. SQLite is not a multi-writer database.
- Login throttling state is in memory and resets on restart.
- The panel has no built-in TLS. Use a reverse proxy.
- Not implemented: multiple administrator roles (all administrators have full access), two-factor
  authentication, webhook delivery mode, external object storage.
- Persian translation quality is a first pass; review `i18n/locales/fa.json` before production use.
- Visual appearance in dark/light modes was not checked in a real browser in the authoring sandbox.
