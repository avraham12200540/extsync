"""Audit and security event logs."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import event_id
from .base import TimestampMixin


class AuditEvent(Base, TimestampMixin):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=event_id)
    actor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    actor_type: Mapped[str] = mapped_column(String(16), default="user", nullable=False)  # user|agent|system|admin
    action: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(48), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    team_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class SecurityEvent(Base, TimestampMixin):
    __tablename__ = "security_events"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=event_id)
    type: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), default="info", nullable=False)  # info|warning|critical
    user_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    device_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
