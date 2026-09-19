"""`/api/admin/media`：文案與圖文選單用得到的公開圖檔（SPEC §6.4）。

只收圖、只進 public bucket。**證明文件不走這裡**——那是 private bucket 與
presigned URL 的世界（SPEC §11），兩條路刻意連端點都不共用。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from ...db import get_db
from ...deps import CurrentUser, current_user, require_cap
from ...services import knowledge as knowledge_service
from ...services.actors import Actor
from ...storage import public_url

router = APIRouter(prefix="/api/admin/media", tags=["admin-media"])


def _out(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "key": row.key,
        "url": public_url(row.key),
        "mime": row.mime,
        "size": row.size,
        "alt": row.alt,
        "uploaded_by": row.uploaded_by,
        "created_at": row.created_at,
    }


@router.get("")
async def list_media(
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return {"items": [_out(r) for r in await knowledge_service.list_media(db, user.tenant_id)]}


@router.post("", status_code=201)
async def upload(
    file: UploadFile = File(...),
    alt: str = Form(default=""),
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    data = await file.read()
    row = await knowledge_service.upload_media(
        db, user.tenant_id, data=data, mime=file.content_type or "", alt=alt, actor=Actor.staff(user)
    )
    await db.commit()
    return _out(row)


@router.delete("/{media_id}", status_code=204)
async def delete(
    media_id: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await knowledge_service.delete_media(db, user.tenant_id, media_id, actor=Actor.staff(user))
    await db.commit()
    return Response(status_code=204)
