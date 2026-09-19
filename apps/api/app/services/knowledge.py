"""知識文件與媒體（SPEC §6.4 / §8.6）。

知識文件是內容助理 (b) 回答時唯一能引用的依據之一（另外兩個是 `schemes` 與既有
`contents`），所以這裡只做最樸素的 CRUD：搬進來、改、刪。向量欄位留著給 P4，
這一階段不算 embedding。

媒體是圖文選單與文案裡用得到的公開圖檔。一律進 public bucket 的 `media/` 前綴，
檔名用內容雜湊——猜不到、可以長快取、同一張圖上傳兩次不會存兩份。
證明文件**不走這裡**（那是 private bucket，SPEC §11）。
"""

from __future__ import annotations

import asyncio
import hashlib
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..config import get_settings
from ..models import KnowledgeDocument, Media
from . import audit
from .actors import Actor
from .versioning import bump, check_version

__all__ = [
    "ALLOWED_MEDIA_MIME",
    "DOCUMENT_NOT_FOUND",
    "MEDIA_NOT_FOUND",
    "MEDIA_PREFIX",
    "create_document",
    "delete_document",
    "delete_media",
    "get_document",
    "list_documents",
    "list_media",
    "update_document",
    "upload_media",
]

DOCUMENT_NOT_FOUND = "找不到這份知識文件"
MEDIA_NOT_FOUND = "找不到這個媒體檔案"
MEDIA_PREFIX = "media/"
ALLOWED_MEDIA_MIME = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


# --------------------------------------------------------------- 知識文件

async def list_documents(
    db: AsyncSession, tenant_id: str, *, q: str | None = None, limit: int = 200
) -> list[KnowledgeDocument]:
    rows = (
        await db.execute(
            select(KnowledgeDocument)
            .where(KnowledgeDocument.tenant_id == tenant_id)
            .order_by(KnowledgeDocument.updated_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in r.title.lower() or needle in (r.content or "").lower()]
    return list(rows)


async def get_document(db: AsyncSession, tenant_id: str, document_id: str) -> KnowledgeDocument:
    row = (
        await db.execute(
            select(KnowledgeDocument).where(
                KnowledgeDocument.tenant_id == tenant_id, KnowledgeDocument.id == document_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, DOCUMENT_NOT_FOUND)
    return row


async def create_document(
    db: AsyncSession, tenant_id: str, payload: dict[str, Any], *, actor: Actor | None = None
) -> KnowledgeDocument:
    row = KnowledgeDocument(tenant_id=tenant_id, title=str(payload.get("title", "")).strip())
    _apply_document(row, payload)
    db.add(row)
    await db.flush()
    await audit.log(db, actor, "create", "knowledge_document", row.id, {"title": row.title}, tenant_id=tenant_id)
    return row


async def update_document(
    db: AsyncSession,
    tenant_id: str,
    document_id: str,
    payload: dict[str, Any],
    *,
    actor: Actor | None = None,
    expected_version: int | None = None,
) -> KnowledgeDocument:
    row = await get_document(db, tenant_id, document_id)
    check_version(row, expected_version)
    before = {"title": row.title, "content": row.content}
    _apply_document(row, payload)
    bump(row)
    await db.flush()
    await audit.log(
        db, actor, "update", "knowledge_document", row.id,
        audit.diff_of(before, {"title": row.title, "content": row.content}), tenant_id=tenant_id,
    )
    return row


async def delete_document(
    db: AsyncSession, tenant_id: str, document_id: str, *, actor: Actor | None = None
) -> None:
    row = await get_document(db, tenant_id, document_id)
    await db.delete(row)
    await audit.log(db, actor, "delete", "knowledge_document", document_id, {"title": row.title}, tenant_id=tenant_id)
    await db.flush()


_DOCUMENT_FIELDS = ("code", "title", "content", "source_url", "source_type", "tags", "scheme_id")


def _apply_document(row: KnowledgeDocument, payload: dict[str, Any]) -> None:
    for name in _DOCUMENT_FIELDS:
        if name in payload:
            setattr(row, name, payload[name])


# ------------------------------------------------------------------- 媒體

async def upload_media(
    db: AsyncSession,
    tenant_id: str,
    *,
    data: bytes,
    mime: str,
    alt: str = "",
    actor: Actor | None = None,
) -> Media:
    """上傳一張公開圖。同一份內容重複上傳只會得到同一個 key。"""
    ext = ALLOWED_MEDIA_MIME.get(mime)
    if ext is None:
        raise HTTPException(400, "只接受 PNG、JPEG 或 WebP 圖片")
    limit = get_settings().max_upload_bytes
    if len(data) > limit:
        raise HTTPException(413, "檔案太大")
    key = f"{MEDIA_PREFIX}{tenant_id}/{hashlib.sha256(data).hexdigest()}.{ext}"
    await asyncio.to_thread(storage.put, get_settings().s3_bucket_public, key, data, mime)
    row = (
        await db.execute(select(Media).where(Media.tenant_id == tenant_id, Media.key == key))
    ).scalar_one_or_none()
    if row is None:
        row = Media(tenant_id=tenant_id, key=key)
        db.add(row)
    row.mime = mime
    row.size = len(data)
    row.alt = alt
    row.uploaded_by = actor.id if actor else None
    await db.flush()
    await audit.log(db, actor, "upload", "media", row.id, {"key": key, "size": len(data)}, tenant_id=tenant_id)
    return row


async def list_media(db: AsyncSession, tenant_id: str, *, limit: int = 200) -> list[Media]:
    rows = (
        await db.execute(
            select(Media).where(Media.tenant_id == tenant_id).order_by(Media.created_at.desc()).limit(limit)
        )
    ).scalars().all()
    return list(rows)


async def delete_media(db: AsyncSession, tenant_id: str, media_id: str, *, actor: Actor | None = None) -> None:
    """先刪物件再刪列：反過來會留下一個沒人記得、也沒人刪得掉的檔案。"""
    row = (
        await db.execute(select(Media).where(Media.tenant_id == tenant_id, Media.id == media_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, MEDIA_NOT_FOUND)
    try:
        await asyncio.to_thread(storage.delete, get_settings().s3_bucket_public, row.key)
    except Exception:
        raise HTTPException(502, "刪除檔案失敗，請稍後再試")
    await db.delete(row)
    await audit.log(db, actor, "delete", "media", media_id, {"key": row.key}, tenant_id=tenant_id)
    await db.flush()
