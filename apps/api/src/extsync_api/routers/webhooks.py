"""Webhook management + delivery log (§32)."""
from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from ..deps import CurrentUser, DBSession
from ..errors import not_found
from ..ids import secret_token
from ..models.webhook import Webhook, WebhookDelivery
from ..rbac import Permission
from ..schemas.common import CamelModel, OkResponse
from ..security.crypto import encrypt_str
from ..services.audit import record_audit
from ..services.authz import load_project_for_user
from ..services.jobs import enqueue_webhook

router = APIRouter(tags=["webhooks"])

ALLOWED_EVENTS = {
    "release.uploaded", "release.validated", "release.validation_failed",
    "release.published", "release.paused", "release.revoked",
    "installation.created", "installation.updated", "installation.failed",
    "rollout.paused", "rollback.completed",
}


class WebhookCreate(CamelModel):
    url: str
    events: list[str]


class WebhookCreated(CamelModel):
    id: str
    url: str
    events: list[str]
    secret: str  # shown once


class WebhookInfo(CamelModel):
    id: str
    url: str
    events: list[str]
    is_active: bool


class DeliveryInfo(CamelModel):
    id: str
    event_type: str
    event_id: str
    status: str
    attempts: int
    response_code: int | None
    created_at: str | None = None


def _iso(v) -> str | None:
    return v.isoformat().replace("+00:00", "Z") if v else None


@router.post("/projects/{project_id}/webhooks", status_code=status.HTTP_201_CREATED, response_model=WebhookCreated)
async def create_webhook(project_id: str, req: WebhookCreate, user: CurrentUser, db: DBSession) -> WebhookCreated:
    await load_project_for_user(db, project_id, user, Permission.WEBHOOK_MANAGE)
    events = [e for e in req.events if e in ALLOWED_EVENTS]
    secret = secret_token(24)
    wh = Webhook(project_id=project_id, url=req.url, secret_encrypted=encrypt_str(secret),
                 events=events, created_by_user_id=user.id)
    db.add(wh)
    await db.flush()
    await record_audit(db, action="webhook.create", actor_user_id=user.id,
                       target_type="webhook", target_id=wh.id, project_id=project_id)
    return WebhookCreated(id=wh.id, url=wh.url, events=events, secret=secret)


@router.get("/projects/{project_id}/webhooks", response_model=list[WebhookInfo])
async def list_webhooks(project_id: str, user: CurrentUser, db: DBSession) -> list[WebhookInfo]:
    await load_project_for_user(db, project_id, user, Permission.WEBHOOK_MANAGE)
    rows = (await db.scalars(select(Webhook).where(Webhook.project_id == project_id))).all()
    return [WebhookInfo(id=w.id, url=w.url, events=w.events, is_active=w.is_active) for w in rows]


@router.delete("/projects/{project_id}/webhooks/{webhook_id}", response_model=OkResponse)
async def delete_webhook(project_id: str, webhook_id: str, user: CurrentUser, db: DBSession) -> OkResponse:
    await load_project_for_user(db, project_id, user, Permission.WEBHOOK_MANAGE)
    wh = await db.get(Webhook, webhook_id)
    if wh is not None and wh.project_id == project_id:
        await db.delete(wh)
    return OkResponse()


@router.get("/projects/{project_id}/webhooks/{webhook_id}/deliveries", response_model=list[DeliveryInfo])
async def list_deliveries(project_id: str, webhook_id: str, user: CurrentUser, db: DBSession) -> list[DeliveryInfo]:
    await load_project_for_user(db, project_id, user, Permission.WEBHOOK_MANAGE)
    rows = (await db.scalars(
        select(WebhookDelivery).where(WebhookDelivery.webhook_id == webhook_id)
        .order_by(WebhookDelivery.created_at.desc()).limit(100)
    )).all()
    return [DeliveryInfo(id=d.id, event_type=d.event_type, event_id=d.event_id, status=d.status,
                         attempts=d.attempts, response_code=d.response_code,
                         created_at=_iso(d.created_at)) for d in rows]


@router.post("/projects/{project_id}/webhooks/{webhook_id}/deliveries/{delivery_id}/resend", response_model=OkResponse)
async def resend_delivery(project_id: str, webhook_id: str, delivery_id: str,
                          user: CurrentUser, db: DBSession) -> OkResponse:
    await load_project_for_user(db, project_id, user, Permission.WEBHOOK_MANAGE)
    delivery = await db.get(WebhookDelivery, delivery_id)
    if delivery is None or delivery.webhook_id != webhook_id:
        raise not_found("המשלוח לא נמצא")
    delivery.status = "pending"
    await db.flush()
    await enqueue_webhook(delivery.id)
    return OkResponse()
