"""Common column types and mixins for ORM models."""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import Enum as SAEnum, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import UtcDateTime


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def pg_enum(enum_cls: type, name: str) -> SAEnum:
    """Portable enum stored as VARCHAR + CHECK (works on Postgres and SQLite)."""
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        validate_strings=True,
        values_callable=lambda e: [m.value for m in e],
    )


class TimestampMixin:
    created_at: Mapped[dt.datetime] = mapped_column(
        UtcDateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        UtcDateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class SoftDeleteMixin:
    deleted_at: Mapped[dt.datetime | None] = mapped_column(
        UtcDateTime, nullable=True, default=None
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


def json_default(value: Any) -> Any:
    return value
