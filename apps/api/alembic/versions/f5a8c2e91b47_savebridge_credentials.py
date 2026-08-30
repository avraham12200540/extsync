"""savebridge client credentials

Individually revocable credentials for SaveBridge builds. Each distributed copy
carries one; the credential is what determines whether the NetFree availability
check applies, so that decision lives server-side and the client cannot state it.

Two defaults matter for safety, and both are deliberately the restrictive one:

  policy DEFAULT 'netfree_required'
      A row created without an explicit policy is GATED, not unrestricted. No
      existing or future client can become unrestricted through a default.

  status DEFAULT 'active'
      Only meaningful together with the row existing at all. This migration
      creates NO rows, so no client is authorized by running it - the legacy
      clients that exist today remain exactly as (un)authorized as before, and
      are handled by the rollout phases rather than by this schema.

Only a MAC of each token is stored. There is no column from which a credential
could be reconstructed.

Revision ID: f5a8c2e91b47
Revises: e4c7b91d5a26
Create Date: 2026-08-30
"""
from __future__ import annotations

from alembic import op

revision: str = "f5a8c2e91b47"
down_revision: str | None = "e4c7b91d5a26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS savebridge_client_credentials (
            id                        VARCHAR(40) PRIMARY KEY,
            label                     VARCHAR(120) NOT NULL,
            token_id                  VARCHAR(64)  NOT NULL UNIQUE,
            token_hash                VARCHAR(64)  NOT NULL,
            policy                    VARCHAR(32)  NOT NULL DEFAULT 'netfree_required',
            credential_type           VARCHAR(32)  NOT NULL DEFAULT 'private_distribution',
            status                    VARCHAR(16)  NOT NULL DEFAULT 'active',
            expires_at                TIMESTAMPTZ,
            created_by_user_id        VARCHAR(40) REFERENCES users(id) ON DELETE SET NULL,
            created_by_email_snapshot VARCHAR(320),
            created_by_name_snapshot  VARCHAR(120),
            revoked_at                TIMESTAMPTZ,
            revoked_by_user_id        VARCHAR(40) REFERENCES users(id) ON DELETE SET NULL,
            revoked_by_email_snapshot VARCHAR(320),
            revoked_by_name_snapshot  VARCHAR(120),
            revoked_reason            TEXT,
            last_used_at              TIMESTAMPTZ,
            use_count                 INTEGER      NOT NULL DEFAULT 0,
            notes                     TEXT,
            created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_sbc_token_id "
        "ON savebridge_client_credentials (token_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_sbc_status "
        "ON savebridge_client_credentials (status)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS savebridge_client_credentials")
