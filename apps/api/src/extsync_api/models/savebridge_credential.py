"""Individually revocable credentials for SaveBridge client builds.

Each distributed copy of the SaveBridge extension carries one credential. The
credential is what tells the server which access policy applies - the client
never states its own policy, and a client that claims one is ignored.

Two things this model is deliberately built around:

  * The secret is never stored. Only a MAC of it is, so reading this table does
    not yield anything that can authenticate.

  * "Revocable" is the real security property, not "unextractable". Anyone
    holding a private build controls their machine and can read the credential
    out of it. What the system guarantees is that the credential is attributable
    to one recipient and can be revoked without affecting anyone else.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base, UtcDateTime
from ..ids import new_id
from .base import TimestampMixin

# --- policy: what the SERVER does about NetFree for this credential ----------
# The only two access policies that exist. There is no third path, and no
# request field can select between them - the credential decides.
POLICY_NETFREE_REQUIRED = "netfree_required"
POLICY_UNRESTRICTED_PRIVATE = "unrestricted_private"
POLICIES = (POLICY_NETFREE_REQUIRED, POLICY_UNRESTRICTED_PRIVATE)

# --- type: how the credential is distributed ---------------------------------
# A public_distribution credential is embedded in the build everyone downloads,
# so it is public knowledge by construction. That is acceptable precisely
# because it grants no policy relief.
TYPE_PUBLIC = "public_distribution"
TYPE_PRIVATE = "private_distribution"
TYPES = (TYPE_PUBLIC, TYPE_PRIVATE)

STATUS_ACTIVE = "active"
STATUS_REVOKED = "revoked"


class SaveBridgeCredential(Base, TimestampMixin):
    __tablename__ = "savebridge_client_credentials"

    id: Mapped[str] = mapped_column(String(40), primary_key=True,
                                    default=lambda: new_id("sbc"))

    label: Mapped[str] = mapped_column(String(120), nullable=False)

    # The non-secret half of the token, used to find this row. Safe to log.
    token_id: Mapped[str] = mapped_column(String(64), unique=True, index=True,
                                          nullable=False)
    # HMAC-SHA256(pepper, full_token). NOT the token, and not reversible into it.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    policy: Mapped[str] = mapped_column(String(32), nullable=False,
                                        default=POLICY_NETFREE_REQUIRED)
    credential_type: Mapped[str] = mapped_column(String(32), nullable=False,
                                                 default=TYPE_PRIVATE)
    status: Mapped[str] = mapped_column(String(16), nullable=False,
                                        default=STATUS_ACTIVE, index=True)

    expires_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)

    # Who issued it. Durable identity for the same reason as the moderation
    # trail: the FK goes NULL if the account is deleted, and "who authorised
    # unrestricted access" has to stay answerable after that.
    created_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_by_name_snapshot: Mapped[str | None] = mapped_column(String(120), nullable=True)

    revoked_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    revoked_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    revoked_by_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    revoked_by_name_snapshot: Mapped[str | None] = mapped_column(String(120), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Visibility, not attestation. A credential used far more than expected, or
    # after a long silence, is worth an administrator's attention - it is not
    # grounds for anything automatic.
    last_used_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    @property
    def is_usable(self) -> bool:
        """Active, not revoked, not expired. Deliberately a single property so no
        caller can check two of the three and forget the other."""
        if self.status != STATUS_ACTIVE:
            return False
        if self.revoked_at is not None:
            return False
        if self.expires_at is not None:
            expires = self.expires_at
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=dt.timezone.utc)
            if expires <= dt.datetime.now(dt.timezone.utc):
                return False
        return True
