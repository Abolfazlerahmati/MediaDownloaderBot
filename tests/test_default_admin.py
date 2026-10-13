"""First-run default administrator and the forced password change, through the real web app."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from mediabot.app import Runtime
from mediabot.bootstrap import DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME, ensure_default_admin
from mediabot.security.passwords import hash_password, verify_password
from mediabot.web.app import create_web_app

NEW_PASSWORD = "a brand new passphrase"
ORIGIN = {"Origin": "http://testserver"}


@pytest.fixture
def rt(app_config):
    runtime = Runtime(app_config)  # no admins yet: a fresh installation
    yield runtime
    runtime.close()


@pytest.fixture
def client(rt):
    return TestClient(create_web_app(rt))


def _sign_in(client: TestClient, password: str, username: str = DEFAULT_ADMIN_USERNAME):
    client.get("/login")
    token = client.cookies.get("mb_csrf")
    return client.post("/api/auth/login", json={"username": username, "password": password},
                       headers={"X-CSRF-Token": token, **ORIGIN})


def _csrf(client: TestClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("mb_csrf"), **ORIGIN}


# ----------------------------------------------------------------------------- bootstrap
def test_bootstrap_creates_default_admin_once_with_forced_change(rt):
    assert ensure_default_admin(rt.admins, enabled=True, hash_password=hash_password) is True
    admin = rt.admins.get_by_username(DEFAULT_ADMIN_USERNAME)
    assert admin is not None and admin.must_change_password is True
    assert verify_password(admin.password_hash, DEFAULT_ADMIN_PASSWORD)
    # A second start must not create or reset anything.
    assert ensure_default_admin(rt.admins, enabled=True, hash_password=hash_password) is False
    assert rt.admins.count() == 1


def test_bootstrap_is_skipped_when_an_administrator_exists(rt):
    rt.admins.create("owner", hash_password(NEW_PASSWORD))
    assert ensure_default_admin(rt.admins, enabled=True, hash_password=hash_password) is False
    assert rt.admins.get_by_username(DEFAULT_ADMIN_USERNAME) is None


def test_bootstrap_can_be_disabled(rt):
    assert ensure_default_admin(rt.admins, enabled=False, hash_password=hash_password) is False
    assert rt.admins.count() == 0


# ----------------------------------------------------------------------------- enforcement
def test_default_login_is_restricted_until_password_changes(rt, client):
    ensure_default_admin(rt.admins, enabled=True, hash_password=hash_password)

    response = _sign_in(client, DEFAULT_ADMIN_PASSWORD)
    assert response.status_code == 200
    assert response.json()["must_change_password"] is True

    # APIs are refused server-side, not only hidden in the UI.
    assert client.get("/api/settings").status_code == 403
    assert client.get("/api/platforms").status_code == 403
    assert client.get("/api/dashboard").status_code == 403

    # The session itself still reports the state, so the account page can show the notice.
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["must_change_password"] is True

    # Pages redirect to the account page; the account page itself loads.
    redirect = client.get("/settings", follow_redirects=False)
    assert redirect.status_code == 303 and redirect.headers["location"] == "/account"
    assert client.get("/account", follow_redirects=False).status_code == 200


def test_wrong_current_password_keeps_the_restriction(rt, client):
    ensure_default_admin(rt.admins, enabled=True, hash_password=hash_password)
    _sign_in(client, DEFAULT_ADMIN_PASSWORD)
    response = client.post("/api/auth/password", json={"current_password": "not-the-default", "new_password": NEW_PASSWORD},
                           headers=_csrf(client))
    assert response.status_code == 400
    assert rt.admins.get_by_username(DEFAULT_ADMIN_USERNAME).must_change_password is True
    assert client.get("/api/settings").status_code == 403


def test_short_new_password_is_rejected_and_keeps_the_restriction(rt, client):
    ensure_default_admin(rt.admins, enabled=True, hash_password=hash_password)
    _sign_in(client, DEFAULT_ADMIN_PASSWORD)
    response = client.post("/api/auth/password", json={"current_password": DEFAULT_ADMIN_PASSWORD, "new_password": "12345678"},
                           headers=_csrf(client))
    assert response.status_code == 422
    assert rt.admins.get_by_username(DEFAULT_ADMIN_USERNAME).must_change_password is True


def test_changing_the_password_lifts_the_restriction_and_stores_the_new_one(rt, client):
    ensure_default_admin(rt.admins, enabled=True, hash_password=hash_password)
    _sign_in(client, DEFAULT_ADMIN_PASSWORD)
    response = client.post("/api/auth/password", json={"current_password": DEFAULT_ADMIN_PASSWORD, "new_password": NEW_PASSWORD},
                           headers=_csrf(client))
    assert response.status_code == 200

    admin = rt.admins.get_by_username(DEFAULT_ADMIN_USERNAME)
    assert admin.must_change_password is False
    assert verify_password(admin.password_hash, NEW_PASSWORD)
    assert not verify_password(admin.password_hash, DEFAULT_ADMIN_PASSWORD)

    assert client.get("/api/settings").status_code == 200
    assert client.get("/settings", follow_redirects=False).status_code == 200
    assert client.get("/api/auth/me").json()["must_change_password"] is False


def test_default_password_no_longer_works_after_the_change(rt, client):
    ensure_default_admin(rt.admins, enabled=True, hash_password=hash_password)
    _sign_in(client, DEFAULT_ADMIN_PASSWORD)
    client.post("/api/auth/password", json={"current_password": DEFAULT_ADMIN_PASSWORD, "new_password": NEW_PASSWORD},
                headers=_csrf(client))
    other = TestClient(create_web_app(rt))
    assert _sign_in(other, DEFAULT_ADMIN_PASSWORD).status_code == 401
    assert _sign_in(other, NEW_PASSWORD).status_code == 200


def test_administrator_created_normally_is_not_forced(rt, client):
    rt.admins.create("owner", hash_password(NEW_PASSWORD))
    response = _sign_in(client, NEW_PASSWORD, username="owner")
    assert response.json()["must_change_password"] is False
    assert client.get("/settings", follow_redirects=False).status_code == 200
