"""`/api/apply/*`：匿名送件、查詢驗證、補件與撤回（SPEC §8.1 / §10.2 / 契約 P3）。

送件是 multipart：`application` 與 `documents` 兩個 JSON 字串，加上依序編號的
`file_0`、`file_1`…。這裡的每個測試都走真的 HTTP 路徑，MinIO 與 Redis 用假的。
"""

from __future__ import annotations

import io
import json
from datetime import UTC, date, datetime, timedelta

import pytest
from app.models import Application, ApplicationDocument, DocumentOcrResult, Faq, ReviewFinding, ReviewRule
from app.services import application as case_service
from PIL import Image
from sqlalchemy import select

from tests.test_state_machine import drive, make_case

APPLY = "/api/apply"


# --------------------------------------------------------------- 測試素材

def png_bytes(size: tuple[int, int] = (40, 30), color: str = "white") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


# 手寫的最小 PDF：一頁空白。不引進 reportlab 只為了產一個測試檔。
PDF_BYTES = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF\n"
)


def ocr(text: str, confidence: int = 90) -> dict:
    return {
        "text": text,
        "confidence": confidence,
        "lines": [
            {"text": line, "confidence": confidence,
             "bbox": {"x0": 0, "y0": 20 * i, "x1": 400, "y1": 20 * i + 18}, "words": []}
            for i, line in enumerate(text.split("\n"))
        ],
    }


def multipart(specs: list[dict], *, application: dict | None = None, files: list[tuple] | None = None):
    """組出送件用的 multipart：data 是兩個 JSON 字串，files 是 file_0、file_1…。"""
    data = {"documents": json.dumps(specs)}
    if application is not None:
        data["application"] = json.dumps(application)
    payload = files if files is not None else [
        (f"file_{i}", (f"doc{i}.png", png_bytes(), "image/png")) for i in range(len(specs))
    ]
    return data, payload


def application_payload(**over) -> dict:
    body = {
        "scheme_code": "TEST115",
        "tier_code": "GENERAL",
        "payment_channel_code": "CREDIT_CARD",
        "applicant_name": "測試用小明",
        "phone": "0912345678",
        "id_last4": "6789",
        "email": "ming@example.tw",
        "tool_name": "ChatGPT Plus",
        "purchase_amount": 1200,
        "purchase_date": "2026-09-01",
        "paid_by_proxy": False,
    }
    body.update(over)
    return body


@pytest.fixture
async def rules(db, scheme) -> list[ReviewRule]:
    """兩條會命中的規則 + 一條必要文件規則，涵蓋三種 rule_type。"""
    rows = [
        ReviewRule(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="AMOUNT",
                   label="臺幣金額", document_type_code="BILLING_STATEMENT",
                   rule_type="keyword_extract", sort_order=10, required=True, severity="error",
                   config={"keywords": ["金額"], "value_after_keyword": True, "normalize": "amount"}),
        ReviewRule(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="AMOUNT_MATCHES",
                   label="金額相符", document_type_code="BILLING_STATEMENT",
                   rule_type="amount_tolerance", sort_order=20, required=True, severity="error",
                   config={"source_rule_code": "AMOUNT", "compare_to": "purchase_amount",
                           "tolerance_pct": 5, "tolerance_abs": 150}),
        ReviewRule(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="DOCS",
                   label="必要文件齊備", document_type_code="",
                   rule_type="required_doc", sort_order=30, required=True, severity="error",
                   config={"document_type_codes": []}),
    ]
    db.add_all(rows)
    await db.commit()
    await db.refresh(scheme)
    return rows


async def verified_token(client, app) -> str:
    r = await client.post(f"{APPLY}/verify", json={"case_no": app.case_no, "last4": "5678"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------ 方案

async def test_scheme_list_only_shows_active_schemes(apply_client, scheme, db):
    scheme.active = False
    await db.commit()
    assert (await apply_client.get(f"{APPLY}/schemes")).json() == []
    scheme.active = True
    await db.commit()
    body = (await apply_client.get(f"{APPLY}/schemes")).json()
    assert [s["code"] for s in body] == ["TEST115"]


async def test_scheme_detail_carries_everything_the_submit_flow_needs(apply_client, scheme, rules):
    body = (await apply_client.get(f"{APPLY}/schemes/{scheme.code}")).json()
    assert body["code"] == "TEST115"
    assert [t["code"] for t in body["tiers"]] == ["GENERAL", "LOW_INCOME"]
    assert [d["code"] for d in body["document_types"]][0] == "ID_CARD_FRONT"
    assert [c["code"] for c in body["payment_channels"]] == ["CREDIT_CARD", "TELECOM"]
    assert [r["code"] for r in body["review_rules"]] == ["AMOUNT", "AMOUNT_MATCHES", "DOCS"]
    assert body["supplement_days"] == 14 and body["max_revisions"] == 2


async def test_an_inactive_scheme_is_a_404_on_the_detail_endpoint(apply_client, scheme, db):
    scheme.active = False
    await db.commit()
    assert (await apply_client.get(f"{APPLY}/schemes/{scheme.code}")).status_code == 404


async def test_required_documents_are_computed_server_side(apply_client, scheme):
    r = await apply_client.post(
        f"{APPLY}/schemes/{scheme.code}/required-documents",
        json={"tier_code": "GENERAL", "payment_channel_code": "CREDIT_CARD", "paid_by_proxy": False},
    )
    assert r.json()["document_type_codes"] == ["ID_CARD_FRONT", "BILLING_STATEMENT"]


async def test_proxy_and_tier_add_their_own_documents(apply_client, scheme):
    r = await apply_client.post(
        f"{APPLY}/schemes/{scheme.code}/required-documents",
        json={"tier_code": "LOW_INCOME", "payment_channel_code": "TELECOM", "paid_by_proxy": True},
    )
    assert r.json()["document_type_codes"] == [
        "ID_CARD_FRONT", "TELECOM_BILL", "PROXY_AFFIDAVIT", "SPECIAL_STATUS_PROOF",
    ]


# ------------------------------------------------------------------ 送件

async def test_submitting_creates_a_case_in_the_review_queue(apply_client, scheme, db):
    data, files = multipart(
        [{"document_type_code": "ID_CARD_FRONT", "masked": False, "mime": "image/png", "page_count": 1,
          "ocr": None}],
        application=application_payload(),
    )
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["case_no"].startswith("HC-")
    assert body["status"] == "UNDER_REVIEW"          # 建案後系統立刻走 T1
    assert body["verdict"] in ("PASS", "FAIL", "INDETERMINATE")

    app = (await db.execute(select(Application))).scalars().one()
    assert app.intake_channel == "WEB" and app.applicant_name == "測試用小明"


async def test_the_uploaded_file_lands_in_the_private_bucket_under_the_case_prefix(
    apply_client, scheme, db, fake_storage
):
    data, files = multipart(
        [{"document_type_code": "BILLING_STATEMENT", "mime": "image/png", "page_count": 1, "ocr": None}],
        application=application_payload(),
    )
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    case_no = r.json()["case_no"]
    doc = (await db.execute(select(ApplicationDocument))).scalars().one()
    assert doc.object_key == f"applications/{doc.tenant_id}/{case_no}/BILLING_STATEMENT/0.png"
    assert doc.object_key in fake_storage.objects
    assert doc.preview_key == f"applications/{doc.tenant_id}/{case_no}/BILLING_STATEMENT/0-preview.jpg"
    assert doc.preview_key in fake_storage.objects


async def test_a_pdf_is_stored_without_a_preview(apply_client, scheme, db, fake_storage):
    data, files = multipart(
        [{"document_type_code": "ID_CARD_FRONT", "mime": "application/pdf", "page_count": 2, "ocr": None}],
        application=application_payload(),
        files=[("file_0", ("id.pdf", PDF_BYTES, "application/pdf"))],
    )
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 201, r.text
    doc = (await db.execute(select(ApplicationDocument))).scalars().one()
    assert doc.object_key.endswith("/0.pdf") and doc.preview_key is None
    assert doc.page_count == 2


async def test_applicant_ocr_is_stored_and_the_server_reruns_the_rules(apply_client, scheme, rules, db):
    data, files = multipart(
        [
            {"document_type_code": "ID_CARD_FRONT", "mime": "image/png", "page_count": 1, "ocr": None},
            {"document_type_code": "BILLING_STATEMENT", "mime": "image/png", "page_count": 1,
             "ocr": ocr("帳單\n金額 NT$1,200")},
        ],
        application=application_payload(purchase_amount=1200),
    )
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["verdict"] == "PASS"
    by_code = {f["rule_code"]: f for f in body["findings"]}
    assert by_code["AMOUNT"]["status"] == "MATCH" and by_code["AMOUNT"]["extracted_value"] == "1200"
    assert by_code["AMOUNT_MATCHES"]["status"] == "MATCH"

    rows = (await db.execute(select(DocumentOcrResult))).scalars().all()
    assert [row.source for row in rows] == ["applicant"]
    stored = (await db.execute(select(ReviewFinding))).scalars().all()
    assert {row.source for row in stored} == {"auto"}


async def test_the_client_precheck_is_never_trusted(apply_client, scheme, rules, db):
    """前端說 PASS，伺服器照樣自己算——這次金額對不上，結論是 FAIL。"""
    data, files = multipart(
        [
            {"document_type_code": "ID_CARD_FRONT", "mime": "image/png", "page_count": 1, "ocr": None},
            {"document_type_code": "BILLING_STATEMENT", "mime": "image/png", "page_count": 1,
             "ocr": ocr("金額 NT$9,999")},
        ],
        application=application_payload(purchase_amount=1200, precheck={"verdict": "PASS", "findings": []}),
    )
    body = (await apply_client.post(f"{APPLY}/applications", data=data, files=files)).json()
    assert body["verdict"] == "FAIL"
    assert {f["rule_code"]: f["status"] for f in body["findings"]}["AMOUNT_MATCHES"] == "MISMATCH"


async def test_missing_documents_come_back_as_a_supplement_suggestion(apply_client, scheme, rules):
    data, files = multipart(
        [{"document_type_code": "ID_CARD_FRONT", "mime": "image/png", "page_count": 1, "ocr": None}],
        application=application_payload(),
    )
    body = (await apply_client.post(f"{APPLY}/applications", data=data, files=files)).json()
    docs = {f["rule_code"]: f for f in body["findings"]}["DOCS"]
    assert docs["status"] == "MISMATCH"
    assert docs["suggested_supplement"] == ["BILLING_STATEMENT"]


async def test_a_closed_scheme_refuses_submissions(apply_client, scheme, db):
    scheme.application_end = date.today() - timedelta(days=1)
    await db.commit()
    data, files = multipart([], application=application_payload())
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 400 and r.json() == {"code": "SCHEME_CLOSED"}


async def test_an_inactive_scheme_refuses_submissions(apply_client, scheme, db):
    scheme.active = False
    await db.commit()
    data, files = multipart([], application=application_payload())
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.json()["code"] == "SCHEME_CLOSED"


async def test_an_unknown_scheme_code_is_a_404(apply_client, scheme):
    data, files = multipart([], application=application_payload(scheme_code="NOPE"))
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 404 and r.json()["code"] == "SCHEME_NOT_FOUND"


async def test_an_unknown_document_type_is_refused(apply_client, scheme, db):
    data, files = multipart(
        [{"document_type_code": "MYSTERY", "mime": "image/png", "page_count": 1, "ocr": None}],
        application=application_payload(),
    )
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 400 and r.json()["code"] == "UNKNOWN_DOCUMENT_TYPE"
    assert (await db.execute(select(Application))).scalars().all() == []


async def test_a_rejected_mime_type_rolls_the_whole_submission_back(apply_client, scheme, db):
    data, files = multipart(
        [{"document_type_code": "ID_CARD_FRONT", "mime": "image/gif", "page_count": 1, "ocr": None}],
        application=application_payload(),
        files=[("file_0", ("a.gif", b"GIF89a", "image/gif"))],
    )
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 400 and r.json()["code"] == "MIME_NOT_ACCEPTED"
    assert (await db.execute(select(Application))).scalars().all() == []


async def test_too_many_pages_is_refused(apply_client, scheme, db):
    data, files = multipart(
        [{"document_type_code": "ID_CARD_FRONT", "mime": "application/pdf", "page_count": 20, "ocr": None}],
        application=application_payload(),
        files=[("file_0", ("id.pdf", PDF_BYTES, "application/pdf"))],
    )
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 400 and r.json()["code"] == "TOO_MANY_PAGES"


async def test_a_missing_file_for_a_declared_document_is_a_422(apply_client, scheme):
    data = {"application": json.dumps(application_payload()),
            "documents": json.dumps([{"document_type_code": "ID_CARD_FRONT", "mime": "image/png"}])}
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=[])
    assert r.status_code == 422


async def test_a_malformed_application_json_is_a_422(apply_client, scheme):
    r = await apply_client.post(f"{APPLY}/applications",
                                data={"application": "{not json", "documents": "[]"}, files=[])
    assert r.status_code == 422


async def test_an_application_missing_a_required_field_is_a_422(apply_client, scheme):
    body = application_payload()
    del body["applicant_name"]
    r = await apply_client.post(f"{APPLY}/applications",
                                data={"application": json.dumps(body), "documents": "[]"}, files=[])
    assert r.status_code == 422


async def test_the_plain_phone_number_never_reaches_the_database(apply_client, scheme, db):
    data, files = multipart([], application=application_payload())
    await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    app = (await db.execute(select(Application))).scalars().one()
    assert "0912345678" not in app.phone_encrypted
    assert app.phone_last4_hash and app.id_last4_hash


# -------------------------------------------------------------- 查詢驗證

async def test_verify_returns_a_case_scoped_token(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    r = await apply_client.post(f"{APPLY}/verify", json={"case_no": app.case_no, "last4": "5678"})
    assert r.status_code == 200
    body = r.json()
    assert body["case_no"] == app.case_no and body["token"]
    assert datetime.fromisoformat(body["expires_at"]) > datetime.now(UTC)


async def test_a_wrong_last4_is_a_401_with_a_code(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    r = await apply_client.post(f"{APPLY}/verify", json={"case_no": app.case_no, "last4": "0000"})
    assert r.status_code == 401 and r.json() == {"code": "VERIFICATION_FAILED"}


async def test_an_unknown_case_answers_exactly_like_a_wrong_last4(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    wrong = await apply_client.post(f"{APPLY}/verify", json={"case_no": app.case_no, "last4": "0000"})
    missing = await apply_client.post(f"{APPLY}/verify", json={"case_no": "HC-2026-999999", "last4": "5678"})
    assert wrong.status_code == missing.status_code and wrong.json() == missing.json()


async def test_six_failures_lock_the_case_with_a_423(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    for _ in range(case_service.VERIFY_MAX_FAILURES):
        await apply_client.post(f"{APPLY}/verify", json={"case_no": app.case_no, "last4": "0000"})
    r = await apply_client.post(f"{APPLY}/verify", json={"case_no": app.case_no, "last4": "5678"})
    assert r.status_code == 423
    assert r.json()["code"] == "LOCKED"
    assert r.json()["retry_after_seconds"] == case_service.VERIFY_LOCK_SECONDS


# ------------------------------------------------------- 帶 token 的案件頁

async def test_the_case_page_shows_the_timeline_and_no_staff_data(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "ID_CARD_FRONT", "object_key": "k", "mime": "image/png"}])
    token = await verified_token(apply_client, app)
    body = (await apply_client.get(f"{APPLY}/applications/{app.case_no}", headers=bearer(token))).json()
    assert body["case_no"] == app.case_no
    assert body["scheme"] == {"code": "TEST115", "name": "測試補助"}
    assert [e["transition_code"] for e in body["events"]] == ["T0", "T1"]
    assert [d["document_type_code"] for d in body["documents"]] == ["ID_CARD_FRONT"]
    assert body["can_withdraw"] is True and body["can_supplement"] is False
    assert "applicant_name" not in body and "phone_masked" not in body


async def test_the_case_page_gives_content_keys_not_sentences(apply_client, db, tenant, scheme):
    """狀態文案走 contents（CLAUDE.md 規則 4）：API 給 key，前端負責渲染。"""
    app = await make_case(db, tenant, scheme)
    token = await verified_token(apply_client, app)
    body = (await apply_client.get(f"{APPLY}/applications/{app.case_no}", headers=bearer(token))).json()
    assert body["status"] == "UNDER_REVIEW"
    assert body["public_label_key"] == "status.UNDER_REVIEW.public_label"
    assert body["next_action"] == "status.UNDER_REVIEW.next_action"


async def test_the_case_page_also_renders_those_keys(apply_client, db, tenant, scheme):
    """key 旁邊附一份渲染好的字：第一次繪製就不必再問一次 `GET /api/contents`。

    router 自己不組中文——字來自 registry 預設值，承辦人發布過就換成他發布的那一份。
    """
    from app.content_registry import get_default

    app = await make_case(db, tenant, scheme)
    token = await verified_token(apply_client, app)
    body = (await apply_client.get(f"{APPLY}/applications/{app.case_no}", headers=bearer(token))).json()
    assert body["public_label"] == get_default("status.UNDER_REVIEW.public_label")
    assert body["next_action_text"] == get_default("status.UNDER_REVIEW.next_action")


async def test_a_published_content_wins_over_the_registry_default(apply_client, db, tenant, scheme):
    from app.services import contents as contents_service

    app = await make_case(db, tenant, scheme)
    await contents_service.get_or_create(db, tenant.id, "status.UNDER_REVIEW.next_action")
    await contents_service.publish(db, tenant.id, "status.UNDER_REVIEW.next_action", "再等我們兩天。")
    await db.commit()
    token = await verified_token(apply_client, app)
    body = (await apply_client.get(f"{APPLY}/applications/{app.case_no}", headers=bearer(token))).json()
    assert body["next_action"] == "status.UNDER_REVIEW.next_action"
    assert body["next_action_text"] == "再等我們兩天。"


async def test_the_content_keys_follow_the_current_status(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T10")
    token = await verified_token(apply_client, app)
    body = (await apply_client.get(f"{APPLY}/applications/{app.case_no}", headers=bearer(token))).json()
    assert body["next_action"] == "status.WITHDRAWN.next_action"


async def test_a_token_for_one_case_is_refused_on_another(apply_client, db, tenant, scheme):
    first = await make_case(db, tenant, scheme)
    second = await make_case(db, tenant, scheme)
    token = await verified_token(apply_client, first)
    r = await apply_client.get(f"{APPLY}/applications/{second.case_no}", headers=bearer(token))
    assert r.status_code == 401


async def test_the_case_page_needs_a_token(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    assert (await apply_client.get(f"{APPLY}/applications/{app.case_no}")).status_code == 401


async def test_an_admin_jwt_is_not_a_case_token(apply_client, db, tenant, scheme, auth_headers, users):
    app = await make_case(db, tenant, scheme)
    r = await apply_client.get(f"{APPLY}/applications/{app.case_no}", headers=auth_headers("admin"))
    assert r.status_code == 401


# ------------------------------------------------------------------ 補件

async def test_supplementing_uploads_a_new_revision_and_returns_to_review(
    apply_client, db, tenant, scheme, rules, fake_storage
):
    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "old", "mime": "image/png"}])
    await drive(db, app, "T2")
    token = await verified_token(apply_client, app)

    data, files = multipart([{"document_type_code": "BILLING_STATEMENT", "mime": "image/png",
                              "page_count": 1, "ocr": ocr("金額 NT$6,000")}])
    r = await apply_client.post(f"{APPLY}/applications/{app.case_no}/documents",
                                data=data, files=files, headers=bearer(token))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "UNDER_REVIEW"       # T4 之後系統立刻走 T5

    docs = (await db.execute(
        select(ApplicationDocument).order_by(ApplicationDocument.revision)
    )).scalars().all()
    assert [(d.revision, d.is_current) for d in docs] == [(0, False), (1, True)]
    assert docs[1].supersedes_id == docs[0].id
    assert docs[1].object_key.endswith("/BILLING_STATEMENT/1.png")


async def test_supplementing_a_type_that_was_not_asked_for_is_refused(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")          # 只要求補 BILLING_STATEMENT
    token = await verified_token(apply_client, app)
    data, files = multipart([{"document_type_code": "ID_CARD_FRONT", "mime": "image/png", "page_count": 1}])
    r = await apply_client.post(f"{APPLY}/applications/{app.case_no}/documents",
                                data=data, files=files, headers=bearer(token))
    assert r.status_code == 400
    assert r.json() == {"code": "UNEXPECTED_DOCUMENT_TYPE", "document_type_code": "ID_CARD_FRONT"}


async def test_supplementing_a_case_that_is_not_waiting_for_one_is_refused(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    token = await verified_token(apply_client, app)
    data, files = multipart([{"document_type_code": "BILLING_STATEMENT", "mime": "image/png", "page_count": 1}])
    r = await apply_client.post(f"{APPLY}/applications/{app.case_no}/documents",
                                data=data, files=files, headers=bearer(token))
    assert r.status_code == 400 and r.json() == {"code": "NOT_IN_SUPPLEMENT"}


async def test_supplementing_bumps_the_revision_count_only_through_t2(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")
    assert app.revision_count == 1
    token = await verified_token(apply_client, app)
    data, files = multipart([{"document_type_code": "BILLING_STATEMENT", "mime": "image/png", "page_count": 1}])
    await apply_client.post(f"{APPLY}/applications/{app.case_no}/documents",
                            data=data, files=files, headers=bearer(token))
    await db.refresh(app)
    assert app.revision_count == 1 and app.supplement_items == []


# ------------------------------------------------------------------ 撤回

async def test_withdrawing_moves_the_case_to_withdrawn(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    token = await verified_token(apply_client, app)
    r = await apply_client.post(f"{APPLY}/applications/{app.case_no}/withdraw", headers=bearer(token))
    assert r.status_code == 200 and r.json() == {"status": "WITHDRAWN"}
    await db.refresh(app)
    assert app.status == "WITHDRAWN" and app.documents_purge_at is not None


async def test_withdrawing_an_approved_case_is_refused(apply_client, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T3")
    token = await verified_token(apply_client, app)
    r = await apply_client.post(f"{APPLY}/applications/{app.case_no}/withdraw", headers=bearer(token))
    assert r.status_code == 409


# -------------------------------------------------------------------- FAQ

@pytest.fixture
async def faqs(db, tenant, scheme) -> None:
    db.add_all([
        Faq(tenant_id=tenant.id, category="上傳", question="帳單看不清楚怎麼辦？",
            answer="重拍一張", keywords=["模糊", "重拍"], priority=10),
        Faq(tenant_id=tenant.id, category="資格", question="我可以申請嗎？",
            answer="看資格", keywords=["資格"], priority=5, scheme_id=scheme.id),
        Faq(tenant_id=tenant.id, category="停用", question="舊問題", answer="舊答案", active=False),
    ])
    await db.commit()


async def test_faqs_list_active_entries_by_priority(apply_client, faqs):
    body = (await apply_client.get(f"{APPLY}/faqs")).json()
    assert [f["question"] for f in body] == ["帳單看不清楚怎麼辦？", "我可以申請嗎？"]


async def test_faqs_search_matches_question_and_keywords(apply_client, faqs):
    assert len((await apply_client.get(f"{APPLY}/faqs", params={"q": "模糊"})).json()) == 1
    assert len((await apply_client.get(f"{APPLY}/faqs", params={"q": "資格"})).json()) == 1
    assert (await apply_client.get(f"{APPLY}/faqs", params={"q": "不存在的詞"})).json() == []


async def test_faqs_can_be_scoped_to_a_scheme(apply_client, faqs, scheme):
    body = (await apply_client.get(f"{APPLY}/faqs", params={"scheme": scheme.code})).json()
    assert len(body) == 2          # 方案專屬 + 通用


# ------------------------------------------------------------------ 限流

async def test_the_submit_endpoint_is_rate_limited_per_ip(apply_client, scheme, fake_redis):
    from app.routers import apply as apply_router

    data, files = multipart([], application=application_payload())
    for _ in range(apply_router.SUBMIT_LIMIT_PER_MINUTE):
        await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 429


async def test_the_read_endpoints_have_their_own_budget(apply_client, scheme, fake_redis):
    from app.routers import apply as apply_router

    for _ in range(apply_router.READ_LIMIT_PER_MINUTE):
        assert (await apply_client.get(f"{APPLY}/schemes")).status_code == 200
    assert (await apply_client.get(f"{APPLY}/schemes")).status_code == 429


async def test_a_dead_redis_never_blocks_traffic(apply_client, scheme, monkeypatch, fake_redis):
    async def boom(*_args, **_kw):
        raise RuntimeError("redis down")

    monkeypatch.setattr(fake_redis, "incr", boom)
    assert (await apply_client.get(f"{APPLY}/schemes")).status_code == 200


# ---------------------------------------------------- 匿名流量的 tenant 歸屬

async def test_anonymous_traffic_prefers_the_default_slug(db, tenant, default_tenant):
    """`slug="default"` 優先；否則取建立時間最早的那一個（決策 D18）。"""
    from app.services import tenancy

    assert await tenancy.default_tenant_id(db) == default_tenant.id


async def test_without_a_default_slug_the_oldest_tenant_wins(db, tenant):
    from app.services import tenancy

    assert await tenancy.default_tenant_id(db) == tenant.id


async def test_no_tenant_at_all_is_an_empty_string(db):
    from app.services import tenancy

    assert await tenancy.default_tenant_id(db) == ""


async def test_another_tenants_scheme_is_invisible_to_anonymous_callers(apply_client, db, tenant, scheme):
    """方案查得到與否只看預設 tenant，不看請求裡的任何欄位。"""
    from app.models import Scheme, Tenant

    other = Tenant(id="z" * 32, name="別的機關", slug="other")
    db.add(other)
    await db.flush()
    db.add(Scheme(tenant_id=other.id, code="OTHER115", name="別家的補助"))
    await db.commit()
    assert [s["code"] for s in (await apply_client.get(f"{APPLY}/schemes")).json()] == ["TEST115"]
    assert (await apply_client.get(f"{APPLY}/schemes/OTHER115")).status_code == 404


# -------------------------------------------- seed 的六條規則吃得進引擎

async def test_the_seeded_review_rules_are_valid_for_the_engine():
    """`scripts/seed_data.py` 的規則設定必須與規則引擎同一套語彙（SPEC §8.3）。"""
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import seed_data
    from app.services import review

    specs = [review.RuleSpec.from_dict(r) for r in seed_data.REVIEW_RULES]
    assert {s.rule_type for s in specs} == set(review.RULE_TYPES)
    findings = review.evaluate(specs, [], review.ApplicationFacts(purchase_amount=6000))
    assert len(findings) == len(specs)

    tolerance = next(s for s in specs if s.rule_type == "amount_tolerance")
    assert tolerance.config["tolerance_pct"] == 5          # 百分比，不是小數
    assert review.within_tolerance(6100, 6000, tolerance.config["tolerance_pct"],
                                   tolerance.config["tolerance_abs"]) is True
    assert review.within_tolerance(6200, 6000, tolerance.config["tolerance_pct"],
                                   tolerance.config["tolerance_abs"]) is False


async def test_the_seeded_required_doc_rule_falls_back_to_the_payment_channel():
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import seed_data
    from app.services import review

    specs = [review.RuleSpec.from_dict(r) for r in seed_data.REVIEW_RULES]
    facts = review.ApplicationFacts(purchase_amount=6000,
                                    required_document_type_codes=("BILLING_STATEMENT",))
    docs = {f.rule_code: f for f in review.evaluate(specs, [], facts)}["REQUIRED_DOCS_PRESENT"]
    assert docs.status == "MISMATCH" and docs.suggested_supplement == ("BILLING_STATEMENT",)
