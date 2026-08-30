"""What the store renders for an extension - approved content, not latest edits.

The build is not the only public thing a developer controls. The name,
descriptions, icon and screenshots are all published content, and without this
module an extension could be approved with an innocuous listing and then renamed
to anything at all, with no review in between. That is the same bypass the
release moderation closes, on a different surface, so it gets the same answer:

    USER SUBMISSION != PUBLICATION.

Two copies of the listing exist:

  Project.<columns>        the DEVELOPER's working copy. They edit it freely.
  Project.approved_listing the snapshot the PUBLIC sees.

They diverge the moment a developer edits a public-facing field, which flips
`listing_review_status` to pending. The store keeps rendering the snapshot until
an administrator accepts the change, so an edit never reaches the public on its
own.

Grandfathering: a NULL snapshot means "render the live fields". Every project
that predates listing moderation is in that state, so nothing went dark when this
shipped - they sit in the administrator's queue as `legacy_pending`, exactly like
legacy releases, and get a real snapshot the first time someone reviews them.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.enums import ReviewStatus
from ..models.project import Project, ProjectScreenshot
from ..models.user import User

#: The public-facing fields. Editing any of these needs review; editing anything
#: else on a project (channel switching, bridge mode) does not, because it is not
#: content the public reads.
LISTING_FIELDS: tuple[str, ...] = (
    "name",
    "short_description",
    "full_description",
    "icon_url",
    "category",
    "website",
    "repo_url",
    "support_url",
    "privacy_policy_url",
)


async def build_snapshot(db: AsyncSession, project: Project) -> dict[str, Any]:
    """Capture the project's CURRENT listing, including screenshots."""
    shots = (await db.scalars(
        select(ProjectScreenshot)
        .where(ProjectScreenshot.project_id == project.id)
        .order_by(ProjectScreenshot.position.asc())
    )).all()
    snapshot: dict[str, Any] = {f: getattr(project, f) for f in LISTING_FIELDS}
    snapshot["screenshots"] = [s.url for s in shots]
    # The developer name is public content too ("by <name>" on every store
    # page), and it is freely editable through PATCH /auth/me - so it is
    # captured here rather than read live, or renaming yourself would change
    # what the store shows with no review.
    owner = await db.get(User, project.owner_user_id)
    snapshot["developer_name"] = (
        (owner.display_name.strip() if owner and owner.display_name else "") or None
    )
    snapshot["capturedAt"] = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    return snapshot


async def current_listing(db: AsyncSession, project: Project) -> dict[str, Any]:
    """What the public should be shown for this project, right now.

    Falls back to the live fields when there is no snapshot (grandfathered).
    """
    if project.approved_listing:
        return dict(project.approved_listing)
    return await build_snapshot(db, project)


def listing_differs(project: Project, snapshot: dict[str, Any] | None,
                    screenshots: list[str], developer_name: str | None = None) -> bool:
    """Has the developer's copy drifted from what was approved?

    Compares the things a visitor actually sees: LISTING_FIELDS, screenshots,
    and the developer name. Pass `developer_name` to include it; omit it when
    the caller is only checking project-owned fields.
    """
    if not snapshot:
        return False
    for field in LISTING_FIELDS:
        if (snapshot.get(field) or None) != (getattr(project, field) or None):
            return True
    if developer_name is not None and (snapshot.get("developer_name") or None) != (
        developer_name or None
    ):
        return True
    return list(snapshot.get("screenshots") or []) != list(screenshots)


async def mark_listing_dirty(db: AsyncSession, project: Project) -> bool:
    """Call after a developer edits a public-facing field or a screenshot.

    Sends the listing back for review IF it actually differs from what was
    approved. A no-op save, or an edit that restores the approved text, does not
    put the project into a queue for nothing.

    Returns True if the listing now needs review.

    Deliberately does NOT touch a `legacy_pending` project: those have no
    snapshot to diverge from, are already queued for a first review, and moving
    them to `pending` would lose the fact that they predate moderation.
    """
    if project.listing_review_status == ReviewStatus.legacy_pending:
        return False
    if not project.approved_listing:
        return False

    shots = (await db.scalars(
        select(ProjectScreenshot.url)
        .where(ProjectScreenshot.project_id == project.id)
        .order_by(ProjectScreenshot.position.asc())
    )).all()
    owner = await db.get(User, project.owner_user_id)
    name = (owner.display_name.strip() if owner and owner.display_name else "") or None
    if not listing_differs(project, project.approved_listing, list(shots), name):
        return False

    project.listing_review_status = ReviewStatus.pending
    project.listing_reviewed_at = None
    return True


async def approve_listing(db: AsyncSession, project: Project, *,
                          admin_user_id: str, reason: str | None = None) -> dict[str, Any]:
    """Accept the developer's current listing as the public one."""
    snapshot = await build_snapshot(db, project)
    project.approved_listing = snapshot
    project.listing_review_status = ReviewStatus.approved
    project.listing_reviewed_by_user_id = admin_user_id
    project.listing_reviewed_at = dt.datetime.now(dt.timezone.utc)
    project.listing_review_reason = reason
    return snapshot


async def reject_listing(db: AsyncSession, project: Project, *,
                         admin_user_id: str, reason: str) -> None:
    """Refuse the developer's edits.

    The snapshot is left untouched, so the store keeps showing the last approved
    listing. A rejected listing edit therefore has no public effect at all, which
    is the point - the developer's copy stays as they wrote it so they can see
    what was refused and fix it.
    """
    project.listing_review_status = ReviewStatus.rejected
    project.listing_reviewed_by_user_id = admin_user_id
    project.listing_reviewed_at = dt.datetime.now(dt.timezone.utc)
    project.listing_review_reason = reason


async def mark_owner_listings_dirty(db: AsyncSession, user_id: str) -> int:
    """Call when a user changes their display name.

    That name appears on the public page of every extension they own, so a
    change is a change to all of those listings. Returns how many now need
    review.
    """
    projects = (await db.scalars(
        select(Project).where(
            Project.owner_user_id == user_id, Project.deleted_at.is_(None)
        )
    )).all()
    dirty = 0
    for project in projects:
        if await mark_listing_dirty(db, project):
            dirty += 1
    return dirty
