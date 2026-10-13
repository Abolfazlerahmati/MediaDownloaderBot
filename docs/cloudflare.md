# Running on Cloudflare (Workers + Containers)

> **Status: partially ready.** The Worker, the webhook mode, and the container configuration are in the
> repository and pass local checks. Two things are still open and must be decided before production use:
> 1. **Persistence.** Containers have an ephemeral disk. Without a persistence layer, settings, the admin
>    account, and the stored bot token are lost when the container sleeps or is replaced. See below.
> 2. **Build and deploy in Workers Builds** have not been run, because the authoring sandbox has no Docker
>    daemon and no Cloudflare access.

## Architecture
```
Telegram ──webhook──► Worker (src/index.ts) ──► Durable Object (MediaBotContainer)
Browser  ──panel────►        │                        │
                             │                        └─► container: python -m mediabot run
                             │                             (Telegram webhook + admin panel, port 8080)
```
- One Durable Object owns one container (`max_instances = 1`, because SQLite and bot state have one writer).
- The container sleeps after 10 minutes without requests. Telegram webhook calls wake it up.
- `BOT_MODE=webhook`: the container registers `https://<your-origin>/telegram/webhook` with Telegram at start,
  and checks Telegram's secret-token header on every update.
- Outbound internet is enabled (`enableInternet: true`) for Telegram and the video platforms.

## Requirements
- Cloudflare account on the **Workers Paid** plan (Containers is not available on the free plan).
- Node.js 22 or newer, for wrangler (local use only).
- Docker, only if you deploy from your own machine. Workers Builds builds the image itself.

## Secrets (never in Git)
```bash
npx wrangler secret put APP_SECRET_KEY    # output of: python -m mediabot gen-secret
npx wrangler secret put BOT_TOKEN         # optional; otherwise save the token in the admin panel
```
The Worker passes these to the container at start. The bot token is encrypted in the database as usual.

## Deploy with Workers Builds (recommended)
Connect the repository in **Workers & Pages → Create → Import a repository**, then set:

| Field | Value | Why |
| --- | --- | --- |
| Project / Worker name | `mediabot` (must match `name` in `wrangler.toml`) | Worker name |
| Git repository | `Abolfazlerahmati/MediaDownloaderBot` | Source |
| Production branch | `main` (after the pull request is merged) | Only production runs `wrangler deploy`, which publishes the image |
| Root directory | `/` | `wrangler.toml` and `Dockerfile` are at the repository root |
| Build command | `npm ci` | Installs the pinned wrangler and types from `package-lock.json`. The earlier `cp`/`sed` build command is **not needed** for this repository. |
| Deploy command | `npx wrangler deploy` | Builds and publishes the container image and rolls out the instance |
| Non-production branch deploy command | `npx wrangler versions upload` | Uploads Worker code only. It does not update the container image. |
| Version command | `npx wrangler versions upload` | Used by Workers Builds for versioned uploads |
| Build watch paths | `/*` | Rebuild on any change |
| Variables and secrets | `APP_SECRET_KEY`, `BOT_TOKEN` as **Secret** | Never as plain variables |

Important: the custom `sed` commands in an earlier draft referenced a D1 database and a KV namespace.
Those bindings do **not** exist in `wrangler.toml` today. Remove them unless you add the bindings.

## Deploy from your machine
```bash
npm ci
npx wrangler login            # or set CLOUDFLARE_API_TOKEN in your shell (not in files)
npx wrangler deploy           # requires Docker running (builds the image)
```
Then open `https://mediabot.<your-subdomain>.workers.dev/login`.

**Creating the administrator:** on Cloudflare this is not possible yet. The administrator account lives in the
database, and that database is on the ephemeral disk (see Persistence below). Until a persistence option is
implemented, use a local or VPS deployment for administration.

## Checks after deploy
1. The Worker deployment is active in the dashboard.
2. `GET /login` returns the sign-in page.
3. Bot & health → Telegram API → healthy, and the webhook is registered (`getWebhookInfo` shows the URL).
4. Send `/start` to the bot in a private chat.

## Limitations of this setup
- **Ephemeral disk.** Data written to `/data` is lost when the container is replaced or re-created. This includes
  the SQLite database. Persistence is required before this is production-ready (see next section).
- **Beta product.** Cloudflare Containers is in beta. Limits and pricing may change.
- **Single instance.** `max_instances = 1`. The bot cannot scale out.
- **Sleep.** After 10 idle minutes the container stops. The next webhook starts it again (a few seconds).
- **Video size.** Telegram's upload limit (50 MB) still applies. Large downloads also need disk; `standard-1` has 8 GB.
- **Restart button.** Panel restarts exit with code 75. Whether Cloudflare restarts the instance on exit is not
  verified; the next request starts it again.

## Persistence options (decision needed)
| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| A. Cloudflare D1 through the Worker | The container calls a Worker route that uses a D1 binding. The database layer is replaced by an HTTP-backed adapter. | Generally available, durable, no API token inside the container | Largest code change; every query is a network call; needs a test against real D1 |
| B. Container snapshots | `durable_object` scheduling policy, `snapshotContainer()` before sleep, restore at start | Keeps SQLite as it is | Beta; snapshots expire after 30 days without restore; more Cloudflare-specific code |
| C. Accept data loss | No change | None | Admin account, settings and token are lost on sleep. Not acceptable for production. |
