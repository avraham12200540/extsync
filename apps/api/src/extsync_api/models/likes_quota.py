"""Daily likes-quota meter for mitmachim.top, synced across machines.

The quota is owned by the AUTHENTICATED principal (the liking user), never by a
client-supplied forum id - so a client can only ever read or modify its own row.
The NodeBB forum identity (uid/username/userslug) is stored as display metadata.

Dates are computed in Asia/Jerusalem (see the service), so the daily reset
matches Israel time regardless of where the user's machine clock is set.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base, UtcDateTime
from ..ids import generic_id
from .base import TimestampMixin


class LikesQuotaDaily(Base, TimestampMixin):
    """One row per (principal, Israel-date). Absent row == a fresh 0/limit day."""

    __tablename__ = "likes_quota_daily"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_likes_quota_user_date"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)

    # Authenticated principal id. ExtSync users.id in production; "dev:*" for the
    # dev auth path. Deliberately a plain indexed string (no FK): the dev path
    # needs no users row, and a throwaway daily row must never block user deletion.
    user_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    # Forum (NodeBB) identity - metadata for display only, not a security key.
    forum_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    forum_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    forum_userslug: Mapped[str | None] = mapped_column(String(255), nullable=True)

    date: Mapped[dt.date] = mapped_column(Date, index=True, nullable=False)
    likes_today: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    daily_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    per_user_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=6)

    # { "<targetKey>": {"username": str | None, "count": int} }
    # targetKey is the liked author's forum uid (or username/slug as a fallback).
    target_users: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # { "<postId>": "<targetKey>" } - posts currently liked today. Source of truth
    # for per-post dedup so a re-sent increment cannot double-count, and a
    # decrement only fires for a post that was actually counted.
    liked_posts: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # set/reset from the popup flips this so the UI can show "manual override".
    manual_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class LikesQuotaEvent(Base):
    """Append-only audit + idempotency log. (user_id, client_event_id) is unique
    so a re-sent client event is recognised and never counted twice."""

    __tablename__ = "likes_quota_events"
    __table_args__ = (
        UniqueConstraint("user_id", "client_event_id", name="uq_likes_event_client"),
        Index("ix_likes_event_user_date", "user_id", "date"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # increment|decrement|set|reset

    post_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    topic_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    delta: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    previous_likes_today: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    new_likes_today: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[dt.datetime] = mapped_column(
        UtcDateTime, server_default=func.now(), nullable=False
    )
