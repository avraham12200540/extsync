"""Teams and membership (RBAC at the team level, §3)."""
from __future__ import annotations

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import generic_id, team_id
from .base import SoftDeleteMixin, TimestampMixin, pg_enum
from .enums import TeamRole


class Team(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=team_id)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class TeamMember(Base, TimestampMixin):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_member"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    team_id: Mapped[str] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[TeamRole] = mapped_column(
        pg_enum(TeamRole, "team_role"), default=TeamRole.viewer, nullable=False
    )
    invited_by_user_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
