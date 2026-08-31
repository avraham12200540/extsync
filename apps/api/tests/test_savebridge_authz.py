"""Who may issue a SaveBridge credential, and who may ask what one means.

Two separate gates, tested at the HTTP boundary against the real app:

  /admin/savebridge/...   platform administrators only. An unrestricted
                          credential is the bypass, so the ability to mint one
                          must not be reachable from any ordinary account, any
                          project role, or any client-supplied flag.

  /internal/savebridge/authenticate
                          the relay only. It is on the private network, but
                          "not routed publicly" is a deployment detail, not an
                          authorization control, so it carries its own key.
"""
from __future__ import annotations

import asyncio

import pytest

ADMIN_ROUTES_POST = [
    ("/admin/savebridge/credentials",
     {"label": "x", "policy": "netfree_required"}),
    ("/admin/savebridge/credentials/sbc_x/revoke", {}),
]


def _register(client, email, account_type="developer"):
    r = client.post("/auth/register", json={
        "email": email, "password": "Sup3r-Secret!", "accountType": account_type,
        "displayName": "Dev", "orgName": "Acme", "acceptTerms": True,
    })
    assert r.status_code == 201, r.text
    r = client.post("/auth/login", json={"email": email, "password": "Sup3r-Secret!"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


def _promote(sessionmaker_factory, email: str) -> None:
    from sqlalchemy import select

    from extsync_api.models.enums import UserRole
    from extsync_api.models.user import User

    async def _go():
        async with sessionmaker_factory() as s:
            user = await s.scalar(select(User).where(User.email == email))
            user.role = UserRole.platform_admin
            await s.commit()

    asyncio.run(_go())


# ------------------------------------------------------------------- admin

@pytest.mark.parametrize("path,body", ADMIN_ROUTES_POST)
def test_a_developer_cannot_issue_or_revoke_credentials(client, path, body):
    headers = _register(client, "sbdev@example.com")
    r = client.post(path, json=body, headers=headers)
    assert r.status_code == 403, f"{path} -> {r.status_code}: {r.text}"


@pytest.mark.parametrize("path,body", ADMIN_ROUTES_POST)
def test_anonymous_cannot_issue_or_revoke_credentials(client, path, body):
    r = client.post(path, json=body)
    assert r.status_code in (401, 403), f"{path} -> {r.status_code}"


def test_a_developer_cannot_even_list_credentials(client):
    headers = _register(client, "sblist@example.com")
    r = client.get("/admin/savebridge/credentials", headers=headers)
    assert r.status_code == 403


def test_a_platform_admin_can_issue_and_gets_the_token_once(client, sessionmaker_factory):
    headers = _register(client, "sbadmin1@example.com")
    _promote(sessionmaker_factory, "sbadmin1@example.com")

    r = client.post("/admin/savebridge/credentials", headers=headers, json={
        "label": "public build", "policy": "netfree_required",
        "credentialType": "public_distribution"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token"].startswith("sbc_v1_")
    assert body["policy"] == "netfree_required"

    # ...and never again.
    listing = client.get("/admin/savebridge/credentials", headers=headers).json()
    assert len(listing) == 1
    assert "token" not in listing[0], "the token is retrievable after creation"
    assert body["token"] not in str(listing[0])


def test_issuing_unrestricted_requires_explicit_confirmation(client, sessionmaker_factory):
    """§48. The bypass must not be reachable by a caller that merely omits a field."""
    headers = _register(client, "sbadmin2@example.com")
    _promote(sessionmaker_factory, "sbadmin2@example.com")

    r = client.post("/admin/savebridge/credentials", headers=headers, json={
        "label": "person A", "policy": "unrestricted_private"})
    assert r.status_code == 422, r.text

    r = client.post("/admin/savebridge/credentials", headers=headers, json={
        "label": "person A", "policy": "unrestricted_private",
        "confirmUnrestricted": True})
    assert r.status_code == 201, r.text
    assert r.json()["policy"] == "unrestricted_private"


def test_an_unrestricted_credential_cannot_be_public_distribution(client,
                                                                  sessionmaker_factory):
    """That combination would hand the bypass to everyone who installs the
    public build, so it is refused outright rather than merely discouraged."""
    headers = _register(client, "sbadmin3@example.com")
    _promote(sessionmaker_factory, "sbadmin3@example.com")

    r = client.post("/admin/savebridge/credentials", headers=headers, json={
        "label": "oops", "policy": "unrestricted_private",
        "credentialType": "public_distribution", "confirmUnrestricted": True})
    assert r.status_code == 422, r.text


def test_an_unknown_policy_is_refused_at_the_edge(client, sessionmaker_factory):
    headers = _register(client, "sbadmin4@example.com")
    _promote(sessionmaker_factory, "sbadmin4@example.com")
    r = client.post("/admin/savebridge/credentials", headers=headers, json={
        "label": "x", "policy": "unrestricted", "confirmUnrestricted": True})
    assert r.status_code == 422


# ---------------------------------------------------------------- internal

def test_the_internal_endpoint_requires_its_key(client):
    r = client.post("/internal/savebridge/authenticate", json={"token": "sbc_v1_x.y"})
    assert r.status_code == 403, r.text


def test_the_internal_endpoint_rejects_a_wrong_key(client):
    r = client.post("/internal/savebridge/authenticate",
                    headers={"X-SaveBridge-Internal-Key": "nope"},
                    json={"token": "sbc_v1_x.y"})
    assert r.status_code == 403


def test_a_users_session_does_not_open_the_internal_endpoint(client, sessionmaker_factory):
    """Even a platform admin's browser session is not the relay."""
    headers = _register(client, "sbadmin5@example.com")
    _promote(sessionmaker_factory, "sbadmin5@example.com")
    r = client.post("/internal/savebridge/authenticate", headers=headers,
                    json={"token": "sbc_v1_x.y"})
    assert r.status_code == 403


def test_the_internal_endpoint_answers_policy_for_a_valid_credential(
    client, sessionmaker_factory,
):
    from extsync_api.config import settings

    headers = _register(client, "sbadmin6@example.com")
    _promote(sessionmaker_factory, "sbadmin6@example.com")
    token = client.post("/admin/savebridge/credentials", headers=headers, json={
        "label": "relay test", "policy": "netfree_required",
        "credentialType": "public_distribution"}).json()["token"]

    r = client.post("/internal/savebridge/authenticate",
                    headers={"X-SaveBridge-Internal-Key": settings.savebridge_internal_key},
                    json={"token": token})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["policy"] == "netfree_required"
    # It answers WHO, never whether a video may be downloaded - that decision
    # belongs to the relay, which is the only component that calls the verifier.
    assert "verdict" not in body and "allowed" not in body


def test_the_internal_endpoint_reports_revocation(client, sessionmaker_factory):
    from extsync_api.config import settings

    headers = _register(client, "sbadmin7@example.com")
    _promote(sessionmaker_factory, "sbadmin7@example.com")
    created = client.post("/admin/savebridge/credentials", headers=headers, json={
        "label": "revoke me", "policy": "unrestricted_private",
        "confirmUnrestricted": True}).json()

    client.post(f"/admin/savebridge/credentials/{created['id']}/revoke",
                headers=headers, json={"reason": "leaked"})

    r = client.post("/internal/savebridge/authenticate",
                    headers={"X-SaveBridge-Internal-Key": settings.savebridge_internal_key},
                    json={"token": created["token"]})
    assert r.status_code == 200
    assert r.json() == {"ok": False, "reason": "revoked"}


# ------------------------------------------- the internal endpoint's origin

def test_an_internal_call_that_came_through_the_edge_is_refused(client):
    """Defence in depth for an endpoint that turned out to be publicly routed.

    Caddy is the only upstream and always appends X-Forwarded-For; the relay
    talks to api:8000 directly and sets none. So the header's presence means the
    call came from outside, which is exactly what this endpoint must refuse -
    even with the correct key.
    """
    from extsync_api.config import settings

    r = client.post(
        "/internal/savebridge/authenticate",
        headers={"X-SaveBridge-Internal-Key": settings.savebridge_internal_key,
                 "X-Forwarded-For": "203.0.113.9"},
        json={"token": "sbc_v1_x.y"})
    # 404, not 403: it should not confirm to the internet that it exists.
    assert r.status_code == 404, r.text


def test_a_forged_forwarded_header_cannot_help_an_attacker(client):
    """The check can only be tripped, never evaded: an attacker can ADD the
    header (refused) but cannot remove the one Caddy appends."""
    from extsync_api.config import settings

    for spoof in ("127.0.0.1", "", "172.18.0.5, 203.0.113.9"):
        r = client.post(
            "/internal/savebridge/authenticate",
            headers={"X-SaveBridge-Internal-Key": settings.savebridge_internal_key,
                     "X-Forwarded-For": spoof},
            json={"token": "sbc_v1_x.y"})
        assert r.status_code == 404, f"{spoof!r} -> {r.status_code}"


def test_a_direct_internal_call_still_works(client):
    """The guard must not break the relay, which is the only legitimate caller."""
    from extsync_api.config import settings

    r = client.post(
        "/internal/savebridge/authenticate",
        headers={"X-SaveBridge-Internal-Key": settings.savebridge_internal_key},
        json={"token": "sbc_v1_AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": False, "reason": "invalid"}


def test_the_admin_routes_are_unaffected_by_the_edge_guard(client, sessionmaker_factory):
    """Admin routes are SUPPOSED to be reachable through the edge - the guard
    must be scoped to /internal/ and not leak onto them."""
    headers = _register(client, "sbedge@example.com")
    _promote(sessionmaker_factory, "sbedge@example.com")
    r = client.get("/admin/savebridge/credentials",
                   headers={**headers, "X-Forwarded-For": "203.0.113.9"})
    assert r.status_code == 200, r.text
