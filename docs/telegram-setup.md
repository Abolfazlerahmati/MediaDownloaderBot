# Telegram setup

1. Open @BotFather in Telegram and send `/newbot`. Choose a display name and a username ending in `bot`.
2. Copy the token (format `123456789:AA...`). Treat it as a password.
3. Provide the token in one of two ways:
   - **Environment (read-only in the panel):** set `BOT_TOKEN` in `.env`. The panel shows the source
     as "environment" and does not allow editing it.
   - **Admin panel:** Bot & health → Token → paste. It is encrypted with a key derived from
     `APP_SECRET_KEY` and stored in the database. The panel shows only the first four and last four
     characters.
4. Recommended BotFather settings:
   - `/setdescription`, `/setabouttext`, `/setuserpic` — optional branding.
   - `/setcommands` — optional; the bot handles `/start` itself.
   - `/setjoingroups` — Enable if you want the bot in groups.
   - `/setprivacy` — see `group-privacy-mode.md`. Required for group link handling.
5. Start the process (`python -m mediabot run`) or use the panel's Start button on Bot & health.
6. Send `/start` to the bot in a private chat. You should see the welcome message and English/فارسی
   buttons.

## What the bot does
- **Private chats:** every message containing a supported public link is handled. `/start` shows the
  welcome message.
- **Groups and supergroups:** the bot answers only when explicitly addressed. In a group, `/start`
  works only as `/start@your_bot_username`. Links are handled only if the bot can see the messages
  (see privacy mode).
- The bot never deletes user messages and never answers unrelated text. Each accepted link gets one
  status reply to the message that contained it, which is then updated in place with the result. Up to
  `max_urls_per_message` links are accepted per message; the first status reply notes any that were ignored.
- Commands: `/start` (welcome and language buttons), `/help`, `/language`.

## Verifying the token
Bot & health → Test Telegram API (calls `getMe`). The result shows the bot username on success.
The result appears in the health snapshot shown on that page.
