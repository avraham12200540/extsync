"""Releases, artifacts, permission snapshots, and channel pointers."""
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
from ..ids import artifact_id, generic_id, release_id
from .base import TimestampMixin, pg_enum
from .enums import Channel, ReleaseStatus


class Release(Base, TimestampMixin):
    __tablename__ = "releases"
    __table_args__ = (
        UniqueConstraint("project_id", "sequence", name="uq_release_project_sequence"),
        UniqueConstraint("project_id", "version", "channel", name="uq_release_version_channel"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=release_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    channel: Mapped[Channel] = mapped_column(
        pg_enum(Channel, "release_channel"), default=Channel.stable, nullable=False
    )
    status: Mapped[ReleaseStatus] = mapped_column(
        pg_enum(ReleaseStatus, "release_status"),
        default=ReleaseStatus.uploaded,
        nullable=False,
        index=True,
    )
    # Monotonic per-project sequence, assigned at publish time. Drives Agent ordering.
    sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)

    uploaded_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    release_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    minimum_agent_version: Mapped[str] = mapped_column(String(16), default="1.0.0", nullable=False)
    rollout_percentage: Mapped[int] = mapped_column(Integer, default=100, nullable=False)

    permissions_changed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    requires_user_approval: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Worker output: full validation report (warnings, errors, inventory, manifest).
    validation_report: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Signed metadata exactly as delivered to the Agent (release-metadata schema).
    signed_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    signature: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    scheduled_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    published_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    superseded_by_release_id: Mapped[str | None] = mapped_column(String(40), nullable=True)

    version_lock: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    __mapper_args__ = {"version_id_col": version_lock}


class ReleaseArtifact(Base, TimestampMixin):
    """Immutable. Original upload and validated artifact stored separately (§25)."""

    __tablename__ = "release_artifacts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=artifact_id)
    release_id: Mapped[str] = mapped_column(
        ForeignKey("releases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # original | validated
    s3_bucket: Mapped[str] = mapped_column(String(120), nullable=False)
    s3_key: Mapped[str] = mapped_column(String(400), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    content_type: Mapped[str] = mapped_column(String(80), default="application/zip", nullable=False)
    file_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ReleasePermissionSnapshot(Base, TimestampMixin):
    __tablename__ = "release_permission_snapshots"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    release_id: Mapped[str] = mapped_column(
        ForeignKey("releases.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    permissions: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    optional_permissions: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    host_permissions: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    optional_host_permissions: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    content_scripts_matches: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    externally_connectable: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    uses_native_messaging: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    web_accessible_resources: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    # Diff vs previous published release in same channel.
    diff_added: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    diff_removed: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    risk_level: Mapped[str] = mapped_column(String(16), default="low", nullable=False)


class ChannelState(Base, TimestampMixin):
    """Current active release pointer per (project, channel)."""

    __tablename__ = "channels"
    __table_args__ = (UniqueConstraint("project_id", "channel", name="uq_channel_project"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel: Mapped[Channel] = mapped_column(pg_enum(Channel, "channel_state"), nullable=False)
    active_release_id: Mapped[str | None] = mapped_column(
        ForeignKey("releases.id", ondelete="SET NULL"), nullable=True
    )
    rollout_percentage: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    is_paused: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class ChannelAssignment(Base, TimestampMixin):
    """History of channel pointer changes (audit + rollback target lookup)."""

    __tablename__ = "channel_assignments"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel: Mapped[Channel] = mapped_column(pg_enum(Channel, "channel_assign"), nullable=False)
    release_id: Mapped[str] = mapped_column(
        ForeignKey("releases.id", ondelete="CASCADE"), nullable=False
    )
    assigned_by_user_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    rollout_percentage: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    unassigned_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
