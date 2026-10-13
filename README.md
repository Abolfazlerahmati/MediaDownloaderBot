# MediaDownloaderBot

A Telegram bot that downloads **public** videos and sends them in the chat, with an admin panel. It runs entirely on
Cloudflare's **free** plan: one Worker (Telegram webhook, admin panel, hourly maintenance), a D1 database, and a KV
namespace. No server, no VPS, no Docker, and no computer that has to stay on. No console is needed: setup happens in the
Cloudflare dashboard and the panel, and updates happen when you push to GitHub.

- **Platforms:** TikTok, Pinterest, YouTube, and Instagram (public links). YouTube and Instagram are disabled until you test them in the panel; they use public endpoints that may refuse Cloudflare's IP ranges.
- **Limit:** files over **50 MB** are not sent; the user gets a clear error.
- **Languages:** English and Persian (the Persian text is a first draft that needs native review).
- **Panel:** login with a forced first-login password change, CSRF and Origin checks, login throttling, settings with
  validation, platform management, bot control, health checks, redacted diagnostics, searchable logs with retention,
  and appearance (two themes, each in light, dark, or system mode). The panel is English-only for now.

Setup: [docs/cloudflare.md](docs/cloudflare.md). Platform status: [docs/platforms.md](docs/platforms.md).

## Project layout
```
src/index.ts          Worker entry: routes, pages, API, static assets, hourly cron
src/webhook.ts        Telegram webhook: secret check, body limit, update processing
src/bot/              Update handling (handler.ts), group rules, production wiring (deps.ts)
src/platforms.ts      URL classification (platform, supported or not)
src/extractors/       Per-platform extraction: tiktok, pinterest, youtube (player API), instagram (embed page)
src/media/            Streaming download with a cap, MP4 header check, file names, multipart upload
src/telegram.ts       Telegram Bot API client
src/db/               Schema and automatic migrations (schema.ts), data access (store.ts), seeds
src/web/              Panel: pages, JSON API, sessions, password policy, health, HTTP helpers
src/security/         Hashing (PBKDF2), tokens, constant-time comparison
src/i18n.ts           English and Persian messages
src/settings.ts       Settings definitions and validation
src/limits.ts         Hard limits in one place
public/static/        Panel CSS and JavaScript (served by Workers Static Assets)
migrations/           Reference copy of the version 1 schema (generated from src/db/schema.ts)
test/                 Vitest tests against an in-memory SQLite D1 double
```

## Development (optional; the deployment does not need it)
```sh
npm ci
npm run typecheck
npm test
npx wrangler dev --local     # local preview; needs a .dev.vars file, see below
```
`.dev.vars` holds `BOT_TOKEN` and `WEBHOOK_SECRET` for local runs. Never commit it.

## Security notes
- The bot token and the webhook secret are Cloudflare Secrets. They are never stored in the repository or the database.
- Each webhook request must carry the secret header, compared in constant time. Otherwise the answer is 403.
- Panel passwords are hashed with PBKDF2-SHA256. Sessions are random tokens stored only as hashes, in an HttpOnly,
  Secure, SameSite=Strict cookie that lasts 12 hours. Every state-changing request needs a CSRF token and a matching Origin.
- Login is throttled per username (5 failures per 15 minutes). Throttle keys are hashed.
- The database stores the platform and the host of each link, not the full URL, and no usernames or download history.
- Logs never contain tokens, full links, or user identifiers.

## Status and limits
- Tests cover the bot flows, the webhook, panel auth and CSRF, settings validation, login throttling, rate limiting,
  dedupe, log retention, streaming and the size cap, MP4 validation, URL handling, and the deploy configuration.
  They run on in-memory SQLite, not on D1, and they include no live network tests.
- The panel's client script has not been run in a real browser from the development environment. Please test it.
- Login is throttled per username, not per IP address, so a determined attacker can try many usernames.
