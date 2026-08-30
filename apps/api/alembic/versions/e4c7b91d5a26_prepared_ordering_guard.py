"""prepared decision: "retire only after a replacement is live"

Some prepared takedowns are removals - the extension is meant to leave the
store. Others are the second half of a replacement, where the old build should
only be retired once its successor is already serving users. The `decision`
column cannot tell those apart: both are `request_changes`.

Without the distinction, applying a replacement's takedown at the wrong moment
takes the extension off the store for everyone who has it installed, because
there is no approved earlier release for the channel to fall back to. This flag
lets the reviewer record the precondition, and the apply path enforces it
server-side.

Defaults to FALSE, so every existing prepared row keeps behaving exactly as it
does today.

Revision ID: e4c7b91d5a26
Revises: d9f2a71c4e83
Create Date: 2026-08-30
"""
from __future__ import annotations

from alembic import op

revision: str = "e4c7b91d5a26"
down_revision: str | None = "d9f2a71c4e83"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE prepared_moderation_decisions
            ADD COLUMN IF NOT EXISTS requires_newer_approved_release
                BOOLEAN NOT NULL DEFAULT FALSE
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE prepared_moderation_decisions
            DROP COLUMN IF EXISTS requires_newer_approved_release
        """
    )
