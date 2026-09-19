"""variants.prompt_notes

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("variants", sa.Column("prompt_notes", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("variants", "prompt_notes")
