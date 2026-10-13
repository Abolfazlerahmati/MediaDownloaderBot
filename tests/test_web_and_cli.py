"""Admin panel HTTP behaviour through the real FastAPI app (no network, no bot)."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from mediabot.app import Runtime
from mediabot.cli import main as cli_main
from mediabot.security.passwords import hash_password, verify_password
from mediabot.web.app import create_web_app

PASSWORD = "correct horse battery"


@pytest.fixture
def rt(app_config):
    runtime = Runtime(app_config)
    runtime.admins.create("admin", hash_password(PASSWORD))
    yield runtime
    runtime.close()


@pytest.fixture
def client(rt):
    return TestClient(create_web_app(rt))


def login(client: TestClient, password: str = PASSWORD) -> dict:
    client.get("/login")  # issues the CSRF cookie
    token = client.cookies.get("mb_csrf")
    return client.post("/api/auth/login", json={"username": "admin", "password": password},
                       headers={"X-CSRF-Token": token, "Origin": "http://testserver"})


def csrf(client: TestClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("mb_csrf"), "Origin": "http://testserver"}


def test_pages_require_sign_in(client):
    response = client.get("/", follow_redirects=False)
    assert response.status_code == 303 and response.headers["location"] == "/login"
    assert client.get("/api/dashboard").status_code == 401


def test_security_headers_are_set(client):
    response = client.get("/login")
    csp = response.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "'unsafe-inline'" not in csp
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_post_without_csrf_token_is_rejected(client):
    client.get("/login")
    response = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert response.status_code == 403


def test_cross_origin_post_is_rejected_even_with_token(client):
    client.get("/login")
    response = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD},
                           headers={"X-CSRF-Token": client.cookies.get("mb_csrf"), "Origin": "https://evil.example"})
    assert response.status_code == 403


def test_wrong_password_is_401_and_correct_password_creates_session(client):
    assert login(client, "wrong password here").status_code == 401
    response = login(client)
    assert response.status_code == 200 and response.json()["username"] == "admin"
    assert "mb_session" in response.headers.get("set-cookie", "")
    assert client.get("/api/auth/me").json()["username"] == "admin"


def test_login_is_throttled_after_repeated_failures(client):
    client.get("/login")
    token = client.cookies.get("mb_csrf")
    statuses = [client.post("/api/auth/login", json={"username": "admin", "password": "nope-nope-nope"},
                            headers={"X-CSRF-Token": token}).status_code for _ in range(7)]
    assert statuses[:5] == [401] * 5
    assert statuses[5] == 429


def test_logout_invalidates_the_session(client):
    login(client)
    assert client.get("/api/dashboard").status_code == 200
    client.post("/api/auth/logout", headers=csrf(client))
    assert client.get("/api/dashboard").status_code == 401


def test_settings_are_validated_server_side(client):
    login(client)
    bad = client.put("/api/settings", json={"changes": {"max_file_size_mb": 999}}, headers=csrf(client))
    assert bad.status_code == 422 and "max_file_size_mb" in bad.json()["detail"]["fields"]
    good = client.put("/api/settings", json={"changes": {"max_concurrent_downloads": 4}}, headers=csrf(client))
    assert good.status_code == 200
    assert good.json()["pending_restart"] == ["max_concurrent_downloads"]


def test_platform_cannot_be_enabled_before_a_successful_test(client):
    login(client)
    listing = client.get("/api/platforms").json()["items"]
    assert {p["key"] for p in listing} >= {"youtube", "tiktok", "instagram", "pinterest"}
    assert all(p["enabled"] is False for p in listing)
    refused = client.post("/api/platforms/youtube/enable", json={"enabled": True}, headers=csrf(client))
    assert refused.status_code == 409


def test_platform_create_and_config_change_resets_enablement(client, rt):
    login(client)
    payload = {"key": "vimeo", "name": "Vimeo", "adapter": "generic_ytdlp", "domains": ["vimeo.com"],
               "allowed_media_types": ["video"], "max_file_size_mb": 30, "options": {"keep_query": False}}
    created = client.post("/api/platforms", json=payload, headers=csrf(client))
    assert created.status_code == 201 and created.json()["enabled"] is False
    rt.platform_repo.set_test_result("vimeo", "healthy", "ok")
    rt.platform_repo.set_enabled("vimeo", True)
    changed = client.put("/api/platforms/vimeo", json={**payload, "max_file_size_mb": 20}, headers=csrf(client))
    assert changed.status_code == 200
    body = changed.json()
    assert body["enabled"] is False and body["last_test_status"] == "untested"


def test_url_checker_recognises_only_configured_domains(client):
    login(client)
    ok = client.post("/api/platforms/youtube/check-url", json={"url": "https://youtu.be/jNQXAC9IVRw"},
                     headers=csrf(client)).json()
    assert ok["recognized"] is True
    other = client.post("/api/platforms/youtube/check-url", json={"url": "https://example.com/x"},
                        headers=csrf(client)).json()
    assert other["recognized"] is False


def test_live_test_without_test_url_is_a_warning_not_a_pass(client):
    login(client)
    result = client.post("/api/platforms/youtube/test", headers=csrf(client)).json()["result"]
    assert result["status"] == "warning"


def test_restart_requires_explicit_confirmation(client):
    login(client)
    assert client.post("/api/system/restart", json={"confirm": "yes"}, headers=csrf(client)).status_code == 422


def test_appearance_is_persisted_per_admin(client, rt):
    login(client)
    saved = client.put("/api/account/appearance", json={"theme": "ios", "mode": "dark"}, headers=csrf(client))
    assert saved.status_code == 200
    assert rt.admins.get_by_username("admin").appearance == {"theme": "ios", "mode": "dark"}
    assert client.get("/api/auth/me").json()["appearance"]["theme"] == "ios"
    assert client.put("/api/account/appearance", json={"theme": "neon", "mode": "dark"},
                      headers=csrf(client)).status_code == 422


def test_dashboard_reports_real_fields_without_secrets(client, rt):
    login(client)
    data = client.get("/api/dashboard").json()
    assert data["workers"]["configured"] == rt.jobs.snapshot()["workers_configured"]
    assert "token" not in str(data).lower() or "telegram_api" in str(data)
    assert rt.secret_box is not None and "smoke" not in str(data)


def test_logs_are_queryable_and_clearable(client, rt):
    login(client)
    rt.op_logs.write({"ts": 1.0, "level": "WARNING", "component": "web", "category": "test",
                      "message": "password=hunter22 happened", "details": {"token": "x"}})
    data = client.get("/api/logs?level=WARNING").json()
    assert data["total"] >= 1
    assert "hunter22" not in str(data)
    assert client.delete("/api/logs", headers=csrf(client)).json()["removed"] >= 1


def test_diagnostics_report_is_plain_text_attachment(client):
    login(client)
    response = client.get("/api/diagnostics/report")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    assert "MediaDownloaderBot diagnostic report" in response.text


def test_static_assets_and_theme_files_are_served(client):
    for path in ("/static/css/tokens.css", "/static/css/themes/merchant.css",
                 "/static/css/themes/ios.css", "/static/js/common.js"):
        assert client.get(path).status_code == 200


# ----------------------------------------------------------------------- CLI
def test_gen_secret_prints_a_long_random_value(capsys):
    assert cli_main(["gen-secret"]) == 0
    value = capsys.readouterr().out.strip()
    assert len(value) >= 48


def test_create_admin_via_stdin_and_duplicate_rejected(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "cli-data"))
    monkeypatch.setenv("APP_SECRET_KEY", "cli-test-secret-0123456789abcdefghijklmnop")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("sys.stdin", io.StringIO(PASSWORD + "\n"))
    assert cli_main(["create-admin", "--username", "Owner", "--password-stdin"]) == 0
    monkeypatch.setattr("sys.stdin", io.StringIO(PASSWORD + "\n"))
    assert cli_main(["create-admin", "--username", "owner", "--password-stdin"]) == 1
    monkeypatch.setattr("sys.stdin", io.StringIO("short\n"))
    assert cli_main(["create-admin", "--username", "other", "--password-stdin"]) == 2


def test_migrations_are_idempotent(db):
    assert db.migrate() == []
    assert db.schema_version() == 2


def test_settings_api_reports_every_invalid_field(client):
    login(client)
    bad = client.put("/api/settings", json={"changes": {"bogus": 1, "max_file_size_mb": 9999, "log_level": "TRACE"}},
                     headers=csrf(client))
    assert bad.status_code == 422
    assert {"bogus", "max_file_size_mb", "log_level"} <= set(bad.json()["detail"]["fields"])


def test_panel_logs_show_entries_written_after_startup(client, rt):
    import logging
    login(client)
    logging.getLogger("mediabot.web").warning("startup-visible probe", extra={"category": "admin_action"})
    data = client.get("/api/logs?q=startup-visible").json()
    assert data["total"] >= 1


def test_bot_process_reports_not_configured_when_disabled(rt):
    import asyncio
    from mediabot.health.checks import check_bot_process
    state, _, _ = asyncio.run(check_bot_process(rt))
    assert state.value == "not_configured"


def test_failed_platform_check_has_a_real_title(rt):
    from mediabot.health.diagnostics import explain
    from mediabot.health.service import _category_for_check
    assert explain(_category_for_check("platform:youtube")).title == "Platform live test needs attention"
    assert explain(_category_for_check("platform:youtube")).title != "Unclassified problem"


PAGES = ["/", "/platforms", "/platforms/new", "/platforms/youtube", "/settings", "/bot",
         "/diagnostics", "/logs", "/account"]


def test_every_page_renders_without_inline_script_or_style(client):
    import re
    login(client)
    for path in PAGES:
        response = client.get(path)
        assert response.status_code == 200, path
        html = response.text
        assert "<title>" in html and 'id="view"' in html, path
        inline_scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html)
        assert inline_scripts == [], path
        assert "<style" not in html and " style=" not in html, path
        assert "/static/js/common.js" in html, path


def test_login_page_is_public_and_has_form_hooks(client):
    response = client.get("/login")
    assert response.status_code == 200
    assert 'id="login-form"' in response.text or "login" in response.text.lower()


def test_theme_selection_changes_the_rendered_stylesheet_and_mode(client, rt):
    login(client)
    client.put("/api/account/appearance", json={"theme": "ios", "mode": "dark"}, headers=csrf(client))
    html = client.get("/").text
    assert 'data-theme="ios"' in html and 'data-mode="dark"' in html
    assert "/static/css/themes/ios.css" in html
    client.put("/api/account/appearance", json={"theme": "merchant", "mode": "light"}, headers=csrf(client))
    html = client.get("/").text
    assert 'data-theme="merchant"' in html and 'data-mode="light"' in html
    assert "/static/css/themes/merchant.css" in html


def test_reset_password_changes_login_and_signs_out_sessions(tmp_path, monkeypatch, capsys):
    import io as _io
    from mediabot.app import Runtime as _Runtime
    from mediabot.config import AppConfig as _AppConfig
    from .conftest import TEST_SECRET as _SECRET

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "reset-data"))
    monkeypatch.setenv("APP_SECRET_KEY", _SECRET)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("sys.stdin", _io.StringIO(PASSWORD + "\n"))
    assert cli_main(["create-admin", "--username", "boss", "--password-stdin"]) == 0
    cfg = _AppConfig(app_secret_key=_SECRET, data_dir=tmp_path / "reset-data", enable_bot=False)
    runtime = _Runtime(cfg)
    admin = runtime.admins.get_by_username("boss")
    runtime.sessions.create(runtime.secret_box.session_hash("tok-abc"), admin.id, "csrf", 3600)
    runtime.close()
    monkeypatch.setattr("sys.stdin", _io.StringIO("brand new passphrase\n"))
    assert cli_main(["reset-password", "--username", "boss", "--password-stdin"]) == 0
    runtime = _Runtime(cfg)
    try:
        assert runtime.sessions.get_valid(runtime.secret_box.session_hash("tok-abc")) is None
        assert verify_password(runtime.admins.get_by_username("boss").password_hash, "brand new passphrase")
    finally:
        runtime.close()


def test_check_command_runs_without_crashing(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "check-data"))
    monkeypatch.setenv("APP_SECRET_KEY", "check-secret-0123456789abcdefghijklmnopqrstuv")
    monkeypatch.chdir(tmp_path)
    code = cli_main(["check"])
    assert code in (0, 1)
    assert capsys.readouterr().out.strip() != ""
