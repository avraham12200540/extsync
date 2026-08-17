"""Private feedback a signed-in user sends to an extension's developer.

Shown only in the owning developer's dashboard (a bug report / message channel),
never publicly. One row per message.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base, UtcDateTime
from ..ids import generic_id
from .base import TimestampMixin


class ExtensionFeedback(Base, TimestampMixin):
    __tablename__ = "extension_feedback"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # SET NULL (not CASCADE) so the developer keeps the message even if the sender
    # later deletes their account; the UI shows a generic name for a null sender.
    from_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional, opt-in reply address. The developer never sees the sender's account
    # email - only an address the sender chose to share so they can be answered.
    reply_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # Set when the developer opens/marks it read (for an unread badge).
    read_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
