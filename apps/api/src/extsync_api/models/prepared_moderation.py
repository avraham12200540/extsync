"""Reviewed-but-not-yet-executed moderation decisions.

A decision can be PREPARED by anyone (a reviewer, an analysis pass, a script)
and is inert until a platform administrator applies it under their own
authenticated session. That split is the whole point of this table: preparing a
decision changes nothing about what the public can see, so the analysis work and
the moment of authority stay separate and separately attributable.

Two properties matter more than anything else here:

  * The stored `decision` is the ONLY thing that is ever executed. The apply
    endpoint takes ids, never actions, so a client cannot turn a prepared
    "approve" into an "unpublish" on the way in.
  * `reviewed_sha256` records the artifact the reviewer actually read. If the
    shipped bytes have changed since, the decision is stale and applying it
    would attribute a judgement to code nobody reviewed.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base, UtcDateTime
from ..ids import event_id
from .base import TimestampMixin


class PreparedDecision(Base, TimestampMixin):
    __tablename__ = "prepared_moderation_decisions"
    __table_args__ = (
        # One live prepared decision per release. Re-preparing replaces rather
        # than stacking, so the queue can never show two answers for one thing.
        UniqueConstraint("release_id", "batch", name="uq_prepared_release_batch"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=event_id)

    release_id: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    project_id: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    # Names the review that produced this, so a later batch is distinguishable
    # from an earlier one in the audit trail.
    batch: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    # approve | approve_with_note | request_changes | unpublish | needs_human_review
    decision: Mapped[str] = mapped_column(String(32), nullable=False)
    # approve_listing | listing_needs_changes | listing_needs_human_review | listing_no_op
    listing_decision: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # "Do not run this until something newer has already taken over the channel."
    #
    # Retiring a release that is still the one serving users takes the extension
    # off the store, which is the CORRECT outcome for a removal and the wrong one
    # for a replacement. The difference is not visible in `decision` - the same
    # request_changes means "take it down" for one extension and "retire the old
    # build once its successor is live" for another - so the reviewer records the
    # precondition here and the apply path enforces it.
    #
    # Deliberately a property of the PREPARED ROW, not of moderation itself: a
    # direct request_changes or unpublish through the normal endpoints is
    # unaffected, because an administrator acting live can see what they are
    # taking down.
    requires_newer_approved_release: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    # Shown to the developer. Required for anything that removes an extension
    # from the store, and validated as such before the batch will run.
    developer_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Administrator-only. Must never reach the developer-facing response.
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The artifact the reviewer actually read.
    reviewed_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # prepared | applied | failed | skipped
    state: Mapped[str] = mapped_column(String(16), default="prepared",
                                       nullable=False, index=True)
    applied_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    applied_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Same durability rule as everywhere else in the moderation trail: who
    # applied this has to remain readable if the account is later deleted.
    applied_by_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    applied_by_name_snapshot: Mapped[str | None] = mapped_column(String(120), nullable=True)
    result_message: Mapped[str | None] = mapped_column(Text, nullable=True)
