"""add platform_flags (Store Safe Mode)

Runtime switches an administrator can flip without a deploy. A table rather than
an environment variable on purpose: an emergency control has to work without a
rebuild, a restart, or SSH access to the droplet.

No rows are created here. An absent flag reads as disabled, so the store starts
open exactly as it is today and nothing changes on deploy.

Revision ID: c8e33a1b7d52
Revises: b7d21e9f5a04
Create Date: 2026-08-30
"""
from __future__ import annotations

from alembic import op

revision: str = "c8e33a1b7d52"
down_revision: str | None = "b7d21e9f5a04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS platform_flags (
            key                VARCHAR(64) PRIMARY KEY,
            enabled            BOOLEAN NOT NULL DEFAULT FALSE,
            value              JSONB,
            reason             TEXT,
            updated_by_user_id VARCHAR(40) REFERENCES users(id) ON DELETE SET NULL,
            updated_at_utc     TIMESTAMPTZ,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS platform_flags")
