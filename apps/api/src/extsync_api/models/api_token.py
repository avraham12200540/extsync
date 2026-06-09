"""Developer API tokens (for CLI / CI)."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import api_token_id
from .base import TimestampMixin


class ApiToken(Base, TimestampMixin):
    __tablename__ = "api_tokens"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=api_token_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Shown once on creation: "exsk_<prefix>.<secret>". Only the hash is stored.
    token_prefix: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    scopes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    last_used_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    expires_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)

    @property
    def is_active(self) -> bool:
        now = dt.datetime.now(dt.timezone.utc)
        if self.revoked_at is not None:
            return False
        if self.expires_at is not None and self.expires_at <= now:
            return False
        return True
