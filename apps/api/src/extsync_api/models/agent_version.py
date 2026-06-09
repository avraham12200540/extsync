"""Agent self-update: published agent versions and their channels (§28)."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import generic_id
from .base import TimestampMixin


class AgentVersion(Base, TimestampMixin):
    __tablename__ = "agent_versions"
    __table_args__ = (UniqueConstraint("version", "channel", name="uq_agent_version_channel"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    version: Mapped[str] = mapped_column(String(16), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), default="stable", nullable=False)  # stable|beta
    download_url: Mapped[str] = mapped_column(String(800), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    signature: Mapped[str] = mapped_column(Text, nullable=False)
    key_id: Mapped[str] = mapped_column(String(64), nullable=False)
    release_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    minimum_supported_version: Mapped[str] = mapped_column(String(16), default="1.0.0", nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    published_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)


class AgentUpdateChannel(Base, TimestampMixin):
    __tablename__ = "agent_update_channels"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    channel: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)  # stable|beta
    active_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_versions.id", ondelete="SET NULL"), nullable=True
    )
    rollout_percentage: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
