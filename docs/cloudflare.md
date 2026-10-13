# Running on Cloudflare (Workers + Containers + D1)

> **Paid plan only.** Cloudflare Containers requires the **Workers Paid** plan. On a free account, use
> [cloudflare-free.md](cloudflare-free.md) instead (your own machine + Cloudflare Tunnel + SQLite).

> **Status: implemented, partly verified.**
> - Verified locally: the Python D1 client, the migrations and repositories (against an in-process fake bridge
>   and against the real Worker code running under `wrangler dev` with its D1 emulator), the webhook mode, the
>   TypeScript build, and the wrangler config (`wrangler deploy --dry-run --containers-rollout=none`).
> - **Not verified:** the container image build (no Docker in the authoring environment), a deploy to a real
>   Cloudflare account, the remote D1 database, Telegram webhook delivery, and admin creation on Cloudflare.
>   Treat the first deployment as a staging test.

## Architecture
```
Telegram ──webhook──► Worker (src/index.ts) ──► Durable Object (MediaBotContainer) ──► container
Browser  ──panel────►        │                                                     python -m mediabot run
                             │                                                     (webhook + admin panel, :8080)
                             └── POST /internal/db ◄──── container (D1 bridge, token-protected)
                                        │
                                        └─► D1 binding "DB" (database "mediabot")
```
- **Persistence:** all data (admin account, settings, platform config, optional language preferences, logs) is in
  **D1**. The container only keeps temporary download files on its ephemeral disk. Those files are deleted after
  each job, and anything left behind is lost on sleep, which is harmless.
- **D1 bridge:** the container cannot bind D1 directly, so every SQL statement is sent to the Worker route
  `POST /internal/db`, which runs it with the `DB` binding. Protocol: see the docstring in `mediabot/db/d1.py`.
  Requests need the header `x-mediabot-db-token`, which is `HMAC-SHA256(APP_SECRET_KEY, "mediabot-db-bridge-v1")`
  in hex. The Worker and the container both derive it from the same secret, so no extra secret is needed.
  Without the token the route returns 401. SQL errors return a generic `database_error` with no SQL or parameters.
- One Durable Object owns one container (`max_instances = 1`). It sleeps after 10 idle minutes; the next webhook
  wakes it up (a few seconds).
- `BOT_MODE=webhook`: the container registers `https://<origin>/telegram/webhook` with Telegram at start and checks
  Telegram's secret-token header on each update.
- Outbound internet is enabled (`enableInternet: true`) for Telegram and the video platforms.

## Requirements
- Cloudflare account on the **Workers Paid** plan (Containers is not on the free plan).
- A D1 database named **`mediabot`** in the same account. `wrangler.toml` binds it as `DB` with
  `database_id = "cb32937c-110c-4621-a236-0f7f6a8b7b2f"`. **If your database has a different id, change it in
  `wrangler.toml` before deploying**, otherwise the deploy fails or binds the wrong database.
- Node.js 22 or newer (wrangler, local use only). Docker only if you deploy from your own machine.

## Secrets (never in Git)
```bash
npx wrangler secret put APP_SECRET_KEY    # output of: python -m mediabot gen-secret
npx wrangler secret put BOT_TOKEN         # optional; otherwise save the token in the admin panel
```

## Deploy with Workers Builds (recommended)
Connect the repository in **Workers & Pages → Create → Import a repository**, then set:

| Field | Value | Why |
| --- | --- | --- |
| Project / Worker name | `mediabot` (must match `name` in `wrangler.toml`) | Worker name |
| Git repository | `Abolfazlerahmati/MediaDownloaderBot` | Source |
| Production branch | `main` (after the pull request is merged) | Only production runs `wrangler deploy`, which publishes the image |
| Root directory | `/` | `wrangler.toml` and `Dockerfile` are at the repository root |
| Build command | `npm ci` | Installs the pinned wrangler and types from `package-lock.json`. The earlier `cp`/`sed` build command is **not needed**. |
| Deploy command | `npx wrangler deploy` | Builds and publishes the container image and rolls out the instance |
| Non-production branch deploy command | `npx wrangler versions upload` | Uploads Worker code only. It does not update the container image. |
| Version command | `npx wrangler versions upload` | Used by Workers Builds for versioned uploads |
| Build watch paths | `/*` | Rebuild on any change |
| Variables and secrets | `APP_SECRET_KEY`, `BOT_TOKEN` as **Secret** | Never as plain variables |

The D1 binding is declared in `wrangler.toml`, so no extra build step is needed. Workers Builds only needs the
database to exist.

## Deploy from your machine
```bash
npm ci
npx wrangler login            # or set CLOUDFLARE_API_TOKEN in your shell (never in files)
npx wrangler deploy           # requires Docker running (builds the image)
```
Then open `https://mediabot.<your-subdomain>.workers.dev/login`.

## Creating the first administrator on Cloudflare (untested procedure)
There is no shell inside the container, so `python -m mediabot create-admin` is not available. Insert the admin
row directly into D1 with a hash made locally. **Not run in the authoring environment; verify on staging first.**
```bash
# 1. Hash the password locally (use the same venv as the project)
.venv/bin/python -c "from mediabot.security.passwords import hash_password; import getpass; \
print(hash_password(getpass.getpass('Password: ')))"        # copy the output to HASH below
# 2. Write the insert to a temporary file (the hash contains '$', so do not pass it on the command line)
cat > /tmp/admin.sql <<'SQL'
INSERT INTO admins(username, password_hash, created_at) VALUES ('admin', 'HASH', CAST(unixepoch() AS REAL));
SQL
# 3. Run it against the remote database (the bot creates the schema on first start; start it once first)
npx wrangler d1 execute mediabot --remote --file=/tmp/admin.sql
rm /tmp/admin.sql
```
Start the Worker once before this step so the migrations run. Afterwards log in at `/login`.

## Checks after deploy
1. The Worker deployment is active in the dashboard, and the D1 database `mediabot` is listed under the Worker's bindings.
2. `GET /login` returns the sign-in page.
3. Log in, then **Bot & health → Telegram API** is healthy, and `getWebhookInfo` shows `https://<origin>/telegram/webhook`.
4. Send `/start` to the bot in a private chat.

## Limitations of this setup
- **Latency.** Every database call is one HTTPS request from the container to the Worker and then to D1. The Python
  client is synchronous, so each call blocks the bot's event loop for that round trip. Operational-log writes also go
  through D1, and each warning or error costs one request. Expect slower admin pages and bursts of log writes.
- **Bridge is only as strong as the secret.** Anyone holding `APP_SECRET_KEY` can run arbitrary SQL through
  `/internal/db`. Rotating the secret invalidates the token.
- **Beta product.** Cloudflare Containers is in beta. Limits and pricing may change.
- **Single instance.** `max_instances = 1`. The bot cannot scale out.
- **Sleep.** After 10 idle minutes the container stops. The next webhook starts it again (a few seconds).
- **Video size.** Telegram's upload limit (50 MB) still applies. Large downloads also need disk; `standard-1` has 8 GB.
- **Restart button.** Panel restarts exit with code 75. Whether Cloudflare restarts the instance on exit is not
  verified; the next request starts it again.
- **Retries.** The bridge does not retry failed requests, because a write might have been applied. A failed write
  surfaces as an error in the log and the request fails.
