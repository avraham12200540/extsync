"""User + developer profile."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base
from ..ids import user_id
from .base import SoftDeleteMixin, TimestampMixin, pg_enum
from .enums import UserRole


class User(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=user_id)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Argon2id hash. Null only for OAuth-only accounts.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    role: Mapped[UserRole] = mapped_column(
        pg_enum(UserRole, "user_role"), default=UserRole.end_user, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    google_sub: Mapped[str | None] = mapped_column(
        String(255), unique=True, index=True, nullable=True
    )

    last_login_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)

    # NotificationKind values the user has opted OUT of receiving by EMAIL. Empty =
    # receive all (the default). In-app notifications are unaffected by this list.
    email_notif_optout: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )

    developer_profile: Mapped["DeveloperProfile | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class DeveloperProfile(Base, TimestampMixin):
    __tablename__ = "developer_profiles"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=user_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # Optional developer / organization name captured at registration (metadata
    # only). The PUBLIC publisher name shown in the store/install pages is the
    # user's display_name, not this field.
    org_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    support_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    accepted_terms_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)

    user: Mapped[User] = relationship(back_populates="developer_profile")
