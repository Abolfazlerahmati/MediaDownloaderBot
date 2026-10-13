"""Checks the free-plan tunnel template and the compose service without running Docker or cloudflared."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from mediabot.web.webhook import WEBHOOK_PATH

ROOT = Path(__file__).resolve().parents[1]


def _ingress() -> list[dict]:
    data = yaml.safe_load((ROOT / "deploy/cloudflared/config.example.yml").read_text(encoding="utf-8"))
    return data["ingress"]


def test_only_the_webhook_path_is_published():
    rules = _ingress()
    publishing = rules[:-1]
    assert len(publishing) == 1, "exactly one published rule is allowed"
    rule = publishing[0]
    assert re.fullmatch(rule["path"], WEBHOOK_PATH), "the regex must match the webhook path"
    # The regex must NOT match the admin panel or other paths.
    for other in ("/", "/login", "/api/auth/login", "/telegram/webhook/extra", "/internal/db"):
        assert not re.fullmatch(rule["path"], other), other
    assert rule["service"] == "http://app:8080"


def test_catch_all_is_last_and_returns_404():
    rules = _ingress()
    assert rules[-1] == {"service": "http_status:404"}


def test_compose_cloudflared_service_is_opt_in_pinned_and_unpublished():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    svc = compose["services"]["cloudflared"]
    assert svc["profiles"] == ["tunnel"]
    assert not svc["image"].endswith(":latest") and ":" in svc["image"]
    assert "ports" not in svc, "cloudflared must not publish ports"
    app = compose["services"]["app"]
    assert app["ports"] == ["127.0.0.1:8080:8080"], "the admin panel stays on localhost"


def test_tunnel_secrets_are_ignored_by_git():
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for pattern in ("deploy/cloudflared/config.yml", "deploy/cloudflared/*.json", "deploy/cloudflared/cert.pem"):
        assert pattern in ignored


BUILD_COMMAND = (
    "cp wrangler.toml wrangler.build.toml && "
    "sed -i 's/database_id = \"[^\"]*\"/database_id = \"cb32937c-110c-4621-a236-0f7f6a8b7b2f\"/' wrangler.build.toml && "
    "sed -i '/binding = \"CACHE\"/{n;s/id = \"[^\"]*\"/id = \"c22c95c3c6ae40a88fbcd4d52c8a5471\"/;}' wrangler.build.toml"
)


def test_workers_builds_build_command_produces_the_expected_bindings(tmp_path):
    """Runs the exact build command from docs/cloudflare.md on a copy of wrangler.toml."""
    import shutil
    import subprocess

    shutil.copy(ROOT / "wrangler.toml", tmp_path / "wrangler.toml")
    subprocess.run(["sh", "-c", BUILD_COMMAND], cwd=tmp_path, check=True)
    built = (tmp_path / "wrangler.build.toml").read_text(encoding="utf-8")
    assert 'database_id = "cb32937c-110c-4621-a236-0f7f6a8b7b2f"' in built
    assert re.search(r'binding = "CACHE"\nid = "c22c95c3c6ae40a88fbcd4d52c8a5471"', built)
    assert 'binding = "DB"' in built


def test_build_command_is_documented_verbatim():
    doc = (ROOT / "docs/cloudflare.md").read_text(encoding="utf-8")
    assert BUILD_COMMAND in doc


def test_worker_does_not_require_a_bot_token_at_deploy_time():
    src = (ROOT / "src/index.ts").read_text(encoding="utf-8")
    assert "BOT_TOKEN" not in src
    assert "APP_SECRET_KEY" in src
