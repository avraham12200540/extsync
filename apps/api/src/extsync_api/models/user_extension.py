"""A user's extension library: store extensions they installed from the site.

One row per (user, project). Populated automatically when a LOGGED-IN user
clicks install in the store; anonymous installs are untracked. Powers the
"my library" page and the bulk install-on-a-new-computer flow.
"""
from __future__ import annotations

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..ids import generic_id
from .base import TimestampMixin


class UserExtension(Base, TimestampMixin):
    __tablename__ = "user_extensions"
    __table_args__ = (
        UniqueConstraint("user_id", "project_id", name="uq_user_extension_user_project"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=generic_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
