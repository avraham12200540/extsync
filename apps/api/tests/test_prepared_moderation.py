"""Applying a batch of prepared decisions must be no weaker than clicking them.

The batch endpoint exists so an administrator does not have to perform forty
separate operations by hand. That convenience is only acceptable if it cannot
become a way to do something the individual actions would not allow, so these
tests are mostly about what the batch REFUSES:

  * a decision cannot be strengthened by the client, because the request carries
    no decision at all - only ids;
  * a decision made about bytes that have since changed is stale and is skipped,
    not applied;
  * "needs human review" is a decision not to decide, and is never executed;
  * one bad item does not take the batch, or the rows around it, with it;
  * running it twice does not decide anything twice.
"""
from __future__ import annotations

import asyncio

import pytest

from extsync_api.config import settings
from extsync_api.models.enums import (
    Channel,
    ProjectStatus,
    ProjectVisibility,
    ReleaseStatus,
    ReviewStatus,
    UserRole,
)
from extsync_api.models.prepared_moderation import PreparedDecision
from extsync_api.models.project import Project
from extsync_api.models.release import Release, ReleaseArtifact
from extsync_api.models.user import User
from extsync_api.services import prepared_moderation as prep

ADMIN_ID, ADMIN_EMAIL = "usr_admin", "admin@extsync.test"
SHA_REVIEWED = "a" * 64
SHA_DIFFERENT = "b" * 64


def _seed(s, *, sha: str = SHA_REVIEWED, decision: str = "approve",
          reason: str | None = "כי כן", n: int = 1) -> None:
    s.add(User(id=ADMIN_ID, email=ADMIN_EMAIL, display_name="Admin",
               role=UserRole.platform_admin, password_hash="x", email_verified=True))
    for i in range(n):
        pid, rid = f"ext_{i}", f"rel_{i}"
        s.add(Project(id=pid, name=f"P{i}", slug=f"p{i}", owner_user_id=ADMIN_ID,
                      status=ProjectStatus.active, visibility=ProjectVisibility.public,
                      listing_review_status=ReviewStatus.legacy_pending))
        s.add(Release(id=rid, project_id=pid, version="1.0", sequence=1,
                      uploaded_by_user_id=ADMIN_ID, channel=Channel.stable,
                      status=ReleaseStatus.published,
                      review_status=ReviewStatus.legacy_pending))
        s.add(ReleaseArtifact(id=f"art_{i}", release_id=rid, kind="validated",
                              s3_bucket=settings.s3_bucket_artifacts,
                              s3_key=f"{pid}/{rid}.zip",
                              size=10, sha256=sha, file_count=1))
        # A private copy as well, so a takedown does not have to archive the
        # public object first. Without it withdraw_artifact_public correctly
        # refuses (it would be deleting the only copy of the build), and these
        # tests would be measuring the absence of object storage instead of the
        # behaviour they are about.
        s.add(ReleaseArtifact(id=f"stage_{i}", release_id=rid, kind="validated",
                              s3_bucket=settings.s3_bucket_pending,
                              s3_key=f"{pid}/{rid}.zip",
                              size=10, sha256=sha, file_count=1))
        s.add(PreparedDecision(id=f"prep_{i}", release_id=rid, project_id=pid,
                               batch="test", decision=decision,
                               listing_decision="approve_listing",
                               developer_reason=reason, internal_note="internal",
                               reviewed_sha256=SHA_REVIEWED))


@pytest.fixture()
def db(client, sessionmaker_factory):
    return sessionmaker_factory


def run(sm, fn):
    async def _go():
        async with sm() as s:
            out = await fn(s)
            await s.commit()
            return out

    return asyncio.run(_go())


def seed(sm, **kw):
    run(sm, lambda s: asyncio.sleep(0, result=_seed(s, **kw)))


def apply(sm, ids):
    async def _go(s):
        return await prep.apply_batch(s, admin=await s.get(User, ADMIN_ID), ids=ids)

    return run(sm, _go)


# ------------------------------------------------------------------- checksums

def test_checksum_state_classifies_missing_evidence_as_unknown():
    assert prep.checksum_state(SHA_REVIEWED, SHA_REVIEWED) == "match"
    assert prep.checksum_state(SHA_REVIEWED, SHA_DIFFERENT) == "changed"
    # Absent is not agreement.
    assert prep.checksum_state(None, SHA_REVIEWED) == "unknown"
    assert prep.checksum_state(SHA_REVIEWED, None) == "unknown"


def test_a_changed_artifact_is_skipped_not_applied(db):
    """The decision was made about bytes that are no longer what ships."""
    seed(db, sha=SHA_DIFFERENT)
    result = apply(db, ["prep_0"])

    assert result.applied == 0
    assert result.skipped == 1
    assert "השתנה" in result.items[0].message

    release = run(db, lambda s: s.get(Release, "rel_0"))
    assert release.review_status == ReviewStatus.legacy_pending, (
        "a stale decision was applied to code nobody reviewed"
    )


def test_preview_reports_the_checksum_comparison(db):
    seed(db, sha=SHA_DIFFERENT)
    rows = run(db, lambda s: prep.preview(s))
    assert rows[0]["checksum"] == "changed"
    assert rows[0]["reviewedSha256"] == SHA_REVIEWED
    assert rows[0]["currentSha256"] == SHA_DIFFERENT
    assert rows[0]["blockedReason"]


# ------------------------------------------------------- what cannot be applied

def test_needs_human_review_is_never_executed(db):
    seed(db, decision="needs_human_review")
    result = apply(db, ["prep_0"])

    assert result.applied == 0 and result.skipped == 1
    release = run(db, lambda s: s.get(Release, "rel_0"))
    assert release.review_status == ReviewStatus.legacy_pending


def test_a_takedown_without_a_developer_reason_is_refused(db):
    """Removing an extension from the store always owes the developer an
    explanation, and the batch is not a way around that."""
    seed(db, decision="unpublish", reason=None)
    result = apply(db, ["prep_0"])

    assert result.applied == 0 and result.skipped == 1
    assert "נימוק" in result.items[0].message
    release = run(db, lambda s: s.get(Release, "rel_0"))
    assert release.status == ReleaseStatus.published


def test_the_request_body_cannot_carry_a_decision(client):
    """The escalation guard, asserted against the actual schema.

    If ApplyPreparedRequest ever grows a decision/action field, a client could
    ask for a stronger action than the one that was reviewed. The absence of
    that field is the control, so the test is on the schema itself.
    """
    spec = client.app.openapi()
    body = spec["paths"]["/admin/moderation/prepared/apply"]["post"]["requestBody"]
    ref = body["content"]["application/json"]["schema"]["$ref"].split("/")[-1]
    props = set(spec["components"]["schemas"][ref]["properties"])
    assert props == {"ids"}, (
        f"the apply request accepts {props} - anything beyond `ids` lets the "
        f"caller influence WHAT is executed, not just which rows"
    )


def test_only_the_stored_decision_is_executed(db):
    """Belt and braces: even given ids, the action comes from the row."""
    seed(db, decision="approve")
    run(db, lambda s: _mutate(s, "prep_0", decision="unpublish"))
    apply(db, ["prep_0"])

    release = run(db, lambda s: s.get(Release, "rel_0"))
    # The row said unpublish, so unpublish is what happened - not the "approve"
    # it was seeded with. The stored value governs in both directions.
    assert release.review_status == ReviewStatus.rejected


async def _mutate(s, prep_id, **kw):
    row = await s.get(PreparedDecision, prep_id)
    for k, v in kw.items():
        setattr(row, k, v)


# ---------------------------------------------------------------- isolation

def test_one_failing_item_does_not_stop_the_others(db):
    seed(db, n=3)
    run(db, lambda s: _mutate(s, "prep_1", release_id="rel_missing"))

    result = apply(db, ["prep_0", "prep_1", "prep_2"])

    assert result.applied == 2
    assert result.failed == 1
    assert {r.state for r in result.items} == {"applied", "failed"}
    for rid in ("rel_0", "rel_2"):
        assert run(db, lambda s, r=rid: s.get(Release, r)).review_status == \
            ReviewStatus.approved


def test_an_unknown_id_is_reported_not_ignored(db):
    seed(db)
    result = apply(db, ["prep_0", "prep_nope"])
    assert result.applied == 1
    assert result.failed == 1
    assert any(i.prepared_id == "prep_nope" for i in result.items)


# ---------------------------------------------------------------- idempotency

def test_applying_twice_decides_once(db):
    seed(db)
    first = apply(db, ["prep_0"])
    second = apply(db, ["prep_0"])

    assert first.applied == 1
    assert second.applied == 0 and second.skipped == 1

    row = run(db, lambda s: s.get(PreparedDecision, "prep_0"))
    assert row.state == "applied"


def test_a_release_already_moved_on_is_not_re_decided(db):
    """Someone else acted in between. The prepared decision was about the state
    the reviewer saw, and that state is gone."""
    seed(db)
    run(db, lambda s: _set_review(s, "rel_0", ReviewStatus.changes_requested))

    result = apply(db, ["prep_0"])
    assert result.applied == 0 and result.skipped == 1
    assert "כבר בסטטוס" in result.items[0].message


async def _set_review(s, rid, status):
    release = await s.get(Release, rid)
    release.review_status = status


# ----------------------------------------------------------------- attribution

def test_the_applying_admin_is_recorded_durably(db):
    seed(db)
    apply(db, ["prep_0"])

    row = run(db, lambda s: s.get(PreparedDecision, "prep_0"))
    assert row.applied_by_user_id == ADMIN_ID
    assert row.applied_by_email_snapshot == ADMIN_EMAIL

    release = run(db, lambda s: s.get(Release, "rel_0"))
    assert release.reviewed_by_user_id == ADMIN_ID
    assert release.reviewed_by_email_snapshot == ADMIN_EMAIL


def test_preparing_a_decision_changes_nothing_public(db):
    """The core separation: a prepared row is inert until applied."""
    seed(db)
    rows = run(db, lambda s: prep.preview(s))
    assert rows and rows[0]["state"] == "prepared"

    release = run(db, lambda s: s.get(Release, "rel_0"))
    assert release.review_status == ReviewStatus.legacy_pending
    assert release.reviewed_by_user_id is None
    assert release.reviewed_by_email_snapshot is None
