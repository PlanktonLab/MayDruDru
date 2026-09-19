"""`/api/admin/applications` 的審核能力（SPEC §8.2「案件審核」/ §8.3 / 契約 P3）。

佇列的分頁與搜尋、案件頁的 findings 與 rules、presigned URL、承辦人重新辨識、
人工覆寫，以及**伺服器端的核准前置條件**——最後一項是這一段的重點：前端顯示什麼
都不算數，T3 只有在所有 required 規則的最新判定都是 MATCH 時才過（SPEC §8.3）。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.models import ApplicationDocument, DocumentOcrResult, ReviewFinding, ReviewRule
from app.services import review
from sqlalchemy import select

from tests.test_apply_api import ocr
from tests.test_state_machine import drive, make_case

CASES = "/api/admin/applications"


@pytest.fixture
async def rules(db, scheme) -> list[ReviewRule]:
    """一條必要的抽值規則 + 一條非必要的警告規則。"""
    rows = [
        ReviewRule(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="AMOUNT",
                   label="臺幣金額", document_type_code="BILLING_STATEMENT",
                   rule_type="keyword_extract", sort_order=10, required=True, severity="error",
                   config={"keywords": ["金額"], "value_after_keyword": True, "normalize": "amount"}),
        ReviewRule(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="CARD",
                   label="卡號末四碼", document_type_code="BILLING_STATEMENT",
                   rule_type="keyword_extract", sort_order=20, required=False, severity="warning",
                   config={"keywords": ["卡號"], "value_after_keyword": True, "normalize": "last4"}),
    ]
    db.add_all(rows)
    await db.commit()
    await db.refresh(scheme)
    return rows


@pytest.fixture
async def case(db, tenant, scheme):
    """一件帶帳單的案子，停在 UNDER_REVIEW。"""
    return await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "docs/bill.png",
         "preview_key": "docs/bill-preview.jpg", "mime": "image/png", "size": 1234, "page_count": 1},
    ])


async def add_ocr(db, app, text: str, *, source: str = "applicant") -> DocumentOcrResult:
    doc = (await db.execute(
        select(ApplicationDocument).where(ApplicationDocument.application_id == app.id)
    )).scalars().first()
    row = DocumentOcrResult(tenant_id=app.tenant_id, document_id=doc.id, source=source,
                            **{k: v for k, v in ocr(text).items() if k in ("text", "confidence", "lines")})
    db.add(row)
    await db.commit()
    return row


# ------------------------------------------------------------------ 佇列

async def test_the_queue_paginates(admin_client, auth_headers, db, tenant, scheme):
    base = datetime.now(UTC) - timedelta(days=5)
    for i in range(5):
        await make_case(db, tenant, scheme, now=base + timedelta(hours=i))
    first = (await admin_client.get(CASES, params={"page": 1, "page_size": 2},
                                    headers=auth_headers("case_reviewer"))).json()
    second = (await admin_client.get(CASES, params={"page": 2, "page_size": 2},
                                     headers=auth_headers("case_reviewer"))).json()
    assert first["total"] == 5 and len(first["items"]) == 2
    assert len(second["items"]) == 2
    assert {i["case_no"] for i in first["items"]}.isdisjoint({i["case_no"] for i in second["items"]})


async def test_the_queue_filters_by_scheme_code(admin_client, auth_headers, db, tenant, scheme):
    await make_case(db, tenant, scheme)
    hit = (await admin_client.get(CASES, params={"scheme": scheme.code},
                                  headers=auth_headers("case_reviewer"))).json()
    miss = (await admin_client.get(CASES, params={"scheme": "NOPE"},
                                   headers=auth_headers("case_reviewer"))).json()
    assert hit["total"] == 1 and miss["total"] == 0


async def test_the_queue_searches_case_no_name_and_tool(admin_client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    headers = auth_headers("case_reviewer")
    for needle in (app.case_no, "小明", "ChatGPT"):
        body = (await admin_client.get(CASES, params={"q": needle}, headers=headers)).json()
        assert [i["case_no"] for i in body["items"]] == [app.case_no], needle
    assert (await admin_client.get(CASES, params={"q": "查無此人"}, headers=headers)).json()["total"] == 0


async def test_the_queue_filters_by_assigned_reviewer(admin_client, auth_headers, db, tenant, scheme, users):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")          # 轉移會順手指派給操作的人
    await db.refresh(app)
    headers = auth_headers("case_reviewer")
    body = (await admin_client.get(CASES, params={"assigned": app.assigned_reviewer_id},
                                   headers=headers)).json()
    assert body["total"] == 1


async def test_queue_rows_carry_the_scheme_and_the_verdict(admin_client, auth_headers, db, tenant, scheme,
                                                           rules, case):
    await add_ocr(db, case, "金額 NT$6,000\n卡號 ****4826")
    await review.persist_findings(db, case, await review.evaluate_application(db, case))
    await db.commit()
    item = (await admin_client.get(CASES, headers=auth_headers("case_reviewer"))).json()["items"][0]
    assert item["scheme_code"] == scheme.code and item["scheme_name"] == scheme.name
    assert item["verdict"] == "PASS"
    assert item["assigned_reviewer"] is None


async def test_a_case_without_findings_has_no_verdict(admin_client, auth_headers, db, tenant, scheme):
    await make_case(db, tenant, scheme)
    item = (await admin_client.get(CASES, headers=auth_headers("case_reviewer"))).json()["items"][0]
    assert item["verdict"] is None


# ---------------------------------------------------------------- 案件頁

async def test_the_case_page_carries_rules_documents_and_ocr(admin_client, auth_headers, db, rules, case):
    await add_ocr(db, case, "金額 NT$6,000")
    body = (await admin_client.get(f"{CASES}/{case.case_no}", headers=auth_headers("case_reviewer"))).json()
    assert [r["code"] for r in body["rules"]] == ["AMOUNT", "CARD"]
    doc = body["documents"][0]
    assert doc["document_type_code"] == "BILLING_STATEMENT"
    assert doc["ocr"]["source"] == "applicant" and doc["ocr"]["lines"]
    assert body["id_last4_masked"] == "****"
    assert body["phone_masked"] == "******5678"


async def test_approval_blockers_list_every_required_rule_without_a_match(admin_client, auth_headers,
                                                                         db, rules, case):
    body = (await admin_client.get(f"{CASES}/{case.case_no}", headers=auth_headers("case_supervisor"))).json()
    assert [b["rule_code"] for b in body["approval_blockers"]] == ["AMOUNT"]
    assert body["approval_blockers"][0]["label"] == "臺幣金額"


async def test_allowed_transitions_use_the_contract_field_names(admin_client, auth_headers, db, case):
    body = (await admin_client.get(f"{CASES}/{case.case_no}", headers=auth_headers("case_reviewer"))).json()
    t2 = next(t for t in body["allowed_transitions"] if t["code"] == "T2")
    assert t2["needs_supplement_items"] is True
    assert t2["needs_reason"] is False and t2["needs_rejection_codes"] is False


# ------------------------------------------------------------ presigned URL

async def test_the_document_url_is_presigned_and_short_lived(admin_client, auth_headers, db, case,
                                                             fake_storage):
    doc = (await db.execute(select(ApplicationDocument))).scalars().one()
    r = await admin_client.get(f"{CASES}/{case.case_no}/documents/{doc.id}/url",
                               headers=auth_headers("case_reviewer"))
    assert r.status_code == 200
    body = r.json()
    assert body["url"].startswith("https://minio.test/")
    assert fake_storage.presigned == ["docs/bill.png"]
    expires = datetime.fromisoformat(body["expires_at"])
    assert timedelta(minutes=4) < expires - datetime.now(UTC) <= timedelta(minutes=5)


async def test_a_purged_document_has_no_url(admin_client, auth_headers, db, case):
    doc = (await db.execute(select(ApplicationDocument))).scalars().one()
    doc.object_key = ""
    await db.commit()
    r = await admin_client.get(f"{CASES}/{case.case_no}/documents/{doc.id}/url",
                               headers=auth_headers("case_reviewer"))
    assert r.status_code == 410


async def test_a_document_from_another_case_is_a_404(admin_client, auth_headers, db, tenant, scheme, case):
    other = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "ID_CARD_FRONT", "object_key": "x"}])
    stranger = (await db.execute(
        select(ApplicationDocument).where(ApplicationDocument.application_id == other.id)
    )).scalars().one()
    r = await admin_client.get(f"{CASES}/{case.case_no}/documents/{stranger.id}/url",
                               headers=auth_headers("case_reviewer"))
    assert r.status_code == 404


# ------------------------------------------------------- 承辦人重新辨識

async def test_reviewer_ocr_outranks_the_applicants_and_re_evaluates(admin_client, auth_headers, db,
                                                                     rules, case):
    await add_ocr(db, case, "金額 看不清楚")
    await review.persist_findings(db, case, await review.evaluate_application(db, case))
    await db.commit()
    doc = (await db.execute(select(ApplicationDocument))).scalars().one()

    r = await admin_client.post(f"{CASES}/{case.case_no}/documents/{doc.id}/ocr",
                                json={"ocr": ocr("金額 NT$6,000")},
                                headers=auth_headers("case_reviewer"))
    assert r.status_code == 200, r.text
    current = {f["rule_code"]: f for f in r.json()["findings"] if not f["superseded"]}
    assert current["AMOUNT"]["status"] == "MATCH"
    assert current["AMOUNT"]["extracted_value"] == "6000"

    sources = [row.source for row in (await db.execute(select(DocumentOcrResult))).scalars()]
    assert sorted(sources) == ["applicant", "reviewer"]


async def test_evaluate_application_prefers_the_reviewer_ocr(db, rules, case):
    await add_ocr(db, case, "金額 看不清楚", source="applicant")
    await add_ocr(db, case, "金額 NT$6,000", source="reviewer")
    findings = {f.rule_code: f for f in await review.evaluate_application(db, case)}
    assert findings["AMOUNT"].status == "MATCH" and findings["AMOUNT"].extracted_value == "6000"


async def test_evaluate_only_looks_at_the_current_revision(db, rules, case, tenant):
    """補件後舊版本還在表上，但判定只看 `is_current` 的那一版。"""
    from app.services import application as case_service

    await add_ocr(db, case, "金額 NT$1")
    await case_service.add_documents(db, case, [
        {"document_type_code": "BILLING_STATEMENT", "object_key": "docs/bill-1.png", "mime": "image/png"}])
    doc = (await db.execute(select(ApplicationDocument).where(
        ApplicationDocument.is_current.is_(True)))).scalars().one()
    db.add(DocumentOcrResult(tenant_id=tenant.id, document_id=doc.id, source="applicant",
                             **{k: v for k, v in ocr("金額 NT$6,000").items()
                                if k in ("text", "confidence", "lines")}))
    await db.commit()
    findings = {f.rule_code: f for f in await review.evaluate_application(db, case)}
    assert findings["AMOUNT"].extracted_value == "6000"


# ----------------------------------------------------------- evaluate 端點

async def test_evaluate_persists_auto_findings_and_returns_a_verdict(admin_client, auth_headers, db,
                                                                     rules, case):
    await add_ocr(db, case, "金額 NT$6,000\n卡號 ****4826")
    r = await admin_client.post(f"{CASES}/{case.case_no}/evaluate", headers=auth_headers("case_reviewer"))
    assert r.status_code == 200, r.text
    assert r.json()["verdict"] == "PASS"
    rows = (await db.execute(select(ReviewFinding))).scalars().all()
    assert {row.rule_code for row in rows} == {"AMOUNT", "CARD"}
    assert {row.source for row in rows} == {"auto"}


async def test_an_unreadable_field_is_indeterminate_not_a_rejection(admin_client, auth_headers, db,
                                                                    rules, case):
    await add_ocr(db, case, "這張帳單上什麼都沒有")
    body = (await admin_client.post(f"{CASES}/{case.case_no}/evaluate",
                                    headers=auth_headers("case_reviewer"))).json()
    assert body["verdict"] == "INDETERMINATE"


# ----------------------------------------------------------- findings 覆寫

async def test_an_override_appends_a_reviewer_row_and_keeps_the_history(admin_client, auth_headers, db,
                                                                       rules, case, users):
    await add_ocr(db, case, "金額 看不清楚")
    await admin_client.post(f"{CASES}/{case.case_no}/evaluate", headers=auth_headers("case_reviewer"))

    r = await admin_client.put(f"{CASES}/{case.case_no}/findings/AMOUNT",
                               json={"status": "MATCH", "extracted_value": "6000", "note": "人工判讀"},
                               headers=auth_headers("case_reviewer"))
    assert r.status_code == 200, r.text
    findings = r.json()["findings"]
    current = [f for f in findings if not f["superseded"] and f["rule_code"] == "AMOUNT"]
    older = [f for f in findings if f["superseded"] and f["rule_code"] == "AMOUNT"]
    assert len(current) == 1 and current[0]["source"] == "reviewer"
    assert current[0]["extracted_value"] == "6000" and current[0]["note"] == "人工判讀"
    assert current[0]["reviewer"]["name"] == "case_reviewer"
    assert len(older) == 1 and older[0]["source"] == "auto"

    rows = (await db.execute(select(ReviewFinding).where(ReviewFinding.rule_code == "AMOUNT"))).scalars().all()
    assert len(rows) == 2        # append-only，舊的沒有被改掉


async def test_the_history_is_newest_first_per_rule(admin_client, auth_headers, db, rules, case):
    await add_ocr(db, case, "金額 NT$1")
    await admin_client.post(f"{CASES}/{case.case_no}/evaluate", headers=auth_headers("case_reviewer"))
    for value in ("2", "3"):
        await admin_client.put(f"{CASES}/{case.case_no}/findings/AMOUNT",
                               json={"status": "MATCH", "extracted_value": value},
                               headers=auth_headers("case_reviewer"))
    body = (await admin_client.get(f"{CASES}/{case.case_no}",
                                   headers=auth_headers("case_reviewer"))).json()
    amount = [f for f in body["findings"] if f["rule_code"] == "AMOUNT"]
    assert amount[0]["superseded"] is False and amount[0]["extracted_value"] == "3"
    assert [f["extracted_value"] for f in amount[1:]] == ["2", "1"]


async def test_overriding_an_unknown_rule_is_a_404(admin_client, auth_headers, db, rules, case):
    r = await admin_client.put(f"{CASES}/{case.case_no}/findings/NOPE",
                               json={"status": "MATCH"}, headers=auth_headers("case_reviewer"))
    assert r.status_code == 404


async def test_an_invalid_override_status_is_a_422(admin_client, auth_headers, db, rules, case):
    r = await admin_client.put(f"{CASES}/{case.case_no}/findings/AMOUNT",
                               json={"status": "LOOKS_FINE"}, headers=auth_headers("case_reviewer"))
    assert r.status_code == 422


# ------------------------------------------- 核准前置條件（伺服器端強制）

async def test_approval_is_blocked_until_every_required_rule_matches(admin_client, auth_headers, db,
                                                                     rules, case):
    """409 → 人工覆寫 → 200。這是 SPEC §8.3「核准前置條件」的完整劇本。"""
    await add_ocr(db, case, "金額 看不清楚")
    await admin_client.post(f"{CASES}/{case.case_no}/evaluate", headers=auth_headers("case_reviewer"))

    blocked = await admin_client.post(f"{CASES}/{case.case_no}/transitions", json={"code": "T3"},
                                      headers=auth_headers("case_supervisor"))
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "TRANSITION_NOT_ALLOWED"
    assert [b["rule_code"] for b in blocked.json()["blockers"]] == ["AMOUNT"]

    await admin_client.put(f"{CASES}/{case.case_no}/findings/AMOUNT",
                           json={"status": "MATCH", "extracted_value": "6000"},
                           headers=auth_headers("case_supervisor"))

    ok = await admin_client.post(f"{CASES}/{case.case_no}/transitions", json={"code": "T3"},
                                 headers=auth_headers("case_supervisor"))
    assert ok.status_code == 201, ok.text
    assert ok.json()["status"] == "APPROVED"


async def test_a_required_rule_that_was_never_evaluated_blocks_approval(admin_client, auth_headers, db,
                                                                        rules, case):
    """「還沒看」不等於「看過沒問題」。"""
    r = await admin_client.post(f"{CASES}/{case.case_no}/transitions", json={"code": "T3"},
                                headers=auth_headers("case_supervisor"))
    assert r.status_code == 409
    assert [b["rule_code"] for b in r.json()["blockers"]] == ["AMOUNT"]


async def test_a_warning_rule_never_blocks_approval(admin_client, auth_headers, db, rules, case):
    await add_ocr(db, case, "金額 NT$6,000")        # CARD 讀不到，但它不是 required
    await admin_client.post(f"{CASES}/{case.case_no}/evaluate", headers=auth_headers("case_reviewer"))
    r = await admin_client.post(f"{CASES}/{case.case_no}/transitions", json={"code": "T3"},
                                headers=auth_headers("case_supervisor"))
    assert r.status_code == 201


async def test_a_case_with_no_rules_at_all_can_be_approved(admin_client, auth_headers, db, case):
    r = await admin_client.post(f"{CASES}/{case.case_no}/transitions", json={"code": "T3"},
                                headers=auth_headers("case_supervisor"))
    assert r.status_code == 201


# ------------------------------------------------------------------ RBAC

@pytest.mark.parametrize("code", ["T3", "T9", "T11"])
async def test_a_reviewer_cannot_run_supervisor_transitions(admin_client, auth_headers, db, case, code):
    r = await admin_client.post(f"{CASES}/{case.case_no}/transitions",
                                json={"code": code, "reason": "理由", "rejection_codes": ["OTHER"]},
                                headers=auth_headers("case_reviewer"))
    assert r.status_code == 403


async def test_a_supervisor_can_reject_with_a_reason_and_a_code(admin_client, auth_headers, db, case):
    r = await admin_client.post(f"{CASES}/{case.case_no}/transitions",
                                json={"code": "T9", "reason": "工具不符", "rejection_codes": ["TOOL_NOT_ELIGIBLE"]},
                                headers=auth_headers("case_supervisor"))
    assert r.status_code == 201 and r.json()["status"] == "REJECTED"
    assert r.json()["events"][-1]["rejection_codes"] == ["TOOL_NOT_ELIGIBLE"]


@pytest.mark.parametrize("path", ["", "/{case}", "/{case}/evaluate"])
async def test_every_case_endpoint_needs_the_case_review_capability(admin_client, auth_headers, case, path):
    url = CASES + path.replace("{case}", case.case_no)
    method = admin_client.post if path.endswith("evaluate") else admin_client.get
    assert (await method(url, headers=auth_headers("sop_editor"))).status_code == 403


# ------------------------------------------------------------------ 指派

async def test_assigning_a_reviewer_round_trips(admin_client, auth_headers, db, case, users):
    reviewer = users["case_reviewer"]
    r = await admin_client.post(f"{CASES}/{case.case_no}/assign", json={"reviewer_id": reviewer.id},
                                headers=auth_headers("case_supervisor"))
    assert r.status_code == 200
    assert r.json()["assigned_reviewer"] == {"id": reviewer.id, "name": "case_reviewer"}
    await db.refresh(case)
    assert case.assigned_reviewer_id == reviewer.id

    cleared = await admin_client.post(f"{CASES}/{case.case_no}/assign", json={"reviewer_id": None},
                                      headers=auth_headers("case_supervisor"))
    assert cleared.json()["assigned_reviewer"] is None


async def test_assigning_someone_from_another_tenant_is_a_404(admin_client, auth_headers, db, case):
    from app.models import Tenant, User

    other = Tenant(id="o" * 32, name="別的機關", slug="other")
    db.add(other)
    await db.flush()
    stranger = User(id="x" * 32, tenant_id=other.id, email="x@x.tw", name="外人",
                    role="case_reviewer", password_hash="x")
    db.add(stranger)
    await db.commit()
    r = await admin_client.post(f"{CASES}/{case.case_no}/assign", json={"reviewer_id": stranger.id},
                                headers=auth_headers("case_supervisor"))
    assert r.status_code == 404


# ------------------------------------------------------------------ 通知

@pytest.mark.parametrize(("codes", "transition"), [
    (["T2"], "T2"),
    (["T3"], "T3"),
    (["T9"], "T9"),
    (["T11"], "T11"),
])
async def test_notifying_transitions_enqueue_a_notification(db, tenant, scheme, codes, transition):
    from app.models import Notification

    app = await make_case(db, tenant, scheme)
    await drive(db, app, *codes)
    rows = (await db.execute(select(Notification).where(Notification.application_id == app.id))).scalars().all()
    assert [r.payload["transition_code"] for r in rows] == [transition]
    # 這件案子沒有人綁 LINE，所以那一列一建立就是 skipped（決策 D22）；有綁定才會是
    # queued 並排進 worker（見 tests/test_line_notify.py）。重點是轉移留下了通知。
    assert rows[0].status == "skipped"
    assert rows[0].error == "no_linked_line_user"


async def test_the_disbursement_chain_notifies_on_t7_only(db, tenant, scheme):
    from app.models import Notification

    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T3", "T6", "T7")
    rows = (await db.execute(select(Notification).where(Notification.application_id == app.id))).scalars().all()
    assert [r.payload["transition_code"] for r in rows] == ["T3", "T7"]


async def test_t8_notifies_when_the_supplement_deadline_passes(db, tenant, scheme):
    from app.models import Notification
    from app.services import application as case_service

    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")
    await case_service.expire_overdue(db, datetime.now(UTC) + timedelta(days=30))
    rows = (await db.execute(select(Notification).where(Notification.application_id == app.id))).scalars().all()
    assert [r.payload["transition_code"] for r in rows] == ["T2", "T8"]


async def test_findings_carry_the_document_type_they_were_read_from(admin_client, auth_headers, db,
                                                                    rules, case):
    await add_ocr(db, case, "金額 NT$6,000")
    body = (await admin_client.post(f"{CASES}/{case.case_no}/evaluate",
                                    headers=auth_headers("case_reviewer"))).json()
    amount = next(f for f in body["findings"] if f["rule_code"] == "AMOUNT")
    assert amount["document_type_code"] == "BILLING_STATEMENT"
    assert amount["document_id"]
