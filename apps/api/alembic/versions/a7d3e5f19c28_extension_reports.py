"""extension reports

Reports about an extension, sent to the platform administrators - never to the
extension's developer, since a report may be about the developer's own conduct.
Reason and email are both optional; a bare report is still a signal.

Creates an empty table and nothing else, so running it changes no behaviour
until the endpoint is used.

Revision ID: a7d3e5f19c28
Revises: f5a8c2e91b47
Create Date: 2026-09-23
"""
from __future__ import annotations

from alembic import op

revision: str = "a7d3e5f19c28"
down_revision: str | None = "f5a8c2e91b47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS extension_reports (
            id                         VARCHAR(40) PRIMARY KEY,
            project_id                 VARCHAR(40) NOT NULL
                REFERENCES projects(id) ON DELETE CASCADE,
            release_id                 VARCHAR(40),
            reason                     TEXT,
            reporter_email             VARCHAR(320),
            reporter_user_id           VARCHAR(40)
                REFERENCES users(id) ON DELETE SET NULL,
            status                     VARCHAR(16) NOT NULL DEFAULT 'open',
            handled_at                 TIMESTAMPTZ,
            handled_by_user_id         VARCHAR(40)
                REFERENCES users(id) ON DELETE SET NULL,
            handled_by_email_snapshot  VARCHAR(320),
            admin_note                 TEXT,
            created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_ext_reports_project ON extension_reports (project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_ext_reports_status ON extension_reports (status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS extension_reports")
