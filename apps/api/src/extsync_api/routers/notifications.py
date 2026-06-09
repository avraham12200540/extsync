"""In-app notifications (§31)."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter
from sqlalchemy import select, update

from ..deps import CurrentUser, DBSession
from ..errors import not_found
from ..models.enums import NotificationKind
from ..models.notification import Notification
from ..schemas.common import CamelModel, OkResponse

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationItem(CamelModel):
    id: str
    kind: NotificationKind
    title: str
    body: str | None
    data: dict | None
    read: bool
    created_at: str | None = None


def _iso(v) -> str | None:
    return v.isoformat().replace("+00:00", "Z") if v else None


@router.get("", response_model=list[NotificationItem])
async def list_notifications(user: CurrentUser, db: DBSession, unread_only: bool = False) -> list[NotificationItem]:
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(100)
    rows = (await db.scalars(stmt)).all()
    return [NotificationItem(id=n.id, kind=n.kind, title=n.title, body=n.body, data=n.data,
                             read=n.read_at is not None, created_at=_iso(n.created_at)) for n in rows]


@router.post("/{notification_id}/read", response_model=OkResponse)
async def mark_read(notification_id: str, user: CurrentUser, db: DBSession) -> OkResponse:
    n = await db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise not_found("ההתראה לא נמצאה")
    if n.read_at is None:
        n.read_at = dt.datetime.now(dt.timezone.utc)
    return OkResponse()


@router.post("/read-all", response_model=OkResponse)
async def mark_all_read(user: CurrentUser, db: DBSession) -> OkResponse:
    await db.execute(
        update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=dt.datetime.now(dt.timezone.utc))
    )
    return OkResponse()
