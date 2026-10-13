
import pytest

from mediabot.errors import UnsafeDestinationError
from mediabot.media.filenames import build_display_name
from mediabot.observability.redact import redact, redact_url
from mediabot.security.passwords import hash_password, password_problem, verify_password
from mediabot.security.secrets_box import SecretBox
from mediabot.security.ssrf import ensure_public_destination, split_and_validate_syntax
from mediabot.urls.detect import MessageEntity, extract_candidates, parse_candidate

from .conftest import TEST_SECRET


# ----------------------------------------------------------------------- filenames
def test_persian_title_and_zwnj_are_preserved():
    name = build_display_name("بی‌خیال فردا", "mp4", fallback_stem="youtube-x")
    assert name.endswith(".mp4")
    assert "\u200c" in name, "ZWNJ must survive sanitisation"
    assert "فردا" in name


def test_dangerous_characters_are_replaced_and_bidi_overrides_removed():
    name = build_display_name('a/b\\c:d*e?f"g<h>i|j\u202eevil', "mp3", fallback_stem="x")
    for ch in '/\\:*?"<>|\u202e':
        assert ch not in name
    assert name.endswith(".mp3")


def test_reserved_windows_names_and_length_cap():
    assert not build_display_name("CON", "mp4", fallback_stem="x").startswith("CON.")
    long_name = build_display_name("ب" * 300, "mp4", fallback_stem="x")
    assert len(long_name.encode("utf-8")) <= 200


def test_missing_title_uses_fallback():
    assert build_display_name(None, "m4a", fallback_stem="youtube-abc").startswith("youtube-abc")


# ----------------------------------------------------------------------- redaction
def test_bot_token_in_telegram_url_is_redacted():
    text = "POST https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/getMe failed"
    out = redact(text)
    assert "AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" not in out
    assert "123456789:" not in out


def test_url_query_and_userinfo_are_dropped():
    assert redact_url("https://user:pw@example.com/a/b?token=secret#frag") == "https://example.com/a/b"


def test_known_secrets_and_key_value_pairs_are_redacted():
    out = redact("password=hunter22 and cookie: abc123 for key sk-live-xyz", ["sk-live-xyz"])
    assert "hunter22" not in out and "abc123" not in out and "sk-live-xyz" not in out


# ----------------------------------------------------------------------- URL detection
def test_extracts_scheme_less_domains_and_strips_trailing_punctuation():
    found = extract_candidates("look youtube.com/watch?v=abc, and https://tiktok.com/@a/video/1.")
    assert "https://youtube.com/watch?v=abc" in found  # scheme-less input is normalised
    assert "https://tiktok.com/@a/video/1" in found


def test_utf16_entity_offsets_are_respected():
    text = "😀 https://youtu.be/abc"  # the emoji is two UTF-16 code units
    entity = MessageEntity(type="url", offset=3, length=len("https://youtu.be/abc"))
    assert extract_candidates(text, [entity]) == ["https://youtu.be/abc"]


def test_duplicates_are_removed_and_non_public_forms_rejected():
    found = extract_candidates("https://youtu.be/a https://youtu.be/a")
    assert found == ["https://youtu.be/a"]
    assert parse_candidate("ftp://youtu.be/a") is None


# ----------------------------------------------------------------------- SSRF guard
@pytest.mark.parametrize("url", [
    "http://user:pw@example.com/",
    "ftp://example.com/",
    "http://example.com:8080/",
])
def test_syntax_rejects_unsafe_urls(url):
    with pytest.raises(UnsafeDestinationError):
        split_and_validate_syntax(url)


async def test_private_ip_literals_are_rejected():
    for url in ("http://127.0.0.1/", "http://10.0.0.5/", "http://169.254.169.254/latest"):
        with pytest.raises(UnsafeDestinationError):
            await ensure_public_destination(url)


# ----------------------------------------------------------------------- passwords & secrets
def test_password_hash_roundtrip_and_policy():
    stored = hash_password("correct horse battery")
    assert stored.startswith("$argon2id$")
    assert verify_password(stored, "correct horse battery")
    assert not verify_password(stored, "wrong horse battery!")
    assert not verify_password(None, "anything at all")
    assert password_problem("short") is not None
    assert password_problem("x" * 300) is not None
    assert password_problem("a long enough passphrase") is None


def test_secret_box_roundtrip_and_keyed_hashes_are_stable():
    box = SecretBox(TEST_SECRET)
    assert box.decrypt(box.encrypt("123456789:token")) == "123456789:token"
    assert box.user_key(42) == SecretBox(TEST_SECRET).user_key(42)
    assert box.user_key(42) != box.user_key(43)
    assert "42" not in box.user_key(42)
