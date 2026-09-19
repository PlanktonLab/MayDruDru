"""platform_components

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_components",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("tenant_id", sa.String(32), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform_id", sa.String(32), sa.ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="other"),
        sa.Column("html", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("height", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("thumb_key", sa.String(300), nullable=True),
        sa.Column("created_by", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_platform_components_tenant_id", "platform_components", ["tenant_id"])
    op.create_index("ix_platform_components_platform_id", "platform_components", ["platform_id"])


def downgrade() -> None:
    op.drop_index("ix_platform_components_platform_id", table_name="platform_components")
    op.drop_index("ix_platform_components_tenant_id", table_name="platform_components")
    op.drop_table("platform_components")
