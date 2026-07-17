"""Developer feedback: a signed-in user sends a private message (bug report,
suggestion) to an extension's developer. Only the owning developer sees it, in
their dashboard. Sending requires being logged in; reading is owner-only.
"""
from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from ..deps import CurrentUser, DBSession
from ..errors import not_found
from ..models.base import utcnow
from ..models.enums import NotificationKind, ProjectStatus, ProjectVisibility
from ..models.extension_feedback import ExtensionFeedback
from ..models.project import Project
from ..models.user import User
from ..schemas.common import OkResponse
from ..schemas.feedback import FeedbackCreate, FeedbackItem
from ..services.events import notify_owner
from ..services.ratelimit import enforce_rate_limit

router = APIRouter(tags=["feedback"])


@router.post("/catalog/{slug}/feedback", status_code=status.HTTP_201_CREATED, response_model=OkResponse)
async def send_feedback(
    slug: str, req: FeedbackCreate, user: CurrentUser, db: DBSession
) -> OkResponse:
    """Any signed-in user may message the developer of a public extension."""
    await enforce_rate_limit(f"feedback:{user.id}", limit=10, window_seconds=600)
    project = await db.scalar(
        select(Project).where(
            Project.slug == slug,
            Project.visibility == ProjectVisibility.public,
            Project.deleted_at.is_(None),
            Project.status == ProjectStatus.active,  # mirror the catalog filter
        )
    )
    if project is None:
        raise not_found("התוסף לא נמצא")
    body = req.body  # already stripped + non-empty by the schema validator
    db.add(ExtensionFeedback(project_id=project.id, from_user_id=user.id, body=body))
    # Notify the owner (+ email unless opted out), but never notify a developer who
    # messaged their own extension (would email themselves).
    if project.owner_user_id != user.id:
        await notify_owner(
            db, project.id, NotificationKind.feedback_received,
            title="הודעה חדשה על התוסף שלך", body=body[:300], email=True,
        )
    await db.commit()
    return OkResponse()


@router.get("/me/feedback", response_model=list[FeedbackItem])
async def my_feedback(user: CurrentUser, db: DBSession) -> list[FeedbackItem]:
    """Every message sent about extensions the caller owns, newest first."""
    stmt = (
        select(ExtensionFeedback, Project.name, Project.slug, User.display_name)
        .join(Project, Project.id == ExtensionFeedback.project_id)
        .join(User, User.id == ExtensionFeedback.from_user_id, isouter=True)
        .where(Project.owner_user_id == user.id)
        .order_by(ExtensionFeedback.created_at.desc())
        .limit(500)
    )
    rows = (await db.execute(stmt)).all()
    return [
        FeedbackItem(
            id=fb.id, project_id=fb.project_id, project_name=pname, project_slug=pslug,
            from_name=(dname.strip() if dname and dname.strip() else "משתמש"),
            body=fb.body, read=fb.read_at is not None,
            created_at=fb.created_at.isoformat().replace("+00:00", "Z"),
        )
        for fb, pname, pslug, dname in rows
    ]


@router.post("/me/feedback/{fid}/read", response_model=OkResponse)
async def mark_read(fid: str, user: CurrentUser, db: DBSession) -> OkResponse:
    # Idempotent and non-leaky: always 200. We only mark read if the message
    # exists AND belongs to the caller; a missing or foreign id is a silent no-op,
    # so the endpoint can't be used as an existence oracle for someone else's id.
    fb = await db.get(ExtensionFeedback, fid)
    if fb is not None and fb.read_at is None:
        project = await db.get(Project, fb.project_id)
        if project is not None and project.owner_user_id == user.id:
            fb.read_at = utcnow()
            await db.commit()
    return OkResponse()
