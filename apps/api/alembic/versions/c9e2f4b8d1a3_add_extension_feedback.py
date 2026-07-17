"""add extension_feedback (private user -> developer messages)

One row per message a signed-in user sends to an extension's developer; shown
only in the owner's dashboard.

Idempotent (IF NOT EXISTS) per the migration conventions.

Revision ID: c9e2f4b8d1a3
Revises: b8d1f3a6c2e7
Create Date: 2026-07-16
"""
from __future__ import annotations

from alembic import op

revision: str = "c9e2f4b8d1a3"
down_revision: str | None = "b8d1f3a6c2e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS extension_feedback (
            id VARCHAR(40) PRIMARY KEY,
            project_id VARCHAR(40) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            from_user_id VARCHAR(40) REFERENCES users(id) ON DELETE SET NULL,
            body TEXT NOT NULL,
            read_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_extension_feedback_project_id ON extension_feedback (project_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_extension_feedback_from_user_id ON extension_feedback (from_user_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS extension_feedback")
