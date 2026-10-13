# Deploying on Cloudflare (free plan)

Everything runs on Cloudflare's free plan: a Worker (webhook and admin API), D1 (database), and KV (reserved).
No Containers, no Durable Objects, no VPS, and no computer that must stay on.

## 1. Create the Telegram bot
1. In Telegram, open @BotFather, send `/newbot`, and copy the token.
2. Keep the token secret. Do not put it in Git, in `wrangler.toml`, or in chat.

## 2. Secrets (Cloudflare Secrets, not the repository)
Run these once from a machine with Wrangler (or set the same names in Workers Builds under Variables and Secrets):

```sh
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET   # any random string, 32+ characters
```

`WEBHOOK_SECRET` is checked on every Telegram request. Generate it with a password manager or `openssl rand -hex 32`.

## 3. Database
The D1 database `mediabot` and the KV namespace `CACHE` are already declared in `wrangler.toml`.
Apply the schema (safe to run again):

```sh
npx wrangler d1 migrations apply mediabot --remote
```

## 4. Deploy
```sh
npx wrangler deploy
```

The Worker is then at `https://mediadownloaderbot.<your-subdomain>.workers.dev`.
Check it with `curl https://mediadownloaderbot.<your-subdomain>.workers.dev/health`.

## 5. Register the webhook
Telegram must call the Worker, and it must send the same secret back. Replace the three placeholders.
Do this once after the first deploy (and again if the URL or the secret changes):

```sh
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  --data-urlencode "url=https://mediadownloaderbot.<your-subdomain>.workers.dev/telegram/webhook" \
  --data-urlencode "secret_token=<WEBHOOK_SECRET>" \
  --data-urlencode "allowed_updates=[\"message\"]"
```

Check the result with `https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo`.
Do not paste the token into chat or into a public log.

## 6. Automatic deploys (Workers Builds, optional)
Connect the repository in Workers & Pages > Create > Import a repository. Then set:

- **Production branch:** the branch that contains this project.
- **Build command:** `sh scripts/workers-build.sh`
- **Deploy command:** `npx wrangler deploy --config=wrangler.build.toml; status=$?; rm -f wrangler.build.toml; exit $status`

The build script copies `wrangler.toml` and fills in the D1 and KV ids. It fails with a clear message when the branch
does not contain `wrangler.toml`. Set `BOT_TOKEN` and `WEBHOOK_SECRET` as secrets in the project settings.

## Free plan limits this design respects
| Limit | Value (Workers Free) | What the code does |
|---|---|---|
| CPU per request | 10 ms | Regex and small JSON parsing only; media is streamed |
| Memory per isolate | 128 MB | No full-file buffering; 50 MB cap enforced while streaming |
| Subrequests per request | 50 | About 4 per update |
| Requests per day | 100,000 | Per-user limit of 5 downloads per minute |

## Troubleshooting
- **403 from the webhook:** the `WEBHOOK_SECRET` in Telegram does not match the Worker secret. Run `setWebhook` again.
- **500 `server_not_configured`:** `BOT_TOKEN` or `WEBHOOK_SECRET` is missing.
- **`no such table: download_jobs`:** the migration was not applied. Run step 3.
- **Bot does not answer:** check `getWebhookInfo` for `last_error_message`, then the Worker logs in the dashboard.
