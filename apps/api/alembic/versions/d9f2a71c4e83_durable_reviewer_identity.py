"""durable reviewer identity + prepared moderation decisions

Two related things.

1. Immutable actor identity snapshots.

   audit_events.actor_user_id, releases.reviewed_by_user_id and
   projects.listing_reviewed_by_user_id are all ON DELETE SET NULL. Deleting an
   account therefore strips the actor from every row it ever produced - the
   record of who approved what does not survive the reviewer's account, silently
   and retroactively. For a moderation trail whose purpose is truthful reviewer
   attribution that is the wrong failure mode.

   The FKs stay exactly as they are (they are the relational link, and a dangling
   id would be worse). These columns are the durable half: written once, at
   action time, and never updated.

   NOTHING IS BACKFILLED. The ~1,444 existing rows with a NULL actor stay NULL.
   A snapshot is only evidence if it was taken at the time; deriving one now
   would produce a guess that reads exactly like a record, which is worse than
   an honest gap.

2. prepared_moderation_decisions.

   Lets a review be recorded without being executed, so the analysis and the
   moment of authority stay separate. Rows here have no effect on anything the
   public can see until an administrator applies them under their own session.

Revision ID: d9f2a71c4e83
Revises: c8e33a1b7d52
Create Date: 2026-08-30
"""
from __future__ import annotations

from alembic import op

revision: str = "d9f2a71c4e83"
down_revision: str | None = "c8e33a1b7d52"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE audit_events
            ADD COLUMN IF NOT EXISTS actor_email_snapshot        VARCHAR(320),
            ADD COLUMN IF NOT EXISTS actor_display_name_snapshot VARCHAR(120)
        """
    )
    op.execute(
        """
        ALTER TABLE releases
            ADD COLUMN IF NOT EXISTS reviewed_by_email_snapshot VARCHAR(320),
            ADD COLUMN IF NOT EXISTS reviewed_by_name_snapshot  VARCHAR(120)
        """
    )
    op.execute(
        """
        ALTER TABLE projects
            ADD COLUMN IF NOT EXISTS listing_reviewed_by_email_snapshot VARCHAR(320),
            ADD COLUMN IF NOT EXISTS listing_reviewed_by_name_snapshot  VARCHAR(120)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS prepared_moderation_decisions (
            id                        VARCHAR(40)  PRIMARY KEY,
            release_id                VARCHAR(40)  NOT NULL,
            project_id                VARCHAR(40)  NOT NULL,
            batch                     VARCHAR(64)  NOT NULL,
            decision                  VARCHAR(32)  NOT NULL,
            listing_decision          VARCHAR(32),
            developer_reason          TEXT,
            internal_note             TEXT,
            reviewed_sha256           VARCHAR(64),
            state                     VARCHAR(16)  NOT NULL DEFAULT 'prepared',
            applied_at                TIMESTAMPTZ,
            applied_by_user_id        VARCHAR(40)
                REFERENCES users(id) ON DELETE SET NULL,
            applied_by_email_snapshot VARCHAR(320),
            applied_by_name_snapshot  VARCHAR(120),
            result_message            TEXT,
            created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_prepared_release_batch UNIQUE (release_id, batch)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_prepared_state "
        "ON prepared_moderation_decisions (state)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_prepared_batch "
        "ON prepared_moderation_decisions (batch)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_prepared_release "
        "ON prepared_moderation_decisions (release_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS prepared_moderation_decisions")
    op.execute(
        """
        ALTER TABLE projects
            DROP COLUMN IF EXISTS listing_reviewed_by_email_snapshot,
            DROP COLUMN IF EXISTS listing_reviewed_by_name_snapshot
        """
    )
    op.execute(
        """
        ALTER TABLE releases
            DROP COLUMN IF EXISTS reviewed_by_email_snapshot,
            DROP COLUMN IF EXISTS reviewed_by_name_snapshot
        """
    )
    op.execute(
        """
        ALTER TABLE audit_events
            DROP COLUMN IF EXISTS actor_email_snapshot,
            DROP COLUMN IF EXISTS actor_display_name_snapshot
        """
    )
