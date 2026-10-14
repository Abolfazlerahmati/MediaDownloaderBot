# Privacy

This describes what the bot and the panel store, how long, and why. It matches the code in `src/db/schema.ts`,
`src/db/store.ts` (retention), and `src/bot/deps.ts` (what is hashed).

## What is stored

| Table | What it holds | Kept for |
|---|---|---|
| `user_prefs` | Telegram user ID and chosen language (`en`/`fa`) | `language_retention_days` (default 90). Nothing is stored when **Store each user's language choice** is off. |
| `rate_events` | Hash of the user ID and a timestamp, one row per started download | 1 hour |
| `dedupe_keys` | Hash of chat ID plus link, and hashes of Telegram `update_id`s | 24 hours |
| `active_jobs` | Random job ID and start time, one row per running download | Removed when the download ends. Leftovers are ignored after the time limit plus a minute and deleted after 1 hour. |
| `app_logs` | Time, severity, event name, platform, and an error code | `log_retention_days` (default 7, max 90) |
| `login_attempts` | Hashed username and time of each failed login | 24 hours |
| `panel_sessions` | Hash of each session token and its expiry | Until expiry (12 hours) |
| `panel_users` | Panel usernames and PBKDF2 password hashes | Until removed |
| `media_platforms`, `app_settings`, `bot_state` | Platform switches and sample links, panel settings, bot username and webhook state | Until changed |
| `schema_migrations` | Which schema versions have been applied | Permanent |

## What is not stored

- Message text, downloaded files, and the full link of any download. Links are hashed for dedupe.
- Usernames, names, and phone numbers from Telegram.
- Logs never contain tokens, full links, user IDs, or message text. The detail field holds an error code and, when the source site gave one, its HTTP status or a short status name such as `LOGIN_REQUIRED`.
- The bot token and the webhook secret are Cloudflare Secrets. They are not in the code, the database, or the logs.

## Why IDs are hashed

User IDs and links are hashed with `WEBHOOK_SECRET` as a salt before they are stored for rate limits and dedupe.
Changing the webhook secret therefore resets these counters, which is intended.

The one exception is `user_prefs`, which needs the plain Telegram user ID to remember a language choice. It is
the only table with a plain user ID, and it is the table the "store language" switch controls.

## Temporary mode (store language off)

Set **Store each user's language choice** to off in the panel. From then on:
- the bot does not write any language choice,
- every user gets the default language,
- existing choices are deleted at the next hourly cleanup.

## Panel data

Panel usernames, password hashes, and session hashes are stored. State-changing panel requests need a valid session,
a CSRF token, and a matching Origin. Failed logins are throttled per username for 15 minutes.

## Limits that affect what is kept

- The rate limit checks the count and then records the download, in two steps. Two links sent at the same instant
  can both pass a limit of 5, so a burst can go slightly over. The job limit is one statement and does not.
- Dedupe is atomic: a link inside its window is never started twice.
- Free-plan quotas (D1 writes and reads, Workers requests) are shared with the panel. Every group message that
  mentions the bot, and every update, writes one row to `dedupe_keys` for its update ID. If a quota runs out,
  Cloudflare rejects the requests until the daily reset.

## Your responsibilities

- Only use the bot for content you have the right to download.
- Tell the people in your group what the bot stores, if you enable group mode.
- The default panel password (`admin` / `12345678`) is public. Change it on first login.
