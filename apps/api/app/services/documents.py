"""證明文件的存放、驗證、預覽與清除（SPEC §6.3 / §8.1 / §11）。

三條硬規則決定了這個模組的形狀：
1. 檔案只進 **private bucket**，任何人都只能透過 5 分鐘的 presigned URL 看到它。
2. 檔案**永不**送 LLM；這裡只做 Pillow 的縮圖，沒有任何模型呼叫。
3. 終態滿保存期限後硬刪影像與 OCR，申請主檔與事件永遠留著（`purge` 系列）。

key 規則（決策 D18）：`applications/{tenant}/{case_no}/{doc_type}/{revision}.{ext}`，
預覽圖同目錄下的 `{revision}-preview.jpg`。案號本身就是命名空間，所以同一件案子的
所有版本都在一個 prefix 底下，人工稽核與整案刪除都只要一個前綴。
"""

from __future__ import annotations

import asyncio
import io
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..config import get_settings
from ..models import Application, ApplicationDocument, DocumentOcrResult, DocumentType

log = logging.getLogger("maydru.documents")

__all__ = [
    "DEFAULT_ACCEPTED_MIME",
    "MIME_EXTENSIONS",
    "PRESIGNED_SECONDS",
    "PREVIEW_MAX_EDGE",
    "DocumentRejected",
    "StoredUpload",
    "delete_objects",
    "delete_ocr",
    "make_preview",
    "next_revision",
    "object_key",
    "presigned_url",
    "preview_key",
    "store_upload",
    "validate_upload",
    "write_ocr",
]

# SPEC §8.1：JPEG / PNG / PDF。`document_types.accepted_mime` 可以再縮，但不能再放寬。
DEFAULT_ACCEPTED_MIME = ("image/jpeg", "image/png", "application/pdf")
MIME_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
}
PREVIEW_MAX_EDGE = 1200
PRESIGNED_SECONDS = 5 * 60      # SPEC §11：presigned URL 5 分鐘

# 錯誤代碼（回給前端的是代碼，文案由 contents 渲染——CLAUDE.md 規則 4）。
MIME_NOT_ACCEPTED = "MIME_NOT_ACCEPTED"
FILE_TOO_LARGE = "FILE_TOO_LARGE"
TOO_MANY_PAGES = "TOO_MANY_PAGES"
EMPTY_FILE = "EMPTY_FILE"
UNKNOWN_DOCUMENT_TYPE = "UNKNOWN_DOCUMENT_TYPE"


class DocumentRejected(Exception):
    """上傳被擋下來。`code` 是給前端對照的代碼，`status` 是對應的 HTTP 狀態。"""

    def __init__(self, code: str, *, status: int = 400, document_type_code: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.document_type_code = document_type_code


@dataclass(frozen=True)
class StoredUpload:
    """一份存好的檔案。給 `services/application.py` 的文件列用的 spec。"""

    document_type_code: str
    object_key: str
    preview_key: str | None
    mime: str
    size: int
    page_count: int
    masked: bool
    revision: int

    def as_spec(self) -> dict[str, Any]:
        return {
            "document_type_code": self.document_type_code,
            "object_key": self.object_key,
            "preview_key": self.preview_key,
            "mime": self.mime,
            "size": self.size,
            "page_count": self.page_count,
            "masked": self.masked,
            "revision": self.revision,
        }


# ------------------------------------------------------------------ key 規則

def _prefix(tenant_id: str, case_no: str, document_type_code: str) -> str:
    return f"applications/{tenant_id}/{case_no}/{document_type_code}"


def object_key(tenant_id: str, case_no: str, document_type_code: str, revision: int, ext: str) -> str:
    return f"{_prefix(tenant_id, case_no, document_type_code)}/{revision}.{ext}"


def preview_key(tenant_id: str, case_no: str, document_type_code: str, revision: int) -> str:
    return f"{_prefix(tenant_id, case_no, document_type_code)}/{revision}-preview.jpg"


# ------------------------------------------------------------------- 驗證

def validate_upload(
    document_type: DocumentType | None,
    *,
    mime: str,
    size: int,
    page_count: int,
    document_type_code: str = "",
) -> str:
    """檢查 mime / 大小 / 頁數，回傳副檔名。不合格就丟 `DocumentRejected`。

    檔案大小的上限是 `MAX_UPLOAD_BYTES`（預設 20 MB），超過回 413——這是 HTTP
    自己就有的語意，不需要另外發明一個代碼。
    """
    code = document_type.code if document_type is not None else document_type_code
    if document_type is None:
        raise DocumentRejected(UNKNOWN_DOCUMENT_TYPE, document_type_code=code)

    normalized = (mime or "").split(";")[0].strip().lower()
    accepted = tuple(document_type.accepted_mime or ()) or DEFAULT_ACCEPTED_MIME
    if normalized not in accepted or normalized not in MIME_EXTENSIONS:
        raise DocumentRejected(MIME_NOT_ACCEPTED, document_type_code=code)

    if size <= 0:
        raise DocumentRejected(EMPTY_FILE, document_type_code=code)
    if size > get_settings().max_upload_bytes:
        raise DocumentRejected(FILE_TOO_LARGE, status=413, document_type_code=code)

    max_pages = document_type.max_pages or 5
    if page_count > max_pages:
        raise DocumentRejected(TOO_MANY_PAGES, document_type_code=code)

    return MIME_EXTENSIONS[normalized]


# ------------------------------------------------------------------- 預覽圖

def make_preview(data: bytes, mime: str) -> bytes | None:
    """影像縮成長邊 1200 的 JPEG；PDF 直接跳過（伺服器端不做 PDF 光柵化）。

    失敗回 None——預覽圖只是方便承辦人掃一眼，壞掉不該讓整次送件失敗。
    """
    if (mime or "").split(";")[0].strip().lower() == "application/pdf":
        return None
    try:
        Image.MAX_IMAGE_PIXELS = get_settings().max_image_pixels
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            rgb = im.convert("RGB")
            rgb.thumbnail((PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE))
            out = io.BytesIO()
            rgb.save(out, format="JPEG", quality=82, optimize=True)
            return out.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        log.warning("預覽圖產生失敗，略過")
        return None


# ------------------------------------------------------------------- 寫入

async def next_revision(db: AsyncSession, application: Application, document_type_code: str) -> int:
    """同一個文件類型的下一個版本號。第一次上傳是 0（與 P1 的建案一致）。"""
    highest = (
        await db.execute(
            select(func.max(ApplicationDocument.revision)).where(
                ApplicationDocument.application_id == application.id,
                ApplicationDocument.document_type_code == document_type_code,
            )
        )
    ).scalar_one_or_none()
    return 0 if highest is None else int(highest) + 1


async def store_upload(
    db: AsyncSession,
    application: Application,
    *,
    document_type: DocumentType | None,
    data: bytes,
    mime: str,
    page_count: int = 1,
    masked: bool = False,
    document_type_code: str = "",
    revision: int | None = None,
) -> StoredUpload:
    """驗證、上傳原件與預覽圖，回傳文件列的 spec（還沒寫資料庫）。

    真正的資料列由 `services/application.py` 的 `create_application()` /
    `add_documents()` 寫入——版本號與 `supersedes_id` 是狀態機那一側的事。
    """
    code = document_type.code if document_type is not None else document_type_code
    ext = validate_upload(document_type, mime=mime, size=len(data), page_count=page_count,
                          document_type_code=code)
    rev = revision if revision is not None else await next_revision(db, application, code)

    key = object_key(application.tenant_id, application.case_no, code, rev, ext)
    normalized = (mime or "").split(";")[0].strip().lower()
    await asyncio.to_thread(storage.put_private, key, data, normalized)

    thumb = make_preview(data, normalized)
    thumb_key: str | None = None
    if thumb is not None:
        thumb_key = preview_key(application.tenant_id, application.case_no, code, rev)
        await asyncio.to_thread(storage.put_private, thumb_key, thumb, "image/jpeg")

    return StoredUpload(
        document_type_code=code,
        object_key=key,
        preview_key=thumb_key,
        mime=normalized,
        size=len(data),
        page_count=max(1, int(page_count or 1)),
        masked=bool(masked),
        revision=rev,
    )


async def write_ocr(
    db: AsyncSession,
    document: ApplicationDocument,
    ocr: dict[str, Any] | None,
    *,
    source: str = "applicant",
    engine: str = "tesseract.js",
    lang: str = "chi_tra+eng",
) -> DocumentOcrResult | None:
    """存一筆 OCR 結果。`source=applicant` 的一律視為不可信，規則引擎會重跑（SPEC §11）。"""
    if not ocr:
        return None
    row = DocumentOcrResult(
        tenant_id=document.tenant_id,
        document_id=document.id,
        source=source,
        engine=engine,
        lang=lang,
        text=str(ocr.get("text", "") or ""),
        confidence=float(ocr.get("confidence") or 0.0),
        lines=list(ocr.get("lines") or []),
        created_at=datetime.now(UTC),
    )
    db.add(row)
    await db.flush()
    return row


# ------------------------------------------------------------------ 讀取

async def presigned_url(object_key_: str, *, seconds: int = PRESIGNED_SECONDS) -> tuple[str, datetime]:
    """private bucket 的短效連結（SPEC §11：只經 presigned URL、5 分鐘）。"""
    bucket = get_settings().s3_bucket_private
    url = await asyncio.to_thread(
        storage.presign_client().presigned_get_object, bucket, object_key_, timedelta(seconds=seconds)
    )
    return str(url), datetime.now(UTC) + timedelta(seconds=seconds)


# ------------------------------------------------------------------ 清除

async def delete_objects(document: ApplicationDocument) -> int:
    """刪掉一份文件在 MinIO 上的原件與預覽圖，回傳刪掉幾個物件。

    刪不掉就記下來繼續——資料庫那一側還是要標記成已清除，不然下一輪又會拿同一筆
    重試到天荒地老。
    """
    bucket = get_settings().s3_bucket_private
    removed = 0
    for key in (document.object_key, document.preview_key):
        if not key:
            continue
        try:
            await asyncio.to_thread(storage.delete, bucket, key)
            removed += 1
        except Exception:
            log.exception("刪除物件失敗：%s", key)
    return removed


async def delete_ocr(db: AsyncSession, document_id: str) -> int:
    """硬刪一份文件的所有 OCR 結果（SPEC §7「清除」）。"""
    rows = (
        await db.execute(select(DocumentOcrResult).where(DocumentOcrResult.document_id == document_id))
    ).scalars().all()
    for row in rows:
        await db.delete(row)
    return len(rows)
