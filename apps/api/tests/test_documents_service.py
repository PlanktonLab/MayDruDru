"""證明文件的存放、驗證、預覽與清除（SPEC §6.3 / §11 / 契約 P3）。

purge 的部分接在 `test_purge.py` 之後：這裡驗的是「清除確實刪掉影像與 OCR，
而且申請主檔與事件時間軸一個都沒少」。
"""

from __future__ import annotations

import io
from datetime import UTC, datetime, timedelta

import pytest
from app.models import (
    Application,
    ApplicationDocument,
    ApplicationStatusEvent,
    DocumentOcrResult,
    DocumentType,
    ReviewFinding,
)
from app.services import application as case_service
from app.services import documents as documents_service
from PIL import Image
from sqlalchemy import func, select

from tests.test_apply_api import PDF_BYTES, png_bytes
from tests.test_state_machine import drive, make_case


def doc_type(**over) -> DocumentType:
    base = {"code": "BILLING_STATEMENT", "accepted_mime": [], "max_pages": 5}
    base.update(over)
    return DocumentType(**base)


# ------------------------------------------------------------------ key 規則

def test_the_object_key_follows_the_contract():
    key = documents_service.object_key("t1", "HC-2026-000001", "BILLING_STATEMENT", 2, "jpg")
    assert key == "applications/t1/HC-2026-000001/BILLING_STATEMENT/2.jpg"


def test_the_preview_sits_next_to_its_original():
    assert documents_service.preview_key("t1", "HC-2026-000001", "ID_CARD_FRONT", 0) == (
        "applications/t1/HC-2026-000001/ID_CARD_FRONT/0-preview.jpg"
    )


# -------------------------------------------------------------------- 驗證

@pytest.mark.parametrize(("mime", "ext"), [
    ("image/jpeg", "jpg"), ("image/png", "png"), ("application/pdf", "pdf"),
    ("image/png; charset=binary", "png"), ("IMAGE/PNG", "png"),
])
def test_accepted_mime_types_map_to_an_extension(mime, ext):
    assert documents_service.validate_upload(doc_type(), mime=mime, size=10, page_count=1) == ext


@pytest.mark.parametrize("mime", ["image/gif", "image/heic", "text/html", ""])
def test_other_mime_types_are_refused(mime):
    with pytest.raises(documents_service.DocumentRejected) as err:
        documents_service.validate_upload(doc_type(), mime=mime, size=10, page_count=1)
    assert err.value.code == "MIME_NOT_ACCEPTED"


def test_a_document_type_can_narrow_the_accepted_list():
    with pytest.raises(documents_service.DocumentRejected):
        documents_service.validate_upload(doc_type(accepted_mime=["application/pdf"]),
                                          mime="image/png", size=10, page_count=1)


def test_an_unknown_document_type_is_refused_before_anything_is_stored():
    with pytest.raises(documents_service.DocumentRejected) as err:
        documents_service.validate_upload(None, mime="image/png", size=10, page_count=1,
                                          document_type_code="MYSTERY")
    assert err.value.code == "UNKNOWN_DOCUMENT_TYPE"
    assert err.value.document_type_code == "MYSTERY"


def test_an_empty_file_is_refused():
    with pytest.raises(documents_service.DocumentRejected) as err:
        documents_service.validate_upload(doc_type(), mime="image/png", size=0, page_count=1)
    assert err.value.code == "EMPTY_FILE"


def test_an_oversized_file_is_a_413():
    from app.config import get_settings

    with pytest.raises(documents_service.DocumentRejected) as err:
        documents_service.validate_upload(doc_type(), mime="image/png",
                                          size=get_settings().max_upload_bytes + 1, page_count=1)
    assert err.value.code == "FILE_TOO_LARGE" and err.value.status == 413


def test_too_many_pages_is_refused():
    with pytest.raises(documents_service.DocumentRejected) as err:
        documents_service.validate_upload(doc_type(max_pages=3), mime="application/pdf",
                                          size=10, page_count=4)
    assert err.value.code == "TOO_MANY_PAGES"


# ------------------------------------------------------------------ 預覽圖

def test_a_large_image_is_shrunk_to_a_jpeg():
    preview = documents_service.make_preview(png_bytes((3000, 2000)), "image/png")
    assert preview is not None
    with Image.open(io.BytesIO(preview)) as im:
        assert im.format == "JPEG"
        assert max(im.size) == documents_service.PREVIEW_MAX_EDGE


def test_a_small_image_keeps_its_size():
    preview = documents_service.make_preview(png_bytes((40, 30)), "image/png")
    with Image.open(io.BytesIO(preview)) as im:
        assert im.size == (40, 30)


def test_pdfs_get_no_preview():
    assert documents_service.make_preview(PDF_BYTES, "application/pdf") is None


def test_a_broken_image_never_breaks_the_submission():
    assert documents_service.make_preview(b"not an image at all", "image/png") is None


# ------------------------------------------------------------------ 上傳

async def test_store_upload_puts_the_original_and_the_preview(db, tenant, scheme, fake_storage):
    app = await make_case(db, tenant, scheme)
    document_type = next(d for d in scheme.document_types if d.code == "BILLING_STATEMENT")
    stored = await documents_service.store_upload(
        db, app, document_type=document_type, data=png_bytes(), mime="image/png", page_count=1, masked=True)
    assert stored.revision == 0 and stored.masked is True
    assert stored.object_key in fake_storage.objects
    assert stored.preview_key in fake_storage.objects
    assert stored.size == len(png_bytes())


async def test_revisions_increase_per_document_type(db, tenant, scheme, fake_storage):
    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "old"}])
    document_type = next(d for d in scheme.document_types if d.code == "BILLING_STATEMENT")
    stored = await documents_service.store_upload(
        db, app, document_type=document_type, data=png_bytes(), mime="image/png")
    assert stored.revision == 1 and stored.object_key.endswith("/BILLING_STATEMENT/1.png")


async def test_write_ocr_stores_lines_and_the_source(db, tenant, scheme):
    await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "k"}])
    doc = (await db.execute(select(ApplicationDocument))).scalars().one()
    row = await documents_service.write_ocr(
        db, doc, {"text": "金額 NT$1", "confidence": 88, "lines": [{"text": "金額 NT$1"}]},
        source="reviewer")
    assert row is not None and row.source == "reviewer" and row.confidence == 88
    assert row.lines == [{"text": "金額 NT$1"}]


async def test_write_ocr_ignores_an_empty_result(db, tenant, scheme):
    await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "k"}])
    doc = (await db.execute(select(ApplicationDocument))).scalars().one()
    assert await documents_service.write_ocr(db, doc, None) is None
    assert (await db.execute(select(func.count(DocumentOcrResult.id)))).scalar_one() == 0


# ------------------------------------------------------------ presigned URL

async def test_presigned_urls_expire_in_five_minutes(fake_storage):
    url, expires_at = await documents_service.presigned_url("applications/t/HC/BILL/0.png")
    assert url.endswith("?signed=1")
    assert timedelta(minutes=4) < expires_at - datetime.now(UTC) <= timedelta(minutes=5)


# ------------------------------------------------------------------- 清除

async def test_purge_deletes_objects_and_ocr_but_keeps_the_case_and_its_events(
    db, tenant, scheme, fake_storage
):
    """SPEC §7「清除」：刪影像、OCR 與 bbox；留申請主檔與事件時間軸。"""
    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "docs/a.png",
         "preview_key": "docs/a-preview.jpg"},
    ])
    doc = (await db.execute(select(ApplicationDocument))).scalars().one()
    await documents_service.write_ocr(db, doc, {"text": "金額 NT$6,000", "confidence": 90, "lines": []})
    db.add(ReviewFinding(tenant_id=tenant.id, application_id=app.id, rule_code="AMOUNT",
                         status="MATCH", bbox={"x0": 1, "y0": 2, "x1": 3, "y1": 4}))
    await db.commit()
    await drive(db, app, "T3", "T6", "T7")
    events_before = (await db.execute(
        select(func.count(ApplicationStatusEvent.id)).where(ApplicationStatusEvent.application_id == app.id)
    )).scalar_one()

    counts = await case_service.purge_due(db, datetime.now(UTC) + timedelta(days=scheme.retention_days + 1))

    assert counts == {"applications": 1, "documents": 1, "objects": 2, "ocr": 1, "findings": 1}
    assert sorted(fake_storage.deleted) == ["docs/a-preview.jpg", "docs/a.png"]
    assert (await db.execute(select(func.count(DocumentOcrResult.id)))).scalar_one() == 0
    assert (await db.execute(select(ReviewFinding))).scalars().one().bbox is None

    await db.refresh(doc)
    assert doc.object_key == "" and doc.preview_key is None and doc.purged_at is not None
    assert (await db.execute(select(func.count(Application.id)))).scalar_one() == 1
    assert (await db.execute(
        select(func.count(ApplicationStatusEvent.id)).where(ApplicationStatusEvent.application_id == app.id)
    )).scalar_one() == events_before


async def test_purge_skips_document_types_marked_keep_after_disbursed(db, tenant, scheme, fake_storage):
    keep = next(d for d in scheme.document_types if d.code == "ID_CARD_FRONT")
    keep.keep_after_disbursed = True
    await db.commit()
    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "ID_CARD_FRONT", "object_key": "docs/id.png"},
        {"document_type_code": "BILLING_STATEMENT", "object_key": "docs/bill.png"},
    ])
    await drive(db, app, "T3", "T6", "T7")
    counts = await case_service.purge_due(db, datetime.now(UTC) + timedelta(days=200))
    assert counts["documents"] == 1
    assert fake_storage.deleted == ["docs/bill.png"]


async def test_the_worker_cron_purges_through_the_documents_service(db, tenant, scheme, fake_storage,
                                                                    monkeypatch):
    """worker 的每日 03:00 工作與 `purge_due()` 走的是同一條路（SPEC §7）。"""
    from app.worker import tasks

    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "docs/w.png"}])
    await drive(db, app, "T10")
    app.documents_purge_at = datetime.now(UTC) - timedelta(days=1)
    await db.commit()

    class _Maker:
        def __call__(self):
            return self

        async def __aenter__(self):
            return db

        async def __aexit__(self, *_exc):
            return False

    monkeypatch.setattr(tasks, "sessionmaker", lambda: _Maker())
    counts = await tasks.purge_documents({})
    assert counts["documents"] == 1
    assert fake_storage.deleted == ["docs/w.png"]


async def test_the_worker_cron_expires_overdue_supplements(db, tenant, scheme, monkeypatch):
    from app.worker import tasks

    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")
    app.supplement_deadline = datetime.now(UTC) - timedelta(days=1)
    await db.commit()

    class _Maker:
        def __call__(self):
            return self

        async def __aenter__(self):
            return db

        async def __aexit__(self, *_exc):
            return False

    monkeypatch.setattr(tasks, "sessionmaker", lambda: _Maker())
    assert (await tasks.expire_supplements({}))["expired"] == 1
    await db.refresh(app)
    assert app.status == "EXPIRED"
