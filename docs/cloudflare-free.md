# Running on a free Cloudflare account (own machine + Cloudflare Tunnel + webhook)

> **Status: configuration written and locally checked; not run live.** The Docker image, the tunnel, and the
> Telegram webhook were not tested in the authoring environment (no Docker, no Cloudflare or Telegram access).
> Treat the first run as a test.

## What the free plan can and cannot do
| Need | Free plan | How this guide handles it |
| --- | --- | --- |
| Run Python, yt-dlp, ffmpeg | **No**: Cloudflare Containers requires the Workers Paid plan | The bot runs on **your machine** in Docker |
| Public HTTPS URL for Telegram webhook | Yes, via **Cloudflare Tunnel** (`cloudflared`) | Tunnel forwards **only** `/telegram/webhook` |
| Database | Local SQLite file on your machine | Default `PERSISTENCE_MODE=minimal`, data in `./data` |
| Cloudflare Workers / D1 | Not needed for this path | The `src/index.ts` Worker is not used here |

So the free path is: **your machine (always on) → cloudflared → the bot container**. Cloudflare only carries the
HTTPS traffic from Telegram to your machine.

## Requirements
- A machine that stays on: a home server, a mini PC, or a small VPS you control. **If it is off, Telegram cannot
  deliver updates**, and they may be delayed or dropped.
- Docker with the Compose plugin.
- A domain whose DNS is managed by Cloudflare (a free zone is enough), for example `example.com`.
  Quick tunnels (`*.trycloudflare.com`) get a random URL that changes, so they are not suitable for webhooks.
- `cloudflared` installed locally, once, to create the tunnel.

## 1. Create the tunnel (once)
```bash
cloudflared tunnel login                 # opens a browser; authorises your zone
cloudflared tunnel create mediabot       # prints a UUID and writes <UUID>.json to ~/.cloudflared/
cloudflared tunnel route dns mediabot bot.example.com
```
Copy the credentials file and create the ingress config:
```bash
mkdir -p deploy/cloudflared
cp ~/.cloudflared/<UUID>.json deploy/cloudflared/
cp deploy/cloudflared/config.example.yml deploy/cloudflared/config.yml
# edit deploy/cloudflared/config.yml: replace TUNNEL_UUID (2 places) and bot.example.com
```
Both `config.yml` and `*.json` are in `.gitignore`. Never commit them. The ingress rule is:
```yaml
ingress:
  - hostname: bot.example.com
    path: ^/telegram/webhook$      # only the webhook is published
    service: http://app:8080
  - service: http_status:404       # everything else: 404 at Cloudflare, not routed to the app
```
The admin panel is **not** published. Reach it on the machine itself (see step 4).

## 2. Configure the bot
Copy `.env.example` to `.env` and set at least:
```
APP_SECRET_KEY=<python -m mediabot gen-secret>
BOT_MODE=webhook
WEBHOOK_BASE_URL=https://bot.example.com
ENABLE_WEB=true
PERSISTENCE_MODE=minimal
# BOT_TOKEN=<from @BotFather>   (or save the token later in the admin panel)
```
`WEBHOOK_BASE_URL` must be the public HTTPS address from step 1. Saving the token in the admin panel restarts the
bot, and the webhook is registered again at that point.

## 3. Start
```bash
docker compose --profile tunnel up -d --build
docker compose logs -f app cloudflared
```
The `cloudflared` service has a pinned image (`2026.10.0`). Check that the tag exists in your registry before you
rely on it.

## 4. Check
1. From any network: `curl -i https://bot.example.com/login` should return **404**. This is intended: the panel is
   not public.
2. `curl -i https://bot.example.com/telegram/webhook` (GET) should return **405**. That proves the route is reachable.
3. In the panel: **Bot & health → Telegram API** is healthy. `getWebhookInfo` shows
   `https://bot.example.com/telegram/webhook` and no `last_error_message`.
4. Send `/start` to the bot in a private chat.

## 5. Reach the admin panel
On the machine: open `http://127.0.0.1:8080/login`. From another computer, use an SSH tunnel:
```bash
ssh -L 8080:127.0.0.1:8080 user@your-machine
```
then open `http://127.0.0.1:8080/login` on your computer. Browsers accept `Secure` cookies on `127.0.0.1`. If the
login does not stick, you can set `ADMIN_COOKIE_SECURE=false` **for local-only use**.

## Limitations
- **Uptime**: the bot works only while your machine is on and the tunnel is connected.
- **Video sites may block your IP**: YouTube, TikTok, Instagram and Pinterest can rate-limit or block home and
  datacenter addresses. This is not something the bot can fix. Test with the platform test in the panel before you enable a platform.
- **Telegram limits**: uploads are limited to 50 MB by Telegram, as before.
- **Backups**: the database is one SQLite file in `./data`. Back it up while the bot is stopped (see `docs/backup-recovery.md`).
- **Cloudflare terms and free-plan limits can change.** Check the current Tunnel documentation before you rely on it.
- **Not verified here**: the Docker build, the `cloudflared` container, the tunnel routing, the Telegram webhook, and
  real downloads. The ingress file and the compose service are checked by tests only.
