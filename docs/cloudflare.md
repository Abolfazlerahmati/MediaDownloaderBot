# Running on Cloudflare (Workers Builds + Containers + D1)

> **Plan requirement: Workers Paid.** Cloudflare Containers is not available on the free plan. On a free account,
> use [cloudflare-free.md](cloudflare-free.md) (your own machine + Cloudflare Tunnel + SQLite).

> **Status: not yet deployed by the author.** The build command, the bindings, the Worker, and the webhook/panel
> code were checked locally (dry runs, D1 emulator, end-to-end run of the panel on D1). The container image build,
> a real deploy from GitHub, and Telegram webhook delivery have not been run against a live account.

## What you set in Cloudflare
| Item | Where | Value |
| --- | --- | --- |
| Git repository | Workers Builds | `Abolfazlerahmati/MediaDownloaderBot` |
| Production branch | Workers Builds | the branch you deploy from (`main` after the PR is merged) |
| Root directory | Workers Builds | `/` |
| Build command | Workers Builds | see below |
| Deploy command | Workers Builds | see below |
| Non-production deploy command | Workers Builds | `npx wrangler versions upload` |
| Build watch paths | Workers Builds | `/*` |
| **Secret** `APP_SECRET_KEY` | Variables and secrets (type: **Secret**) | output of `python -m mediabot gen-secret` |
| D1 database | Cloudflare dashboard | a database named **`mediabot`** (its id is in `wrangler.toml`) |

That is the only secret. **The bot token is not a deploy setting.** You enter it in the admin panel after the first
sign-in.

### Build command (your command, unchanged)
```bash
cp wrangler.toml wrangler.build.toml && sed -i 's/database_id = "[^"]*"/database_id = "cb32937c-110c-4621-a236-0f7f6a8b7b2f"/' wrangler.build.toml && sed -i '/binding = "CACHE"/{n;s/id = "[^"]*"/id = "c22c95c3c6ae40a88fbcd4d52c8a5471"/;}' wrangler.build.toml
```
The ids already match `wrangler.toml`, so this command is a safe no-op for this repository. It is kept because you
asked for it. The `sed` for `CACHE` works only because `id = ...` is the line directly under `binding = "CACHE"`.
Keep that layout.

### Deploy command (your command, unchanged)
```bash
npx wrangler deploy --config=wrangler.build.toml; status=$?; rm -f wrangler.build.toml; exit $status
```
The build step creates `wrangler.build.toml`, and the deploy step removes it again. The file is also in `.gitignore`.

If the build log says `wrangler` is missing or is not the pinned 4.150.0, prefix the build command with `npm ci && `.

## Updates
Updates come from GitHub:
1. You push to the production branch (or merge the pull request).
2. Workers Builds builds the image from `Dockerfile`, deploys the Worker, and rolls out the container.
3. The container starts, applies any new migrations to D1, and continues. **Your data stays in D1**; the container's
   disk is temporary and is not needed for state.

Non-production branches only upload the Worker code (`versions upload`) and do not replace the container image.

## First sign-in (default administrator)
On the first start, when there are no administrators, the bot creates:
- username **`admin`**
- password **`12345678`**, with the flag **must change at first sign-in**

Sign in at `https://<your-worker>/login`. Until you change the password, the server refuses all admin APIs (403) and
redirects every page to **Account**, where you must enter the default password as the current password and choose a
new one (at least 12 characters). Then the panel unlocks.

**Security warning:** the panel is on a public URL, and the default password is public. **Sign in and change the
password immediately after the first deploy.** Until you do, anyone who finds the URL can sign in as `admin`.
Possible hardening: Cloudflare Access in front of the panel. Keep the Telegram webhook path (`/telegram/webhook`)
outside Access, because Telegram cannot sign in through it. This repository does not configure Access for you.

The default account cannot be turned off on Cloudflare in this version: the Worker does not pass
`DEFAULT_ADMIN_ENABLED` to the container. Change the password before anyone else can reach the panel.

## Bot token and health checks (in the panel)
1. **Bot & health → Bot token**: paste the token from @BotFather. It is encrypted with `APP_SECRET_KEY` and shown
   masked afterwards.
2. Saving the token restarts the bot, which registers `https://<your-worker>/telegram/webhook` with Telegram using the
   secret token.
3. Run **Telegram API test** to check the connection. Each health check shows its own result (healthy, warning, failed).
4. **Platforms**: each platform is disabled and untested until you run its test. Enable a platform only after its
   test passes.
5. Send `/start` to the bot in a private chat.

## How it runs
```
Telegram ──webhook──► Worker (src/index.ts) ──► Durable Object (MediaBotContainer) ──► container
Browser  ──panel────►        │                                                     python -m mediabot run
                             │                                                     (webhook + panel, :8080)
                             └── POST /internal/db ◄──── container (D1 bridge, token-protected)
                                        │
                                        └─► D1 binding "DB" (database "mediabot")
```
- **Persistence:** admin account, settings, platform configuration, the encrypted bot token, optional language
  preferences, and operational logs live in **D1**. The container's disk holds only temporary download files.
- **D1 bridge:** the container sends SQL to `POST /internal/db`, which the Worker runs with the `DB` binding. The
  request must carry `x-mediabot-db-token`, derived as `HMAC-SHA256(APP_SECRET_KEY, "mediabot-db-bridge-v1")`. Without
  it the route returns 401. SQL errors return a generic `database_error` with no SQL or parameters.
- One Durable Object owns one container (`max_instances = 1`). The container sleeps after 10 idle minutes and wakes on
  the next request (a few seconds).
- `BOT_MODE=webhook`, `WEBHOOK_BASE_URL` = the Worker's public origin. The Worker sets this from the request, so no
  value is needed at deploy time.
- The KV namespace `CACHE` is bound but not used by the application.

## Limitations
- **Plan:** Workers Paid is required (Containers).
- **Default password** is public until changed (see above).
- **Latency:** every database call is one HTTPS request from the container to the Worker and then to D1. The Python
  client is synchronous, so each call blocks the bot's event loop for that round trip. Warnings and errors are also
  written to D1, one request each.
- **The bridge is only as strong as the secret.** Anyone with `APP_SECRET_KEY` can run arbitrary SQL through
  `/internal/db`. Changing the secret invalidates the bridge token **and makes the stored bot token unreadable**, so
  you would have to enter it again.
- **Beta product:** Cloudflare Containers is in beta. Limits and pricing may change.
- **Single instance:** `max_instances = 1`. Job queue, rate limits, and webhook state are in memory; one instance only.
- **Video size:** Telegram's upload limit (50 MB) applies. `standard-1` has 8 GB of temporary disk.
- **Restart button:** a panel restart exits with code 75. Whether Cloudflare restarts the instance on exit is not
  verified; the next request starts it again.
- **Not verified live:** the image build in Workers Builds, the GitHub-triggered deploy, the production D1 database, and
  Telegram webhook delivery.

## Local checks (what was run)
```bash
npm ci
npx tsc --noEmit
npx wrangler deploy --dry-run --containers-rollout=none     # config and bindings only; no Docker needed
.venv/bin/python -m pytest -q tests                          # includes the D1 bridge and first-sign-in tests
```
