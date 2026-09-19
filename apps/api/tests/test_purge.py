"""終態案件的文件清除（SPEC §7「清除」/ §11）。

被刪的是影像、OCR 與 bbox；留下的是申請主檔與事件時間軸。
"""

from datetime import UTC, datetime, timedelta

import pytest
from app.models import Application, ApplicationDocument, ApplicationStatusEvent, DocumentOcrResult, ReviewFinding
from app.services import application as case_service
from sqlalchemy import func, select

from tests.test_state_machine import drive, make_case


@pytest.fixture
def deleted_keys(monkeypatch):
    """測試不連 MinIO：記下被要求刪掉的 key 就好。"""
    keys: list[str] = []
    monkeypatch.setattr(case_service.storage, "delete", lambda bucket, key: keys.append(key))
    return keys


async def disbursed_case(db, tenant, scheme, **kw):
    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "docs/a.jpg", "preview_key": "prev/a.jpg"},
        {"document_type_code": "ID_CARD_FRONT", "object_key": "docs/b.jpg"},
    ], **kw)
    await drive(db, app, "T3", "T6", "T7")
    return app


async def _ocr_and_finding(db, app):
    doc = (await db.execute(select(ApplicationDocument).where(
        ApplicationDocument.application_id == app.id))).scalars().first()
    db.add(DocumentOcrResult(tenant_id=app.tenant_id, document_id=doc.id, text="NT$6,000", source="applicant"))
    db.add(ReviewFinding(tenant_id=app.tenant_id, application_id=app.id, rule_code="R1",
                         status="MATCH", bbox={"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}))
    await db.commit()


async def test_nothing_is_purged_before_the_retention_period_ends(db, tenant, scheme, deleted_keys):
    app = await disbursed_case(db, tenant, scheme)
    counts = await case_service.purge_due(db, datetime.now(UTC))
    assert counts["applications"] == 0
    assert deleted_keys == []
    assert app.documents_purged_at is None


async def test_purge_deletes_objects_ocr_and_bboxes(db, tenant, scheme, deleted_keys):
    app = await disbursed_case(db, tenant, scheme)
    await _ocr_and_finding(db, app)
    later = datetime.now(UTC) + timedelta(days=scheme.retention_days + 1)

    counts = await case_service.purge_due(db, later)
    assert counts["applications"] == 1 and counts["documents"] == 2
    assert sorted(deleted_keys) == ["docs/a.jpg", "docs/b.jpg", "prev/a.jpg"]
    assert counts["ocr"] == 1 and counts["findings"] == 1
    assert (await db.execute(select(func.count(DocumentOcrResult.id)))).scalar_one() == 0
    finding = (await db.execute(select(ReviewFinding))).scalars().one()
    assert finding.bbox is None


async def test_purge_keeps_the_application_and_its_timeline(db, tenant, scheme, deleted_keys):
    await disbursed_case(db, tenant, scheme)
    later = datetime.now(UTC) + timedelta(days=scheme.retention_days + 1)
    await case_service.purge_due(db, later)

    assert (await db.execute(select(func.count(Application.id)))).scalar_one() == 1
    assert (await db.execute(select(func.count(ApplicationStatusEvent.id)))).scalar_one() == 5
    docs = list((await db.execute(select(ApplicationDocument))).scalars())
    assert len(docs) == 2
    assert all(d.object_key == "" and d.preview_key is None and d.purged_at is not None for d in docs)


async def test_purge_is_idempotent(db, tenant, scheme, deleted_keys):
    app = await disbursed_case(db, tenant, scheme)
    later = datetime.now(UTC) + timedelta(days=scheme.retention_days + 1)
    first = await case_service.purge_due(db, later)
    second = await case_service.purge_due(db, later)
    assert first["applications"] == 1 and second["applications"] == 0
    assert len(deleted_keys) == 3
    assert app.documents_purged_at is not None


async def test_keep_after_disbursed_documents_survive(db, tenant, scheme, deleted_keys):
    keeper = next(d for d in scheme.document_types if d.code == "ID_CARD_FRONT")
    keeper.keep_after_disbursed = True
    await db.commit()

    await disbursed_case(db, tenant, scheme)
    later = datetime.now(UTC) + timedelta(days=scheme.retention_days + 1)
    counts = await case_service.purge_due(db, later)

    assert counts["documents"] == 1
    assert deleted_keys == ["docs/a.jpg", "prev/a.jpg"]
    kept = (await db.execute(select(ApplicationDocument).where(
        ApplicationDocument.document_type_code == "ID_CARD_FRONT"))).scalars().one()
    assert kept.object_key == "docs/b.jpg" and kept.purged_at is None


async def test_a_storage_failure_does_not_wedge_the_job(db, tenant, scheme, monkeypatch):
    """物件刪不掉還是要標記完成，否則每天都會拿同一筆重試到天荒地老。"""
    def boom(bucket, key):
        raise RuntimeError("minio down")

    monkeypatch.setattr(case_service.storage, "delete", boom)
    app = await disbursed_case(db, tenant, scheme)
    later = datetime.now(UTC) + timedelta(days=scheme.retention_days + 1)
    counts = await case_service.purge_due(db, later)
    assert counts["documents"] == 2 and counts["objects"] == 0
    assert app.documents_purged_at is not None


async def test_an_open_case_is_never_purged(db, tenant, scheme, deleted_keys):
    await make_case(db, tenant, scheme, documents=[{"document_type_code": "ID_CARD_FRONT", "object_key": "x"}])
    far_future = datetime.now(UTC) + timedelta(days=3650)
    assert (await case_service.purge_due(db, far_future))["applications"] == 0
    assert deleted_keys == []


async def test_old_document_revisions_are_purged_too(db, tenant, scheme, deleted_keys):
    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "v1.jpg"},
    ])
    await drive(db, app, "T2")
    await case_service.add_documents(db, app, [{"document_type_code": "BILLING_STATEMENT", "object_key": "v2.jpg"}])
    await drive(db, app, "T4", "T5", "T3", "T6", "T7")
    later = datetime.now(UTC) + timedelta(days=scheme.retention_days + 1)

    await case_service.purge_due(db, later)
    assert sorted(deleted_keys) == ["v1.jpg", "v2.jpg"]
