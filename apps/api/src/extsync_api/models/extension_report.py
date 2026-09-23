"""A report about an extension, sent to the PLATFORM - never to its developer.

Deliberately a separate thing from ExtensionFeedback, which is a message to the
developer. A report can be "this extension is malicious", and routing that to the
extension's own developer would only warn the person being reported. Reports are
readable by platform administrators and nobody else.

Everything the reporter supplies is optional. A report with no reason and no email
is still a signal - someone thought this was worth flagging - and asking for more
would only make fewer people bother.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base, UtcDateTime
from ..ids import generic_id
from .base import TimestampMixin

REPORT_OPEN = "open"
REPORT_RESOLVED = "resolved"      # an administrator acted on it
REPORT_DISMISSED = "dismissed"    # looked at, nothing to do
REPORT_STATES = (REPORT_OPEN, REPORT_RESOLVED, REPORT_DISMISSED)


class ExtensionReport(Base, TimestampMixin):
    __tablename__ = "extension_reports"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The version that was live when the report was made. A report is about what
    # someone actually saw, and by the time an administrator reads it the
    # extension may have moved on.
    release_id: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # Both optional, by design. See the module docstring.
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reporter_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # Set when the reporter happened to be signed in. Never required: reporting
    # does not need an account.
    reporter_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    status: Mapped[str] = mapped_column(String(16), default=REPORT_OPEN,
                                        nullable=False, index=True)
    # Who closed it, durably - same rule as the rest of the moderation trail: the
    # FK goes NULL if that account is ever deleted, the snapshot does not.
    handled_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    handled_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    handled_by_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # Administrator-only. Never shown to the reporter or the developer.
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
