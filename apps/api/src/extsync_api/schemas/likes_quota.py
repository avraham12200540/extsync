"""Request/response schemas for the likes-quota meter (camelCase JSON)."""
from __future__ import annotations

from pydantic import Field

from .common import CamelModel


class ForumUser(CamelModel):
    """NodeBB identity sent by the extension. Metadata only - never trusted as a
    security key; the row is always owned by the authenticated principal."""

    forum_user_id: str | None = None
    username: str | None = None
    userslug: str | None = None


class IncrementRequest(CamelModel):
    post_id: str
    topic_id: str | None = None
    target_user_id: str | None = None
    target_username: str | None = None
    client_event_id: str | None = None
    created_at: str | None = None
    forum_user: ForumUser | None = None


# A decrement carries the same fields as an increment.
class DecrementRequest(IncrementRequest):
    pass


class SetRequest(CamelModel):
    likes_today: int = Field(ge=0, le=1000)  # hard ceiling; real range enforced vs the daily limit
    reason: str | None = None
    forum_user: ForumUser | None = None


class ResetRequest(CamelModel):
    reason: str | None = None
    forum_user: ForumUser | None = None


class TargetUserState(CamelModel):
    username: str | None = None
    count: int = 0


class TodayState(CamelModel):
    ok: bool = True
    date: str
    likes_today: int
    daily_limit: int
    per_user_limit: int
    target_users: dict[str, TargetUserState] = {}
    updated_at: str
