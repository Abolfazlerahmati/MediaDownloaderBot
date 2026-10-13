"""Runtime settings: typed model, server-side validation, persistence and restart tracking.

Values are stored as one JSON document in the ``settings`` table. Settings listed in
``RESTART_REQUIRED`` keep their startup value until the process restarts; the admin
panel shows them as "pending restart" in the meantime.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from mediabot.db.repositories import SettingsRepo
from mediabot.i18n import Translator

logger = logging.getLogger("mediabot.settings")
SETTINGS_KEY = "runtime_settings"
LANG_CODE_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")


def _meta(group: str, label: str, help_text: str = "", *, restart: bool = False, unit: str = "") -> dict[str, Any]:
    return {"group": group, "label": label, "help": help_text, "restart": restart, "unit": unit}


class RuntimeSettings(BaseModel):
    model_config = ConfigDict(validate_assignment=True, extra="forbid")

    # --- language & bot behaviour -------------------------------------------
    default_language: str = Field("en", json_schema_extra=_meta(
        "Language", "Default language", "Used for new users and when no preference is stored."))
    available_languages: list[str] = Field(["en", "fa"], min_length=1, max_length=10,
                                           json_schema_extra=_meta("Language", "Available languages",
                                                                   "Languages users can choose from (codes, e.g. en, fa)."))
    maintenance_mode: bool = Field(False, json_schema_extra=_meta(
        "Bot behaviour", "Maintenance mode", "Valid links receive a maintenance notice instead of being processed."))
    max_urls_per_message: int = Field(3, ge=1, le=5, json_schema_extra=_meta(
        "Bot behaviour", "Links processed per message", "Extra links in one message are ignored.", unit="links"))
    rate_limit_user_per_minute: int = Field(6, ge=1, le=60, json_schema_extra=_meta(
        "Rate limits", "Links per user per minute", "Sliding window per Telegram user (kept in memory only)."))
    rate_limit_chat_per_minute: int = Field(30, ge=1, le=300, json_schema_extra=_meta(
        "Rate limits", "Links per chat per minute", "Sliding window per chat (kept in memory only)."))
    rate_limit_notice_seconds: int = Field(60, ge=10, le=600, json_schema_extra=_meta(
        "Rate limits", "Rate-limit notice cooldown", "Minimum time between rate-limit replies to the same user.", unit="s"))
    duplicate_window_seconds: int = Field(1800, ge=60, le=86400, json_schema_extra=_meta(
        "Rate limits", "Duplicate protection window", "Repeated updates for the same message and link are ignored in this window.", unit="s"))
    drop_pending_updates_on_start: bool = Field(True, json_schema_extra=_meta(
        "Bot behaviour", "Ignore updates received while offline",
        "Prevents a burst of stale downloads after downtime. Applied when the bot starts."))

    # --- downloads -------------------------------------------------------------
    max_file_size_mb: int = Field(50, ge=1, le=50, json_schema_extra=_meta(
        "Downloads", "Maximum file size", "Telegram Bot API upload limit is 50 MB.", unit="MB"))
    max_duration_minutes: int = Field(60, ge=0, le=1440, json_schema_extra=_meta(
        "Downloads", "Maximum media duration", "0 disables the duration limit.", unit="min"))
    download_timeout_seconds: int = Field(300, ge=30, le=1800, json_schema_extra=_meta(
        "Downloads", "Download timeout", "Upper bound for one download attempt.", unit="s"))
    probe_timeout_seconds: int = Field(90, ge=10, le=300, json_schema_extra=_meta(
        "Downloads", "Metadata timeout", "Upper bound for metadata extraction.", unit="s"))
    max_concurrent_downloads: int = Field(2, ge=1, le=8, json_schema_extra=_meta(
        "Downloads", "Maximum concurrent downloads", "Number of worker tasks.", restart=True))
    max_queue_length: int = Field(50, ge=1, le=500, json_schema_extra=_meta(
        "Downloads", "Queue limit", "New links are refused when this many jobs are waiting."))
    retry_max_attempts: int = Field(2, ge=0, le=5, json_schema_extra=_meta(
        "Downloads", "Retries for transient failures", "Only temporary failures and timeouts are retried."))
    retry_base_delay_seconds: int = Field(5, ge=1, le=60, json_schema_extra=_meta(
        "Downloads", "Retry base delay", "Doubles after each attempt (exponential backoff).", unit="s"))
    subprocess_memory_limit_mb: int = Field(2048, ge=0, le=8192, json_schema_extra=_meta(
        "Downloads", "Memory limit per download process", "0 disables the limit (Linux only).", unit="MB"))
    min_free_disk_mb: int = Field(512, ge=64, le=10240, json_schema_extra=_meta(
        "Storage", "Minimum free disk space", "New downloads are refused below this free space.", unit="MB"))

    # --- quality, formats and metadata ------------------------------------------
    default_max_video_height: int = Field(1080, ge=0, le=4320, json_schema_extra=_meta(
        "Quality & formats", "Preferred maximum video height", "A preference, not a hard limit. 0 = best available."))
    preferred_video_container: Literal["mp4", "mkv"] = Field("mp4", json_schema_extra=_meta(
        "Quality & formats", "Preferred video container", "mp4 is sent as a playable Telegram video."))
    preferred_audio_container: Literal["m4a", "mp3", "any"] = Field("m4a", json_schema_extra=_meta(
        "Quality & formats", "Preferred audio container", "Native streams are used; audio is never re-encoded."))
    metadata_embed_tags: bool = Field(True, json_schema_extra=_meta(
        "Quality & formats", "Embed source tags", "Adds title/artist tags by remuxing (no re-encoding)."))
    metadata_embed_audio_artwork: bool = Field(True, json_schema_extra=_meta(
        "Quality & formats", "Embed the item's own cover in audio", "Only the cover of the same item is used."))
    thumbnails_enabled: bool = Field(True, json_schema_extra=_meta(
        "Quality & formats", "Send the item's own thumbnail to Telegram", "No thumbnail is ever substituted from another item."))
    validate_with_ffmpeg: bool = Field(True, json_schema_extra=_meta(
        "Quality & formats", "Check files for readability before upload", "Runs ffmpeg in copy mode; no re-encoding."))

    # --- storage & retention --------------------------------------------------
    temp_directory: str = Field("", json_schema_extra=_meta(
        "Storage", "Temporary directory", "Blank uses the default (DATA_DIR/tmp). Requires restart.", restart=True))
    temp_retention_minutes: int = Field(60, ge=5, le=1440, json_schema_extra=_meta(
        "Storage", "Temporary file retention", "Leftover job folders older than this are removed.", unit="min"))
    preference_retention_days: int = Field(30, ge=1, le=365, json_schema_extra=_meta(
        "Privacy", "Language preference retention", "Stored language choices expire after this many days without change.", unit="days"))
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field("INFO", json_schema_extra=_meta(
        "Logging", "Log level", "Applies immediately."))
    log_retention_days: int = Field(14, ge=1, le=365, json_schema_extra=_meta(
        "Logging", "Log retention", "Older operational log entries are deleted.", unit="days"))
    log_max_rows: int = Field(100000, ge=1000, le=1000000, json_schema_extra=_meta(
        "Logging", "Maximum stored log entries", "Oldest entries are removed beyond this count."))

    # --- messages ------------------------------------------------------------------
    error_message_overrides: dict[str, dict[str, str]] = Field(default_factory=dict, json_schema_extra=_meta(
        "Messages", "Error message overrides", "Per language and message key. Plain text, max 300 characters."))

    # --- health -----------------------------------------------------------------
    health_check_interval_seconds: int = Field(120, ge=30, le=3600, json_schema_extra=_meta(
        "Health", "Health check interval", "Cheap local and Telegram checks.", unit="s"))
    platform_check_interval_minutes: int = Field(360, ge=0, le=10080, json_schema_extra=_meta(
        "Health", "Live platform test interval", "Enabled platforms are re-tested this often. 0 disables.", unit="min"))

    # --- validators ---------------------------------------------------------------
    @field_validator("default_language")
    @classmethod
    def _lang_format(cls, value: str) -> str:
        if not LANG_CODE_RE.match(value):
            raise ValueError("must be a language code such as en or fa")
        return value

    @field_validator("available_languages")
    @classmethod
    def _langs_format(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for code in value:
            if not LANG_CODE_RE.match(code):
                raise ValueError(f"'{code}' is not a valid language code")
            if code not in cleaned:
                cleaned.append(code)
        return cleaned

    @field_validator("default_max_video_height")
    @classmethod
    def _height(cls, value: int) -> int:
        if 0 < value < 144:
            raise ValueError("must be 0 or at least 144")
        return value

    @field_validator("temp_directory")
    @classmethod
    def _temp_dir(cls, value: str) -> str:
        value = value.strip()
        if value and not Path(value).is_absolute():
            raise ValueError("must be an absolute path")
        if len(value) > 300:
            raise ValueError("path is too long")
        return value


RESTART_REQUIRED = frozenset(
    name for name, f in RuntimeSettings.model_fields.items()
    if (f.json_schema_extra or {}).get("restart")  # type: ignore[union-attr]
)


class SettingsValidationError(Exception):
    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__("settings validation failed")
        self.errors = errors


def settings_schema() -> list[dict[str, Any]]:
    schema: list[dict[str, Any]] = []
    for name, field in RuntimeSettings.model_fields.items():
        extra = dict(field.json_schema_extra or {})  # type: ignore[arg-type]
        annotation = field.annotation
        kind = "text"
        choices: list[str] = []
        origin = getattr(annotation, "__origin__", None)
        if annotation is bool:
            kind = "bool"
        elif annotation is int:
            kind = "int"
        elif origin is Literal:
            kind = "choice"
            choices = list(annotation.__args__)  # type: ignore[attr-defined]
        elif annotation is str:
            kind = "text"
        elif origin is list:
            kind = "list"
        elif origin is dict:
            kind = "messages"
        meta = next((m for m in field.metadata if hasattr(m, "ge") or hasattr(m, "le")), None)
        schema.append({
            "key": name,
            "kind": kind,
            "choices": choices,
            "min": getattr(meta, "ge", None),
            "max": getattr(meta, "le", None),
            "group": extra.get("group", "Other"),
            "label": extra.get("label", name),
            "help": extra.get("help", ""),
            "unit": extra.get("unit", ""),
            "restart_required": bool(extra.get("restart")),
        })
    return schema


class SettingsService:
    def __init__(self, repo: SettingsRepo, translator: Translator) -> None:
        self._repo = repo
        self._translator = translator
        stored = self._load_stored()
        self._stored = stored
        # Values that need a restart keep the value that was active at startup.
        self._applied: dict[str, Any] = {k: getattr(stored, k) for k in RESTART_REQUIRED}

    # ----- loading --------------------------------------------------------
    def _load_stored(self) -> RuntimeSettings:
        raw = self._repo.get(SETTINGS_KEY)
        if not raw:
            return RuntimeSettings()
        try:
            data = json.loads(raw)
            return RuntimeSettings.model_validate(data)
        except (ValueError, ValidationError) as exc:
            logger.error("stored runtime settings are invalid; defaults are used: %s", exc.__class__.__name__,
                         extra={"category": "config_invalid"})
            return RuntimeSettings()

    # ----- access ------------------------------------------------------------
    def stored(self) -> RuntimeSettings:
        return self._stored

    def current(self) -> RuntimeSettings:
        """Effective settings: live values, with restart-required values as applied at startup."""
        data = self._stored.model_dump()
        data.update(self._applied)
        return RuntimeSettings.model_validate(data)

    def pending_restart(self) -> list[str]:
        return sorted(k for k in RESTART_REQUIRED if getattr(self._stored, k) != self._applied.get(k))

    def values_for_api(self) -> dict[str, Any]:
        return self._stored.model_dump()

    # ----- mutation ----------------------------------------------------------
    def update(self, changes: dict[str, Any]) -> tuple[list[str], list[str]]:
        """Validate and persist changes. Returns (changed_keys, pending_restart_keys)."""
        # Collect every problem in one pass so the admin sees all invalid fields at once.
        errors: dict[str, str] = {k: "Unknown setting." for k in changes if k not in RuntimeSettings.model_fields}
        merged = self._stored.model_dump()
        merged.update({k: v for k, v in changes.items() if k in RuntimeSettings.model_fields})
        try:
            candidate = RuntimeSettings.model_validate(merged)
        except ValidationError as exc:
            for err in exc.errors():
                field = str(err["loc"][0]) if err["loc"] else "settings"
                errors.setdefault(field, str(err["msg"]).replace("Value error, ", ""))
            raise SettingsValidationError(errors) from exc
        errors.update(self._cross_validate(candidate))
        if errors:
            raise SettingsValidationError(errors)
        changed = [k for k in changes if getattr(self._stored, k) != getattr(candidate, k)]
        if changed:
            self._repo.set(SETTINGS_KEY, candidate.model_dump_json())
            self._stored = candidate
        return changed, self.pending_restart()

    def _cross_validate(self, settings: RuntimeSettings) -> dict[str, str]:
        errors: dict[str, str] = {}
        for code in settings.available_languages:
            if not self._translator.is_supported(code):
                errors["available_languages"] = f"No translation file exists for '{code}'."
                break
        if settings.default_language not in settings.available_languages:
            errors["default_language"] = "The default language must be one of the available languages."
        for lang, overrides in settings.error_message_overrides.items():
            if not self._translator.is_supported(lang):
                errors["error_message_overrides"] = f"Unknown language '{lang}'."
                break
            for key, text in overrides.items():
                if key not in self._translator.keys():
                    errors["error_message_overrides"] = f"Unknown message key '{key}'."
                    break
                if len(text) > 300 or "{" in text or "}" in text or "<" in text:
                    errors["error_message_overrides"] = "Overrides must be plain text up to 300 characters without braces or '<'."
                    break
        if settings.temp_directory:
            path = Path(settings.temp_directory)
            if path.exists() and not os.access(path, os.W_OK):
                errors["temp_directory"] = "The directory is not writable by the application."
        return errors
