# Administrator setup

## Default administrator on a fresh installation
On the first start, when no administrator exists, the bot creates **`admin` / `12345678`** and marks it *must change
password*. Signing in shows the Account page, and the rest of the panel stays locked (the API returns 403) until you
enter `12345678` as the current password and choose a new one (at least 12 characters). Set
`DEFAULT_ADMIN_ENABLED=false` to skip the default account (for example on a machine that is never exposed).

## Create an administrator from the command line
```bash
python -m mediabot create-admin --username admin --password-stdin
```
Type the password and press Enter (it is not shown on screen and not stored in shell history).
Usernames are case-insensitive and stored in lowercase. Passwords must be 12–256 characters.
Creating a second administrator with the same username is rejected.

In Docker:
```bash
docker compose run --rm app create-admin --username admin --password-stdin
```

## Reset a forgotten password
```bash
python -m mediabot reset-password --username admin --password-stdin
```
A reset ends the account's existing sessions. Restart is not needed.

## Sign in
Open the panel URL, enter the username and password. Five failed attempts within 15 minutes for the
same IP address or username lock further attempts for that window (HTTP 429).

## Change password and appearance
- Account page: change password (current password required; all other sessions are invalidated).
- Account page: choose the design theme (Merchant SEP style or iOS-inspired) and the colour mode
  (light, dark, or follow system). Your choice is saved to your administrator account.

## Sessions
Sessions last `SESSION_TTL_HOURS` (default 12) and are stored as hashes. Sign out from the top bar.
