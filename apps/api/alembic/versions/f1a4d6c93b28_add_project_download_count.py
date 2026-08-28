"""add projects.download_count (site ZIP downloads + agent acquisitions)

The store shows two separate numbers: DOWNLOADS (every time the file was
obtained, including the site's ZIP button) and INSTALLS (registered installs
only, counted from the installations table). This adds the download counter.

Idempotent (IF NOT EXISTS) per the migration conventions.

Revision ID: f1a4d6c93b28
Revises: d7b3c8e15f92
Create Date: 2026-08-23
"""
from __future__ import annotations

from alembic import op

revision: str = "f1a4d6c93b28"
down_revision: str | None = "d7b3c8e15f92"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS download_count")
