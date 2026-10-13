# MediaDownloaderBot

A Telegram bot that downloads **public** videos and sends them in the chat. It runs entirely on
Cloudflare's **free** plan: a Worker that receives Telegram webhooks, and a D1 database.
No server, no VPS, and no computer that has to stay on.

- **Supported now:** TikTok and Pinterest (public links; live testing is your step).
- **Not implemented:** YouTube and Instagram. The bot replies with a clear message.
- **Limit:** files over **50 MB** are not sent, and the user gets a clear error.

See [docs/platforms.md](docs/platforms.md) for the exact status of each platform.
See [docs/cloudflare.md](docs/cloudflare.md) for deployment steps.

## Project layout
```
src/index.ts          Worker entry: routes, webhook secret check, status pages
src/bot.ts            Telegram update handling (commands, rate limit, job records)
src/platforms.ts      URL classification (which platform, supported or not)
src/extractors/       Page parsing: pinterest.ts, tiktok.ts, page.ts (fetch), html.ts (helpers)
src/media.ts          Streaming download with a 50 MB cap
src/telegram.ts       Telegram Bot API client and streaming multipart upload
src/db.ts             D1 store (users, download history)
src/limits.ts         All hard limits in one place
migrations/           D1 schema
test/                 Vitest tests (synthetic fixtures, no network)
scripts/workers-build.sh   Workers Builds build step
```

## Development
```sh
npm ci
npm run typecheck
npm test
cp .dev.vars.example .dev.vars   # then edit values; never commit .dev.vars
npx wrangler d1 migrations apply mediabot --local
npm run dev
```

## Security notes
- The bot token and the webhook secret are Cloudflare Secrets. They are never stored in the repository.
- Each webhook request must carry the secret header, compared in constant time. Otherwise the answer is 403.
- Download links are fetched with browser-like headers only for the page or CDN that needs them.
- The database stores the platform and the host of each link, not the full URL.
- Users see short, fixed error messages. Internal details are logged without tokens.

## Status and limits
- Tests cover URL handling, extractors (with synthetic fixtures), streaming and size limits, Telegram
  framing, bot flows, the webhook, and the deploy config. There are no live network tests.
- No admin panel in this version. Moderation tools are not included yet.
- The bot replies in Persian only.
- Rate limiting is per user and per minute, stored in D1. It does not limit abusive traffic before the Worker.
