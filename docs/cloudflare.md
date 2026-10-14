# Setup and updates from the Cloudflare dashboard and GitHub (no console)

Everything runs on Cloudflare's free plan: one Worker (Telegram webhook, admin panel, and hourly maintenance),
one D1 database, and a KV namespace that is declared but not used yet. There is no Container, no Durable Object,
no Docker, and no computer that must stay on. This project does not use Docker, Render, Oracle, or Cloud Run.

You never need a terminal. Setup happens in the Cloudflare dashboard and the admin panel, and updates happen when you push to GitHub.

## 1. Create the Telegram bot
1. In Telegram, open @BotFather, send `/newbot`, and copy the token.
2. Keep the token secret. Do not put it in GitHub, in `wrangler.toml`, or in chat.

## 2. Create the webhook secret
Make any random string of 32 or more characters (for example, a password manager's generator set to 40 characters).
Telegram sends it back on every webhook call, and the Worker rejects calls without it.

## 3. Add the secrets in the Cloudflare dashboard
Workers & Pages > **mediadownloaderbot** > Settings > **Variables and secrets** > Add:

| Name | Type | Value |
|---|---|---|
| `BOT_TOKEN` | Secret | the token from BotFather |
| `WEBHOOK_SECRET` | Secret | the random string from step 2 |

Secrets are not shown again after saving. Changing a secret takes effect on the next request.

**The panel never accepts or stores the token.** Bot and health shows only a read-only status: set or missing.
To change the token later, edit `BOT_TOKEN` in the same place, then in the panel run **Test connection** and **Register webhook**.

## 4. Connect the GitHub repository (automatic deploys)
Workers & Pages > Create > Import a repository > choose `MediaDownloaderBot` > select the Worker
`mediadownloaderbot`. In the build settings, paste these two commands exactly:

- **Build command:** `npm ci && npm run typecheck && npm test`
- **Deploy command:** `npx wrangler deploy`

The production branch is the branch you chose in Workers Builds (`arena/b1b810c8-mediadownloaderbot`).
Each push to that branch runs the build. If a test fails, the deploy does not happen.

The D1 database `mediabot` and the KV namespace are already declared in `wrangler.toml`. The Worker creates
its tables itself on the first request, so you do not need to run any migration command.

## 5. Open the panel and change the password
Open `https://mediadownloaderbot.<your-subdomain>.workers.dev/login`.

- Username: `admin`
- Password: `12345678`

**Change the password immediately.** The default password is public (it is in this repository). Until it is changed,
every panel page except the account page is blocked, but anyone who reaches the login page can sign in with the default.

## 6. Register the Telegram webhook
Panel > **Bot and health** > **Register webhook**.

The panel uses `BOT_TOKEN` and `WEBHOOK_SECRET` from step 3, and registers
`https://<your Worker URL>/telegram/webhook`. Check the status on the same page: the username, pending updates, and the last
Telegram error. Run **Test connection** to verify the token.

If you create, change, or remove `WEBHOOK_SECRET`, press **Register webhook** again. Telegram keeps the secret it was given at the last registration. The panel shows **Register again** and a warning when the current secret does not match that registration.

## 7. Settings, platforms, and the bot
- **Settings:** bot on/off, default language, group behaviour, rate limit (per user per minute), duplicate window,
  maximum file size (up to 50 MB), log retention, and the maintenance message. Every value is validated on the server.
- **Platforms:** enable or disable a platform, save a public sample link, and run an extraction test. Platforms that are
  not implemented on Workers cannot be enabled.
- **Logs:** searchable by severity, event, and text. Old entries are removed hourly according to the retention setting.
- **Diagnostics:** settings, limits, and secret status (set or missing), never the values.
- **Themes:** Merchant (generic payments-console look, default) and iOS (generic grouped look), each in light, dark, or system mode. The text colour pairs are tested for WCAG AA contrast. The Merchant theme is generic and is not the SEP brand design, because the SEP merchant site could not be reached when this was written.
- **Panel language:** English or Persian, saved per admin account in Appearance. It does not change the bot's default language. Persian switches the whole panel to right-to-left layout. Numbers stay in ASCII digits.

## Free plan limits this design respects
| Limit | Value (Workers Free) | What the code does |
|---|---|---|
| CPU per request | 10 ms of CPU | Regex, small JSON, and PBKDF2 at 20,000 iterations (verify in a live deployment) |
| Memory per isolate | 128 MB | Media is streamed, never buffered whole; 50 MB cap enforced while streaming |
| Subrequests per request | 50 | A download uses a few calls to the source site and Telegram |
| Requests per day | 100,000 | Per-user limit of 5 downloads per minute (configurable) |
| Cron triggers | 5 | One hourly maintenance trigger |
| Telegram upload | 50 MB via the public Bot API | Files over the cap return a clear error |

## Troubleshooting
- **Panel says the database is not ready (503):** check the D1 binding `DB` in Settings > Bindings. It must point to `mediabot`.
- **Bot username is empty, or Test connection fails:** `BOT_TOKEN` is missing or wrong. Fix it in step 3.
- **Webhook shows 403 Forbidden:** the secret Telegram holds does not match `WEBHOOK_SECRET`. Create or edit the secret in Cloudflare, deploy or wait for the change to apply, then press **Register webhook**. Workers logs show `webhook_rejected` with `secret_header_missing` (no secret was sent, usually registered before the secret existed) or `secret_mismatch`.
- **500 `server_not_configured` in the logs:** `BOT_TOKEN` or `WEBHOOK_SECRET` is missing.
- **Build fails on GitHub:** open the build log in Workers & Pages > mediadownloaderbot > Deployments.
- **The panel shows old text after an update:** reload with Ctrl+Shift+R.
