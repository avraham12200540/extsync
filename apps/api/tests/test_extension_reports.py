"""Reporting an extension.

The properties that matter, in order:

  1. Nothing is required. No account, no reason, no email - a bare report is a
     valid report, because asking for more only makes fewer people bother.
  2. Reports go to administrators and NOWHERE else. Not to the developer, who
     may be the subject of the report, and not to other users.
  3. An open endpoint is a spam target, so it is rate limited per connection.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select

from extsync_api.models.enums import (
    Channel,
    ProjectStatus,
    ProjectVisibility,
    ReleaseStatus,
    ReviewStatus,
    UserRole,
)
from extsync_api.models.extension_report import ExtensionReport
from extsync_api.models.project import Project
from extsync_api.models.release import ChannelState, Release
from extsync_api.models.user import User

SLUG = "reported-ext"


def _register(client, email, account_type="developer"):
    r = client.post("/auth/register", json={
        "email": email, "password": "Sup3r-Secret!", "accountType": account_type,
        "displayName": "Dev", "orgName": "Acme", "acceptTerms": True,
    })
    assert r.status_code == 201, r.text
    r = client.post("/auth/login", json={"email": email, "password": "Sup3r-Secret!"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


def _promote(sm, email):
    async def _go():
        async with sm() as s:
            u = await s.scalar(select(User).where(User.email == email))
            u.role = UserRole.platform_admin
            await s.commit()
    asyncio.run(_go())


@pytest.fixture()
def public_ext(client, sessionmaker_factory):
    """A public, active extension with a live stable release."""
    async def _go():
        async with sessionmaker_factory() as s:
            s.add(User(id="usr_owner", email="owner@example.com", display_name="Owner",
                       role=UserRole.developer, password_hash="x", email_verified=True))
            s.add(Project(id="ext_rep", name="Reported", slug=SLUG, owner_user_id="usr_owner",
                          status=ProjectStatus.active, visibility=ProjectVisibility.public,
                          listing_review_status=ReviewStatus.approved))
            s.add(Release(id="rel_rep", project_id="ext_rep", version="1.0", sequence=1,
                          uploaded_by_user_id="usr_owner", channel=Channel.stable,
                          status=ReleaseStatus.published, review_status=ReviewStatus.approved))
            s.add(ChannelState(id="chn_rep", project_id="ext_rep", channel=Channel.stable,
                               active_release_id="rel_rep", rollout_percentage=100,
                               is_paused=False))
            await s.commit()
    asyncio.run(_go())
    return sessionmaker_factory


def _reports(sm):
    async def _go():
        async with sm() as s:
            return (await s.scalars(select(ExtensionReport))).all()
    return asyncio.run(_go())


# ----------------------------------------------------------- nothing required

def test_a_completely_empty_report_is_accepted(client, public_ext):
    """No account, no reason, no email. Still a report."""
    r = client.post(f"/catalog/{SLUG}/report", json={})
    assert r.status_code == 201, r.text
    rows = _reports(public_ext)
    assert len(rows) == 1
    assert rows[0].reason is None and rows[0].reporter_email is None
    assert rows[0].reporter_user_id is None


def test_a_report_with_a_reason_and_email_keeps_both(client, public_ext):
    r = client.post(f"/catalog/{SLUG}/report",
                    json={"reason": "  steals passwords  ", "email": " me@example.com "})
    assert r.status_code == 201, r.text
    row = _reports(public_ext)[0]
    assert row.reason == "steals passwords"
    assert row.reporter_email == "me@example.com"


def test_blank_fields_are_stored_as_nothing(client, public_ext):
    """Leaving a box empty and typing only spaces must mean the same thing."""
    r = client.post(f"/catalog/{SLUG}/report", json={"reason": "   ", "email": "  "})
    assert r.status_code == 201, r.text
    row = _reports(public_ext)[0]
    assert row.reason is None
    assert row.reporter_email is None


def test_an_invalid_email_is_refused(client, public_ext):
    """Optional does not mean unchecked: something typed must be an address."""
    r = client.post(f"/catalog/{SLUG}/report", json={"email": "not-an-email"})
    assert r.status_code == 422, r.text
    assert _reports(public_ext) == []


def test_the_live_version_is_recorded(client, public_ext):
    client.post(f"/catalog/{SLUG}/report", json={})
    assert _reports(public_ext)[0].release_id == "rel_rep"


def test_a_signed_in_reporter_is_recorded(client, public_ext):
    headers = _register(client, "reporter@example.com")
    client.post(f"/catalog/{SLUG}/report", json={}, headers=headers)
    assert _reports(public_ext)[0].reporter_user_id is not None


def test_an_unknown_extension_cannot_be_reported(client, public_ext):
    r = client.post("/catalog/no-such-thing/report", json={})
    assert r.status_code == 404


def test_a_private_extension_cannot_be_reported_through_the_store(client, sessionmaker_factory):
    async def _go():
        async with sessionmaker_factory() as s:
            s.add(User(id="usr_o2", email="o2@example.com", display_name="O",
                       role=UserRole.developer, password_hash="x", email_verified=True))
            s.add(Project(id="ext_priv", name="Private", slug="private-ext",
                          owner_user_id="usr_o2", status=ProjectStatus.active,
                          visibility=ProjectVisibility.private))
            await s.commit()
    asyncio.run(_go())
    r = client.post("/catalog/private-ext/report", json={})
    assert r.status_code == 404


# ------------------------------------------------------------- who can read

def test_the_developer_cannot_read_reports_about_their_own_extension(client, public_ext):
    """The whole point: a report may be ABOUT the developer."""
    client.post(f"/catalog/{SLUG}/report", json={"reason": "malicious"})
    headers = _register(client, "somedev@example.com")
    r = client.get("/admin/moderation/reports", headers=headers)
    assert r.status_code == 403


def test_anonymous_cannot_read_reports(client, public_ext):
    r = client.get("/admin/moderation/reports")
    assert r.status_code in (401, 403)


def test_a_developer_cannot_close_a_report(client, public_ext):
    client.post(f"/catalog/{SLUG}/report", json={})
    rid = _reports(public_ext)[0].id
    headers = _register(client, "closer@example.com")
    r = client.post(f"/admin/moderation/reports/{rid}", json={"status": "dismissed"},
                    headers=headers)
    assert r.status_code == 403


def test_an_admin_sees_the_report(client, public_ext, sessionmaker_factory):
    client.post(f"/catalog/{SLUG}/report", json={"reason": "spam", "email": "a@example.com"})
    headers = _register(client, "rep-admin@example.com")
    _promote(sessionmaker_factory, "rep-admin@example.com")

    r = client.get("/admin/moderation/reports", headers=headers)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["projectSlug"] == SLUG
    assert rows[0]["reason"] == "spam"
    assert rows[0]["reporterEmail"] == "a@example.com"
    assert rows[0]["status"] == "open"


def test_an_admin_can_resolve_and_the_actor_is_durable(client, public_ext, sessionmaker_factory):
    client.post(f"/catalog/{SLUG}/report", json={})
    rid = _reports(public_ext)[0].id
    headers = _register(client, "rep-admin2@example.com")
    _promote(sessionmaker_factory, "rep-admin2@example.com")

    r = client.post(f"/admin/moderation/reports/{rid}",
                    json={"status": "resolved", "adminNote": "took it down"}, headers=headers)
    assert r.status_code == 200, r.text
    row = _reports(public_ext)[0]
    assert row.status == "resolved"
    assert row.handled_by_email_snapshot == "rep-admin2@example.com"
    assert row.admin_note == "took it down"

    # Resolved reports leave the default (open) list...
    assert client.get("/admin/moderation/reports", headers=headers).json() == []
    # ...but are still there for the record.
    assert len(client.get("/admin/moderation/reports?state=all", headers=headers).json()) == 1


def test_the_open_count_feeds_the_moderation_badge(client, public_ext, sessionmaker_factory):
    client.post(f"/catalog/{SLUG}/report", json={})
    client.post(f"/catalog/{SLUG}/report", json={"reason": "x"})
    headers = _register(client, "rep-admin3@example.com")
    _promote(sessionmaker_factory, "rep-admin3@example.com")
    counts = client.get("/admin/moderation/counts", headers=headers).json()
    assert counts["openReports"] == 2


def test_an_invalid_status_is_refused(client, public_ext, sessionmaker_factory):
    client.post(f"/catalog/{SLUG}/report", json={})
    rid = _reports(public_ext)[0].id
    headers = _register(client, "rep-admin4@example.com")
    _promote(sessionmaker_factory, "rep-admin4@example.com")
    r = client.post(f"/admin/moderation/reports/{rid}", json={"status": "deleted"},
                    headers=headers)
    assert r.status_code == 422
