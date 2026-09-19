"""`/api/admin/faqs` 與 `/api/admin/knowledge`：常見問題與知識文件（SPEC §8.6）。

兩張表的生命週期一樣（承辦人寫、LINE 與網頁讀），所以放同一個模組、同一組規則：
讀給任何登入者，寫要 `admin`。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ...db import get_db
from ...deps import CurrentUser, current_user, require_cap
from ...services import faq as faq_service
from ...services import knowledge as knowledge_service
from ...services.actors import Actor

router = APIRouter(prefix="/api/admin", tags=["admin-faqs"])


class FaqIn(BaseModel):
    code: str = ""
    category: str = ""
    question: str
    answer: str = ""
    keywords: list[str] = []
    priority: int = 0
    active: bool = True
    scheme_id: str | None = None
    source: str = "manual"
    expected_version: int | None = None


class ActiveIn(BaseModel):
    active: bool


class DocumentIn(BaseModel):
    code: str = ""
    title: str
    content: str = ""
    source_url: str = ""
    source_type: str = "manual"
    tags: list[str] = []
    scheme_id: str | None = None
    expected_version: int | None = None


def _faq_out(row: Any) -> dict[str, Any]:
    return {
        "id": row.id, "code": row.code, "category": row.category, "question": row.question,
        "answer": row.answer, "keywords": list(row.keywords or []), "priority": row.priority,
        "active": row.active, "scheme_id": row.scheme_id, "source": row.source, "version": row.version,
        "updated_at": row.updated_at,
    }


def _document_out(row: Any) -> dict[str, Any]:
    return {
        "id": row.id, "code": row.code, "title": row.title, "content": row.content,
        "source_url": row.source_url, "source_type": row.source_type, "tags": list(row.tags or []),
        "scheme_id": row.scheme_id, "version": row.version, "updated_at": row.updated_at,
    }


# --------------------------------------------------------------------- FAQ

@router.get("/faqs")
async def list_faqs(
    category: str | None = None,
    q: str | None = None,
    active_only: bool = False,
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    rows = await faq_service.list_faqs(db, user.tenant_id, category=category, q=q, active_only=active_only)
    return {"items": [_faq_out(r) for r in rows], "categories": await faq_service.categories(db, user.tenant_id)}


@router.post("/faqs", status_code=201)
async def create_faq(
    body: FaqIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = await faq_service.create(db, user.tenant_id, body.model_dump(exclude={"expected_version"}),
                                   actor=Actor.staff(user))
    await db.commit()
    return _faq_out(row)


@router.put("/faqs/{faq_id}")
async def update_faq(
    faq_id: str,
    body: FaqIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = await faq_service.update(
        db, user.tenant_id, faq_id, body.model_dump(exclude={"expected_version"}),
        actor=Actor.staff(user), expected_version=body.expected_version,
    )
    await db.commit()
    return _faq_out(row)


@router.post("/faqs/{faq_id}/status")
async def set_faq_status(
    faq_id: str,
    body: ActiveIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = await faq_service.set_active(db, user.tenant_id, faq_id, body.active, actor=Actor.staff(user))
    await db.commit()
    return _faq_out(row)


@router.delete("/faqs/{faq_id}", status_code=204)
async def delete_faq(
    faq_id: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await faq_service.delete(db, user.tenant_id, faq_id, actor=Actor.staff(user))
    await db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- 知識文件

@router.get("/knowledge")
async def list_documents(
    q: str | None = None,
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    rows = await knowledge_service.list_documents(db, user.tenant_id, q=q)
    return {"items": [_document_out(r) for r in rows]}


@router.post("/knowledge", status_code=201)
async def create_document(
    body: DocumentIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = await knowledge_service.create_document(
        db, user.tenant_id, body.model_dump(exclude={"expected_version"}), actor=Actor.staff(user)
    )
    await db.commit()
    return _document_out(row)


@router.get("/knowledge/{document_id}")
async def get_document(
    document_id: str,
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return _document_out(await knowledge_service.get_document(db, user.tenant_id, document_id))


@router.put("/knowledge/{document_id}")
async def update_document(
    document_id: str,
    body: DocumentIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = await knowledge_service.update_document(
        db, user.tenant_id, document_id, body.model_dump(exclude={"expected_version"}),
        actor=Actor.staff(user), expected_version=body.expected_version,
    )
    await db.commit()
    return _document_out(row)


@router.delete("/knowledge/{document_id}", status_code=204)
async def delete_document(
    document_id: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await knowledge_service.delete_document(db, user.tenant_id, document_id, actor=Actor.staff(user))
    await db.commit()
    return Response(status_code=204)
