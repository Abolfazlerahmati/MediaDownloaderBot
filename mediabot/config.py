"""Environment-based configuration (validated at startup).

Only deployment-level settings live here. Operator-tunable behaviour (limits,
languages, themes, retention ...) is stored in the database and managed from the
admin panel - see ``mediabot.services.settings``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MIN_SECRET_LENGTH = 32


class ConfigError(RuntimeError):
    """Raised when required deployment configuration is missing or invalid."""


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_secret_key: str | None = None
    bot_token: str | None = None

    data_dir: Path = Path("data")
    database_path: Path | None = None
    temp_dir: Path | None = None

    admin_host: str = "127.0.0.1"
    admin_port: int = Field(default=8080, ge=1, le=65535)
    admin_cookie_secure: bool = True
    session_ttl_hours: int = Field(default=12, ge=1, le=168)

    enable_bot: bool = True
    enable_web: bool = True
    # polling: the bot asks Telegram for updates (needs a long-running process).
    # webhook: Telegram pushes updates to <webhook_base_url>/telegram/webhook (for Cloudflare Containers).
    bot_mode: Literal["polling", "webhook"] = "polling"
    webhook_base_url: str | None = None
    # sqlite: local file (default). d1: Cloudflare D1 through the Worker bridge (Cloudflare deployment).
    db_backend: Literal["sqlite", "d1"] = "sqlite"
    db_bridge_url: str | None = None
    db_bridge_token: str | None = None

    # Create admin 'admin' with password 12345678 on the first start when no administrator exists.
    # The password must be changed at the first sign-in. Set to false to disable the default account.
    default_admin_enabled: bool = True
    persistence_mode: Literal["minimal", "temporary"] = "minimal"
    ffmpeg_path: str | None = None
    restart_supervised: bool = False

    @field_validator("bot_token", mode="before")
    @classmethod
    def _blank_token_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("app_secret_key", mode="before")
    @classmethod
    def _blank_secret_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    # ----- derived paths -------------------------------------------------
    @property
    def resolved_data_dir(self) -> Path:
        return self.data_dir.expanduser().resolve()

    @property
    def resolved_database_path(self) -> Path:
        if self.database_path is not None:
            return self.database_path.expanduser().resolve()
        return self.resolved_data_dir / "app.db"

    @property
    def resolved_temp_dir(self) -> Path:
        if self.temp_dir is not None:
            return self.temp_dir.expanduser().resolve()
        return self.resolved_data_dir / "tmp"

    def validation_problems(self) -> list[str]:
        """Return human-readable problems that prevent the application from starting."""
        problems: list[str] = []
        if not self.app_secret_key:
            problems.append(
                "APP_SECRET_KEY is not set. Generate one with "
                "`python -m mediabot.cli gen-secret` and put it in your .env file."
            )
        elif len(self.app_secret_key) < MIN_SECRET_LENGTH:
            problems.append(
                f"APP_SECRET_KEY must be at least {MIN_SECRET_LENGTH} characters long."
            )
        if not self.enable_bot and not self.enable_web:
            problems.append("Both ENABLE_BOT and ENABLE_WEB are false; nothing to run.")
        if self.db_backend == "d1":
            if not self.db_bridge_url or not self.db_bridge_url.startswith(("https://", "http://127.0.0.1", "http://localhost")):
                problems.append("DB_BACKEND=d1 requires DB_BRIDGE_URL (https://...). Plain http is allowed only for localhost tests.")
            if not self.db_bridge_token or len(self.db_bridge_token) < 32:
                problems.append("DB_BACKEND=d1 requires DB_BRIDGE_TOKEN (set by the Worker; at least 32 characters).")
        if self.enable_bot and self.bot_mode == "webhook":
            if not self.webhook_base_url or not self.webhook_base_url.startswith("https://"):
                problems.append("BOT_MODE=webhook requires WEBHOOK_BASE_URL to be a public https:// URL.")
            if not self.enable_web:
                problems.append("BOT_MODE=webhook needs ENABLE_WEB=true: the webhook is served by the web process.")
        return problems

    def require_valid(self) -> None:
        problems = self.validation_problems()
        if problems:
            raise ConfigError("\n".join(f"- {p}" for p in problems))


def load_config() -> AppConfig:
    """Load configuration from the environment / .env file."""
    return AppConfig()
