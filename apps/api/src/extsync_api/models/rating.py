"""Store ratings: one 1-5 star rating per (user, project), changeable."""
from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import generic_id
from .base import TimestampMixin


class ProjectRating(Base, TimestampMixin):
    __tablename__ = "project_ratings"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_rating_project_user"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    stars: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..5 (validated in API)
