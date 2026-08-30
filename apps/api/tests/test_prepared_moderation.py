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
import inspect

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
    """Run `fn(session)` and commit. `fn` may be sync or async - the seed helpers
    are plain functions and the service calls are coroutines."""
    async def _go():
        async with sm() as s:
            out = fn(s)
            if inspect.isawaitable(out):
                out = await out
            await s.commit()
            return out

    return asyncio.run(_go())


def seed(sm, **kw):
    run(sm, lambda s: _seed(s, **kw))


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


def test_approving_code_while_refusing_the_listing_does_not_approve_the_listing(db):
    """The two halves of a decision can disagree, and the code half must not
    quietly settle the listing half.

    approve_release normally carries the listing along, because a reviewer on the
    review page is looking at both. When the prepared decision says the listing
    needs changes, that shortcut would set approved_listing to the very content
    being refused - and the rejection that follows does not clear it, so the
    store would keep serving a snapshot nobody approved.
    """
    seed(db, decision="approve_with_note")
    run(db, lambda s: _mutate(s, "prep_0", listing_decision="listing_needs_changes"))

    result = apply(db, ["prep_0"])
    assert result.applied == 1

    project = run(db, lambda s: s.get(Project, "ext_0"))
    release = run(db, lambda s: s.get(Release, "rel_0"))
    assert release.review_status == ReviewStatus.approved
    assert project.listing_review_status == ReviewStatus.rejected
    assert project.approved_listing is None, (
        "the listing was refused, but an approved snapshot was published anyway"
    )


def test_approving_both_halves_still_approves_the_listing(db):
    """The default path must keep working: one decision, both halves."""
    seed(db, decision="approve")
    result = apply(db, ["prep_0"])
    assert result.applied == 1

    project = run(db, lambda s: s.get(Project, "ext_0"))
    assert project.listing_review_status == ReviewStatus.approved
    assert project.approved_listing is not None


# ------------------------------------------------- the transition ordering guard
#
# Retiring a release that is STILL the one serving users empties the channel,
# because there is no approved earlier release to fall back to. For a removal
# that is correct. For the second half of a replacement it is a self-inflicted
# outage, and the two look identical in `decision` - both are request_changes.
# So the reviewer marks the row, and these tests are the proof that the mark is
# enforced by the server rather than merely displayed.

def _channel(s, project_id: str, active_release_id: str | None):
    from extsync_api.models.release import ChannelState
    s.add(ChannelState(id=f"chn_{project_id}", project_id=project_id,
                       channel=Channel.stable, active_release_id=active_release_id,
                       rollout_percentage=100, is_paused=False))


def _successor(s, *, review_status: ReviewStatus, sequence: int = 2,
               version: str = "2.0") -> None:
    """A newer release on the same project/channel, and point the channel at it."""
    s.add(Release(id="rel_new", project_id="ext_0", version=version, sequence=sequence,
                  uploaded_by_user_id=ADMIN_ID, channel=Channel.stable,
                  status=ReleaseStatus.published, review_status=review_status))
    s.add(ReleaseArtifact(id="art_new", release_id="rel_new", kind="validated",
                          s3_bucket=settings.s3_bucket_artifacts, s3_key="ext_0/rel_new.zip",
                          size=10, sha256=SHA_REVIEWED, file_count=1))


async def _guarded(s):
    row = await s.get(PreparedDecision, "prep_0")
    row.decision = "request_changes"
    row.requires_newer_approved_release = True


def test_the_takedown_is_refused_while_its_release_is_still_current(db):
    """THE WRONG-ORDER CLICK. This is the one that would empty the store."""
    seed(db)
    run(db, lambda s: _channel(s, "ext_0", "rel_0"))   # rel_0 is still live
    run(db, _guarded)

    result = apply(db, ["prep_0"])

    assert result.applied == 0
    assert result.skipped == 1
    assert "לא ניתן להסיר את הגרסה הנוכחית" in result.items[0].message

    release = run(db, lambda s: s.get(Release, "rel_0"))
    assert release.review_status == ReviewStatus.legacy_pending
    assert release.status == ReleaseStatus.published, "the live release was taken down"


def test_the_takedown_is_refused_when_the_successor_is_not_approved(db):
    """`legacy_pending` means live but never reviewed. Handing the channel to
    something unreviewed and then retiring the old build is not a transition."""
    seed(db)
    run(db, lambda s: _successor(s, review_status=ReviewStatus.legacy_pending))
    run(db, lambda s: _channel(s, "ext_0", "rel_new"))
    run(db, _guarded)

    result = apply(db, ["prep_0"])
    assert result.applied == 0 and result.skipped == 1
    assert "לא ניתן להסיר" in result.items[0].message


def test_the_takedown_proceeds_once_an_approved_successor_is_live(db):
    """The guard must open, or it is just a permanent block."""
    seed(db)
    run(db, lambda s: _successor(s, review_status=ReviewStatus.approved))
    run(db, lambda s: _channel(s, "ext_0", "rel_new"))
    run(db, _guarded)

    result = apply(db, ["prep_0"])
    assert result.applied == 1, result.items[0].message

    old = run(db, lambda s: s.get(Release, "rel_0"))
    assert old.review_status == ReviewStatus.changes_requested
    # and the successor kept the channel
    from extsync_api.models.release import ChannelState
    state = run(db, lambda s: s.get(ChannelState, "chn_ext_0"))
    assert state.active_release_id == "rel_new"


def test_the_guard_only_applies_to_rows_that_ask_for_it(db):
    """An ordinary takedown of a live release is still allowed - that is what
    UNPUBLISH means, and the guard must not quietly redefine it."""
    seed(db, decision="unpublish")
    run(db, lambda s: _channel(s, "ext_0", "rel_0"))
    # requires_newer_approved_release deliberately left False

    result = apply(db, ["prep_0"])
    assert result.applied == 1, result.items[0].message
    release = run(db, lambda s: s.get(Release, "rel_0"))
    assert release.review_status == ReviewStatus.rejected


def test_the_preview_reports_the_block_before_anyone_clicks(db):
    seed(db)
    run(db, lambda s: _channel(s, "ext_0", "rel_0"))
    run(db, _guarded)

    row = run(db, lambda s: prep.preview(s))[0]
    assert row["requiresNewerApprovedRelease"] is True
    assert row["successor"]["ready"] is False
    assert row["successor"]["reason"] == "still_current"
    assert "לא ניתן להסיר את הגרסה הנוכחית" in row["blockedReason"]


def test_the_guard_is_re_evaluated_at_apply_time_not_taken_from_the_preview(db):
    """The channel can move between loading the page and pressing the button.
    A preview that said "ready" must not be able to authorise a stale action."""
    seed(db)
    run(db, lambda s: _successor(s, review_status=ReviewStatus.approved))
    run(db, lambda s: _channel(s, "ext_0", "rel_new"))
    run(db, _guarded)

    ready = run(db, lambda s: prep.preview(s))[0]
    assert ready["successor"]["ready"] is True and not ready["blockedReason"]

    # Someone rolls the channel back to the old release in the meantime.
    async def _rollback(s):
        from extsync_api.models.release import ChannelState
        st = await s.get(ChannelState, "chn_ext_0")
        st.active_release_id = "rel_0"

    run(db, _rollback)

    result = apply(db, ["prep_0"])
    assert result.applied == 0 and result.skipped == 1
    assert "לא ניתן להסיר את הגרסה הנוכחית" in result.items[0].message


# ------------------------------------------------------------- listing no-op

def test_listing_no_op_leaves_the_listing_completely_alone(db):
    """"Leave the listing as it is" has to mean exactly that: not approved, not
    rejected, and no approved snapshot written."""
    seed(db, decision="approve")
    run(db, lambda s: _mutate(s, "prep_0", listing_decision="listing_no_op"))

    result = apply(db, ["prep_0"])
    assert result.applied == 1

    project = run(db, lambda s: s.get(Project, "ext_0"))
    assert project.listing_review_status == ReviewStatus.legacy_pending
    assert project.approved_listing is None
    assert project.listing_reviewed_by_user_id is None
