"""add likes_quota_daily + likes_quota_events (mitmachim.top likes meter)

Revision ID: c1d2e3f4a5b6
Revises: a1b2c3d4e5f6
Create Date: 2026-06-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "likes_quota_daily",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column("user_id", sa.String(length=64), nullable=False, index=True),
        sa.Column("forum_user_id", sa.String(length=64), nullable=True),
        sa.Column("forum_username", sa.String(length=255), nullable=True),
        sa.Column("forum_userslug", sa.String(length=255), nullable=True),
        sa.Column("date", sa.Date(), nullable=False, index=True),
        sa.Column("likes_today", sa.Integer(), nullable=False),
        sa.Column("daily_limit", sa.Integer(), nullable=False),
        sa.Column("per_user_limit", sa.Integer(), nullable=False),
        sa.Column("target_users", sa.JSON(), nullable=False),
        sa.Column("liked_posts", sa.JSON(), nullable=False),
        sa.Column("manual_override", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.UniqueConstraint("user_id", "date", name="uq_likes_quota_user_date"),
    )

    op.create_table(
        "likes_quota_events",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column("user_id", sa.String(length=64), nullable=False, index=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("post_id", sa.String(length=64), nullable=True),
        sa.Column("topic_id", sa.String(length=64), nullable=True),
        sa.Column("target_user_id", sa.String(length=64), nullable=True),
        sa.Column("target_username", sa.String(length=255), nullable=True),
        sa.Column("client_event_id", sa.String(length=64), nullable=True),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("previous_likes_today", sa.Integer(), nullable=False),
        sa.Column("new_likes_today", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.UniqueConstraint("user_id", "client_event_id", name="uq_likes_event_client"),
    )
    op.create_index("ix_likes_event_user_date", "likes_quota_events", ["user_id", "date"])


def downgrade() -> None:
    op.drop_index("ix_likes_event_user_date", table_name="likes_quota_events")
    op.drop_table("likes_quota_events")
    op.drop_table("likes_quota_daily")
