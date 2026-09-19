"""`/api/admin/schemes/{code}/document-types/{dt_code}/sop-flows`（SPEC §8.2「文件類型對照」）。

承辦人在後台把「這個方案的這一份文件」接到「這幾條 SOP 流程」。一份文件在不同
平台有不同的拿法，所以一列對照是一組 `(flow_id, platform_id)`。

刻意獨立成一個 router 而不是塞進 `admin/schemes.py`：那個檔案的 `/{code}/{kind}`
是吃任意子設定表的通用殼，對照表需要的是「依 code 定位文件類型、整批取代」的
語意，混在一起只會讓兩邊都變難讀。路徑段數不同（這裡是四段），不會互相搶路由。

PUT 是**整批取代**：前端送的是「現在勾選的全部」，不是差異。逐列比對而不是全刪
再全建，主鍵才不會每存一次就換一次，稽核日誌也才對得上同一列。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...db import get_db
from ...deps import CurrentUser, require_cap
from ...services import audit, sop_links
from ...services import scheme as scheme_service
from ...services.actors import Actor

router = APIRouter(prefix="/api/admin/schemes", tags=["admin-schemes"])

DOCUMENT_TYPE_NOT_FOUND = "找不到此文件類型"


class SopFlowLinkIn(BaseModel):
    flow_id: str
    platform_id: str


class SopFlowLinksIn(BaseModel):
    links: list[SopFlowLinkIn] = Field(default_factory=list)


def _out(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "document_type_id": row.document_type_id,
        "flow_id": row.flow_id,
        "platform_id": row.platform_id,
        "sort_order": row.sort_order,
    }


async def _document_type(db: AsyncSession, tenant_id: str, code: str, dt_code: str) -> Any:
    scheme = await scheme_service.get_scheme(db, tenant_id, code)
    found = scheme_service.document_type_of(scheme, dt_code)
    if found is None:
        raise HTTPException(404, DOCUMENT_TYPE_NOT_FOUND)
    return found


@router.get("/{code}/document-types/{dt_code}/sop-flows")
async def list_sop_flows(
    code: str,
    dt_code: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    document_type = await _document_type(db, user.tenant_id, code, dt_code)
    rows = await sop_links.links_for_document_type(db, user.tenant_id, document_type.id)
    return [_out(r) for r in rows]


@router.put("/{code}/document-types/{dt_code}/sop-flows")
async def put_sop_flows(
    code: str,
    dt_code: str,
    body: SopFlowLinksIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    document_type = await _document_type(db, user.tenant_id, code, dt_code)
    rows = await sop_links.replace_links(
        db, user.tenant_id, document_type, [link.model_dump() for link in body.links]
    )
    await audit.log(
        db, Actor.staff(user), "update", "document_type_sop_flows", document_type.id,
        {"scheme": code, "document_type": dt_code, "count": len(rows)}, tenant_id=user.tenant_id,
    )
    await db.commit()
    return [_out(r) for r in rows]
