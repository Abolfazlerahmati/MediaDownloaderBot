"""Server-side validation of administrator-supplied platform configuration.

Administrators pick an adapter *type* from the registry; they can supply domains,
URL patterns, limits and adapter options, but never code. Every value is checked
here before it is stored.
"""

from __future__ import annotations

import re
from typing import Any

from mediabot.errors import UnsafeDestinationError
from mediabot.platforms.base import OptionSpec
from mediabot.platforms.registry import adapter_class
from mediabot.platforms.service import domain_matches
from mediabot.security.ssrf import is_valid_public_hostname, split_and_validate_syntax

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")
NAME_MAX = 60
MEDIA_TYPES = ("video", "audio", "image")
FORMAT_SELECTOR_RE = re.compile(r"^[A-Za-z0-9_\[\]()+/*\-.=<>:!&'\" ]{1,200}$")
NESTED_QUANTIFIER_RE = re.compile(r"\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]")


class FieldErrors(Exception):
    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__("validation failed")
        self.errors = errors


def _strings(value: Any, field: str, errors: dict[str, str], *, max_items: int) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [line for line in re.split(r"[\n,]", value)]
    if not isinstance(value, list):
        errors[field] = "Must be a list."
        return []
    cleaned = [str(v).strip() for v in value if str(v).strip()]
    if len(cleaned) > max_items:
        errors[field] = f"At most {max_items} entries are allowed."
    return cleaned


def normalize_domain(raw: str) -> str:
    value = raw.strip().lower()
    value = re.sub(r"^https?://", "", value)
    value = value.split("/")[0].rstrip(".")
    value = value.removeprefix("www.")
    return value


def _int_or_none(value: Any, field: str, errors: dict[str, str], lo: int, hi: int) -> int | None:
    if value in (None, ""):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        errors[field] = "Must be a whole number."
        return None
    if not lo <= number <= hi:
        errors[field] = f"Must be between {lo} and {hi}."
        return None
    return number


def _validate_options(adapter_cls: type, raw: Any, errors: dict[str, str]) -> dict[str, Any]:
    specs: dict[str, OptionSpec] = {o.key: o for o in adapter_cls.options_spec}
    if raw in (None, ""):
        raw = {}
    if not isinstance(raw, dict):
        errors["options"] = "Options must be an object."
        return {}
    result = {key: spec.default for key, spec in specs.items()}
    for key, value in raw.items():
        spec = specs.get(key)
        if spec is None:
            errors[f"options.{key}"] = "Unknown option for this adapter."
            continue
        if spec.kind == "bool":
            if isinstance(value, str):
                value = value.lower() in {"1", "true", "yes", "on"}
            if not isinstance(value, bool):
                errors[f"options.{key}"] = "Must be true or false."
                continue
        elif spec.kind == "choice" and value not in spec.choices:
            errors[f"options.{key}"] = f"Must be one of: {', '.join(spec.choices)}."
            continue
        result[key] = value
    return result


def validate_url_pattern(pattern: str) -> str | None:
    if len(pattern) > 300:
        return "Pattern is too long (max 300 characters)."
    try:
        compiled = re.compile(pattern)
    except re.error as exc:
        return f"Invalid regular expression: {exc.msg}."
    if NESTED_QUANTIFIER_RE.search(pattern):
        return "Nested quantifiers are not allowed (risk of slow matching)."
    if compiled.search("") is not None:
        return "Pattern matches everything; make it more specific."
    return None


def validate_platform(
    payload: dict[str, Any],
    *,
    creating: bool,
    existing_key: str | None = None,
    existing_keys: set[str] | None = None,
) -> dict[str, Any]:
    """Validate and normalise a platform payload. Raises FieldErrors."""
    errors: dict[str, str] = {}
    values: dict[str, Any] = {}

    key = str(payload.get("key") or existing_key or "").strip().lower()
    if creating:
        if not KEY_RE.match(key):
            errors["key"] = "Use 2-32 lowercase letters, digits or underscores, starting with a letter."
        elif existing_keys and key in existing_keys:
            errors["key"] = "A platform with this key already exists."
    values["key"] = key

    name = str(payload.get("name") or "").strip()
    if not 1 <= len(name) <= NAME_MAX:
        errors["name"] = f"Name must be 1-{NAME_MAX} characters."
    values["name"] = name

    adapter_key = str(payload.get("adapter") or "").strip()
    adapter_cls = adapter_class(adapter_key)
    if adapter_cls is None:
        errors["adapter"] = "Choose a supported adapter type."
    values["adapter"] = adapter_key

    raw_domains = _strings(payload.get("domains"), "domains", errors, max_items=20)
    domains: list[str] = []
    for raw in raw_domains:
        domain = normalize_domain(raw)
        if not is_valid_public_hostname(domain):
            errors["domains"] = f"'{raw}' is not a valid public domain name (IP addresses and local names are not allowed)."
            break
        if domain not in domains:
            domains.append(domain)
    if not domains and "domains" not in errors:
        errors["domains"] = "At least one domain is required."
    values["domains"] = domains

    patterns = _strings(payload.get("url_patterns"), "url_patterns", errors, max_items=10)
    for pattern in patterns:
        problem = validate_url_pattern(pattern)
        if problem:
            errors["url_patterns"] = problem
            break
    values["url_patterns"] = patterns

    media = _strings(payload.get("allowed_media_types"), "allowed_media_types", errors, max_items=3)
    if any(m not in MEDIA_TYPES for m in media):
        errors["allowed_media_types"] = "Only video, audio and image are supported."
    media = [m for m in dict.fromkeys(media) if m in MEDIA_TYPES]
    if not media and "allowed_media_types" not in errors:
        errors["allowed_media_types"] = "Select at least one media type."
    values["allowed_media_types"] = media

    values["max_file_size_mb"] = _int_or_none(payload.get("max_file_size_mb"), "max_file_size_mb", errors, 1, 50)
    values["max_duration_seconds"] = _int_or_none(
        payload.get("max_duration_seconds"), "max_duration_seconds", errors, 1, 86400
    )
    values["max_height"] = _int_or_none(payload.get("max_height"), "max_height", errors, 144, 4320)

    selector = payload.get("format_selector")
    selector = str(selector).strip() if selector not in (None, "") else None
    if selector is not None:
        if not FORMAT_SELECTOR_RE.match(selector) or selector.startswith("-"):
            errors["format_selector"] = "Only yt-dlp format expressions (letters, digits and [ ] ( ) + / * - . = < > : ! & ' \") are allowed."
    values["format_selector"] = selector

    values["thumbnails_enabled"] = bool(payload.get("thumbnails_enabled", True))

    if adapter_cls is not None:
        values["options"] = _validate_options(adapter_cls, payload.get("options"), errors)
    else:
        values["options"] = {}

    test_url = payload.get("test_url")
    test_url = str(test_url).strip() if test_url not in (None, "") else None
    if test_url:
        try:
            split = split_and_validate_syntax(test_url)
            if not domain_matches(split.host, domains):
                errors["test_url"] = "The test URL must belong to one of the configured domains."
            elif adapter_cls is not None and adapter_cls.canonicalize(split, _DummyRecord(domains, values["options"])) is None:
                errors["test_url"] = "The test URL is not a recognised URL pattern for this adapter."
        except UnsafeDestinationError as exc:
            errors["test_url"] = f"Invalid test URL: {exc.detail}."
    values["test_url"] = test_url

    if errors:
        raise FieldErrors(errors)
    return values


class _DummyRecord:
    """Minimal stand-in so adapter.canonicalize can run before a record exists."""

    def __init__(self, domains: list[str], options: dict[str, Any]) -> None:
        self.domains = domains
        self.options = options
