"""Likes-quota meter: end-to-end behavior over the SQLite test app."""
from __future__ import annotations

import asyncio
import base64

import pytest

from extsync_api.config import settings
from extsync_api.services import likes_quota_service as svc

DEV_HEADER = {"X-Dev-Quota-User": "tester-1"}
BASE = "/api/likes-quota"


def _forum_header(cookie: str = "good") -> dict:
    return {"X-Forum-Session": base64.b64encode(cookie.encode()).decode()}


@pytest.fixture(autouse=True)
def _enable_dev_auth():
    # DEV-ONLY auth path: allowed because environment is "development" in tests.
    prev = settings.likes_quota_dev_auth
    settings.likes_quota_dev_auth = True
    yield
    settings.likes_quota_dev_auth = prev


def test_requires_auth(client):
    # No token and no dev header -> 401 with a structured error body.
    r = client.get(f"{BASE}/today")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


def test_today_starts_empty(client):
    r = client.get(f"{BASE}/today", headers=DEV_HEADER)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["likesToday"] == 0
    assert body["dailyLimit"] == 20
    assert body["perUserLimit"] == 6
    assert body["targetUsers"] == {}


def test_increment_and_per_user_tally(client):
    r = client.post(f"{BASE}/increment", headers=DEV_HEADER, json={
        "postId": "1", "topicId": "10", "targetUserId": "502",
        "targetUsername": "YAHBDK", "clientEventId": "e1",
    })
    body = r.json()
    assert body["likesToday"] == 1
    assert body["targetUsers"]["502"]["count"] == 1
    assert body["targetUsers"]["502"]["username"] == "YAHBDK"


def test_duplicate_client_event_is_idempotent(client):
    payload = {"postId": "1", "targetUserId": "502", "clientEventId": "dup"}
    client.post(f"{BASE}/increment", headers=DEV_HEADER, json=payload)
    r2 = client.post(f"{BASE}/increment", headers=DEV_HEADER, json=payload)
    assert r2.json()["likesToday"] == 1  # not double-counted


def test_same_post_counts_once_per_day(client):
    client.post(f"{BASE}/increment", headers=DEV_HEADER, json={
        "postId": "7", "targetUserId": "502", "clientEventId": "a"})
    # different event id, same post -> no extra count
    r = client.post(f"{BASE}/increment", headers=DEV_HEADER, json={
        "postId": "7", "targetUserId": "502", "clientEventId": "b"})
    assert r.json()["likesToday"] == 1
    assert r.json()["targetUsers"]["502"]["count"] == 1


def test_decrement_undoes_a_liked_post(client):
    client.post(f"{BASE}/increment", headers=DEV_HEADER, json={
        "postId": "1", "targetUserId": "502", "clientEventId": "i1"})
    client.post(f"{BASE}/increment", headers=DEV_HEADER, json={
        "postId": "2", "targetUserId": "502", "clientEventId": "i2"})
    r = client.post(f"{BASE}/decrement", headers=DEV_HEADER, json={
        "postId": "1", "targetUserId": "502", "clientEventId": "d1"})
    body = r.json()
    assert body["likesToday"] == 1
    assert body["targetUsers"]["502"]["count"] == 1


def test_decrement_unknown_post_is_noop(client):
    r = client.post(f"{BASE}/decrement", headers=DEV_HEADER, json={
        "postId": "999", "clientEventId": "dx"})
    assert r.json()["likesToday"] == 0


def test_set_and_validation(client):
    r = client.post(f"{BASE}/set", headers=DEV_HEADER, json={"likesToday": 20, "reason": "manual-popup"})
    assert r.json()["likesToday"] == 20

    bad = client.post(f"{BASE}/set", headers=DEV_HEADER, json={"likesToday": 25})
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "VALIDATION_ERROR"


def test_reset_clears_everything(client):
    client.post(f"{BASE}/increment", headers=DEV_HEADER, json={
        "postId": "1", "targetUserId": "502", "clientEventId": "z1"})
    r = client.post(f"{BASE}/reset", headers=DEV_HEADER, json={"reason": "manual-reset"})
    body = r.json()
    assert body["likesToday"] == 0
    assert body["targetUsers"] == {}


def test_principals_are_isolated(client):
    client.post(f"{BASE}/increment", headers={"X-Dev-Quota-User": "alice"}, json={
        "postId": "1", "targetUserId": "502", "clientEventId": "qa"})
    # bob sees his own empty meter, not alice's
    r = client.get(f"{BASE}/today", headers={"X-Dev-Quota-User": "bob"})
    assert r.json()["likesToday"] == 0


# ---- forum-login identity (server-verified via NodeBB) ---------------------

async def _fake_verify(cookie_value):
    """Stand in for the real NodeBB /api/self call."""
    if cookie_value == "good":
        return {"forumUserId": "777", "username": "Tester", "userslug": "tester"}
    return None


def test_forum_login_identifies_and_isolates(client, monkeypatch):
    monkeypatch.setattr(svc, "verify_forum_session", _fake_verify)

    # A valid forum session works with NO ExtSync token and NO dev header.
    r = client.post(f"{BASE}/increment", headers=_forum_header("good"), json={
        "postId": "p1", "targetUserId": "502", "targetUsername": "YAHBDK", "clientEventId": "f1"})
    assert r.status_code == 200
    assert r.json()["likesToday"] == 1

    # The row is keyed by the verified forum uid (forum:777), isolated from others.
    r2 = client.get(f"{BASE}/today", headers=_forum_header("good"))
    assert r2.json()["likesToday"] == 1

    # A different (invalid) session is unauthorized, not someone else's data.
    r3 = client.get(f"{BASE}/today", headers=_forum_header("bad"))
    assert r3.status_code == 401


def test_forum_session_takes_precedence_over_client_uid(client, monkeypatch):
    monkeypatch.setattr(svc, "verify_forum_session", _fake_verify)
    # Client lies about forumUser in the body; the verified session (uid 777) must win.
    client.post(f"{BASE}/increment", headers=_forum_header("good"), json={
        "postId": "p1", "targetUserId": "1", "clientEventId": "f2",
        "forumUser": {"forumUserId": "999999", "username": "spoofed"}})
    # The real principal (forum:777) holds the count; the spoofed id never got a row.
    assert client.get(f"{BASE}/today", headers=_forum_header("good")).json()["likesToday"] == 1


def test_verify_forum_session_unit(monkeypatch):
    respx = pytest.importorskip("respx")
    import httpx

    settings.likes_quota_forum_verify = True
    with respx.mock:
        respx.get("https://mitmachim.top/api/self").mock(
            return_value=httpx.Response(200, json={"uid": 502, "username": "YAHBDK", "userslug": "yahbdk"}))
        out = asyncio.run(svc.verify_forum_session("anycookie"))
    assert out == {"forumUserId": "502", "username": "YAHBDK", "userslug": "yahbdk"}

    with respx.mock:
        respx.get("https://mitmachim.top/api/self").mock(return_value=httpx.Response(401, json="not-authorized"))
        out2 = asyncio.run(svc.verify_forum_session("anycookie"))
    assert out2 is None
