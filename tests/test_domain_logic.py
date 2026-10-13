import pytest

from mediabot.jobs.guards import SlidingWindowLimiter, TTLCache
from mediabot.media.delivery import DeliveryKind, choose_delivery
from mediabot.platforms.base import MediaType
from mediabot.platforms.validation import FieldErrors, validate_platform
from mediabot.services.settings import SettingsService, SettingsValidationError
from mediabot.db.repositories import SettingsRepo
from mediabot.i18n import get_translator
from mediabot.services.token_store import BotTokenStore
from mediabot.security.secrets_box import SecretBox

from .conftest import TEST_SECRET, VALID_TOKEN


# ----------------------------------------------------------------------- delivery
@pytest.mark.parametrize("media,ext,kind", [
    (MediaType.VIDEO, "mp4", DeliveryKind.VIDEO),
    (MediaType.AUDIO, "mp3", DeliveryKind.AUDIO),
    (MediaType.AUDIO, "m4a", DeliveryKind.AUDIO),
    (MediaType.AUDIO, "ogg", DeliveryKind.DOCUMENT),
    (MediaType.VIDEO, "mkv", DeliveryKind.DOCUMENT),
    (MediaType.IMAGE, "jpg", DeliveryKind.DOCUMENT),
])
def test_delivery_kind(media, ext, kind):
    assert choose_delivery(media, ext) == kind


# ----------------------------------------------------------------------- guards
def test_ttl_cache_expires_entries():
    now = [0.0]
    cache = TTLCache(clock=lambda: now[0])
    assert cache.seen_or_add("k", 10) is False
    assert cache.seen_or_add("k", 10) is True
    now[0] = 11
    assert cache.seen_or_add("k", 10) is False


def test_limiter_multi_key_is_atomic():
    limiter = SlidingWindowLimiter()
    assert limiter.try_acquire([("a", 2), ("b", 1)]) is True
    assert limiter.try_acquire([("a", 2), ("b", 1)]) is False  # b exhausted
    # 'a' must not have been charged by the rejected attempt
    assert limiter.try_acquire([("a", 2)]) is True
    assert limiter.try_acquire([("a", 2)]) is False


# ----------------------------------------------------------------------- platform validation
def valid_payload(**overrides):
    payload = {
        "key": "vimeo",
        "name": "Vimeo",
        "adapter": "generic_ytdlp",
        "domains": ["vimeo.com"],
        "url_patterns": [],
        "allowed_media_types": ["video"],
        "max_file_size_mb": 30,
        "options": {"keep_query": False},
    }
    payload.update(overrides)
    return payload


def test_valid_platform_is_normalised():
    values = validate_platform(valid_payload(), creating=True, existing_keys=set())
    assert values["domains"] == ["vimeo.com"]
    assert values["options"]["keep_query"] is False


@pytest.mark.parametrize("payload,field", [
    (valid_payload(key="Bad Key"), "key"),
    (valid_payload(key="youtube"), "key"),
    (valid_payload(adapter="shell_exec"), "adapter"),
    (valid_payload(max_file_size_mb=500), "max_file_size_mb"),
    (valid_payload(format_selector="-o /etc/x"), "format_selector"),
    (valid_payload(options={"rm_rf": True}), "options.rm_rf"),
    (valid_payload(allowed_media_types=[]), "allowed_media_types"),
])
def test_invalid_platform_payloads_name_the_field(payload, field):
    with pytest.raises(FieldErrors) as info:
        validate_platform(payload, creating=True, existing_keys={"youtube"})
    assert field in info.value.errors


# ----------------------------------------------------------------------- settings
def test_settings_validation_and_restart_flags(db):
    service = SettingsService(SettingsRepo(db), get_translator())
    assert service.current().default_language == "en"
    with pytest.raises(SettingsValidationError) as info:
        service.update({"max_file_size_mb": 0})
    assert "max_file_size_mb" in info.value.errors
    with pytest.raises(SettingsValidationError):
        service.update({"no_such_setting": 1})
    changed, pending = service.update({"max_concurrent_downloads": 4, "maintenance_mode": True})
    assert set(changed) == {"max_concurrent_downloads", "maintenance_mode"}
    assert "max_concurrent_downloads" in pending
    assert service.current().maintenance_mode is True
    assert service.current().max_concurrent_downloads != 4, "restart-required values apply only after restart"


def test_settings_persist_across_service_instances(db):
    SettingsService(SettingsRepo(db), get_translator()).update({"maintenance_mode": True})
    assert SettingsService(SettingsRepo(db), get_translator()).current().maintenance_mode is True


# ----------------------------------------------------------------------- bot token store
def test_token_store_masks_and_prefers_environment(db):
    repo = SettingsRepo(db)
    store = BotTokenStore(repo, None, SecretBox(TEST_SECRET))
    assert store.source() == "none"
    store.set_token(VALID_TOKEN)
    assert store.get_token() == VALID_TOKEN
    masked = store.masked()
    assert VALID_TOKEN not in masked and masked.startswith("1234") and masked.endswith("AAAA")
    assert "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" not in repo.get("bot_token_encrypted")  # stored encrypted
    with pytest.raises(ValueError):
        store.set_token("not-a-token")
    env_store = BotTokenStore(repo, "987654321:" + "B" * 35, SecretBox(TEST_SECRET))
    assert env_store.source() == "environment"
    assert env_store.get_token().startswith("987654321:")
    store.clear()
    assert store.get_token() is None


def test_all_invalid_settings_are_reported_together(db):
    service = SettingsService(SettingsRepo(db), get_translator())
    with pytest.raises(SettingsValidationError) as info:
        service.update({"no_such_key": 1, "max_file_size_mb": 9999, "log_level": "TRACE"})
    fields = info.value.errors
    assert {"no_such_key", "max_file_size_mb", "log_level"} <= set(fields)
