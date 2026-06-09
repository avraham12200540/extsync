"""Devices, device sessions, installations, events, update attempts, rollout."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import device_id, generic_id, installation_id
from .base import TimestampMixin, pg_enum
from .enums import Channel, DeviceOS, InstallationStatus, UpdateAttemptStatus


class Device(Base, TimestampMixin):
    """An Agent installation. anonymous_device_id is random (NOT hardware-derived, §2)."""

    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=device_id)
    anonymous_device_id: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    # Optional link to a registered end-user account (§2.c).
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    agent_version: Mapped[str] = mapped_column(String(16), default="0.0.0", nullable=False)
    os: Mapped[DeviceOS] = mapped_column(
        pg_enum(DeviceOS, "device_os"), default=DeviceOS.windows, nullable=False
    )
    os_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Ed25519 public key the Agent uses to authenticate its requests (optional hardening).
    agent_public_key_b64: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_seen_at: Mapped[dt.datetime | None] = mapped_column(nullable=True, index=True)


class DeviceSession(Base, TimestampMixin):
    __tablename__ = "device_sessions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    device_id: Mapped[str] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(nullable=False)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)


class Installation(Base, TimestampMixin):
    """A managed extension on a specific device. Server mirror of local state."""

    __tablename__ = "installations"
    __table_args__ = (
        UniqueConstraint("device_id", "project_id", name="uq_installation_device_project"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=installation_id)
    device_id: Mapped[str] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), index=True, nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel: Mapped[Channel] = mapped_column(
        pg_enum(Channel, "installation_channel"), default=Channel.stable, nullable=False
    )
    current_release_id: Mapped[str | None] = mapped_column(
        ForeignKey("releases.id", ondelete="SET NULL"), nullable=True
    )
    current_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    extension_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[InstallationStatus] = mapped_column(
        pg_enum(InstallationStatus, "installation_status"),
        default=InstallationStatus.downloading,
        nullable=False,
        index=True,
    )
    has_bridge: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updates_paused: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    install_link_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_seen_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    removed_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)


class InstallationEvent(Base, TimestampMixin):
    __tablename__ = "installation_events"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    installation_id: Mapped[str] = mapped_column(
        ForeignKey("installations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type: Mapped[str] = mapped_column(String(48), nullable=False)
    release_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str | None] = mapped_column(String(48), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class UpdateAttempt(Base, TimestampMixin):
    __tablename__ = "update_attempts"
    __table_args__ = (
        UniqueConstraint(
            "installation_id", "idempotency_key", name="uq_update_attempt_idem"
        ),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    installation_id: Mapped[str] = mapped_column(
        ForeignKey("installations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    release_id: Mapped[str] = mapped_column(
        ForeignKey("releases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    from_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_version: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[UpdateAttemptStatus] = mapped_column(
        pg_enum(UpdateAttemptStatus, "update_attempt_status"),
        default=UpdateAttemptStatus.pending,
        nullable=False,
    )
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    reload_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    started_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    finished_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)


class RolloutAssignment(Base, TimestampMixin):
    """Cached deterministic bucket per (project, channel, device) — §22."""

    __tablename__ = "rollout_assignments"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "channel", "device_id", name="uq_rollout_assignment"
        ),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel: Mapped[Channel] = mapped_column(pg_enum(Channel, "rollout_channel"), nullable=False)
    device_id: Mapped[str] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    bucket: Mapped[int] = mapped_column(Integer, nullable=False)  # 0..99
