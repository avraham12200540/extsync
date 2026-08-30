"""Projects (Chrome extensions) and their stable signing keys (ADR-0005)."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import generic_id, project_id
from .base import SoftDeleteMixin, TimestampMixin, pg_enum
from .enums import ProjectStatus, ProjectVisibility, ReviewStatus


class Project(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=project_id)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    short_description: Mapped[str] = mapped_column(String(280), default="", nullable=False)
    full_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    repo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    support_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    privacy_policy_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    visibility: Mapped[ProjectVisibility] = mapped_column(
        pg_enum(ProjectVisibility, "project_visibility"),
        default=ProjectVisibility.private,
        nullable=False,
    )
    status: Mapped[ProjectStatus] = mapped_column(
        pg_enum(ProjectStatus, "project_status"),
        default=ProjectStatus.draft,
        nullable=False,
    )

    # Ownership: a project belongs to a user, optionally scoped to a team.
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True, nullable=True
    )

    # Stable Chrome extension id, computed from the project public key.
    extension_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)

    # Whether nightly channel is exposed to end users for switching.
    allow_channel_switch: Mapped[bool] = mapped_column(default=True, nullable=False)
    bridge_mode: Mapped[str] = mapped_column(String(16), default="basic", nullable=False)  # basic|integrated
    # Times the extension file was actually obtained: the site's ZIP button plus
    # every Agent acquisition. Deliberately a superset of the installation count -
    # an install is a real registered install, a download is just a download.
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")

    # ---- public listing moderation (§12) ----
    # The listing a developer can edit freely (name, descriptions, icon,
    # screenshots) is public content in its own right, so the same rule applies
    # to it as to a build: what the public sees is what an administrator
    # approved, not what was most recently typed.
    #
    # `approved_listing` is the snapshot the store actually renders. The columns
    # above stay the DEVELOPER's working copy. When they diverge,
    # `listing_review_status` goes to pending and the store keeps showing the
    # snapshot until an administrator accepts the change.
    #
    # NULL snapshot = grandfathered: projects that predate listing moderation
    # keep rendering their live fields, exactly like legacy_pending releases,
    # until someone reviews them.
    approved_listing: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    listing_review_status: Mapped[ReviewStatus] = mapped_column(
        pg_enum(ReviewStatus, "project_listing_review_status"),
        default=ReviewStatus.pending,
        nullable=False,
        index=True,
    )
    listing_reviewed_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Durable reviewer identity for the listing decision, for the same reason as
    # Release.reviewed_by_email_snapshot: the FK above goes NULL if the account
    # is ever deleted, and the compliance record has to outlive the account.
    listing_reviewed_by_email_snapshot: Mapped[str | None] = mapped_column(
        String(320), nullable=True
    )
    listing_reviewed_by_name_snapshot: Mapped[str | None] = mapped_column(
        String(120), nullable=True
    )
    listing_reviewed_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    listing_review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Optimistic locking for sensitive concurrent edits.
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    __mapper_args__ = {"version_id_col": version}


class ProjectScreenshot(Base, TimestampMixin):
    """A promotional/preview image shown on the extension's public detail page.
    Up to 10 per project (enforced in the API). Ordered by `position`."""

    __tablename__ = "project_screenshots"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ProjectKey(Base, TimestampMixin):
    """RSA keypair that yields the stable extension id. Private key encrypted at rest;
    NEVER returned to clients or placed in a ZIP (ADR-0005)."""

    __tablename__ = "project_keys"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    algorithm: Mapped[str] = mapped_column(String(32), default="rsa-2048", nullable=False)
    # Base64 DER SubjectPublicKeyInfo — this is what becomes manifest.key.
    public_key_b64: Mapped[str] = mapped_column(Text, nullable=False)
    # Private key PEM, encrypted (Fernet/AES-GCM via app secret or KMS).
    private_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    extension_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
