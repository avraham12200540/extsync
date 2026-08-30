"""add public listing moderation to projects

The listing a developer edits - name, descriptions, icon, screenshots - is public
content in its own right. Without this, an extension could be approved with an
innocuous listing and then renamed to anything, with no review in between.

`approved_listing` holds the snapshot the store renders; the existing columns
stay the developer's working copy. They diverge whenever a developer edits, and
the store keeps showing the snapshot until an administrator accepts the change.

Backfill policy, mirroring the release migration (a3f81c26d904):

  Existing projects are marked `legacy_pending` and left with a NULL snapshot,
  which means "keep rendering the live fields". Nothing goes dark, and nothing is
  silently treated as reviewed - they enter the administrator's queue instead.

  The backfill is strictly ONE-SHOT, keyed on whether this run created the
  column. A time-based guard is not enough: on a re-run, a genuinely new project
  still sitting at 'pending' would also be older than now() and would get
  misclassified as legacy - i.e. grandfathered without ever being reviewed.

Idempotent (IF NOT EXISTS) per the migration conventions.

Revision ID: b7d21e9f5a04
Revises: a3f81c26d904
Create Date: 2026-08-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "b7d21e9f5a04"
down_revision: str | None = "a3f81c26d904"
branch_labels = None
depends_on = None


def upgrade() -> None:
    first_run = op.get_bind().execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'projects' AND column_name = 'listing_review_status'"
    )).scalar() is None

    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS approved_listing JSONB")
    op.execute(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS listing_review_status "
        "VARCHAR(32) NOT NULL DEFAULT 'pending'"
    )
    op.execute(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS listing_reviewed_by_user_id "
        "VARCHAR(40) REFERENCES users(id) ON DELETE SET NULL"
    )
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS listing_reviewed_at TIMESTAMPTZ")
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS listing_review_reason TEXT")

    if first_run:
        # NULL approved_listing is deliberate: it means "render the live fields",
        # so no existing store page changes the moment this ships.
        op.execute(
            "UPDATE projects SET listing_review_status = 'legacy_pending' "
            "WHERE listing_review_status = 'pending'"
        )

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_projects_listing_review "
        "ON projects (listing_review_status)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_projects_listing_review")
    for col in ("listing_review_reason", "listing_reviewed_at",
                "listing_reviewed_by_user_id", "listing_review_status",
                "approved_listing"):
        op.execute(f"ALTER TABLE projects DROP COLUMN IF EXISTS {col}")
