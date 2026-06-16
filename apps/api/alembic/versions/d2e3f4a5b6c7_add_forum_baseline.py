"""add likes_quota_daily.forum_baseline (forum-sync mode)

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-06-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "d2e3f4a5b6c7"
down_revision: str | None = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("likes_quota_daily", sa.Column("forum_baseline", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("likes_quota_daily", "forum_baseline")
