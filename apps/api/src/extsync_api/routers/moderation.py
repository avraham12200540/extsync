"""Store moderation API - platform administrators only.

Every route here depends on `AdminUser`, which requires role == platform_admin.
That is deliberately a stricter gate than project authority: an extension owner
must never be able to review their own submission, and MODERATION_ACT is excluded
from OWNER_PERMISSIONS and from every team role so no project-level grant can
reach these actions.

Reading vs acting are both restricted, because the queue itself reveals what other
developers have submitted.
"""
from __future__ import annotations

from fastapi import APIRouter, Query, Request
from pydantic import Field
from sqlalchemy import false, func, select
from sqlalchemy.orm import aliased

from ..deps import AdminUser, DBSession
from ..errors import not_found
from ..models.enums import ProjectStatus, ProjectVisibility, ReleaseStatus, ReviewStatus
from ..models.audit import AuditEvent
from ..models.enums import NotificationKind
from ..models.project import Project, ProjectScreenshot
from ..models.platform_flag import STORE_SAFE_MODE, PlatformFlag
from ..models.release import ChannelState, Release
from ..models.user import User
from ..schemas.common import CamelModel
from ..services import moderation as svc
from ..services.artifact_publication import public_artifact, staged_artifact
from ..services.audit import record_audit
from ..services.events import notify_owner
from ..services.listing import (
    LISTING_FIELDS,
    approve_listing,
    build_snapshot,
    reject_listing,
)
from ..services.ratelimit import client_ip
from ..services.safe_mode import set_safe_mode

router = APIRouter(prefix="/admin/moderation", tags=["moderation"])


def _iso(v) -> str | None:
    return v.isoformat().replace("+00:00", "Z") if v else None


def _risk_level(release: Release) -> str:
    """Top bypass signal from the stored validation report, if the worker ran a
    scan. Older reports predate the scanner and simply have nothing to show."""
    report = release.validation_report or {}
    scan = report.get("riskScan") or {}
    return scan.get("topLevel") or "none"


# --------------------------------------------------------------------------- schemas
class ModerationDecision(CamelModel):
    """An administrator's decision.

    Two separate free-text fields on purpose:
      reason - SHOWN TO THE DEVELOPER. Write it as a message to them.
      note   - internal only. Never leaves the admin API.
    """

    reason: str | None = Field(default=None, max_length=2000)
    note: str | None = Field(default=None, max_length=4000)


class RequiredReasonDecision(ModerationDecision):
    """For actions that refuse something - an explanation is mandatory."""

    reason: str = Field(min_length=1, max_length=2000)


class QueueItem(CamelModel):
    release_id: str
    project_id: str
    project_name: str
    project_slug: str
    developer_email: str | None = None
    version: str
    channel: str
    status: ReleaseStatus
    review_status: ReviewStatus
    risk_score: int
    permissions_changed: bool
    created_at: str | None = None
    published_at: str | None = None
    # True when this release is the one currently serving the channel, i.e. the
    # thing real users get. Drives the legacy queue's "currently live" scoping.
    is_live: bool = False
    # Whether the project has any earlier reviewed release: distinguishes a brand
    # new extension from an update to one already in the store.
    is_new_extension: bool = True
    # Strongest bypass-capability signal found by the static scan: critical |
    # high | medium | info | none. Advisory - it says what was found, never
    # whether to approve, and "none" means nothing matched, not "safe".
    risk_level: str = "none"


class QueueCounts(CamelModel):
    pending_new: int = 0
    pending_update: int = 0
    legacy_live: int = 0
    changes_requested: int = 0
    rejected: int = 0
    approved: int = 0
    listing_pending: int = 0


class ListingQueueItem(CamelModel):
    """A store listing whose text or images changed since it was approved."""

    project_id: str
    project_name: str
    project_slug: str
    developer_email: str | None = None
    listing_review_status: ReviewStatus
    updated_at: str | None = None
    #: Fields that differ from the approved snapshot. Empty for a project
    #: that has never been reviewed (nothing to diff against yet).
    changed_fields: list[str] = []


# --------------------------------------------------------------------------- helpers
async def _load(db, release_id: str) -> tuple[Project, Release]:
    release = await db.get(Release, release_id)
    if release is None:
        raise not_found("הגרסה לא נמצאה")
    project = await db.get(Project, release.project_id)
    if project is None:
        raise not_found("הפרויקט לא נמצא")
    return project, release


async def _live_release_ids(db) -> set[str]:
    """Releases currently serving a channel of a listed, public project.

    This is what makes the legacy queue mean "the extensions actually in the
    store right now" rather than "every historical row we ever backfilled".
    """
    rows = await db.scalars(
        select(ChannelState.active_release_id)
        .join(Project, Project.id == ChannelState.project_id)
        .where(
            ChannelState.active_release_id.is_not(None),
            Project.deleted_at.is_(None),
            Project.status == ProjectStatus.active,
            Project.visibility == ProjectVisibility.public,
        )
    )
    return {r for r in rows.all() if r}


# --------------------------------------------------------------------------- queue
@router.get("/counts", response_model=QueueCounts)
async def queue_counts(_: AdminUser, db: DBSession) -> QueueCounts:
    live = await _live_release_ids(db)

    async def _count(*where) -> int:
        # Joined to Project so a soft-deleted extension never inflates a queue
        # badge with work that does not exist.
        return await db.scalar(
            select(func.count()).select_from(Release)
            .join(Project, Project.id == Release.project_id)
            .where(Project.deleted_at.is_(None), *where)
        ) or 0

    pending_rows = (await db.execute(
        select(Release)
        .join(Project, Project.id == Release.project_id)
        .where(Project.deleted_at.is_(None),
               Release.review_status == ReviewStatus.pending)
    )).scalars().all()
    # A submission is an "update" when the project already has a reviewed release.
    reviewed_projects = set((await db.scalars(
        select(Release.project_id).where(
            Release.review_status.in_([ReviewStatus.approved, ReviewStatus.legacy_pending])
        )
    )).all())

    legacy_live = await _count(
        Release.review_status == ReviewStatus.legacy_pending,
        Release.id.in_(live) if live else false(),
    )

    return QueueCounts(
        pending_new=sum(1 for r in pending_rows if r.project_id not in reviewed_projects),
        pending_update=sum(1 for r in pending_rows if r.project_id in reviewed_projects),
        legacy_live=legacy_live,
        changes_requested=await _count(Release.review_status == ReviewStatus.changes_requested),
        rejected=await _count(Release.review_status == ReviewStatus.rejected),
        approved=await _count(Release.review_status == ReviewStatus.approved),
        listing_pending=await db.scalar(
            select(func.count()).select_from(Project).where(
                Project.deleted_at.is_(None),
                Project.listing_review_status.in_(
                    [ReviewStatus.pending, ReviewStatus.legacy_pending]
                ),
            )
        ) or 0,
    )


@router.get("/queue", response_model=list[QueueItem])
async def queue(
    _: AdminUser, db: DBSession,
    state: ReviewStatus = ReviewStatus.pending,
    # FastAPI binds query parameters by the PYTHON name, so this needs an
    # explicit camelCase alias to match the rest of the API. Without it the
    # client's `liveOnly=true` was silently ignored and the legacy queue
    # returned every historical row instead of the ~46 that are actually live.
    live_only: bool = Query(False, alias="liveOnly"),
    limit: int = 100,
    offset: int = 0,
) -> list[QueueItem]:
    """Releases in a given review state.

    `live_only=true` restricts to releases currently serving a channel of a public,
    active project. That is how the legacy queue is scoped to the ~46 releases that
    actually represent store content today, instead of every historical row the
    backfill marked - superseded versions, validation failures and never-published
    uploads are all excluded by it.
    """
    live = await _live_release_ids(db)

    owner = aliased(User)
    stmt = (
        select(Release, Project, owner.email)
        .join(Project, Project.id == Release.project_id)
        .join(owner, owner.id == Project.owner_user_id, isouter=True)
        .where(Release.review_status == state, Project.deleted_at.is_(None))
        .order_by(Release.created_at.desc())
        .limit(min(limit, 500)).offset(offset)
    )
    rows = (await db.execute(stmt)).all()

    reviewed_projects = set((await db.scalars(
        select(Release.project_id).where(
            Release.review_status.in_([ReviewStatus.approved, ReviewStatus.legacy_pending])
        )
    )).all())

    items: list[QueueItem] = []
    for release, project, email in rows:
        is_live = release.id in live
        if live_only and not is_live:
            continue
        items.append(QueueItem(
            release_id=release.id, project_id=project.id, project_name=project.name,
            project_slug=project.slug, developer_email=email,
            version=release.version, channel=release.channel.value,
            status=release.status, review_status=release.review_status,
            risk_score=release.risk_score,
            permissions_changed=release.permissions_changed,
            created_at=_iso(release.created_at), published_at=_iso(release.published_at),
            is_live=is_live,
            is_new_extension=project.id not in reviewed_projects,
            risk_level=_risk_level(release),
        ))
    return items


@router.get("/releases/{release_id}")
async def review_detail(release_id: str, _: AdminUser, db: DBSession) -> dict:
    """Everything an administrator needs to decide, including internal notes.

    This is the one place `review_note` is readable, and it is behind
    platform_admin. It must never be mirrored into a developer-facing response.
    """
    project, release = await _load(db, release_id)
    owner = await db.get(User, project.owner_user_id)
    reviewer = (await db.get(User, release.reviewed_by_user_id)
                if release.reviewed_by_user_id else None)
    pub = await public_artifact(db, release.id)
    staged = await staged_artifact(db, release.id)
    live = await _live_release_ids(db)

    return {
        "release": {
            "id": release.id, "version": release.version,
            "channel": release.channel.value, "status": release.status.value,
            "reviewStatus": release.review_status.value,
            "riskScore": release.risk_score,
            "permissionsChanged": release.permissions_changed,
            "requiresUserApproval": release.requires_user_approval,
            "releaseNotes": release.release_notes,
            "validationReport": release.validation_report,
            "createdAt": _iso(release.created_at),
            "publishedAt": _iso(release.published_at),
            "isLive": release.id in live,
            "riskLevel": _risk_level(release),
        },
        "review": {
            "reason": release.review_reason,      # developer-facing
            "note": release.review_note,          # INTERNAL - admin API only
            "reviewedAt": _iso(release.reviewed_at),
            "reviewedByEmail": reviewer.email if reviewer else None,
        },
        "project": {
            "id": project.id, "name": project.name, "slug": project.slug,
            "status": project.status.value, "visibility": project.visibility.value,
            "shortDescription": project.short_description,
            "fullDescription": project.full_description,
            "iconUrl": project.icon_url, "website": project.website,
            "repoUrl": project.repo_url, "category": project.category,
            "extensionId": project.extension_id,
        },
        "developer": {
            "email": owner.email if owner else None,
            "id": owner.id if owner else None,
        },
        "artifact": {
            # Where the bytes are is itself review-relevant: a release with only a
            # staged artifact is genuinely not downloadable by anyone.
            "public": bool(pub),
            "staged": bool(staged),
            "size": (pub or staged).size if (pub or staged) else None,
            "sha256": (pub or staged).sha256 if (pub or staged) else None,
            "fileCount": (pub or staged).file_count if (pub or staged) else None,
        },
    }


# --------------------------------------------------------------------------- actions
@router.post("/releases/{release_id}/approve")
async def approve(release_id: str, req: ModerationDecision, admin: AdminUser,
                  db: DBSession, request: Request) -> dict:
    project, release = await _load(db, release_id)
    await svc.approve_release(db, project, release, admin=admin, reason=req.reason,
                              note=req.note, ip=client_ip(request))
    await db.commit()
    return {"ok": True, "reviewStatus": release.review_status.value}


@router.post("/releases/{release_id}/reject")
async def reject(release_id: str, req: RequiredReasonDecision, admin: AdminUser,
                 db: DBSession, request: Request) -> dict:
    project, release = await _load(db, release_id)
    await svc.reject_release(db, project, release, admin=admin, reason=req.reason,
                             note=req.note, ip=client_ip(request))
    await db.commit()
    return {"ok": True, "reviewStatus": release.review_status.value}


@router.post("/releases/{release_id}/request-changes")
async def request_changes(release_id: str, req: RequiredReasonDecision, admin: AdminUser,
                          db: DBSession, request: Request) -> dict:
    project, release = await _load(db, release_id)
    await svc.request_changes(db, project, release, admin=admin, reason=req.reason,
                              note=req.note, ip=client_ip(request))
    await db.commit()
    return {"ok": True, "reviewStatus": release.review_status.value}


@router.post("/releases/{release_id}/unpublish")
async def unpublish(release_id: str, req: RequiredReasonDecision, admin: AdminUser,
                    db: DBSession, request: Request) -> dict:
    project, release = await _load(db, release_id)
    await svc.unpublish_release(db, project, release, admin=admin, reason=req.reason,
                                note=req.note, ip=client_ip(request))
    await db.commit()
    return {"ok": True, "reviewStatus": release.review_status.value}


# ------------------------------------------------------------------- listings
@router.get("/listings", response_model=list[ListingQueueItem])
async def listing_queue(_: AdminUser, db: DBSession, limit: int = 200) -> list[ListingQueueItem]:
    """Store listings awaiting review.

    Covers two cases at once: a listing whose text or images a developer changed
    after approval (`pending`), and one that predates listing moderation and has
    never been reviewed (`legacy_pending`). The public keeps seeing the approved
    snapshot - or, for a legacy project, the live fields - until one of these is
    acted on.
    """
    owner = aliased(User)
    rows = (await db.execute(
        select(Project, owner.email)
        .join(owner, owner.id == Project.owner_user_id, isouter=True)
        .where(
            Project.deleted_at.is_(None),
            Project.listing_review_status.in_(
                [ReviewStatus.pending, ReviewStatus.legacy_pending]
            ),
        )
        .order_by(Project.updated_at.desc())
        .limit(min(limit, 500))
    )).all()

    items: list[ListingQueueItem] = []
    for project, email in rows:
        changed: list[str] = []
        snapshot = project.approved_listing or None
        if snapshot:
            shots = (await db.scalars(
                select(ProjectScreenshot.url)
                .where(ProjectScreenshot.project_id == project.id)
                .order_by(ProjectScreenshot.position.asc())
            )).all()
            for field in LISTING_FIELDS:
                if (snapshot.get(field) or None) != (getattr(project, field) or None):
                    changed.append(field)
            if list(snapshot.get("screenshots") or []) != list(shots):
                changed.append("screenshots")
        items.append(ListingQueueItem(
            project_id=project.id, project_name=project.name, project_slug=project.slug,
            developer_email=email,
            listing_review_status=project.listing_review_status,
            updated_at=_iso(project.updated_at),
            changed_fields=changed,
        ))
    return items


@router.get("/listings/{project_id}")
async def listing_detail(project_id: str, _: AdminUser, db: DBSession) -> dict:
    """The approved listing beside the developer's current one, for a diff."""
    project = await db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise not_found("הפרויקט לא נמצא")
    owner = await db.get(User, project.owner_user_id)
    proposed = await build_snapshot(db, project)
    return {
        "projectId": project.id,
        "projectSlug": project.slug,
        "listingReviewStatus": project.listing_review_status.value,
        "reviewedAt": _iso(project.listing_reviewed_at),
        "reason": project.listing_review_reason,
        "developerEmail": owner.email if owner else None,
        # None means nothing has been approved yet, so the store is currently
        # rendering the developer's live fields (a grandfathered project).
        "approved": project.approved_listing,
        "proposed": proposed,
    }


@router.post("/listings/{project_id}/approve")
async def approve_listing_route(project_id: str, req: ModerationDecision, admin: AdminUser,
                                db: DBSession, request: Request) -> dict:
    project = await db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise not_found("הפרויקט לא נמצא")
    await approve_listing(db, project, admin_user_id=admin.id, reason=req.reason)
    await record_audit(db, action="moderation.listing_approve", actor_user_id=admin.id,
                       target_type="project", target_id=project.id, project_id=project.id,
                       ip_address=client_ip(request))
    await db.commit()
    return {"ok": True, "listingReviewStatus": project.listing_review_status.value}


@router.post("/listings/{project_id}/reject")
async def reject_listing_route(project_id: str, req: RequiredReasonDecision, admin: AdminUser,
                               db: DBSession, request: Request) -> dict:
    """Refuse the developer's listing edits.

    The approved snapshot is left alone, so the store simply keeps showing what
    it was already showing - a refused edit never had any public effect.
    """
    project = await db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise not_found("הפרויקט לא נמצא")
    await reject_listing(db, project, admin_user_id=admin.id, reason=req.reason)
    await record_audit(db, action="moderation.listing_reject", actor_user_id=admin.id,
                       target_type="project", target_id=project.id, project_id=project.id,
                       ip_address=client_ip(request), extra={"reason": req.reason})
    await notify_owner(db, project.id, NotificationKind.release_changes_requested,
                       title="פרטי התוסף בחנות לא אושרו",
                       body=f"השינויים בפרטי התוסף לא אושרו. סיבה: {req.reason}",
                       email=True)
    await db.commit()
    return {"ok": True, "listingReviewStatus": project.listing_review_status.value}


# ----------------------------------------------------------------- safe mode
class SafeModeRequest(CamelModel):
    enabled: bool
    reason: str | None = Field(default=None, max_length=1000)


@router.get("/safe-mode")
async def safe_mode_status(_: AdminUser, db: DBSession) -> dict:
    flag = await db.scalar(
        select(PlatformFlag).where(PlatformFlag.key == STORE_SAFE_MODE)
    )
    actor = (await db.get(User, flag.updated_by_user_id)
             if flag and flag.updated_by_user_id else None)
    return {
        "enabled": bool(flag and flag.enabled),
        "reason": flag.reason if flag else None,
        "updatedAt": _iso(flag.updated_at_utc) if flag else None,
        "updatedByEmail": actor.email if actor else None,
    }


@router.post("/safe-mode")
async def set_safe_mode_route(req: SafeModeRequest, admin: AdminUser,
                              db: DBSession, request: Request) -> dict:
    """Close or reopen the whole store.

    While closed the public gets nothing: no catalog, no extension pages, no
    install-link resolution, no Agent update offers. It does NOT remove files
    from public storage - someone already holding a direct artifact URL can
    still fetch that file. Removing a specific extension's bytes is what the
    per-release takedown does. The UI states this distinction too, because
    during an incident it is exactly the thing that must not be assumed.
    """
    await set_safe_mode(db, enabled=req.enabled, admin_user_id=admin.id,
                        reason=req.reason)
    await record_audit(
        db,
        action="moderation.safe_mode_on" if req.enabled else "moderation.safe_mode_off",
        actor_user_id=admin.id, target_type="platform", target_id=STORE_SAFE_MODE,
        ip_address=client_ip(request), extra={"reason": req.reason},
    )
    await db.commit()
    return {"ok": True, "enabled": req.enabled}


# --------------------------------------------------------------- audit trail
@router.get("/audit")
async def moderation_audit(_: AdminUser, db: DBSession, limit: int = 100,
                           offset: int = 0) -> list[dict]:
    """Every moderation decision ever taken, newest first.

    Scoped to moderation actions rather than the whole audit log: this is the
    record of who allowed what into the store, which is the thing anyone
    auditing this system will ask to see.
    """
    actor = aliased(User)
    rows = (await db.execute(
        select(AuditEvent, actor.email, Project.name, Project.slug)
        .join(actor, actor.id == AuditEvent.actor_user_id, isouter=True)
        .join(Project, Project.id == AuditEvent.project_id, isouter=True)
        .where(AuditEvent.action.like("moderation.%"))
        .order_by(AuditEvent.created_at.desc())
        .limit(min(limit, 500)).offset(offset)
    )).all()
    return [
        {
            "id": ev.id,
            "action": ev.action,
            "at": _iso(ev.created_at),
            "adminEmail": email,
            "projectName": pname,
            "projectSlug": pslug,
            "targetType": ev.target_type,
            "targetId": ev.target_id,
            "ip": ev.ip_address,
            "extra": ev.extra or {},
        }
        for ev, email, pname, pslug in rows
    ]
