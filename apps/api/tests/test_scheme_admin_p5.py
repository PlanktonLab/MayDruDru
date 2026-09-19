"""方案管理區的三個新動作：排序、待審工具、規則試算（SPEC §8.2 / §8.3 / P5）。

規則試算是這三支裡最值得寫測試的一支：它存在的理由是**校準**——後台的試算面板在
瀏覽器裡跑 `@maydru/review-rules`，這一支跑的是 `services/review.py`，兩邊對同一段
文字必須判得一樣。所以這裡的斷言不只是「有回 findings」，而是「判出來的值就是
規則引擎本人算的那一個」。
"""

from __future__ import annotations

import pytest
from app.models import AuditLog, DocumentType, EligibleTool, ReviewRule
from app.services import review
from sqlalchemy import select

ADMIN = "/api/admin/schemes"
NON_ADMIN_ROLES = ["viewer", "sop_editor", "sop_reviewer", "case_reviewer", "case_supervisor"]


def ocr(text: str, confidence: int = 90) -> dict:
    return {
        "text": text,
        "confidence": confidence,
        "lines": [
            {"text": line, "confidence": confidence,
             "bbox": {"x0": 0, "y0": 20 * i, "x1": 400, "y1": 20 * i + 18}}
            for i, line in enumerate(text.split("\n"))
        ],
    }


@pytest.fixture
async def rules(db, scheme):
    rows = [
        ReviewRule(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="TWD_AMOUNT",
                   label="臺幣金額", document_type_code="BILLING_STATEMENT",
                   rule_type="keyword_extract", sort_order=1, required=True, severity="error",
                   config={"keywords": ["新臺幣", "NT$"], "value_after_keyword": True,
                           "regex": r"[\d,]+", "normalize": "amount"}),
        ReviewRule(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="AMOUNT_MATCHES",
                   label="金額相符", document_type_code="BILLING_STATEMENT",
                   rule_type="amount_tolerance", sort_order=2, required=True, severity="error",
                   config={"source_rule_code": "TWD_AMOUNT", "compare_to": "purchase_amount",
                           "tolerance_pct": 5, "tolerance_abs": 150}),
    ]
    db.add_all(rows)
    await db.commit()
    await db.refresh(scheme)
    return rows


@pytest.fixture
async def tools(db, scheme):
    rows = [
        EligibleTool(tenant_id=scheme.tenant_id, scheme_id=scheme.id, name="ChatGPT Plus",
                     vendor="OpenAI", aliases=["chatgpt"], status="APPROVED", sort_order=1),
        EligibleTool(tenant_id=scheme.tenant_id, scheme_id=scheme.id, name="chatgpt 訂閱",
                     status="PENDING", request_count=3, sort_order=2),
        EligibleTool(tenant_id=scheme.tenant_id, scheme_id=scheme.id, name="某個沒聽過的工具",
                     status="PENDING", request_count=1, sort_order=3),
    ]
    db.add_all(rows)
    await db.commit()
    await db.refresh(scheme)
    return rows


async def audit_actions(db) -> list[str]:
    return [r.action for r in (await db.execute(select(AuditLog))).scalars()]


# =================================================================== 排序

async def test_reordering_rewrites_sort_order_in_the_order_given(client, auth_headers, db, scheme):
    ids = [d.id for d in (await db.execute(
        select(DocumentType).where(DocumentType.scheme_id == scheme.id).order_by(DocumentType.sort_order)
    )).scalars()]
    flipped = list(reversed(ids))
    r = await client.post(f"{ADMIN}/{scheme.code}/document-types/reorder",
                          json={"ids": flipped}, headers=auth_headers("admin"))
    assert r.status_code == 200, r.text
    assert [row["id"] for row in r.json()] == flipped
    assert [row["sort_order"] for row in r.json()] == list(range(len(flipped)))


async def test_a_row_left_out_of_the_order_lands_at_the_back(client, auth_headers, db, scheme):
    ids = [d.id for d in (await db.execute(
        select(DocumentType).where(DocumentType.scheme_id == scheme.id).order_by(DocumentType.sort_order)
    )).scalars()]
    r = await client.post(f"{ADMIN}/{scheme.code}/document-types/reorder",
                          json={"ids": ids[1:]}, headers=auth_headers("admin"))
    assert [row["id"] for row in r.json()][-1] == ids[0]


async def test_an_id_that_no_longer_exists_is_ignored_rather_than_a_404(client, auth_headers, db, scheme):
    """按下儲存的那一刻別人剛好刪掉其中一列——那不該讓整次排序失敗。"""
    ids = [d.id for d in (await db.execute(
        select(DocumentType).where(DocumentType.scheme_id == scheme.id)
    )).scalars()]
    r = await client.post(f"{ADMIN}/{scheme.code}/document-types/reorder",
                          json={"ids": ["ghost", *ids]}, headers=auth_headers("admin"))
    assert r.status_code == 200
    assert len(r.json()) == len(ids)


async def test_reordering_an_empty_list_keeps_the_existing_order(client, auth_headers, db, scheme):
    before = [row["id"] for row in (await client.get(f"{ADMIN}/{scheme.code}/document-types",
                                                     headers=auth_headers("admin"))).json()]
    r = await client.post(f"{ADMIN}/{scheme.code}/document-types/reorder",
                          json={"ids": []}, headers=auth_headers("admin"))
    assert [row["id"] for row in r.json()] == before


async def test_reordering_review_rules_works_too(client, auth_headers, scheme, rules):
    ids = [r.id for r in rules]
    r = await client.post(f"{ADMIN}/{scheme.code}/review-rules/reorder",
                          json={"ids": list(reversed(ids))}, headers=auth_headers("admin"))
    assert [row["code"] for row in r.json()] == ["AMOUNT_MATCHES", "TWD_AMOUNT"]


async def test_reordering_an_unknown_kind_is_a_404(client, auth_headers, scheme):
    r = await client.post(f"{ADMIN}/{scheme.code}/nonsense/reorder", json={"ids": []},
                          headers=auth_headers("admin"))
    assert r.status_code == 404


async def test_reordering_an_unknown_scheme_is_a_404(client, auth_headers, tenant):
    r = await client.post(f"{ADMIN}/NOPE/document-types/reorder", json={"ids": []},
                          headers=auth_headers("admin"))
    assert r.status_code == 404


async def test_reordering_writes_an_audit_row(client, auth_headers, db, scheme):
    await client.post(f"{ADMIN}/{scheme.code}/document-types/reorder", json={"ids": []},
                      headers=auth_headers("admin"))
    assert "reorder" in await audit_actions(db)


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
async def test_reordering_needs_the_admin_capability(client, auth_headers, role, scheme):
    r = await client.post(f"{ADMIN}/{scheme.code}/document-types/reorder", json={"ids": []},
                          headers=auth_headers(role))
    assert r.status_code == 403


# ============================================================= 待審工具

async def test_the_pending_queue_only_has_pending_tools(client, auth_headers, scheme, tools):
    body = (await client.get(f"{ADMIN}/{scheme.code}/eligible-tools/pending",
                             headers=auth_headers("admin"))).json()
    assert {t["name"] for t in body} == {"chatgpt 訂閱", "某個沒聽過的工具"}


async def test_the_pending_queue_puts_the_most_asked_for_tool_first(client, auth_headers, scheme, tools):
    body = (await client.get(f"{ADMIN}/{scheme.code}/eligible-tools/pending",
                             headers=auth_headers("admin"))).json()
    assert body[0]["name"] == "chatgpt 訂閱"


async def test_approving_a_pending_tool_keeps_the_note(client, auth_headers, db, scheme, tools):
    r = await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[2].id}/resolve",
                          json={"status": "APPROVED", "verdict_note": "查過了，符合補助範圍"},
                          headers=auth_headers("admin"))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "APPROVED"
    assert r.json()["verdict_note"] == "查過了，符合補助範圍"


async def test_rejecting_a_pending_tool_keeps_it_on_the_list_as_rejected(client, auth_headers, db, scheme, tools):
    await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[2].id}/resolve",
                      json={"status": "REJECTED", "verdict_note": "不是數位工具"},
                      headers=auth_headers("admin"))
    row = await db.get(EligibleTool, tools[2].id)
    await db.refresh(row)
    assert row.status == "REJECTED"


async def test_resolving_bumps_the_version(client, auth_headers, db, scheme, tools):
    before = tools[2].version
    r = await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[2].id}/resolve",
                          json={"status": "APPROVED"}, headers=auth_headers("admin"))
    assert r.json()["version"] == before + 1


async def test_merging_a_pending_tool_folds_its_name_into_the_aliases(client, auth_headers, db, scheme, tools):
    r = await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[1].id}/resolve",
                          json={"status": "APPROVED", "merge_into_id": tools[0].id},
                          headers=auth_headers("admin"))
    assert r.status_code == 200, r.text
    assert r.json()["id"] == tools[0].id
    assert "chatgpt 訂閱" in r.json()["aliases"]
    assert "chatgpt" in r.json()["aliases"]           # 原本就有的別名留著


async def test_merging_sums_the_request_counts(client, auth_headers, scheme, tools):
    r = await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[1].id}/resolve",
                          json={"status": "APPROVED", "merge_into_id": tools[0].id},
                          headers=auth_headers("admin"))
    assert r.json()["request_count"] == 3


async def test_merging_deletes_the_duplicate_row(client, auth_headers, db, scheme, tools):
    """留著只會讓同一個工具在清單上出現兩次。"""
    await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[1].id}/resolve",
                      json={"status": "APPROVED", "merge_into_id": tools[0].id},
                      headers=auth_headers("admin"))
    assert await db.get(EligibleTool, tools[1].id) is None


async def test_merging_into_an_unknown_tool_is_a_404(client, auth_headers, scheme, tools):
    r = await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[1].id}/resolve",
                          json={"status": "APPROVED", "merge_into_id": "ghost"},
                          headers=auth_headers("admin"))
    assert r.status_code == 404


async def test_merging_a_tool_into_itself_is_a_404(client, auth_headers, scheme, tools):
    r = await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[1].id}/resolve",
                          json={"status": "APPROVED", "merge_into_id": tools[1].id},
                          headers=auth_headers("admin"))
    assert r.status_code == 404


async def test_resolving_an_unknown_tool_is_a_404(client, auth_headers, scheme):
    r = await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/ghost/resolve",
                          json={"status": "APPROVED"}, headers=auth_headers("admin"))
    assert r.status_code == 404


async def test_an_unknown_status_is_refused(client, auth_headers, scheme, tools):
    r = await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[1].id}/resolve",
                          json={"status": "MAYBE"}, headers=auth_headers("admin"))
    assert r.status_code == 422


async def test_resolving_writes_an_audit_row(client, auth_headers, db, scheme, tools):
    await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[1].id}/resolve",
                      json={"status": "APPROVED"}, headers=auth_headers("admin"))
    assert "resolve" in await audit_actions(db)


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
async def test_resolving_needs_the_admin_capability(client, auth_headers, role, scheme, tools):
    r = await client.post(f"{ADMIN}/{scheme.code}/eligible-tools/{tools[1].id}/resolve",
                          json={"status": "APPROVED"}, headers=auth_headers(role))
    assert r.status_code == 403


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
async def test_the_pending_queue_needs_the_admin_capability(client, auth_headers, role, scheme):
    r = await client.get(f"{ADMIN}/{scheme.code}/eligible-tools/pending", headers=auth_headers(role))
    assert r.status_code == 403


# ============================================================= 規則試算

BILL = "消費明細\n新臺幣 1,200\n卡號 ****1234"


async def test_dry_run_uses_the_rules_the_scheme_already_has(client, auth_headers, scheme, rules):
    r = await client.post(
        f"{ADMIN}/{scheme.code}/review-rules/evaluate",
        json={"documents": [{"document_type_code": "BILLING_STATEMENT", "ocr": ocr(BILL)}],
              "facts": {"purchase_amount": 1200, "payment_channel_code": "CREDIT_CARD"}},
        headers=auth_headers("admin"),
    )
    assert r.status_code == 200, r.text
    by_code = {f["rule_code"]: f for f in r.json()["findings"]}
    assert by_code["TWD_AMOUNT"]["status"] == "MATCH"
    assert by_code["TWD_AMOUNT"]["extracted_value"] == "1200"
    assert by_code["AMOUNT_MATCHES"]["status"] == "MATCH"


async def test_dry_run_says_where_the_bbox_is_so_the_panel_can_highlight_it(client, auth_headers, scheme, rules):
    body = (await client.post(
        f"{ADMIN}/{scheme.code}/review-rules/evaluate",
        json={"documents": [{"document_type_code": "BILLING_STATEMENT", "ocr": ocr(BILL)}],
              "facts": {"purchase_amount": 1200}},
        headers=auth_headers("admin"))).json()
    hit = next(f for f in body["findings"] if f["rule_code"] == "TWD_AMOUNT")
    assert hit["bbox"] == {"x0": 0, "y0": 20, "x1": 400, "y1": 38}


async def test_dry_run_flags_a_mismatched_amount_as_blocking(client, auth_headers, scheme, rules):
    body = (await client.post(
        f"{ADMIN}/{scheme.code}/review-rules/evaluate",
        json={"documents": [{"document_type_code": "BILLING_STATEMENT", "ocr": ocr(BILL)}],
              "facts": {"purchase_amount": 9999}},
        headers=auth_headers("admin"))).json()
    assert body["verdict"] == "FAIL"
    assert body["blocking"] == ["AMOUNT_MATCHES"]


async def test_dry_run_takes_the_rules_being_edited_before_they_are_saved(client, auth_headers, scheme):
    """規則編輯器要能在存檔前試算，否則每改一個關鍵字就得先寫進資料庫。"""
    body = (await client.post(
        f"{ADMIN}/{scheme.code}/review-rules/evaluate",
        json={
            "rules": [{"code": "DRAFT_RULE", "label": "草稿規則", "document_type_code": "BILLING_STATEMENT",
                       "rule_type": "keyword_extract", "required": True, "severity": "error",
                       "sort_order": 1, "active": True,
                       "config": {"keywords": ["卡號"], "value_after_keyword": True, "normalize": "last4"}}],
            "documents": [{"document_type_code": "BILLING_STATEMENT", "ocr": ocr(BILL)}],
            "facts": {},
        },
        headers=auth_headers("admin"))).json()
    assert [f["rule_code"] for f in body["findings"]] == ["DRAFT_RULE"]
    assert body["findings"][0]["extracted_value"] == "1234"


async def test_dry_run_derives_the_required_documents_from_the_scheme(client, auth_headers, db, scheme):
    """`required_doc` 沒給清單時要看方案自己算出來的必要文件，而不是判成沒事。"""
    db.add(ReviewRule(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="DOCS",
                      label="必要文件齊備", document_type_code="", rule_type="required_doc",
                      sort_order=1, required=True, severity="error", config={"document_type_codes": []}))
    await db.commit()
    body = (await client.post(
        f"{ADMIN}/{scheme.code}/review-rules/evaluate",
        json={"documents": [], "facts": {"tier_code": "GENERAL", "payment_channel_code": "CREDIT_CARD"}},
        headers=auth_headers("admin"))).json()
    assert body["findings"][0]["status"] == "MISMATCH"
    assert body["suggested_supplement"] == ["ID_CARD_FRONT", "BILLING_STATEMENT"]


async def test_dry_run_with_nothing_to_look_at_is_unreadable_not_a_crash(client, auth_headers, scheme, rules):
    body = (await client.post(f"{ADMIN}/{scheme.code}/review-rules/evaluate", json={},
                              headers=auth_headers("admin"))).json()
    assert {f["status"] for f in body["findings"]} == {"UNREADABLE"}
    assert body["verdict"] == "INDETERMINATE"


async def test_dry_run_matches_the_engine_exactly(client, auth_headers, db, scheme, rules):
    """校準：端點回的必須就是 `services/review.evaluate()` 算的，一個欄位都不差。"""
    documents = [{"document_type_code": "BILLING_STATEMENT", "ocr": ocr(BILL)}]
    facts = {"purchase_amount": 1200, "payment_channel_code": "CREDIT_CARD", "tier_code": "GENERAL"}
    body = (await client.post(f"{ADMIN}/{scheme.code}/review-rules/evaluate",
                              json={"documents": documents, "facts": facts},
                              headers=auth_headers("admin"))).json()
    direct = review.evaluate(
        await review.rules_for(db, scheme.id),
        [review.OcrDocument(document_type_code="BILLING_STATEMENT", ocr=review.OcrResult.from_dict(ocr(BILL)))],
        review.ApplicationFacts.from_dict(facts | {"required_document_type_codes": ["ID_CARD_FRONT", "BILLING_STATEMENT"]}),
    )
    assert body["findings"] == [f.to_dict() for f in direct]


async def test_dry_run_leaves_no_findings_behind(client, auth_headers, db, scheme, rules):
    """試算是純運算：按幾次都不會在 `review_findings` 留下假資料。"""
    from app.models import ReviewFinding

    for _ in range(3):
        await client.post(f"{ADMIN}/{scheme.code}/review-rules/evaluate",
                          json={"documents": [{"document_type_code": "BILLING_STATEMENT", "ocr": ocr(BILL)}],
                                "facts": {"purchase_amount": 1200}},
                          headers=auth_headers("admin"))
    assert (await db.execute(select(ReviewFinding))).scalars().all() == []


async def test_dry_run_on_an_unknown_scheme_is_a_404(client, auth_headers, tenant):
    r = await client.post(f"{ADMIN}/NOPE/review-rules/evaluate", json={}, headers=auth_headers("admin"))
    assert r.status_code == 404


async def test_the_evaluate_route_is_not_shadowed_by_the_child_resource_route(client, auth_headers, scheme, rules):
    """`/{code}/{kind}/reorder` 與 `/{code}/{kind}/{child_id}` 都長得像它，順序不能錯。"""
    r = await client.post(f"{ADMIN}/{scheme.code}/review-rules/evaluate", json={},
                          headers=auth_headers("admin"))
    assert r.status_code == 200
    assert "verdict" in r.json()


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
async def test_dry_run_needs_the_admin_capability(client, auth_headers, role, scheme):
    r = await client.post(f"{ADMIN}/{scheme.code}/review-rules/evaluate", json={},
                          headers=auth_headers(role))
    assert r.status_code == 403
