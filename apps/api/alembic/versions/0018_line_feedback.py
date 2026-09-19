"""LINE Demo 回饋

Revision ID: 0018
Revises: 0017
"""

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "line_feedback",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", sa.String(length=32), nullable=False),
        sa.Column("application_id", sa.String(length=32), nullable=True),
        sa.Column("line_user_id_hash", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("context", sa.String(length=40), nullable=False, server_default="general"),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_line_feedback_tenant_id", "line_feedback", ["tenant_id"])
    op.create_index("ix_line_feedback_application_id", "line_feedback", ["application_id"])
    op.create_index("ix_line_feedback_context", "line_feedback", ["context"])
    op.create_index("ix_line_feedback_created_at", "line_feedback", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_line_feedback_created_at", table_name="line_feedback")
    op.drop_index("ix_line_feedback_context", table_name="line_feedback")
    op.drop_index("ix_line_feedback_application_id", table_name="line_feedback")
    op.drop_index("ix_line_feedback_tenant_id", table_name="line_feedback")
    op.drop_table("line_feedback")
