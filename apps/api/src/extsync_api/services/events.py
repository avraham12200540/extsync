"""Domain event emission: webhook deliveries + developer notifications (§31, §32).

`emit_event` enqueues WebhookDelivery rows (delivered by the webhook worker) for
every active webhook subscribed to the event. `notify_owner` creates an in-app
notification for the project owner.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.enums import NotificationKind
from ..models.notification import Notification
from ..models.project import Project
from ..models.user import User
from ..models.webhook import Webhook, WebhookDelivery
from .email import send_notification_email


async def emit_event(db: AsyncSession, project_id: str, event_type: str, payload: dict) -> int:
    """Create pending webhook deliveries for subscribed webhooks. Returns count."""
    webhooks = (
        await db.scalars(
            select(Webhook).where(Webhook.project_id == project_id, Webhook.is_active.is_(True))
        )
    ).all()
    count = 0
    body = {"event": event_type, "projectId": project_id, "data": payload}
    for wh in webhooks:
        if event_type in (wh.events or []):
            db.add(WebhookDelivery(webhook_id=wh.id, event_type=event_type, payload=body))
            count += 1
    return count


async def notify_owner(
    db: AsyncSession, project_id: str, kind: NotificationKind, title: str,
    body: str | None = None, data: dict | None = None, email: bool = False,
) -> None:
    project = await db.get(Project, project_id)
    if project is None:
        return
    db.add(Notification(
        user_id=project.owner_user_id, kind=kind, title=title, body=body,
        data={**(data or {}), "projectId": project_id},
    ))
    if email:
        owner = await db.get(User, project.owner_user_id)
        if owner is not None and owner.email:
            try:
                await send_notification_email(owner.email, title, f"{project.name} - {body or ''}")
            except Exception:
                pass  # already logged inside send_email; never fail the caller
