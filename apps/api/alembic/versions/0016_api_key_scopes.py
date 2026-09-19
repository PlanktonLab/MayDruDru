"""API key scopes（SPEC §10.1）

Revision ID: 0016
Revises: 0015
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

ALL_SCOPES = ["read", "apply", "review", "sop", "contents", "webhooks", "admin"]


def upgrade() -> None:
    op.add_column("api_keys", sa.Column("scopes", sa.JSON(), nullable=False,
                                        server_default=json.dumps(ALL_SCOPES)))


def downgrade() -> None:
    op.drop_column("api_keys", "scopes")
