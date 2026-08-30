"""Audit log, security events, and notification helpers (§20, §22, §30, §31)."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.audit import AuditEvent, SecurityEvent
from ..models.enums import NotificationKind
from ..models.notification import Notification
from ..models.user import User


async def record_audit(
    db: AsyncSession,
    *,
    action: str,
    actor: User | None = None,
    actor_user_id: str | None = None,
    actor_type: str = "user",
    target_type: str | None = None,
    target_id: str | None = None,
    project_id: str | None = None,
    team_id: str | None = None,
    ip_address: str | None = None,
    extra: dict | None = None,
) -> AuditEvent:
    """Append one audit row.

    Pass `actor` (the User) rather than `actor_user_id` wherever the caller has
    the object. Doing so also stores an immutable copy of the actor's email and
    display name, which is what keeps the row meaningful after the account is
    deleted - `actor_user_id` is ON DELETE SET NULL, so on its own it silently
    turns a named action into an anonymous one, retroactively and with no trace.

    `actor_user_id` alone still works, for the callers that genuinely only have
    an id; those rows simply carry no snapshot rather than a guessed one.
    """
    event = AuditEvent(
        action=action,
        actor_user_id=actor.id if actor is not None else actor_user_id,
        actor_email_snapshot=actor.email if actor is not None else None,
        actor_display_name_snapshot=(actor.display_name or None) if actor is not None else None,
        actor_type=actor_type,
        target_type=target_type,
        target_id=target_id,
        project_id=project_id,
        team_id=team_id,
        ip_address=ip_address,
        extra=extra,
    )
    db.add(event)
    return event


async def record_security_event(
    db: AsyncSession,
    *,
    type: str,
    severity: str = "info",
    user_id: str | None = None,
    project_id: str | None = None,
    device_id: str | None = None,
    ip_address: str | None = None,
    message: str | None = None,
    detail: dict | None = None,
) -> SecurityEvent:
    event = SecurityEvent(
        type=type,
        severity=severity,
        user_id=user_id,
        project_id=project_id,
        device_id=device_id,
        ip_address=ip_address,
        message=message,
        detail=detail,
    )
    db.add(event)
    return event


async def notify(
    db: AsyncSession,
    *,
    user_id: str,
    kind: NotificationKind,
    title: str,
    body: str | None = None,
    data: dict | None = None,
) -> Notification:
    n = Notification(user_id=user_id, kind=kind, title=title, body=body, data=data)
    db.add(n)
    return n
