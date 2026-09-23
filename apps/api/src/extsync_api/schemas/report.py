"""Schemas for extension reports (anyone -> platform administrators)."""
from __future__ import annotations

from pydantic import EmailStr, Field, TypeAdapter, ValidationError, field_validator

from .common import CamelModel

_EMAIL = TypeAdapter(EmailStr)


class ReportCreate(CamelModel):
    """Both fields optional. A report with neither is still accepted.

    Everything is normalised so that "left the box empty" and "typed only
    spaces" mean the same thing - nothing - rather than one being accepted and
    the other failing validation.
    """

    reason: str | None = Field(default=None, max_length=4000)
    email: str | None = Field(default=None, max_length=320)

    @field_validator("reason")
    @classmethod
    def _clean_reason(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("email")
    @classmethod
    def _clean_email(cls, v: str | None) -> str | None:
        # Optional, so a blank box must not block an otherwise fine report. Only
        # something that was actually typed has to look like an address.
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


class ReportHandle(CamelModel):
    """An administrator closing a report."""

    status: str = Field(pattern="^(resolved|dismissed|open)$")
    admin_note: str | None = Field(default=None, max_length=4000)
