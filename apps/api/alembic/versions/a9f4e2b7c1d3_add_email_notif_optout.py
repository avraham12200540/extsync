"""add email_notif_optout to users

Per-user list of NotificationKind values opted out of EMAIL delivery.
Empty list (the default) means the user receives all notification emails.

Idempotent (ADD/DROP COLUMN IF [NOT] EXISTS): the column was added out-of-band
during the 2026-07-12 deploy where the first attempt collided with an existing
revision id, so this migration must be safe to (re-)run.

Revision ID: a9f4e2b7c1d3
Revises: f4a5b6c7d8e9
Create Date: 2026-07-12
"""
from __future__ import annotations

from alembic import op

revision: str = "a9f4e2b7c1d3"
down_revision: str | None = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notif_optout JSON NOT NULL DEFAULT '[]'::json"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_notif_optout")
