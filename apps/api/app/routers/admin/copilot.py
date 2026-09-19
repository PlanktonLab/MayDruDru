"""`/api/admin/copilot`：內容助理（SPEC §8.2 / §8.6 / §9.6）。

薄殼：收參數、叫 `services/copilot.py`、commit、回序列化結果。三支端點全部要
`admin`——助理寫的是要發布給民眾的字的草稿，讀得到它就等於看得到機關下一步要說
什麼，這不是每個登入者都該有的視野。

助理只寫 draft。這個模組沒有任何一條路徑通往「發布」，發布走
`POST /api/admin/contents/{key}/publish`，由人按（決策 D8）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...db import get_db
from ...deps import CurrentUser, require_cap
from ...services import copilot as copilot_service
from ...services.actors import Actor

router = APIRouter(prefix="/api/admin/copilot", tags=["admin-copilot"])


class ContentDraftIn(BaseModel):
    instruction: str = Field(default="", max_length=500)
    tone: str = Field(default="", max_length=100)


class SuggestIn(BaseModel):
    limit: int = Field(default=8, ge=1, le=20)


@router.post("/contents/{key}/draft")
async def draft_content(
    key: str,
    body: ContentDraftIn | None = None,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """助理 (a)：依這個 key 的說明、語氣與變數產生草稿，只寫 `contents.draft`。"""
    payload = body or ContentDraftIn()
    result = await copilot_service.draft_content(
        db, user.tenant_id, key,
        instruction=payload.instruction, tone=payload.tone, actor=Actor.staff(user),
    )
    await db.commit()
    return result


@router.get("/faq-suggestions")
async def list_faq_suggestions(
    status: str = "pending",
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return {"items": await copilot_service.list_suggestions(db, user.tenant_id, status=status)}


@router.post("/faq-suggestions")
async def generate_faq_suggestions(
    body: SuggestIn | None = None,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """助理 (b)：把未命中訊息聚類，每一群請模型寫一則 FAQ 建議。"""
    payload = body or SuggestIn()
    items = await copilot_service.faq_suggestions(
        db, user.tenant_id, limit=payload.limit, actor=Actor.staff(user)
    )
    await db.commit()
    return {"items": items}


@router.post("/faq-suggestions/{suggestion_id}/accept", status_code=201)
async def accept_faq_suggestion(
    suggestion_id: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """採用建議：建出一則**停用中**的 FAQ（`source=copilot`），等承辦人員改完再啟用。"""
    row = await copilot_service.accept_faq_suggestion(
        db, user.tenant_id, suggestion_id, actor=Actor.staff(user)
    )
    await db.commit()
    return {"id": row.id, "question": row.question, "answer": row.answer,
            "active": row.active, "source": row.source, "version": row.version}


@router.post("/faq-suggestions/{suggestion_id}/dismiss")
async def dismiss_faq_suggestion(
    suggestion_id: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = await copilot_service.dismiss_faq_suggestion(
        db, user.tenant_id, suggestion_id, actor=Actor.staff(user)
    )
    await db.commit()
    return {"id": row.id, "status": row.status}


@router.post("/schemes/{code}/drafts")
async def scheme_drafts(
    code: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """助理 (c)：依方案設定一次產出整套對外文案的草稿（狀態、退件說明、文件指引）。"""
    result = await copilot_service.scheme_drafts(db, user.tenant_id, code, actor=Actor.staff(user))
    await db.commit()
    return result
