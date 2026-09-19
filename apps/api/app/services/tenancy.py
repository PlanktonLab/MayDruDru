"""匿名端點的 tenant 歸屬（決策 D18）。

`/api/apply/*` 沒有登入、也沒有 API key，所以請求裡沒有任何 tenant 資訊。MayDru 的
部署形態是「一個機關一套」，因此匿名流量一律歸給**預設 tenant**：`slug="default"`，
找不到就取建立時間最早的那一個。

之所以不用網域或 header 判斷：那會讓「送件到哪個機關」變成一個可以被偽造的輸入。
SaaS 化時這裡換成一張網域對照表即可，呼叫端不必動。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Tenant

__all__ = ["DEFAULT_TENANT_SLUG", "default_tenant_id"]

DEFAULT_TENANT_SLUG = "default"


async def default_tenant_id(db: AsyncSession) -> str:
    """匿名流量歸屬的 tenant。一個 tenant 都沒有時回空字串（查詢自然不會命中）。"""
    preferred = (
        await db.execute(select(Tenant.id).where(Tenant.slug == DEFAULT_TENANT_SLUG).limit(1))
    ).scalar_one_or_none()
    if preferred:
        return str(preferred)
    first = (
        await db.execute(select(Tenant.id).order_by(Tenant.created_at, Tenant.id).limit(1))
    ).scalar_one_or_none()
    return str(first or "")
