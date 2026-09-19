"""platforms.demo_data

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("platforms", sa.Column("demo_data", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))
    op.alter_column("platforms", "demo_data", server_default=None)


def downgrade() -> None:
    op.drop_column("platforms", "demo_data")
