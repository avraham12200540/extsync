"""Auth-supporting tables: sessions, verifications, resets, 2FA, recovery, device flow."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import generic_id, session_id
from .base import TimestampMixin, pg_enum
from .enums import DeviceOS


class UserSession(Base, TimestampMixin):
    """A login session. The refresh token is stored hashed; rotation revokes old rows."""

    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=session_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    refresh_token_hash: Mapped[str] = mapped_column(
        String(128), unique=True, index=True, nullable=False
    )
    # Rotation chain: when a refresh is used, a new session row is created and this
    # one is marked replaced_by; reuse of a replaced token => theft detection.
    replaced_by_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    expires_at: Mapped[dt.datetime] = mapped_column(nullable=False)

    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    os: Mapped[DeviceOS] = mapped_column(
        pg_enum(DeviceOS, "session_os"), default=DeviceOS.unknown, nullable=False
    )

    @property
    def is_active(self) -> bool:
        now = dt.datetime.now(dt.timezone.utc)
        return self.revoked_at is None and self.expires_at > now


class EmailVerification(Base, TimestampMixin):
    __tablename__ = "email_verifications"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(nullable=False)
    consumed_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)


class PasswordReset(Base, TimestampMixin):
    __tablename__ = "password_resets"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(nullable=False)
    consumed_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)


class TwoFactorSecret(Base, TimestampMixin):
    __tablename__ = "two_factor_secrets"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # TOTP secret, encrypted at rest (see security/crypto). Confirmed only after first verify.
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)


class RecoveryCode(Base, TimestampMixin):
    __tablename__ = "recovery_codes"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    used_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)


class DeviceFlow(Base, TimestampMixin):
    """OAuth-style device pairing so the Agent never asks for a password (§20)."""

    __tablename__ = "device_flows"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    # Short, human-typed user code shown by the Agent.
    user_code: Mapped[str] = mapped_column(String(16), unique=True, index=True, nullable=False)
    # Opaque device code the Agent polls with (stored hashed).
    device_code_hash: Mapped[str] = mapped_column(
        String(128), unique=True, index=True, nullable=False
    )
    approved_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    device_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(nullable=False)


Index("ix_user_sessions_user_active", UserSession.user_id, UserSession.revoked_at)
