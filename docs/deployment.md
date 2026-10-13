# Deployment

## Option A: Docker Compose (recommended)
> The Dockerfile and compose file were written in an environment without a Docker daemon and have
> **not been built or run** by the authors. Treat the first `docker compose build` as a verification
> step and follow the troubleshooting guide if it fails.

```bash
cp .env.example .env
# edit .env: APP_SECRET_KEY (python -m mediabot gen-secret), BOT_TOKEN (optional)
docker compose build
docker compose run --rm app check
docker compose run --rm app create-admin --username admin --password-stdin
docker compose up -d
docker compose logs -f app
```

What the compose file does:
- Publishes the panel on `127.0.0.1:8080` only. Put a TLS reverse proxy (Caddy, nginx, Traefik) in
  front of it for remote access, and keep `ADMIN_COOKIE_SECURE=true`.
- Mounts `./data` to `/data` for the SQLite database and temporary files.
- Runs as a non-root user, read-only root filesystem, `no-new-privileges`, all capabilities dropped.
- `restart: unless-stopped` plus `RESTART_SUPERVISED=true`, so a panel-initiated restart (exit code 75)
  is picked up by Docker.

## Option B: systemd on a Linux host
Create a service user and virtualenv, then use a unit like this (adjust paths):
```ini
[Unit]
Description=MediaDownloaderBot
After=network-online.target
Wants=network-online.target

[Service]
User=mediabot
WorkingDirectory=/opt/mediabot
EnvironmentFile=/opt/mediabot/.env
ExecStart=/opt/mediabot/.venv/bin/python -m mediabot run
Restart=on-failure
RestartForceExitStatus=75
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/opt/mediabot/data
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```
Set `RESTART_SUPERVISED=true` in `.env` so the panel's restart button is honoured.
Install `ffmpeg` with your package manager.

## Reverse proxy (remote access)
- Terminate TLS at the proxy and forward to `127.0.0.1:8080`.
- The panel does not trust `X-Forwarded-*` headers. Login rate limits and cookie decisions use the
  direct peer address, which will be the proxy. Limit access to the panel at the proxy (IP allow-list,
  VPN, or basic auth in front of the login page) if you expose it publicly.
- Do not expose port 8080 directly to the internet.

## Upgrades
1. Back up the data directory (see `backup-recovery.md`).
2. Replace the code and run `python -m mediabot migrate` (also run automatically on start).
3. Restart the service.
