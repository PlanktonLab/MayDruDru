"""內容助理的建議表（SPEC §8.6 b）

Revision ID: 0015
Revises: 0014

「採用建議」是第二次呼叫，需要一個穩定的 id；重跑聚類不保證得到同一批建議，
所以產出當下就落地一列。樣本句在寫進來之前已經去識別化（services/copilot.py）。
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "copilot_suggestions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("tenant_id", sa.String(32), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False, server_default="faq"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(32), nullable=True),
        sa.Column("resolved_by", sa.String(32), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("target_id", sa.String(32), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_copilot_suggestions_tenant_id", "copilot_suggestions", ["tenant_id"])
    op.create_index("ix_copilot_suggestions_kind", "copilot_suggestions", ["kind"])
    op.create_index("ix_copilot_suggestions_status", "copilot_suggestions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_copilot_suggestions_status", table_name="copilot_suggestions")
    op.drop_index("ix_copilot_suggestions_kind", table_name="copilot_suggestions")
    op.drop_index("ix_copilot_suggestions_tenant_id", table_name="copilot_suggestions")
    op.drop_table("copilot_suggestions")
