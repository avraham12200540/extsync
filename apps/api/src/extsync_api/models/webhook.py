"""Webhooks and their delivery log (HMAC-signed, retried, replay-protected — §32)."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import event_id, generic_id, webhook_id
from .base import TimestampMixin


class Webhook(Base, TimestampMixin):
    __tablename__ = "webhooks"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=webhook_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    url: Mapped[str] = mapped_column(String(800), nullable=False)
    # HMAC secret, encrypted at rest.
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    events: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class WebhookDelivery(Base, TimestampMixin):
    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    webhook_id: Mapped[str] = mapped_column(
        ForeignKey("webhooks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Stable event id used for replay protection on the receiver side.
    event_id: Mapped[str] = mapped_column(String(40), default=event_id, index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)  # pending|success|failed
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    response_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_retry_at: Mapped[dt.datetime | None] = mapped_column(nullable=True, index=True)
    delivered_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
