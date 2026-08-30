"""Runtime platform switches an administrator can flip without a deploy.

Deliberately a database table rather than an environment variable: the point of
an emergency control is that it works at 3am from a phone, without a rebuild, a
restart, or SSH access to the droplet.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from .base import TimestampMixin


class PlatformFlag(Base, TimestampMixin):
    """One named switch. `key` is the identifier code refers to."""

    __tablename__ = "platform_flags"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Optional structured payload for flags that need more than on/off.
    value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Why it was flipped - matters most for the ones flipped during an incident.
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at_utc: Mapped[dt.datetime | None] = mapped_column(nullable=True)


#: When on, the store serves nothing to the public: no catalog, no install
#: resolution, no Agent update offers. See services/safe_mode.py for exactly what
#: it does and does not cover.
STORE_SAFE_MODE = "store_safe_mode"
