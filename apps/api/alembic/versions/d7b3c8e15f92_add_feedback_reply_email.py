"""add extension_feedback.reply_email (optional reply address)

A sender may choose to leave an address so the developer can answer them. It is
opt-in and separate from their account email, which the developer never sees.

Idempotent (IF NOT EXISTS) per the migration conventions.

Revision ID: d7b3c8e15f92
Revises: c9e2f4b8d1a3
Create Date: 2026-08-16
"""
from __future__ import annotations

from alembic import op

revision: str = "d7b3c8e15f92"
down_revision: str | None = "c9e2f4b8d1a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE extension_feedback ADD COLUMN IF NOT EXISTS reply_email VARCHAR(320)")


def downgrade() -> None:
    op.execute("ALTER TABLE extension_feedback DROP COLUMN IF EXISTS reply_email")
