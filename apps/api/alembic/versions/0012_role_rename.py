"""角色改名：editor → sop_editor、reviewer → sop_reviewer（決策 D14）

Revision ID: 0012
Revises: 0011

SOP_Tutor 的四個角色只描述 SOP 製作。MayDru 多了案件審核這條線，所以角色
名稱要先說清楚自己管的是哪一邊；`viewer`、`admin`、`owner` 名稱不變。
新增的 case_reviewer / case_supervisor 由管理者自己指派，這裡不猜。
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

RENAMES = (("editor", "sop_editor"), ("reviewer", "sop_reviewer"))


def upgrade() -> None:
    users = sa.table("users", sa.column("role", sa.String))
    for old, new in RENAMES:
        op.execute(users.update().where(users.c.role == op.inline_literal(old)).values(role=new))


def downgrade() -> None:
    users = sa.table("users", sa.column("role", sa.String))
    for old, new in RENAMES:
        op.execute(users.update().where(users.c.role == op.inline_literal(new)).values(role=old))
    # 降版沒有舊名稱可以對應的新角色，一律退回最低權限，不讓任何帳號因為降版而變大。
    op.execute(
        users.update()
        .where(users.c.role.in_([op.inline_literal("case_reviewer"), op.inline_literal("case_supervisor")]))
        .values(role="viewer")
    )
