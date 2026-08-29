"""add release moderation review state (NetFree store moderation)

Introduces an ORTHOGONAL review dimension on releases. `releases.status` keeps
its existing meaning (delivery lifecycle); `review_status` says whether a site
administrator has cleared the release for public distribution.

Backfill policy - deliberate and conservative:
  every row that already exists predates moderation, so it is set to
  'legacy_pending', NOT 'approved'. Nothing is silently grandfathered into an
  approved state. Currently-published releases stay publicly available (the
  availability policy treats legacy_pending + published as live) while still
  appearing in the administrator's legacy review queue.

New rows default to 'pending', so anything submitted from now on is private and
unavailable until an administrator approves it.

Idempotent (IF NOT EXISTS) per the migration conventions.

Revision ID: a3f81c26d904
Revises: f1a4d6c93b28
Create Date: 2026-08-29
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "a3f81c26d904"
down_revision: str | None = "f1a4d6c93b28"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Is this the run that actually introduces the column? The backfill below must
    # be strictly ONE-SHOT. A time-based guard is not enough: on a re-run, a
    # genuinely new submission still sitting at 'pending' would also be older than
    # now() and would get misclassified as legacy - i.e. silently grandfathered.
    # New releases must NEVER become legacy_pending.
    first_run = op.get_bind().execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'releases' AND column_name = 'review_status'"
    )).scalar() is None

    # New rows default to 'pending'; existing rows are corrected below.
    op.execute(
        "ALTER TABLE releases ADD COLUMN IF NOT EXISTS review_status "
        "VARCHAR(32) NOT NULL DEFAULT 'pending'"
    )
    op.execute(
        "ALTER TABLE releases ADD COLUMN IF NOT EXISTS reviewed_by_user_id VARCHAR(40) "
        "REFERENCES users(id) ON DELETE SET NULL"
    )
    op.execute("ALTER TABLE releases ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ")
    op.execute("ALTER TABLE releases ADD COLUMN IF NOT EXISTS review_reason TEXT")
    op.execute("ALTER TABLE releases ADD COLUMN IF NOT EXISTS review_note TEXT")

    # Everything that existed before this column did predates moderation. Mark it
    # legacy so it enters the review queue instead of being treated as reviewed.
    # Nothing is silently promoted to 'approved'.
    if first_run:
        op.execute(
            "UPDATE releases SET review_status = 'legacy_pending' "
            "WHERE review_status = 'pending'"
        )

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_releases_review_status ON releases (review_status)"
    )
    # The moderation queues are always scoped per project, and the availability
    # policy filters on both dimensions at once.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_releases_project_review ON releases (project_id, review_status)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_releases_project_review")
    op.execute("DROP INDEX IF EXISTS ix_releases_review_status")
    for col in ("review_note", "review_reason", "reviewed_at", "reviewed_by_user_id", "review_status"):
        op.execute(f"ALTER TABLE releases DROP COLUMN IF EXISTS {col}")
