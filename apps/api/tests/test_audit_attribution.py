"""Reviewer attribution has to outlive the reviewer's account.

audit_events.actor_user_id, releases.reviewed_by_user_id and
projects.listing_reviewed_by_user_id are all ON DELETE SET NULL. On their own
that means deleting an account silently rewrites history: every decision that
person ever made stops naming anyone, retroactively, with nothing in the row to
show that it once did. A moderation trail whose whole purpose is "who cleared
this for the public" cannot work that way.

These tests assert the property directly - approve, then delete the reviewer,
then check the record still identifies them.
"""
from __future__ import annotations

import asyncio
import datetime as dt

import pytest
from sqlalchemy import select, text

from extsync_api.models.audit import AuditEvent
from extsync_api.models.enums import (
    Channel,
    ProjectStatus,
    ProjectVisibility,
    ReleaseStatus,
    ReviewStatus,
    UserRole,
)
from extsync_api.models.project import Project
from extsync_api.models.release import Release, ReleaseArtifact
from extsync_api.models.user import User
from extsync_api.services.audit import record_audit
from extsync_api.services.listing import approve_listing
from extsync_api.services.moderation import _stamp

ADMIN_ID = "usr_admin"
ADMIN_EMAIL = "admin@extsync.test"
ADMIN_NAME = "Real Administrator"
# The reviewer is deliberately NOT the developer: the extension is owned and
# uploaded by someone else, so deleting the reviewer only exercises the three
# nullable reviewer FKs and is not blocked by ownership references.
DEV_ID = "usr_dev"


def _admin() -> User:
    return User(
        id=ADMIN_ID, email=ADMIN_EMAIL, display_name=ADMIN_NAME,
        role=UserRole.platform_admin, password_hash="x", email_verified=True,
    )


def _developer() -> User:
    return User(
        id=DEV_ID, email="dev@extsync.test", display_name="Dev",
        role=UserRole.developer, password_hash="x", email_verified=True,
    )


def _project() -> Project:
    return Project(
        id="ext_1", name="Thing", slug="thing", owner_user_id=DEV_ID,
        status=ProjectStatus.active, visibility=ProjectVisibility.public,
    )


def _release() -> Release:
    return Release(
        id="rel_1", project_id="ext_1", version="1.0", sequence=1,
        uploaded_by_user_id=DEV_ID, channel=Channel.stable,
        status=ReleaseStatus.published, review_status=ReviewStatus.legacy_pending,
    )


@pytest.fixture()
def seeded(client, sessionmaker_factory):
    async def _run() -> None:
        async with sessionmaker_factory() as s:
            s.add_all([_admin(), _developer(), _project(), _release()])
            await s.commit()

    asyncio.run(_run())
    return sessionmaker_factory


def _run(sm, coro_fn):
    async def _go():
        async with sm() as s:
            out = await coro_fn(s)
            await s.commit()
            return out

    return asyncio.run(_go())


async def _delete_admin(s) -> None:
    """Delete the reviewer and let the FK action actually fire.

    SQLite ignores foreign keys unless the connection asks for them, so without
    this PRAGMA the delete would leave actor_user_id pointing at a row that no
    longer exists - which would make these tests pass for the wrong reason and
    never exercise the ON DELETE SET NULL that causes the problem in Postgres.
    """
    await s.execute(text("PRAGMA foreign_keys=ON"))
    await s.delete(await s.get(User, ADMIN_ID))


def _fk_is_set_null(column) -> bool:
    return any(getattr(fk, "ondelete", "") == "SET NULL"
               for fk in column.foreign_keys)


# ------------------------------------------------------------------ the audit row

def test_audit_records_both_the_fk_and_the_snapshot(seeded):
    async def act(s):
        await record_audit(s, action="moderation.approve", actor=await s.get(User, ADMIN_ID),
                           target_type="release", target_id="rel_1")

    _run(seeded, act)

    async def read(s):
        return await s.scalar(select(AuditEvent).where(AuditEvent.target_id == "rel_1"))

    ev = _run(seeded, read)
    assert ev.actor_user_id == ADMIN_ID
    assert ev.actor_email_snapshot == ADMIN_EMAIL
    assert ev.actor_display_name_snapshot == ADMIN_NAME


def test_snapshot_survives_the_reviewer_account_being_deleted(seeded):
    """The regression this whole change exists for."""
    async def act(s):
        await record_audit(s, action="moderation.approve", actor=await s.get(User, ADMIN_ID),
                           target_type="release", target_id="rel_1")

    _run(seeded, act)

    _run(seeded, _delete_admin)

    async def read(s):
        return await s.scalar(select(AuditEvent).where(AuditEvent.target_id == "rel_1"))

    ev = _run(seeded, read)
    # The FK is allowed to go: that is the schema working as designed.
    assert ev.actor_user_id is None
    # The identity is not.
    assert ev.actor_email_snapshot == ADMIN_EMAIL, (
        "deleting the reviewer erased who performed this moderation action - "
        "the audit row no longer identifies anyone"
    )
    assert ev.actor_display_name_snapshot == ADMIN_NAME


def test_audit_without_an_actor_object_stores_no_invented_snapshot(seeded):
    """Callers that genuinely only have an id must leave the snapshot empty.

    An empty snapshot is an honest gap. A derived one would be a guess that
    reads exactly like a record.
    """
    async def act(s):
        await record_audit(s, action="moderation.approve", actor_user_id=ADMIN_ID,
                           target_type="release", target_id="rel_other")

    _run(seeded, act)

    async def read(s):
        return await s.scalar(select(AuditEvent).where(AuditEvent.target_id == "rel_other"))

    ev = _run(seeded, read)
    assert ev.actor_user_id == ADMIN_ID
    assert ev.actor_email_snapshot is None
    assert ev.actor_display_name_snapshot is None


# ------------------------------------------------------------ the release itself

def test_release_review_stamps_a_durable_reviewer(seeded):
    async def act(s):
        release = await s.get(Release, "rel_1")
        _stamp(release, await s.get(User, ADMIN_ID), ReviewStatus.approved, None, "note")

    _run(seeded, act)

    _run(seeded, _delete_admin)

    release = _run(seeded, lambda s: s.get(Release, "rel_1"))
    assert release.reviewed_by_user_id is None
    assert release.reviewed_by_email_snapshot == ADMIN_EMAIL
    assert release.reviewed_by_name_snapshot == ADMIN_NAME
    assert release.review_status == ReviewStatus.approved


def test_listing_approval_stamps_a_durable_reviewer(seeded):
    async def act(s):
        await approve_listing(s, await s.get(Project, "ext_1"),
                              admin=await s.get(User, ADMIN_ID))

    _run(seeded, act)

    _run(seeded, _delete_admin)

    project = _run(seeded, lambda s: s.get(Project, "ext_1"))
    assert project.listing_reviewed_by_user_id is None
    assert project.listing_reviewed_by_email_snapshot == ADMIN_EMAIL
    assert project.listing_reviewed_by_name_snapshot == ADMIN_NAME


# ------------------------------------------------------------------- reporting

def test_reviewer_identity_prefers_live_and_falls_back_to_snapshot():
    """The display rule, unit-tested so the fallback cannot silently invert.

    `source` matters as much as the value: a reader has to be able to tell "this
    account still exists" from "this is all that is left of it".
    """
    from extsync_api.routers.moderation import _reviewer_identity

    live = User(id="u", email="now@x.test", display_name="Now",
                role=UserRole.platform_admin, password_hash="x")
    assert _reviewer_identity(live, "old@x.test", "Old") == {
        "reviewedByEmail": "now@x.test", "reviewedByName": "Now",
        "reviewedByIdentitySource": "live",
    }
    assert _reviewer_identity(None, "old@x.test", "Old") == {
        "reviewedByEmail": "old@x.test", "reviewedByName": "Old",
        "reviewedByIdentitySource": "snapshot",
    }
    assert _reviewer_identity(None, None, None) == {
        "reviewedByEmail": None, "reviewedByName": None,
        "reviewedByIdentitySource": None,
    }


def test_historical_rows_are_left_alone(seeded):
    """No backfill. A row that never had a snapshot must not acquire one."""
    async def act(s):
        s.add(AuditEvent(id="evt_hist", action="moderation.approve",
                         actor_user_id=None, actor_type="user",
                         target_type="release", target_id="rel_hist",
                         created_at=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)))

    _run(seeded, act)
    ev = _run(seeded, lambda s: s.get(AuditEvent, "evt_hist"))
    assert ev.actor_user_id is None
    assert ev.actor_email_snapshot is None
    assert ev.actor_display_name_snapshot is None


def test_the_fks_really_are_set_null(seeded):
    """Pins the schema these tests are defending against.

    If a future migration made any of these ON DELETE CASCADE, the row itself
    would vanish and no snapshot could save it - so the snapshot design depends
    on the delete action staying SET NULL. If it ever changes to RESTRICT the
    tests above would pass trivially, which is the other way to be wrong.
    """
    assert _fk_is_set_null(AuditEvent.__table__.c.actor_user_id)
    assert _fk_is_set_null(Release.__table__.c.reviewed_by_user_id)
    assert _fk_is_set_null(Project.__table__.c.listing_reviewed_by_user_id)
