"""Schemas for developer feedback (private user -> developer messages)."""
from __future__ import annotations

from pydantic import Field, field_validator

from .common import CamelModel


class FeedbackCreate(CamelModel):
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def _strip_nonempty(cls, v: str) -> str:
        # Reject whitespace-only bodies (which pass min_length) with a 422, and
        # store the trimmed text so the router doesn't re-strip.
        v = v.strip()
        if not v:
            raise ValueError("ההודעה ריקה")
        return v


class FeedbackItem(CamelModel):
    id: str
    project_id: str
    project_name: str
    project_slug: str
    from_name: str  # sender's display name (or a generic label if the account is gone)
    body: str
    read: bool
    created_at: str


class UnreadCount(CamelModel):
    count: int
