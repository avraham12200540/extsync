"""In-app notifications (§31)."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import notification_id
from .base import TimestampMixin, pg_enum
from .enums import NotificationKind


class Notification(Base, TimestampMixin):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=notification_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[NotificationKind] = mapped_column(
        pg_enum(NotificationKind, "notification_kind"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    read_at: Mapped[dt.datetime | None] = mapped_column(nullable=True, index=True)
