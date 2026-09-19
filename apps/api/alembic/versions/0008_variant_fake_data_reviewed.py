"""variants.fake_data_reviewed

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Replicas made before this feature carry an unstructured report and are
    # already past review, so they start acknowledged and never raise a notice.
    op.add_column("variants", sa.Column("fake_data_reviewed", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.alter_column("variants", "fake_data_reviewed", server_default=sa.false())


def downgrade() -> None:
    op.drop_column("variants", "fake_data_reviewed")
