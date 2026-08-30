"""Applying prepared moderation decisions under a real administrator's session.

The point of this module is to make a batch of decisions executable in one
authenticated action WITHOUT weakening any of the properties that make a single
decision trustworthy. Concretely:

  * The action executed comes from the stored row, never from the request. The
    caller sends ids. A client cannot promote a prepared "approve" into an
    "unpublish" by editing a payload, because the payload has no field to edit.

  * The actor is whoever is authenticated right now. Preparation records no
    reviewer at all; `applied_by` is written here, from the session, and the
    same durable snapshot the rest of the moderation trail uses is written with
    it. There is no path that lets a prepared row name its own reviewer.

  * The artifact is re-checked. `reviewed_sha256` is the build the reviewer
    actually read; if the shipped bytes have changed since, applying the
    decision would attribute a judgement to code nobody looked at, so the item
    is refused as stale and marked for re-review instead.

  * One failure is one failure. Each item runs in a nested transaction, so a
    release that cannot be approved does not roll back the twenty before it, and
    the result says per item what happened.

  * Applying twice is safe. An already-applied row is skipped, and so is one
    whose release has already left the review state the decision assumed.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import APIError
from ..logging import get_logger
from ..models.enums import ReviewStatus
from ..models.prepared_moderation import PreparedDecision
from ..models.project import Project
from ..models.release import ChannelState, Release
from ..models.user import User
from . import moderation as svc
from .artifact_publication import distribution_artifact
from .listing import approve_listing, reject_listing

logger = get_logger("extsync.prepared")

# Decisions this module knows how to execute. `needs_human_review` is
# deliberately absent: it is a decision NOT to decide, and there is nothing to
# apply. It stays in the queue as a visible item of work.
EXECUTABLE = {"approve", "approve_with_note", "request_changes", "unpublish"}
DECISIONS = EXECUTABLE | {"needs_human_review"}

LISTING_DECISIONS = {"approve_listing", "listing_needs_changes",
                     "listing_needs_human_review", "listing_no_op"}

# Listing decisions that deliberately do nothing. `listing_no_op` says the
# reviewer looked and chose to leave the listing exactly as it is - which is a
# different statement from "a human still has to decide" (needs_human_review)
# and from "no listing decision was recorded at all" (NULL).
LISTING_NO_OPS = {None, "listing_no_op", "listing_needs_human_review"}

# Decisions that end with the release no longer being distributed. These are the
# ones whose ordering matters when a replacement is on its way.
TAKEDOWN = {"request_changes", "unpublish"}

# Anything that removes an extension from the store must carry an explanation
# for the developer. This is checked at preparation time AND again at apply
# time, because a row could have been prepared before this rule existed.
REASON_REQUIRED = {"request_changes", "unpublish"}


@dataclass
class ItemResult:
    prepared_id: str
    release_id: str
    project_slug: str = ""
    decision: str = ""
    ok: bool = False
    state: str = "failed"          # applied | skipped | failed
    message: str = ""


@dataclass
class BatchResult:
    applied: int = 0
    skipped: int = 0
    failed: int = 0
    items: list[ItemResult] = field(default_factory=list)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


async def current_sha256(db: AsyncSession, release_id: str) -> str | None:
    """The checksum of the build that would be distributed right now.

    Uses the distribution artifact rather than only the public one, so a release
    whose bytes are currently staged (not yet public) still compares against
    something real instead of looking like it has no artifact at all.
    """
    art = await distribution_artifact(db, release_id)
    return art.sha256 if art else None


def checksum_state(reviewed: str | None, current: str | None) -> str:
    """match | changed | unknown.

    `unknown` when the review recorded no checksum, or the release has no
    artifact to compare against. It is deliberately not treated as `match`: a
    missing checksum is missing evidence, not agreement.
    """
    if not reviewed or not current:
        return "unknown"
    return "match" if reviewed == current else "changed"


async def successor_state(db: AsyncSession, row: PreparedDecision) -> dict:
    """Has something newer already taken over this release's channel?

    Answers the question the ordering guard turns on, and is also what the UI
    shows, so the screen and the server cannot disagree about whether the
    transition is ready.
    """
    release = await db.get(Release, row.release_id)
    if release is None:
        return {"ready": False, "reason": "release_missing", "activeReleaseId": None}

    state = await db.scalar(select(ChannelState).where(
        ChannelState.project_id == release.project_id,
        ChannelState.channel == release.channel,
    ))
    active_id = state.active_release_id if state else None

    # Still the one being served: retiring it now is what would empty the store.
    if active_id == release.id:
        return {"ready": False, "reason": "still_current", "activeReleaseId": active_id,
                "activeVersion": release.version, "activeApproved": None}

    if active_id is None:
        return {"ready": False, "reason": "no_active_release", "activeReleaseId": None}

    active = await db.get(Release, active_id)
    if active is None:
        return {"ready": False, "reason": "no_active_release", "activeReleaseId": active_id}

    # A successor that is merely live is not enough. `legacy_pending` means live
    # but never reviewed, and handing over to something unreviewed would defeat
    # the point of retiring the old build.
    approved = active.review_status == ReviewStatus.approved
    newer = (active.sequence or 0) > (release.sequence or 0)
    return {
        "ready": bool(approved and newer),
        "reason": None if (approved and newer)
                  else "successor_not_approved" if not approved else "successor_not_newer",
        "activeReleaseId": active.id,
        "activeVersion": active.version,
        "activeApproved": approved,
    }


def _blocking_reason(row: PreparedDecision, checksum: str,
                     successor: dict | None = None) -> str | None:
    """Why this row must not be executed, or None if it may be."""
    if row.state == "applied":
        return "כבר בוצע"
    if row.decision not in EXECUTABLE:
        return "החלטה שאינה ניתנת לביצוע אוטומטי (דורשת הכרעה אנושית)"
    if checksum == "changed":
        return ("הקובץ השתנה מאז הבדיקה - נדרשת בדיקה מחדש לפני החלטה")
    if row.decision in REASON_REQUIRED and not (row.developer_reason or "").strip():
        return "פעולה שמסירה תוסף מהחנות מחייבת נימוק למפתח"

    # The ordering guard. Only rows the reviewer explicitly marked as
    # "retire this AFTER its replacement is live" are subject to it, so an
    # ordinary takedown - one where the extension is meant to leave the store -
    # is not affected.
    if (row.requires_newer_approved_release and row.decision in TAKEDOWN
            and successor is not None and not successor.get("ready")):
        return (
            "לא ניתן להסיר את הגרסה הנוכחית עד שגרסה חדשה ומאושרת תהיה פעילה בערוץ. "
            "יש להעלות, לפרסם ולאשר את הגרסה החדשה, לוודא שהיא מוגשת לציבור, "
            "ורק אז להסיר את הישנה. "
            "(Cannot retire the current release until a newer approved release "
            "is active.)"
        )
    return None


async def preview(db: AsyncSession, batch: str | None = None) -> list[dict]:
    """The queue, with everything needed to decide whether to run it.

    Includes the checksum comparison, because "was this decision made about the
    code that is live now?" is the question that most needs answering before a
    batch runs, and it cannot be answered from the prepared row alone.
    """
    stmt = select(PreparedDecision, Release, Project).join(
        Release, Release.id == PreparedDecision.release_id, isouter=True,
    ).join(Project, Project.id == PreparedDecision.project_id, isouter=True)
    if batch:
        stmt = stmt.where(PreparedDecision.batch == batch)
    rows = (await db.execute(stmt.order_by(PreparedDecision.decision,
                                           PreparedDecision.created_at))).all()

    out: list[dict] = []
    for row, release, project in rows:
        current = await current_sha256(db, row.release_id) if release else None
        cs = checksum_state(row.reviewed_sha256, current)
        succ = await successor_state(db, row) if row.requires_newer_approved_release else None
        out.append({
            "id": row.id,
            "batch": row.batch,
            "releaseId": row.release_id,
            "projectId": row.project_id,
            "extension": project.name if project else None,
            "slug": project.slug if project else None,
            "version": release.version if release else None,
            "channel": release.channel.value if release else None,
            "currentReviewStatus": release.review_status.value if release else None,
            "listingReviewStatus": (project.listing_review_status.value
                                    if project else None),
            "decision": row.decision,
            "listingDecision": row.listing_decision,
            "developerReason": row.developer_reason,
            "internalNote": row.internal_note,
            "reviewedSha256": row.reviewed_sha256,
            "currentSha256": current,
            "checksum": cs,
            "state": row.state,
            "appliedAt": row.applied_at.isoformat().replace("+00:00", "Z")
                         if row.applied_at else None,
            "appliedByEmail": row.applied_by_email_snapshot,
            "resultMessage": row.result_message,
            "blockedReason": _blocking_reason(row, cs, succ),
            # Present only for rows that must wait for a replacement. Drives the
            # ordered checklist the admin screen shows for those transitions.
            "requiresNewerApprovedRelease": row.requires_newer_approved_release,
            "successor": succ,
        })
    return out


async def _apply_listing(db: AsyncSession, project: Project, row: PreparedDecision,
                         admin: User) -> None:
    """The listing half of a decision, when the review made one.

    `listing_needs_human_review` is intentionally a no-op: like its release-level
    counterpart it records that nobody decided, and acting on it would invent a
    decision.
    """
    if row.listing_decision in LISTING_NO_OPS:
        return
    if row.listing_decision == "approve_listing":
        if project.listing_review_status in (ReviewStatus.pending,
                                             ReviewStatus.legacy_pending):
            await approve_listing(db, project, admin=admin)
    elif row.listing_decision == "listing_needs_changes":
        reason = (row.developer_reason or "").strip()
        if reason:
            await reject_listing(db, project, admin=admin, reason=reason)


async def _apply_one(db: AsyncSession, row: PreparedDecision, admin: User,
                     ip: str | None) -> ItemResult:
    res = ItemResult(prepared_id=row.id, release_id=row.release_id,
                     decision=row.decision)

    release = await db.get(Release, row.release_id)
    if release is None:
        res.state, res.message = "failed", "הגרסה לא נמצאה"
        return res
    project = await db.get(Project, release.project_id)
    if project is None:
        res.state, res.message = "failed", "הפרויקט לא נמצא"
        return res
    res.project_slug = project.slug

    current = await current_sha256(db, row.release_id)
    # Recomputed here, not trusted from the preview: the channel can move between
    # loading the page and pressing the button, in either direction.
    succ = await successor_state(db, row) if row.requires_newer_approved_release else None
    blocked = _blocking_reason(row, checksum_state(row.reviewed_sha256, current), succ)
    if blocked:
        res.state, res.message = "skipped", blocked
        return res

    # Idempotency at the level that actually matters: not "did we run this row"
    # but "is the release still in the state this decision was made about". A
    # release someone already moved on from must not be silently re-decided.
    if release.review_status not in (ReviewStatus.pending, ReviewStatus.legacy_pending):
        res.state = "skipped"
        res.message = (f"הגרסה כבר בסטטוס {release.review_status.value} - "
                       f"ההחלטה המוכנה התקבלה על סטטוס אחר")
        return res

    reason = (row.developer_reason or "").strip() or None
    note = (row.internal_note or "").strip() or None

    if row.decision in ("approve", "approve_with_note"):
        # When the review cleared the code but asked for listing changes, the
        # approval must NOT carry the listing along: doing so would set the
        # approved snapshot to content this very decision is refusing, and the
        # rejection that follows would leave that snapshot in place.
        await svc.approve_release(
            db, project, release, admin=admin, reason=reason, note=note, ip=ip,
            approve_listing_too=(row.listing_decision in (None, "approve_listing")),
        )
    elif row.decision == "request_changes":
        await svc.request_changes(db, project, release, admin=admin,
                                  reason=reason, note=note, ip=ip)
    elif row.decision == "unpublish":
        await svc.unpublish_release(db, project, release, admin=admin,
                                    reason=reason, note=note, ip=ip)
    else:  # pragma: no cover - _blocking_reason already refused these
        res.state, res.message = "skipped", "החלטה לא ניתנת לביצוע"
        return res

    # approve_release already approves a pending listing as part of approving the
    # extension as presented; this covers the other listing decisions and the
    # case where the review said something different about the listing.
    await _apply_listing(db, project, row, admin)

    row.state = "applied"
    row.applied_at = _now()
    row.applied_by_user_id = admin.id
    row.applied_by_email_snapshot = admin.email
    row.applied_by_name_snapshot = admin.display_name or None
    row.result_message = None

    res.ok, res.state, res.message = True, "applied", "בוצע"
    return res


async def apply_batch(db: AsyncSession, *, admin: User, ids: list[str],
                      ip: str | None = None) -> BatchResult:
    """Execute the named prepared decisions as `admin`.

    `ids` is the whole of the caller's influence over what happens. Everything
    else - which action, on which release, with what text - comes from the
    stored row.
    """
    result = BatchResult()
    if not ids:
        return result

    rows = (await db.scalars(
        select(PreparedDecision).where(PreparedDecision.id.in_(ids))
    )).all()
    found = {r.id for r in rows}
    for missing in [i for i in ids if i not in found]:
        result.failed += 1
        result.items.append(ItemResult(prepared_id=missing, release_id="",
                                       state="failed",
                                       message="ההחלטה המוכנה לא נמצאה"))

    for row in rows:
        # A nested transaction per item: a failure rolls back only its own work,
        # including any partial artifact move, and the batch keeps going.
        try:
            async with db.begin_nested():
                res = await _apply_one(db, row, admin, ip)
                if res.state == "failed":
                    raise _ItemFailed(res.message)
        except _ItemFailed as exc:
            res = ItemResult(prepared_id=row.id, release_id=row.release_id,
                             decision=row.decision, state="failed", message=str(exc))
        except APIError as exc:
            # An expected refusal from the moderation service (for example a
            # release with no artifact to publish). Record it against the row.
            res = ItemResult(prepared_id=row.id, release_id=row.release_id,
                             decision=row.decision, state="failed",
                             message=exc.message)
            row.state = "failed"
            row.result_message = exc.message
        except Exception as exc:  # noqa: BLE001 - one item must not kill the batch
            logger.exception("prepared: applying %s failed", row.id)
            res = ItemResult(prepared_id=row.id, release_id=row.release_id,
                             decision=row.decision, state="failed",
                             message=f"שגיאה בלתי צפויה: {type(exc).__name__}")
            row.state = "failed"
            row.result_message = res.message

        result.items.append(res)
        if res.state == "applied":
            result.applied += 1
        elif res.state == "skipped":
            result.skipped += 1
        else:
            result.failed += 1

    logger.info("prepared: %s applied=%d skipped=%d failed=%d",
                admin.email, result.applied, result.skipped, result.failed)
    return result


class _ItemFailed(Exception):
    """Internal: turns a failed item into a rollback of just that item."""
