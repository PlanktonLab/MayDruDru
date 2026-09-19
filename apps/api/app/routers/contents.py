"""`/api/contents`：已發布文案的公開讀取（SPEC §10.2）。

apply-web 的每一頁都需要幾段文字（狀態說明、退件說明、上傳提醒），與其把它們
複製進前端，不如讓前端指名要哪幾個 key。匿名可讀，因為這些字本來就是要給民眾看的；
草稿不會出現在這裡，只有已發布的版本。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..content_registry import keys_in_category
from ..db import get_db
from ..models import Tenant
from ..services import contents as contents_service

router = APIRouter(prefix="/api/contents", tags=["contents"])

MAX_KEYS = 100


@router.get("")
async def get_contents(
    keys: str | None = Query(default=None, description="逗號分隔的 content key"),
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id = (await db.execute(select(Tenant.id).order_by(Tenant.created_at))).scalars().first() or ""
    wanted: list[str] = []
    if keys:
        wanted = [k.strip() for k in keys.split(",") if k.strip()][:MAX_KEYS]
    elif category:
        wanted = list(keys_in_category(category))
    return {"items": {key: await contents_service.t(db, tenant_id, key) for key in wanted}}


@router.post("/render")
async def render(body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """key + 變數 → 文字或 Flex（SPEC §10.1 的 `/v1/contents/render` 同一個 service）。"""
    tenant_id = (await db.execute(select(Tenant.id).order_by(Tenant.created_at))).scalars().first() or ""
    return await contents_service.render(db, tenant_id, str(body.get("key", "")), body.get("variables") or {})
