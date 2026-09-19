"""申請人完整身分證字號（加密保存，SPEC §11／D40）

Revision ID: 0017
Revises: 0016

既有案件沒有這一欄的資料，也補不回來（原本就沒有存過完整號碼），
所以只加欄位、預設空字串，不做任何回填。
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "applications",
        sa.Column("id_number_encrypted", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("applications", "id_number_encrypted")
