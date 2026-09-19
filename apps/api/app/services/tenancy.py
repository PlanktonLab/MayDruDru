"""tenant 歸屬與首位管理者的判斷（決策 D18、D26）。

`/api/apply/*` 沒有登入、也沒有 API key，所以請求裡沒有任何 tenant 資訊。MayDru 的
部署形態是「一個機關一套」，因此匿名流量一律歸給**預設 tenant**：`slug="default"`，
找不到就取建立時間最早的那一個。

之所以不用網域或 header 判斷：那會讓「送件到哪個機關」變成一個可以被偽造的輸入。
SaaS 化時這裡換成一張網域對照表即可，呼叫端不必動。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Tenant, User

__all__ = ["DEFAULT_TENANT_SLUG", "default_tenant_id", "default_tenant", "needs_bootstrap"]

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


async def default_tenant(db: AsyncSession) -> Tenant | None:
    """`default_tenant_id()` 指的那一個 tenant 本身。"""
    tenant_id = await default_tenant_id(db)
    return await db.get(Tenant, tenant_id) if tenant_id else None


async def needs_bootstrap(db: AsyncSession) -> bool:
    """這台機器還沒有人能登入嗎？（決策 D26）

    閘門看的是「有沒有一個還在用的 owner」，不是「有沒有 tenant」。`scripts/seed.py`
    會先把機關與方案灌進去，tenant 因此在第一個人註冊之前就存在了——用 tenant 數量
    當閘門，會讓一台**零使用者**的機器自稱已初始化，誰都進不去，也沒有補救的路。
    """
    owner = (
        await db.execute(
            select(User.id).where(User.role == "owner", User.is_active.is_(True)).limit(1)
        )
    ).scalar_one_or_none()
    return owner is None
