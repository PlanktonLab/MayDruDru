"""驗收：**新增方案不改 code 即可送件**（SPEC §16 P5 / 決策 D6 / 未決事項 O5）。

這一份測試不測任何單一函式，它測的是一個承諾：一位承辦人員只用後台 API 把一個
全新的方案建起來——級距、文件類型、繳費管道、審核規則、退件碼——市民就能對它送件，
伺服器會用**這個方案自己的規則**判定，主管就能核准。整段路徑上沒有任何一行程式碼
提到這個方案的代碼。

所以這裡刻意不用 conftest 的 `scheme` fixture：那是測試自己 new 出來的物件，
用了就等於繞過「後台 API 建得起來」這個真正要驗的部分。
"""

from __future__ import annotations

import io
import json

import pytest
from app.models import Application, ReviewFinding, Scheme
from PIL import Image
from sqlalchemy import select

ADMIN = "/api/admin/schemes"
CASES = "/api/admin/applications"
APPLY = "/api/apply"
CODE = "AI116"


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), "white").save(buf, format="PNG")
    return buf.getvalue()


def ocr(text: str) -> dict:
    return {
        "text": text,
        "confidence": 92,
        "lines": [
            {"text": line, "confidence": 92,
             "bbox": {"x0": 0, "y0": 20 * i, "x1": 400, "y1": 20 * i + 18}}
            for i, line in enumerate(text.split("\n"))
        ],
    }


# 一個全新方案的完整設定，全部經由 `/api/admin/schemes` 建立。
SCHEME_BODY = {
    "code": CODE,
    "name": "AI 領航青年數位工具補助（116 年）",
    "category": "青年",
    "description": "補助青年購買 AI 數位工具的部分費用。",
    "eligibility": "設籍本市、年滿 18 歲至 45 歲。",
    "amount_note": "最高補助 3,000 元",
    "tags": ["青年", "數位"],
    "identity_tags": ["一般", "特定對象"],
    "details": [{"label": "承辦單位", "value": "青年事務科"}],
    "active": True,
    "retention_days": 60,
    "supplement_days": 10,
    "max_revisions": 2,
}

CHILDREN: list[tuple[str, dict]] = [
    ("tiers", {"code": "GENERAL", "label": "一般", "subsidy_rate": 0.5, "cap_amount": 3000,
               "required_proof_doc_types": [], "sort_order": 1}),
    ("tiers", {"code": "SPECIAL", "label": "特定對象", "subsidy_rate": 0.9, "cap_amount": 6000,
               "required_proof_doc_types": ["SPECIAL_PROOF"], "sort_order": 2}),
    ("document-types", {"code": "ID_DOC", "label": "身分證明", "hint": "正面即可", "required": True,
                        "must_mask": False, "accepted_mime": ["image/png", "image/jpeg"],
                        "max_pages": 1, "sort_order": 1}),
    ("document-types", {"code": "RECEIPT", "label": "消費證明", "hint": "需看得到臺幣金額",
                        "required": False, "must_mask": True,
                        "accepted_mime": ["image/png", "image/jpeg"], "max_pages": 3, "sort_order": 2}),
    ("document-types", {"code": "SPECIAL_PROOF", "label": "特定對象證明", "required": False, "sort_order": 3}),
    ("payment-channels", {"code": "CREDIT_CARD", "label": "信用卡",
                          "required_document_type_codes": ["RECEIPT"],
                          "guide_content_key": "apply.guide.credit_card", "sort_order": 1}),
    ("review-rules", {"code": "TWD_AMOUNT", "label": "消費證明上有臺幣金額",
                      "document_type_code": "RECEIPT", "rule_type": "keyword_extract",
                      "required": True, "severity": "error", "sort_order": 1, "active": True,
                      "config": {"keywords": ["新臺幣", "NT$"], "value_after_keyword": True,
                                 "regex": r"[\d,]+", "normalize": "amount"}}),
    ("review-rules", {"code": "AMOUNT_MATCHES", "label": "金額與申報相符",
                      "document_type_code": "RECEIPT", "rule_type": "amount_tolerance",
                      "required": True, "severity": "error", "sort_order": 2, "active": True,
                      "config": {"source_rule_code": "TWD_AMOUNT", "compare_to": "purchase_amount",
                                 "tolerance_pct": 5, "tolerance_abs": 150}}),
    ("review-rules", {"code": "DOCS_PRESENT", "label": "必要文件齊備",
                      "document_type_code": "", "rule_type": "required_doc",
                      "required": True, "severity": "error", "sort_order": 3, "active": True,
                      "config": {"document_type_codes": []}}),
    ("rejection-codes", {"code": "NO_TWD", "staff_label": "看不到臺幣金額",
                         "public_what_wrong": "消費證明上看不到換算後的臺幣金額。",
                         "public_how_to_fix": "請重新上傳一張看得到臺幣金額的明細。",
                         "related_document_type_codes": ["RECEIPT"], "sort_order": 1, "active": True}),
    ("eligible-tools", {"name": "示範 AI 工具", "vendor": "示範廠商", "aliases": ["demo ai"],
                        "status": "APPROVED", "sort_order": 1}),
]

RECEIPT_TEXT = "消費明細\n新臺幣 3,000\n扣款日 2026/09/01"


@pytest.fixture
async def built_scheme(apply_client, auth_headers, db, tenant):
    """完全用後台 API 建出來的方案。回傳它的 code。"""
    created = await apply_client.post(ADMIN, json=SCHEME_BODY, headers=auth_headers("admin"))
    assert created.status_code == 201, created.text
    for kind, body in CHILDREN:
        r = await apply_client.post(f"{ADMIN}/{CODE}/{kind}", json=body, headers=auth_headers("admin"))
        assert r.status_code == 201, (kind, body.get("code") or body.get("name"), r.text)
    return CODE


def submit_payload(amount: int = 3000) -> tuple[dict, list]:
    specs = [
        {"document_type_code": "ID_DOC", "masked": False, "mime": "image/png", "page_count": 1, "ocr": None},
        {"document_type_code": "RECEIPT", "masked": True, "mime": "image/png", "page_count": 1,
         "ocr": ocr(RECEIPT_TEXT)},
    ]
    data = {
        "documents": json.dumps(specs),
        "application": json.dumps({
            "scheme_code": CODE,
            "tier_code": "GENERAL",
            "payment_channel_code": "CREDIT_CARD",
            "applicant_name": "測試用小華",
            "phone": "0912345678",
            "id_last4": "6789",
            "tool_name": "示範 AI 工具",
            "purchase_amount": amount,
            "purchase_date": "2026-09-01",
            "paid_by_proxy": False,
        }),
    }
    files = [(f"file_{i}", (f"doc{i}.png", png_bytes(), "image/png")) for i in range(len(specs))]
    return data, files


# ------------------------------------------------------------------ 建起來

async def test_the_admin_api_alone_builds_a_whole_new_scheme(apply_client, auth_headers, db, built_scheme):
    row = (await db.execute(select(Scheme).where(Scheme.code == CODE))).scalar_one()
    assert row.name.startswith("AI 領航青年")
    assert {t.code for t in row.tiers} == {"GENERAL", "SPECIAL"}
    assert {d.code for d in row.document_types} == {"ID_DOC", "RECEIPT", "SPECIAL_PROOF"}
    assert {c.code for c in row.payment_channels} == {"CREDIT_CARD"}
    assert {r.code for r in row.review_rules} == {"TWD_AMOUNT", "AMOUNT_MATCHES", "DOCS_PRESENT"}
    assert {r.code for r in row.rejection_codes} == {"NO_TWD"}


async def test_the_new_scheme_shows_up_for_citizens_without_a_deploy(apply_client, built_scheme):
    listed = (await apply_client.get(f"{APPLY}/schemes")).json()
    assert CODE in {s["code"] for s in listed}


async def test_the_citizen_facing_detail_carries_the_configured_rules(apply_client, built_scheme):
    body = (await apply_client.get(f"{APPLY}/schemes/{CODE}")).json()
    assert [r["code"] for r in body["review_rules"]] == ["TWD_AMOUNT", "AMOUNT_MATCHES", "DOCS_PRESENT"]
    assert body["supplement_days"] == 10 and body["max_revisions"] == 2


async def test_required_documents_come_from_the_new_configuration(apply_client, built_scheme):
    r = await apply_client.post(f"{APPLY}/schemes/{CODE}/required-documents",
                                json={"tier_code": "SPECIAL", "payment_channel_code": "CREDIT_CARD",
                                      "paid_by_proxy": False})
    assert r.json()["document_type_codes"] == ["ID_DOC", "RECEIPT", "SPECIAL_PROOF"]


# ------------------------------------------------------------------ 送得進去

async def test_a_citizen_can_submit_to_the_brand_new_scheme(apply_client, db, built_scheme):
    data, files = submit_payload()
    r = await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    assert r.status_code == 201, r.text
    assert r.json()["case_no"].startswith("HC-")
    assert r.json()["status"] == "UNDER_REVIEW"
    app = (await db.execute(select(Application))).scalars().one()
    assert app.scheme_id == (await db.execute(select(Scheme.id).where(Scheme.code == CODE))).scalar_one()


async def test_the_findings_come_from_the_rules_the_clerk_just_wrote(apply_client, built_scheme):
    data, files = submit_payload()
    body = (await apply_client.post(f"{APPLY}/applications", data=data, files=files)).json()
    by_code = {f["rule_code"]: f for f in body["findings"]}
    assert set(by_code) == {"TWD_AMOUNT", "AMOUNT_MATCHES", "DOCS_PRESENT"}
    assert by_code["TWD_AMOUNT"]["status"] == "MATCH"
    assert by_code["TWD_AMOUNT"]["extracted_value"] == "3000"
    assert by_code["AMOUNT_MATCHES"]["status"] == "MATCH"
    assert body["verdict"] == "PASS"


async def test_a_wrong_amount_is_caught_by_the_new_scheme_rules(apply_client, built_scheme):
    data, files = submit_payload(amount=9999)
    body = (await apply_client.post(f"{APPLY}/applications", data=data, files=files)).json()
    by_code = {f["rule_code"]: f for f in body["findings"]}
    assert by_code["AMOUNT_MATCHES"]["status"] == "MISMATCH"
    assert body["verdict"] == "FAIL"


async def test_the_server_re_runs_the_rules_and_persists_them(apply_client, db, built_scheme):
    data, files = submit_payload()
    await apply_client.post(f"{APPLY}/applications", data=data, files=files)
    rows = (await db.execute(select(ReviewFinding))).scalars().all()
    assert {r.rule_code for r in rows} == {"TWD_AMOUNT", "AMOUNT_MATCHES", "DOCS_PRESENT"}
    assert {r.source for r in rows} == {"auto"}


# ------------------------------------------------------------------ 審得完

async def test_the_case_reaches_the_review_queue_with_the_new_scheme_settings(
    apply_client, auth_headers, built_scheme
):
    data, files = submit_payload()
    case_no = (await apply_client.post(f"{APPLY}/applications", data=data, files=files)).json()["case_no"]
    detail = (await apply_client.get(f"{CASES}/{case_no}", headers=auth_headers("case_reviewer"))).json()
    assert detail["scheme_settings"]["code"] == CODE
    assert [c["code"] for c in detail["scheme_settings"]["rejection_codes"]] == ["NO_TWD"]
    assert detail["scheme_settings"]["supplement_days"] == 10


async def test_a_supervisor_can_approve_a_case_on_the_new_scheme(apply_client, auth_headers, db, built_scheme):
    """核准的前置條件是「所有 required 規則都 MATCH」，而那些規則是剛剛才寫進去的。"""
    data, files = submit_payload()
    case_no = (await apply_client.post(f"{APPLY}/applications", data=data, files=files)).json()["case_no"]
    r = await apply_client.post(f"{CASES}/{case_no}/transitions",
                                json={"code": "T3", "payload": {"approved_amount": 1500}},
                                headers=auth_headers("case_supervisor"))
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "APPROVED"


async def test_a_failing_case_on_the_new_scheme_cannot_be_approved(apply_client, auth_headers, built_scheme):
    """同一組規則也要擋得住：金額對不上就不准過（SPEC §8.3，伺服器端強制）。"""
    data, files = submit_payload(amount=9999)
    case_no = (await apply_client.post(f"{APPLY}/applications", data=data, files=files)).json()["case_no"]
    r = await apply_client.post(f"{CASES}/{case_no}/transitions", json={"code": "T3"},
                                headers=auth_headers("case_supervisor"))
    assert r.status_code == 409, r.text


async def test_the_new_schemes_rejection_code_can_be_used_to_send_it_back(apply_client, auth_headers, built_scheme):
    data, files = submit_payload(amount=9999)
    case_no = (await apply_client.post(f"{APPLY}/applications", data=data, files=files)).json()["case_no"]
    r = await apply_client.post(
        f"{CASES}/{case_no}/transitions",
        json={"code": "T2", "supplement_items": [
            {"document_type_code": "RECEIPT", "rejection_code": "NO_TWD", "note": "金額對不上"}]},
        headers=auth_headers("case_reviewer"),
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "NEEDS_REVISION"


async def test_the_scheme_copilot_writes_copy_for_the_brand_new_scheme(apply_client, auth_headers, built_scheme):
    """新方案連文案都不必手寫第一版——助理依設定產草稿，承辦人員改完再發布。"""
    body = (await apply_client.post(f"/api/admin/copilot/schemes/{CODE}/drafts",
                                    headers=auth_headers("admin"))).json()
    keys = {d["key"] for d in body["drafts"]}
    assert f"scheme.{CODE}.guide.RECEIPT" in keys
    assert f"scheme.{CODE}.rejection.NO_TWD.public_how_to_fix" in keys
    assert f"scheme.{CODE}.status.APPROVED.public_label" in keys
