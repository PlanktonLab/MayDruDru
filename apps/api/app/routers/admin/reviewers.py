"""`/api/admin/reviewers`：可以被指派案件的人（SPEC §8.2「指派」）。

名單不是「所有同事」，而是**這個機關裡帶得到 `case_review` 或 `case_supervise` 的
啟用帳號**——指派給一個按不動任何按鈕的人，等於把案件丟進黑洞。角色與 capability
的對照在 `deps.ROLE_CAPS`（決策 D14），這裡只反查，不自己列角色名。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...db import get_db
from ...deps import CurrentUser, require_cap, roles_with_any_cap
from ...models import User
from .schemas import StaffOut

router = APIRouter(prefix="/api/admin/reviewers", tags=["admin-applications"])

ASSIGNABLE_CAPS = ("case_review", "case_supervise")


@router.get("", response_model=list[StaffOut])
async def list_reviewers(
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> list[StaffOut]:
    """指派選單的選項。停用的帳號不出現——停用就是「不要再派給他」。"""
    rows = (
        await db.execute(
            select(User)
            .where(
                User.tenant_id == user.tenant_id,
                User.is_active.is_(True),
                User.role.in_(roles_with_any_cap(*ASSIGNABLE_CAPS)),
            )
            .order_by(User.name, User.email)
        )
    ).scalars().all()
    return [StaffOut(id=u.id, name=u.name or u.email, email=u.email, role=u.role) for u in rows]


__all__ = ["router"]
