"""`/api/admin/contents`：罐頭訊息的列表、草稿、發布、還原與預覽（SPEC §8.2 / §8.6）。

讀取任何登入的承辦人都可以（要知道民眾看到什麼才審得了案），寫入要 `admin`
——發布是對外說話，不該是每個人都能按的按鈕。

樂觀鎖：帶 `expected_version` 就檢查，對不上由 service 丟 409。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...db import get_db
from ...deps import CurrentUser, current_user, require_cap
from ...services import contents as contents_service
from ...services.actors import Actor

router = APIRouter(prefix="/api/admin/contents", tags=["admin-contents"])


class DraftIn(BaseModel):
    draft: str = ""
    expected_version: int | None = None


class PublishIn(BaseModel):
    content: str | None = None          # None = 發布目前的草稿
    expected_version: int | None = None


class ResetIn(BaseModel):
    expected_version: int | None = None


class PreviewIn(BaseModel):
    key: str = Field(min_length=1)
    text: str | None = None


@router.get("")
async def list_contents(
    category: str | None = None,
    q: str | None = None,
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    views = await contents_service.list_contents(db, user.tenant_id, category=category, q=q)
    await db.commit()
    return {
        "items": [v.dict() for v in views],
        "categories": contents_service.categories(),
        "stats": await contents_service.stats(db, user.tenant_id),
    }


@router.get("/categories")
async def categories(user: CurrentUser = Depends(current_user)) -> list[dict[str, Any]]:
    return contents_service.categories()


@router.post("/preview")
async def preview(
    body: PreviewIn,
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await contents_service.preview(db, user.tenant_id, body.key, body.text)


@router.get("/{key}")
async def get_content(
    key: str,
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """讀取時補列（youth-line-bot 也是）：沒有 `version` 就鎖不住第一次編輯。"""
    await contents_service.get_or_create(db, user.tenant_id, key)
    await db.commit()
    views = await contents_service.list_contents(db, user.tenant_id)
    await db.commit()
    return next(v.dict() for v in views if v.key == key)


@router.put("/{key}")
async def save_draft(
    key: str,
    body: DraftIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    view = await contents_service.save_draft(
        db, user.tenant_id, key, body.draft, actor=Actor.staff(user), expected_version=body.expected_version
    )
    await db.commit()
    return view.dict()


@router.post("/{key}/publish")
async def publish(
    key: str,
    body: PublishIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    actor = Actor.staff(user)
    if body.content is None:
        view = await contents_service.publish_draft(
            db, user.tenant_id, key, actor=actor, expected_version=body.expected_version
        )
    else:
        view = await contents_service.publish(
            db, user.tenant_id, key, body.content, actor=actor, expected_version=body.expected_version
        )
    await db.commit()
    return view.dict()


@router.post("/{key}/reset")
async def reset(
    key: str,
    body: ResetIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    view = await contents_service.reset(
        db, user.tenant_id, key, actor=Actor.staff(user), expected_version=body.expected_version
    )
    await db.commit()
    return view.dict()
