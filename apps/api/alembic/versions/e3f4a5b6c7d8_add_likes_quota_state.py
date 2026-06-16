"""add likes_quota_state (rolling-window meter)

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-06-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "e3f4a5b6c7d8"
down_revision: str | None = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "likes_quota_state",
        sa.Column("user_id", sa.String(length=64), primary_key=True),
        sa.Column("forum_user_id", sa.String(length=64), nullable=True),
        sa.Column("forum_username", sa.String(length=255), nullable=True),
        sa.Column("forum_userslug", sa.String(length=255), nullable=True),
        sa.Column("baseline_pids", sa.JSON(), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("limit_hit", sa.Boolean(), nullable=False),
        sa.Column("limit_hit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("daily_limit", sa.Integer(), nullable=False),
        sa.Column("per_user_limit", sa.Integer(), nullable=False),
        sa.Column("window_seconds", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("(CURRENT_TIMESTAMP)")),
    )


def downgrade() -> None:
    op.drop_table("likes_quota_state")
