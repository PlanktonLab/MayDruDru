"""Preserve billing facts and independent document periods (D37)."""
import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("eligible_tools", sa.Column("inquiry_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("applications", sa.Column("billing_cycle", sa.String(10), nullable=False, server_default="MONTHLY"))
    op.add_column("applications", sa.Column("billing_periods", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("applications", sa.Column("original_currency", sa.String(3), nullable=False, server_default="TWD"))
    op.add_column("applications", sa.Column("original_amount", sa.Float(), nullable=True))
    op.add_column("application_documents", sa.Column("period_index", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    op.drop_column("eligible_tools", "inquiry_count")
    op.drop_column("application_documents", "period_index")
    for column in ("original_amount", "original_currency", "billing_periods", "billing_cycle"):
        op.drop_column("applications", column)
