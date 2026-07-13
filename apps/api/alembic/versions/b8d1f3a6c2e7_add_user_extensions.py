"""add user_extensions library table

One row per (user, project): the store extensions a logged-in user installed
from the site. Powers the "my library" page + bulk install on a new computer.

Idempotent (IF NOT EXISTS) per the migration conventions.

Revision ID: b8d1f3a6c2e7
Revises: a9f4e2b7c1d3
Create Date: 2026-07-13
"""
from __future__ import annotations

from alembic import op

revision: str = "b8d1f3a6c2e7"
down_revision: str | None = "a9f4e2b7c1d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_extensions (
            id VARCHAR(40) PRIMARY KEY,
            user_id VARCHAR(40) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            project_id VARCHAR(40) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_user_extension_user_project UNIQUE (user_id, project_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_extensions_user_id ON user_extensions (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_extensions_project_id ON user_extensions (project_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_extensions")
