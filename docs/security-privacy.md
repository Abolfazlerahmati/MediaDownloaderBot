# Security and privacy

## Admin panel
- Passwords are hashed with Argon2id. Minimum 12 characters.
- Sessions use a random token; only its hash is stored. Cookies are `HttpOnly`, `SameSite=Strict`,
  and `Secure` by default. Sessions expire after `SESSION_TTL_HOURS`.
- CSRF protection: double-submit token plus an `Origin` check on every unsafe method. Cross-origin
  POSTs are rejected with 403.
- Login throttling in memory: 5 failures per 15 minutes per IP and per username.
- Authorization is enforced server-side on every API route. The UI is only a convenience.
- Strict Content Security Policy (`default-src 'self'`, no inline scripts or styles, `frame-ancestors 'none'`),
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Secrets (bot token, `APP_SECRET_KEY`) are never displayed in full. The bot token is encrypted at
  rest with a key derived from `APP_SECRET_KEY`.
- Settings and platform configuration are validated on the server; the UI validation is not trusted.
- Diagnostics and logs are redacted: bot token patterns, `password=`/`token=`-style pairs, cookies,
  and URL query strings and credentials are removed before storage or display.
- Known limitation: there is no Host allow-list and no IP allow-list. Restrict exposure at the proxy.

## Media downloads
- Only public media from the configured platforms. The bot does not attempt to bypass logins,
  paywalls, private accounts, or DRM. Private or login-only content is reported as inaccessible.
- URLs are checked before download: scheme and host must match the platform's configured domains,
  and the destination must resolve to a public address (SSRF guard). Userinfo, non-standard ports,
  and private/loopback/link-local addresses are rejected.
- Downloads run as argv subprocesses (no shell), with process-group kill on timeout, output caps, and a
  minimal environment that does not inherit the bot token.
- Downloaded files are checked by magic bytes and, when enabled, decoded by ffmpeg before delivery.
- Filenames are sanitized (path separators, control and bidirectional override characters removed).

## Privacy
- No user-profile database. Telegram user IDs and chat IDs are never stored in clear. Only a keyed
  HMAC of the user ID is used, and only when minimal mode keeps a language preference.
- Not stored: usernames, names, phone numbers, message text, file contents, or download history.
- Temporary media is deleted after each job and swept on a timer.
- `PERSISTENCE_MODE=temporary` keeps even the language preference in memory only.
- Operational logs contain categories, platform keys, job IDs, and redacted messages. They do not contain
  message text or full URLs (only scheme, host and path are kept).

## Responsibilities
You are responsible for using the bot in line with each platform's terms of service and applicable law,
and for respecting copyright. Do not use it to download content you have no right to copy.
