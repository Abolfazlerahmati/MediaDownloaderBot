# Group privacy mode

Telegram bots have a **privacy mode** that controls which group messages they receive.

- **Privacy mode ON (Telegram's default):** the bot receives only commands addressed to it
  (`/start@bot_name`), replies to its own messages, and messages that mention it. It will **not** see
  a plain link posted in a group, so it cannot download it.
- **Privacy mode OFF:** the bot receives all group messages and can process links posted by members.
- A bot that is an **administrator** of the group receives all messages regardless of privacy mode.

## Recommended configuration
1. In @BotFather send `/setprivacy`, choose your bot, then **Disable**.
2. If the bot was already in a group, remove it and add it again (the setting applies on join).
   Alternatively promote it to administrator with no special rights.
3. Check: post a supported link in the group. The bot should reply to that message.

## Behaviour in groups (enforced by the bot, regardless of privacy mode)
- Only links from enabled platforms are handled; other text is ignored silently.
- Duplicate updates (Telegram retries) and repeated links within the duplicate window are ignored.
- Up to `max_urls_per_message` links are handled per message. The first status reply notes any extra links that were ignored.
- Per-user and per-chat rate limits apply (`rate_limit_user_per_minute`, `rate_limit_chat_per_minute`).
- Language buttons in groups change only the clicking user's own preference, and the group's shared
  messages are never edited. A toast confirms the change.

## Privacy consideration
With privacy mode disabled the bot technically receives every message in the group. The bot does not
store or log message text. It processes only messages that contain a recognized link, and discards
everything else in memory.
