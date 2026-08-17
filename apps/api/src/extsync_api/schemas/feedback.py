"""Schemas for developer feedback (private user -> developer messages)."""
from __future__ import annotations

from pydantic import EmailStr, Field, TypeAdapter, ValidationError, field_validator

from .common import CamelModel

_EMAIL = TypeAdapter(EmailStr)


class FeedbackCreate(CamelModel):
    body: str = Field(min_length=1, max_length=4000)
    # Optional: an address the sender WANTS to share so the developer can reply.
    reply_email: str | None = Field(default=None, max_length=320)

    @field_validator("body")
    @classmethod
    def _strip_nonempty(cls, v: str) -> str:
        # Reject whitespace-only bodies (which pass min_length) with a 422, and
        # store the trimmed text so the router doesn't re-strip.
        v = v.strip()
        if not v:
            raise ValueError("ההודעה ריקה")
        return v

    @field_validator("reply_email")
    @classmethod
    def _clean_email(cls, v: str | None) -> str | None:
        # The field is optional, so an empty/blank box means "no reply address" -
        # it must not fail validation and block an otherwise fine message.
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        try:
            _EMAIL.validate_python(v)
        except ValidationError:
            raise ValueError("כתובת המייל אינה תקינה") from None
        return v


class FeedbackItem(CamelModel):
    id: str
    project_id: str
    project_name: str
    project_slug: str
    from_name: str  # sender's display name (or a generic label if the account is gone)
    body: str
    reply_email: str | None  # only when the sender chose to share one
    read: bool
    created_at: str


class UnreadCount(CamelModel):
    count: int
