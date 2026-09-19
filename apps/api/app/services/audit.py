"""稽核日誌（SPEC §11：所有 admin 寫入都留一列）。

`diff` 只放欄位的前後值，不複製整筆案件——稽核表不該變成案件資料的第二份副本
（youth-line-bot 的作法，連案號都是遮蔽過的）。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog
from .actors import Actor

__all__ = ["diff_of", "list_logs", "log"]


async def list_logs(
    db: AsyncSession, tenant_id: str, *, action: str = "", target_type: str = "",
    actor: str = "", offset: int = 0, limit: int = 50,
) -> tuple[list[AuditLog], int]:
    where = [AuditLog.tenant_id == tenant_id]
    if action:
        where.append(AuditLog.action == action)
    if target_type:
        where.append(AuditLog.target_type == target_type)
    if actor:
        where.append(func.lower(AuditLog.actor_name).like(f"%{actor.strip().lower()}%"))
    total = int((await db.execute(select(func.count(AuditLog.id)).where(*where))).scalar_one())
    rows = (await db.execute(select(AuditLog).where(*where).order_by(
        AuditLog.created_at.desc(), AuditLog.id.desc(),
    ).offset(offset).limit(limit))).scalars().all()
    return list(rows), total


async def log(
    db: AsyncSession,
    actor: Actor | None,
    action: str,
    target_type: str,
    target_id: str,
    diff: dict[str, Any] | None = None,
    *,
    tenant_id: str = "",
) -> AuditLog:
    """寫一列稽核。不 commit——由呼叫端的交易決定什麼時候落地。"""
    row = AuditLog(
        tenant_id=tenant_id,
        actor_id=actor.id if actor else None,
        actor_name=actor.name if actor else "",
        action=action,
        target_type=target_type,
        target_id=target_id,
        diff=diff or {},
    )
    db.add(row)
    return row


def diff_of(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """只留真的變了的欄位，格式 `{欄位: {"from": 舊, "to": 新}}`。"""
    out: dict[str, Any] = {}
    for key, new in after.items():
        old = before.get(key)
        if old != new:
            out[key] = {"from": old, "to": new}
    return out
