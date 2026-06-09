"""Install links — all the variants from spec §16."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import install_link_id
from .base import TimestampMixin, pg_enum
from .enums import Channel, InstallLinkType


class InstallLink(Base, TimestampMixin):
    __tablename__ = "install_links"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=install_link_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The opaque token that appears in /install/{token}. Unique, high entropy.
    token: Mapped[str] = mapped_column(String(96), unique=True, index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    link_type: Mapped[InstallLinkType] = mapped_column(
        pg_enum(InstallLinkType, "install_link_type"),
        default=InstallLinkType.public,
        nullable=False,
    )
    channel: Mapped[Channel] = mapped_column(
        pg_enum(Channel, "install_link_channel"), default=Channel.stable, nullable=False
    )

    # Constraints
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    requires_account: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allowed_email_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    org_team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), nullable=True
    )

    disabled_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    @property
    def is_one_time(self) -> bool:
        return self.link_type == InstallLinkType.one_time or self.max_uses == 1

    def is_usable(self, now: dt.datetime | None = None) -> tuple[bool, str | None]:
        now = now or dt.datetime.now(dt.timezone.utc)
        if self.disabled_at is not None:
            return False, "disabled"
        if self.expires_at is not None and self.expires_at <= now:
            return False, "expired"
        if self.max_uses is not None and self.used_count >= self.max_uses:
            return False, "limit_reached"
        return True, None
