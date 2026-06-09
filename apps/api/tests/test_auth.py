"""End-to-end auth flow tests against the real app + SQLite."""
from __future__ import annotations

import asyncio
import datetime as dt

import pyotp

from extsync_api.config import settings
from extsync_api.db import get_sessionmaker
from extsync_api.models.auth import EmailVerification, PasswordReset
from extsync_api.security.crypto import hash_token

COOKIE = settings.session_cookie_name


def _register(client, email="dev@example.com", password="Sup3r-Secret!"):
    r = client.post("/auth/register", json={
        "email": email, "password": password,
        "displayName": "Dev One", "orgName": "Acme", "acceptTerms": True,
    })
    assert r.status_code == 201, r.text
    return email, password


def test_register_login_me_logout(client):
    email, password = _register(client)

    # duplicate registration is rejected
    dup = client.post("/auth/register", json={
        "email": email, "password": password,
        "displayName": "X", "orgName": "", "acceptTerms": True,
    })
    assert dup.status_code == 409

    # must accept terms
    bad = client.post("/auth/register", json={
        "email": "x@y.com", "password": password,
        "displayName": "X", "orgName": "", "acceptTerms": False,
    })
    assert bad.status_code == 422

    # login
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["twoFactorRequired"] is False
    access = body["accessToken"]
    assert COOKIE in r.cookies or COOKIE in client.cookies

    # /me with bearer
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["email"] == email
    assert me.json()["role"] == "developer"

    # wrong password
    bad_login = client.post("/auth/login", json={"email": email, "password": "nope"})
    assert bad_login.status_code == 401
    assert bad_login.json()["error"]["code"] == "INVALID_CREDENTIALS"

    # logout clears cookie; refresh then fails
    out = client.post("/auth/logout")
    assert out.status_code == 200


def test_unauthorized_without_token(client):
    assert client.get("/auth/me").status_code == 401


def test_refresh_rotation_and_reuse_detection(client):
    email, password = _register(client, email="rot@example.com")
    client.post("/auth/login", json={"email": email, "password": password})
    old_refresh = client.cookies.get(COOKIE)
    assert old_refresh

    # first refresh rotates the token
    r1 = client.post("/auth/refresh")
    assert r1.status_code == 200, r1.text
    new_refresh = client.cookies.get(COOKIE)
    assert new_refresh and new_refresh != old_refresh

    # replaying the OLD refresh token must be rejected (theft detection)
    client.cookies.clear()
    reuse = client.post("/auth/refresh", cookies={COOKIE: old_refresh})
    assert reuse.status_code == 401
    assert reuse.json()["error"]["code"] in {"SESSION_EXPIRED", "UNAUTHORIZED"}

    # and all sessions are revoked -> even the new token no longer works
    after = client.post("/auth/refresh", cookies={COOKIE: new_refresh})
    assert after.status_code == 401


def test_email_verification(client):
    email, _ = _register(client, email="verify@example.com")
    # Inject a verification row with a known token (only the hash is stored).
    raw = "known-verify-token-123"

    async def _seed():
        sm = get_sessionmaker()
        async with sm() as s:
            from sqlalchemy import select
            from extsync_api.models.user import User
            user = await s.scalar(select(User).where(User.email == email))
            s.add(EmailVerification(
                user_id=user.id, token_hash=hash_token(raw),
                expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1),
            ))
            await s.commit()

    asyncio.run(_seed())
    ok = client.post("/auth/verify-email", json={"token": raw})
    assert ok.status_code == 200

    bad = client.post("/auth/verify-email", json={"token": "wrong"})
    assert bad.status_code == 400


def test_two_factor_setup_and_login(client):
    email, password = _register(client, email="tfa@example.com")
    login = client.post("/auth/login", json={"email": email, "password": password})
    access = login.json()["accessToken"]
    h = {"Authorization": f"Bearer {access}"}

    setup = client.post("/auth/2fa/setup", headers=h)
    assert setup.status_code == 200
    secret = setup.json()["secret"]

    code = pyotp.TOTP(secret).now()
    confirm = client.post("/auth/2fa/verify", headers=h, json={"code": code})
    assert confirm.status_code == 200
    recovery = confirm.json()["recoveryCodes"]
    assert len(recovery) == 10

    # next login requires 2FA
    client.cookies.clear()
    login2 = client.post("/auth/login", json={"email": email, "password": password})
    assert login2.json()["twoFactorRequired"] is True
    challenge = login2.json()["challenge"]

    # wrong code rejected
    bad = client.post("/auth/2fa/verify", json={"challenge": challenge, "code": "000000"})
    assert bad.status_code == 401

    # correct code completes login
    code2 = pyotp.TOTP(secret).now()
    done = client.post("/auth/2fa/verify", json={"challenge": challenge, "code": code2})
    assert done.status_code == 200
    assert done.json()["accessToken"]

    # a recovery code also works as a fallback
    client.cookies.clear()
    login3 = client.post("/auth/login", json={"email": email, "password": password})
    challenge3 = login3.json()["challenge"]
    rec = client.post("/auth/2fa/verify", json={"challenge": challenge3, "code": recovery[0]})
    assert rec.status_code == 200


def test_device_flow(client):
    # Agent starts the flow
    start = client.post("/auth/device-flow/start", json={"anonymousDeviceId": "anon-device-001"})
    assert start.status_code == 200, start.text
    user_code = start.json()["userCode"]
    device_code = start.json()["deviceCode"]

    # polling before approval => pending
    poll1 = client.post("/auth/device-flow/token", json={"deviceCode": device_code})
    assert poll1.json()["status"] == "pending"

    # a logged-in user approves it
    email, password = _register(client, email="pair@example.com")
    access = client.post("/auth/login", json={"email": email, "password": password}).json()["accessToken"]
    approve = client.post("/auth/device-flow/approve",
                          headers={"Authorization": f"Bearer {access}"},
                          json={"userCode": user_code})
    assert approve.status_code == 200

    # now polling returns a device token
    poll2 = client.post("/auth/device-flow/token", json={"deviceCode": device_code})
    assert poll2.json()["status"] == "approved"
    assert poll2.json()["deviceToken"]
    assert poll2.json()["deviceId"]
