"""Administrator moderation actions on releases.

These are the ONLY functions that write `Release.review_status`. Everything else
in the codebase reads that field through services/availability.py and never sets
it, which keeps "who may change a moderation decision" answerable by looking at
one module.

Authority is enforced at the router (platform_admin only, via AdminUser) and is
also structurally excluded from project owners - MODERATION_ACT is in
PLATFORM_ONLY_PERMISSIONS, so no amount of project or team authority grants it.

Every action here does three things together, and all three matter:

  1. sets the review state (what the policy reads),
  2. moves the BYTES (approval copies into public storage; every negative action
     deletes from it), so the storage layer agrees with the policy rather than
     merely being covered by it,
  3. records an audit entry and tells the developer, in-app and by email
     (notify_owner(email=True) already honours per-kind opt-outs and never
     fails the caller if SMTP is down).

Doing only (1) would leave a release the API calls private while its artifact is
still anonymously downloadable at a known URL. The two layers must never
disagree.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import APIError, ErrorCode
from ..logging import get_logger
from ..models.enums import NotificationKind, ReleaseStatus, ReviewStatus
from ..models.project import Project
from ..models.release import ChannelState, Release
from ..models.user import User
from .artifact_publication import publish_artifact_public, withdraw_artifact_public
from .audit import record_audit
from .availability import PUBLIC_REVIEW_STATES
from .events import emit_event, notify_owner
from .listing import approve_listing
from .release_service import activate_channel

logger = get_logger("extsync.moderation")


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _stamp(release: Release, admin: User, status: ReviewStatus,
           reason: str | None, note: str | None) -> None:
    """Record the decision itself.

    `reason` is developer-facing and `note` is internal - they are separate
    columns precisely so an administrator can write a frank internal assessment
    without it ever reaching the submitter.
    """
    release.review_status = status
    release.reviewed_by_user_id = admin.id
    release.reviewed_at = _now()
    release.review_reason = reason
    if note is not None:
        release.review_note = note


async def _previous_public_release(db: AsyncSession, project: Project,
                                   release: Release) -> Release | None:
    """The newest earlier version in this channel that is itself cleared.

    Deliberately checks the review dimension: falling back to "the previous
    version" without it would be a way to make an unreviewed release live by
    getting the one above it taken down.
    """
    return await db.scalar(
        select(Release).where(
            Release.project_id == project.id,
            Release.channel == release.channel,
            Release.id != release.id,
            Release.status == ReleaseStatus.superseded,
            Release.review_status.in_(PUBLIC_REVIEW_STATES),
        ).order_by(Release.sequence.desc()).limit(1)
    )


async def _take_down(db: AsyncSession, project: Project, release: Release) -> str | None:
    """Remove a release from public distribution entirely.

    Deletes the public artifact (so the URL stops working for anyone who already
    has it) and, if this release is the channel's live pointer, hands the channel
    back to the newest earlier version that is itself approved - restoring it to
    `published` so it is actually available again. Rejecting a bad UPDATE must not
    take the whole extension offline.

    If there is no cleared earlier version, the channel pointer is cleared and the
    extension leaves the store. That is the correct outcome: nothing about it has
    been approved.

    Returns the id of the release promoted back into the channel, if any.
    """
    await withdraw_artifact_public(db, release)

    state = await db.scalar(
        select(ChannelState).where(
            ChannelState.project_id == project.id,
            ChannelState.channel == release.channel,
        )
    )
    if state is None or state.active_release_id != release.id:
        return None

    prev = await _previous_public_release(db, project, release)
    if prev is None:
        state.active_release_id = None
        return None

    # Its signed metadata is still valid, so putting it back into `published` is
    # enough to make it servable - but its BYTES may have been archived into
    # private storage, since superseded artifacts are not left anonymously
    # downloadable. Restore them, or the store would show a version with nothing
    # behind the download button.
    prev.status = ReleaseStatus.published
    prev.superseded_by_release_id = None
    state.active_release_id = prev.id
    if await publish_artifact_public(db, prev) is None:
        logger.error(
            "takedown: promoted release %s back into channel %s but could not "
            "restore its artifact - the channel now has no downloadable file",
            prev.id, release.channel.value,
        )
    return prev.id


def _require_reviewable(release: Release) -> None:
    if release.status in (ReleaseStatus.uploaded, ReleaseStatus.validating,
                          ReleaseStatus.validation_failed):
        raise APIError(
            ErrorCode.RELEASE_NOT_READY,
            "לא ניתן לבדוק גרסה שלא סיימה אימות בהצלחה",
            status_code=409,
        )


# --------------------------------------------------------------------------- approve
async def approve_release(db: AsyncSession, project: Project, release: Release, *,
                          admin: User, reason: str | None = None, note: str | None = None,
                          ip: str | None = None) -> Release:
    """Clear a release for public distribution.

    Copies the validated build from private staging into public storage. Until
    this runs there is nothing at the public URL, so approval is what actually
    makes the bytes reachable - not a flag flip.
    """
    _require_reviewable(release)
    _stamp(release, admin, ReviewStatus.approved, reason, note)

    published = await publish_artifact_public(db, release)
    if published is None:
        # No staged artifact and no existing public one: approving would produce a
        # listing with nothing to download. Refuse rather than half-approve.
        raise APIError(
            ErrorCode.RELEASE_NOT_READY,
            "אין קובץ מאומת לגרסה הזו, ולכן לא ניתן לאשר אותה",
            status_code=409,
        )

    # Approval is what puts the version into its channel. Publishing only
    # submitted it; until now the channel kept serving the previously
    # approved release.
    if release.status == ReleaseStatus.published:
        await activate_channel(db, project, release, user=admin)

    # Approving is a judgement about the extension AS PRESENTED - the reviewer
    # was looking at the listing on the same page - so the listing shown at that
    # moment becomes the approved one. Without this a new extension would need
    # two separate approvals to be fully public, and the listing half would be
    # easy to forget.
    if release.review_status == ReviewStatus.approved and project.listing_review_status in (
        ReviewStatus.pending, ReviewStatus.legacy_pending,
    ):
        await approve_listing(db, project, admin_user_id=admin.id)

    await record_audit(db, action="moderation.approve", actor_user_id=admin.id,
                       target_type="release", target_id=release.id, project_id=project.id,
                       ip_address=ip, extra={"version": release.version,
                                             "channel": release.channel.value})
    await emit_event(db, project.id, "release.approved",
                     {"releaseId": release.id, "version": release.version})
    await notify_owner(db, project.id, NotificationKind.release_approved,
                       title="הגרסה אושרה",
                       body=f"גרסה {release.version} אושרה ופורסמה לציבור.",
                       data={"releaseId": release.id}, email=True)
    logger.info("moderation: %s approved release %s", admin.id, release.id)
    return release


# --------------------------------------------------------------------------- reject
async def reject_release(db: AsyncSession, project: Project, release: Release, *,
                         admin: User, reason: str, note: str | None = None,
                         ip: str | None = None) -> Release:
    """Refuse a release permanently.

    `reason` is required and is shown to the developer - a rejection with no
    explanation is not something we want to be able to send. The release is also
    moved to `revoked`, so the developer cannot re-publish it; the way forward is
    a new version.
    """
    _stamp(release, admin, ReviewStatus.rejected, reason, note)
    promoted = await _take_down(db, project, release)
    release.status = ReleaseStatus.revoked
    release.revoked_reason = reason

    await record_audit(db, action="moderation.reject", actor_user_id=admin.id,
                       target_type="release", target_id=release.id, project_id=project.id,
                       ip_address=ip, extra={"version": release.version,
                                             "channel": release.channel.value,
                                             "promoted": promoted})
    await emit_event(db, project.id, "release.rejected",
                     {"releaseId": release.id, "version": release.version})
    await notify_owner(db, project.id, NotificationKind.release_rejected,
                       title="הגרסה נדחתה",
                       body=f"גרסה {release.version} נדחתה בבדיקה. סיבה: {reason}",
                       data={"releaseId": release.id}, email=True)
    logger.info("moderation: %s rejected release %s", admin.id, release.id)
    return release


# ------------------------------------------------------------------ request changes
async def request_changes(db: AsyncSession, project: Project, release: Release, *,
                          admin: User, reason: str, note: str | None = None,
                          ip: str | None = None) -> Release:
    """Send a release back to the developer with required changes.

    Also takes the bytes down. `changes_requested` is a non-public state, so
    leaving the artifact in public storage would put the two layers in
    disagreement - the API would call it unavailable while the file stayed
    downloadable at a known URL.
    """
    _stamp(release, admin, ReviewStatus.changes_requested, reason, note)
    promoted = await _take_down(db, project, release)

    await record_audit(db, action="moderation.request_changes", actor_user_id=admin.id,
                       target_type="release", target_id=release.id, project_id=project.id,
                       ip_address=ip, extra={"version": release.version,
                                             "channel": release.channel.value,
                                             "promoted": promoted})
    await emit_event(db, project.id, "release.changes_requested",
                     {"releaseId": release.id, "version": release.version})
    await notify_owner(db, project.id, NotificationKind.release_changes_requested,
                       title="נדרשים תיקונים בגרסה",
                       body=f"לגרסה {release.version} נדרשים תיקונים לפני אישור. {reason}",
                       data={"releaseId": release.id}, email=True)
    logger.info("moderation: %s requested changes on release %s", admin.id, release.id)
    return release


# ------------------------------------------------------------------------ unpublish
async def unpublish_release(db: AsyncSession, project: Project, release: Release, *,
                            admin: User, reason: str, note: str | None = None,
                            ip: str | None = None) -> Release:
    """Take a currently-live release off the store.

    Mechanically identical to a rejection - and just as final. It exists as its
    own action so the audit trail distinguishes "refused a new submission" from
    "removed something that was already public", which are very different events
    when reading the log later.

    This is the action that ends grandfathering for a legacy extension: once used,
    the release is `rejected` and no developer action can bring it back.
    """
    _stamp(release, admin, ReviewStatus.rejected, reason, note)
    promoted = await _take_down(db, project, release)
    release.status = ReleaseStatus.revoked
    release.revoked_reason = reason

    await record_audit(db, action="moderation.unpublish", actor_user_id=admin.id,
                       target_type="release", target_id=release.id, project_id=project.id,
                       ip_address=ip, extra={"version": release.version,
                                             "channel": release.channel.value,
                                             "promoted": promoted})
    await emit_event(db, project.id, "release.unpublished",
                     {"releaseId": release.id, "version": release.version})
    await notify_owner(db, project.id, NotificationKind.release_rejected,
                       title="הגרסה הוסרה מהחנות",
                       body=f"גרסה {release.version} הוסרה מהחנות. סיבה: {reason}",
                       data={"releaseId": release.id}, email=True)
    logger.info("moderation: %s unpublished release %s", admin.id, release.id)
    return release
