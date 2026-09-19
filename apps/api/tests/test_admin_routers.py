"""`/api/admin/*` 端點：capability 閘門、佇列排序、轉移、樂觀鎖 409（SPEC §10.2）。"""

from datetime import UTC, datetime, timedelta

import pytest

from tests.test_state_machine import drive, make_case

SCHEMES = "/api/admin/schemes"
CASES = "/api/admin/applications"


# ------------------------------------------------------------ 方案 CRUD

async def test_scheme_crud_over_http(client, auth_headers, tenant):
    admin = auth_headers("admin")
    created = await client.post(SCHEMES, json={"code": "HC999", "name": "測試方案"}, headers=admin)
    assert created.status_code == 201
    assert created.json()["version"] == 1

    listed = await client.get(SCHEMES, headers=admin)
    assert [s["code"] for s in listed.json()] == ["HC999"]

    patched = await client.patch(f"{SCHEMES}/HC999", json={"name": "改名", "expected_version": 1}, headers=admin)
    assert patched.status_code == 200 and patched.json()["version"] == 2

    assert (await client.delete(f"{SCHEMES}/HC999", headers=admin)).status_code == 204
    assert (await client.get(f"{SCHEMES}/HC999", headers=admin)).status_code == 404


async def test_a_stale_expected_version_gets_a_409(client, auth_headers, scheme):
    admin = auth_headers("admin")
    r = await client.patch(f"{SCHEMES}/{scheme.code}", json={"name": "x", "expected_version": 99}, headers=admin)
    assert r.status_code == 409
    assert "重新載入" in r.json()["detail"]


async def test_omitting_the_version_still_saves(client, auth_headers, scheme):
    r = await client.patch(f"{SCHEMES}/{scheme.code}", json={"name": "腳本改的"}, headers=auth_headers("admin"))
    assert r.status_code == 200


async def test_the_admin_scheme_view_includes_staff_only_configuration(client, auth_headers, scheme):
    r = await client.get(f"{SCHEMES}/{scheme.code}", headers=auth_headers("admin"))
    body = r.json()
    assert body["code"] == scheme.code
    assert "review_rules" in body and "version" in body
    assert [t["code"] for t in body["tiers"]] == ["GENERAL", "LOW_INCOME"]


@pytest.mark.parametrize("role", ["viewer", "sop_editor", "sop_reviewer", "case_reviewer", "case_supervisor"])
async def test_scheme_management_needs_the_admin_capability(client, auth_headers, role):
    assert (await client.get(SCHEMES, headers=auth_headers(role))).status_code == 403


@pytest.mark.parametrize("role", ["admin", "owner"])
async def test_admin_and_owner_can_manage_schemes(client, auth_headers, role):
    assert (await client.get(SCHEMES, headers=auth_headers(role))).status_code == 200


async def test_unauthenticated_requests_are_refused(client):
    assert (await client.get(SCHEMES)).status_code == 401
    assert (await client.get(CASES)).status_code == 401


# ------------------------------------------------------------- 子設定表

async def test_child_resources_round_trip_over_http(client, auth_headers, scheme):
    admin = auth_headers("admin")
    url = f"{SCHEMES}/{scheme.code}/rejection-codes"
    made = await client.post(url, json={"code": "DOC_MISSING", "staff_label": "缺少必要文件"}, headers=admin)
    assert made.status_code == 201
    child_id = made.json()["id"]

    listed = await client.get(url, headers=admin)
    assert [c["code"] for c in listed.json()] == ["DOC_MISSING"]

    patched = await client.patch(f"{url}/{child_id}", json={"staff_label": "缺件", "expected_version": 1}, headers=admin)
    assert patched.status_code == 200 and patched.json()["version"] == 2

    stale = await client.patch(f"{url}/{child_id}", json={"staff_label": "又改", "expected_version": 1}, headers=admin)
    assert stale.status_code == 409

    assert (await client.delete(f"{url}/{child_id}", headers=admin)).status_code == 204


async def test_an_unknown_child_kind_is_a_404(client, auth_headers, scheme):
    r = await client.get(f"{SCHEMES}/{scheme.code}/nonsense", headers=auth_headers("admin"))
    assert r.status_code == 404


# --------------------------------------------------------- 方案設定（案件頁）

@pytest.fixture
async def rejection_codes(db, tenant, scheme):
    from app.models import RejectionCode

    db.add_all([
        RejectionCode(tenant_id=tenant.id, scheme_id=scheme.id, code="BILLING_NO_TWD",
                      staff_label="帳單未顯示臺幣金額", public_what_wrong="帳單上看不到臺幣金額",
                      public_how_to_fix="請改上傳有臺幣金額的那一頁。",
                      related_document_type_codes=["BILLING_STATEMENT"], sort_order=1),
        RejectionCode(tenant_id=tenant.id, scheme_id=scheme.id, code="RETIRED", active=False, sort_order=9),
    ])
    await db.commit()
    await db.refresh(scheme)
    return scheme


async def test_scheme_settings_give_the_reviewer_the_staff_label(client, auth_headers, rejection_codes, scheme):
    r = await client.get(f"{SCHEMES}/{scheme.code}/settings", headers=auth_headers("case_reviewer"))
    assert r.status_code == 200
    body = r.json()
    assert [c["code"] for c in body["rejection_codes"]] == ["BILLING_NO_TWD"]
    assert body["rejection_codes"][0]["staff_label"] == "帳單未顯示臺幣金額"
    assert body["rejection_codes"][0]["related_sop_flow_ids"] == []
    assert [d["code"] for d in body["document_types"]][0] == "ID_CARD_FRONT"
    assert body["supplement_days"] == 14 and body["max_revisions"] == 2 and body["retention_days"] == 90
    assert [t["code"] for t in body["tiers"]] == ["GENERAL", "LOW_INCOME"]
    assert [c["code"] for c in body["payment_channels"]] == ["CREDIT_CARD", "TELECOM"]


async def test_scheme_settings_are_not_shadowed_by_the_child_resource_route(client, auth_headers, scheme):
    """`settings` 不是子設定表：路由順序錯掉的話這裡會拿到 404 或 403。"""
    r = await client.get(f"{SCHEMES}/{scheme.code}/settings", headers=auth_headers("case_reviewer"))
    assert r.status_code == 200 and "rejection_codes" in r.json()


@pytest.mark.parametrize("role", ["viewer", "sop_editor", "sop_reviewer"])
async def test_scheme_settings_need_the_case_review_capability(client, auth_headers, scheme, role):
    assert (await client.get(f"{SCHEMES}/{scheme.code}/settings", headers=auth_headers(role))).status_code == 403


async def test_unknown_scheme_settings_are_a_404(client, auth_headers):
    assert (await client.get(f"{SCHEMES}/NOPE/settings", headers=auth_headers("case_reviewer"))).status_code == 404


# ------------------------------------------------------------- 可指派名單

REVIEWERS = "/api/admin/reviewers"


async def test_the_reviewer_list_is_everyone_who_can_actually_review(client, auth_headers, users):
    body = (await client.get(REVIEWERS, headers=auth_headers("case_reviewer"))).json()
    assert {u["role"] for u in body} == {"case_reviewer", "case_supervisor", "admin", "owner"}
    assert all(u["id"] and u["email"] and u["name"] for u in body)


async def test_deactivated_accounts_drop_off_the_reviewer_list(client, auth_headers, db, users):
    users["case_reviewer"].is_active = False
    await db.commit()
    body = (await client.get(REVIEWERS, headers=auth_headers("case_supervisor"))).json()
    assert "case_reviewer" not in {u["role"] for u in body}


async def test_the_reviewer_list_is_scoped_to_the_tenant(client, auth_headers, db, users):
    from app.models import Tenant, User

    db.add(Tenant(id="o" * 32, name="別的機關", slug="other"))
    await db.flush()
    db.add(User(id="x" * 32, tenant_id="o" * 32, email="other@example.gov.tw",
                name="別人", role="case_reviewer", password_hash="x"))
    await db.commit()
    body = (await client.get(REVIEWERS, headers=auth_headers("case_reviewer"))).json()
    assert "x" * 32 not in {u["id"] for u in body}


@pytest.mark.parametrize("role", ["viewer", "sop_editor", "sop_reviewer"])
async def test_the_reviewer_list_needs_the_case_review_capability(client, auth_headers, role):
    assert (await client.get(REVIEWERS, headers=auth_headers(role))).status_code == 403


# ----------------------------------------------------------------- 佇列

async def test_queue_is_ordered_by_first_submission(client, auth_headers, db, tenant, scheme):
    base = datetime.now(UTC) - timedelta(days=5)
    first = await make_case(db, tenant, scheme, now=base)
    second = await make_case(db, tenant, scheme, now=base + timedelta(days=1))
    await drive(db, first, "T2")  # 退件也不會把順位往後推

    r = await client.get(CASES, headers=auth_headers("case_reviewer"))
    body = r.json()
    assert body["total"] == 2
    assert [i["case_no"] for i in body["items"]] == [first.case_no, second.case_no]


async def test_queue_masks_the_applicant_name(client, auth_headers, db, tenant, scheme):
    await make_case(db, tenant, scheme)
    item = (await client.get(CASES, headers=auth_headers("case_reviewer"))).json()["items"][0]
    assert item["applicant_name_masked"] == "測OOO明"
    assert "applicant_name" not in item and "phone_encrypted" not in item


async def test_queue_filters_by_status(client, auth_headers, db, tenant, scheme):
    a = await make_case(db, tenant, scheme)
    await make_case(db, tenant, scheme)
    await drive(db, a, "T2")
    r = await client.get(CASES, params={"status": "NEEDS_REVISION"}, headers=auth_headers("case_reviewer"))
    assert [i["case_no"] for i in r.json()["items"]] == [a.case_no]


@pytest.mark.parametrize("role", ["viewer", "sop_editor", "sop_reviewer"])
async def test_the_queue_needs_the_case_review_capability(client, auth_headers, role):
    assert (await client.get(CASES, headers=auth_headers(role))).status_code == 403


# --------------------------------------------------------------- 案件頁

async def test_case_detail_carries_documents_events_and_next_actions(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "ID_CARD_FRONT", "object_key": "k", "mime": "image/jpeg"}])
    r = await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_supervisor"))
    body = r.json()
    assert body["status"] == "UNDER_REVIEW"
    assert [d["document_type_code"] for d in body["documents"]] == ["ID_CARD_FRONT"]
    assert [e["transition_code"] for e in body["events"]] == ["T0", "T1"]
    assert body["required_document_types"] == ["ID_CARD_FRONT", "BILLING_STATEMENT"]
    assert body["phone_masked"] == "******5678"


async def test_case_detail_embeds_the_scheme_settings(client, auth_headers, db, tenant, scheme, rejection_codes):
    """案件頁要組補件表單，設定就跟著案件一起給——不用再打第二支 API。"""
    app = await make_case(db, tenant, scheme)
    body = (await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_reviewer"))).json()
    assert body["scheme_code"] == "TEST115"
    settings = body["scheme_settings"]
    assert settings["code"] == "TEST115"
    assert [c["staff_label"] for c in settings["rejection_codes"]] == ["帳單未顯示臺幣金額"]
    assert settings["supplement_days"] == 14
    assert {d["code"] for d in settings["document_types"]} >= {"ID_CARD_FRONT", "BILLING_STATEMENT"}


async def test_the_timeline_names_the_staff_member_who_acted(client, auth_headers, db, tenant, scheme, users):
    app = await make_case(db, tenant, scheme)
    posted = await client.post(f"{CASES}/{app.case_no}/transitions", json={"code": "T3"},
                               headers=auth_headers("case_supervisor"))
    assert posted.status_code == 201

    body = (await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_supervisor"))).json()
    by_code = {e["transition_code"]: e for e in body["events"]}
    assert by_code["T3"]["actor_type"] == "STAFF"
    assert by_code["T3"]["actor_name"] == users["case_supervisor"].name
    # 系統與市民沒有名字，也不該被編一個出來。
    assert by_code["T1"]["actor_type"] == "SYSTEM" and by_code["T1"]["actor_name"] is None
    assert posted.json()["events"][-1]["actor_name"] == users["case_supervisor"].name


async def test_an_applicant_event_has_no_actor_name(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T10")  # 市民自行撤回
    body = (await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_reviewer"))).json()
    withdrawn = next(e for e in body["events"] if e["transition_code"] == "T10")
    assert withdrawn["actor_type"] == "APPLICANT" and withdrawn["actor_name"] is None


async def test_available_transitions_depend_on_the_viewers_capabilities(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    reviewer = (await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_reviewer"))).json()
    supervisor = (await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_supervisor"))).json()
    assert [t["code"] for t in reviewer["allowed_transitions"]] == ["T2"]
    assert sorted(t["code"] for t in supervisor["allowed_transitions"]) == ["T11", "T2", "T3", "T9"]


async def test_a_terminal_case_offers_no_transitions(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T10")
    body = (await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_supervisor"))).json()
    assert body["allowed_transitions"] == []
    assert body["documents_purge_at"] is not None


async def test_an_unknown_case_number_is_a_404(client, auth_headers):
    assert (await client.get(f"{CASES}/HC-2026-999999", headers=auth_headers("case_reviewer"))).status_code == 404


# --------------------------------------------------------------- 轉移端點

async def test_posting_a_transition_moves_the_case(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    r = await client.post(
        f"{CASES}/{app.case_no}/transitions",
        json={"code": "T2", "supplement_items": [
            {"document_type_code": "BILLING_STATEMENT", "rejection_code": "BILLING_NO_TWD", "note": "缺臺幣金額"}]},
        headers=auth_headers("case_reviewer"),
    )
    assert r.status_code == 201
    assert r.json()["status"] == "NEEDS_REVISION"
    assert r.json()["events"][-1]["to_status"] == "NEEDS_REVISION"
    await db.refresh(app)
    assert app.status == "NEEDS_REVISION" and app.revision_count == 1


async def test_a_reviewer_cannot_approve_over_http(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    r = await client.post(f"{CASES}/{app.case_no}/transitions", json={"code": "T3"},
                          headers=auth_headers("case_reviewer"))
    assert r.status_code == 403
    await db.refresh(app)
    assert app.status == "UNDER_REVIEW"


async def test_a_supervisor_can_approve_over_http(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    r = await client.post(f"{CASES}/{app.case_no}/transitions", json={"code": "T3", "payload": {"approved_amount": 3000}},
                          headers=auth_headers("case_supervisor"))
    assert r.status_code == 201
    await db.refresh(app)
    assert app.status == "APPROVED" and app.approved_amount == 3000


async def test_rejecting_without_a_reason_is_refused_over_http(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    r = await client.post(f"{CASES}/{app.case_no}/transitions",
                          json={"code": "T9", "rejection_codes": ["OTHER"]},
                          headers=auth_headers("case_supervisor"))
    assert r.status_code == 400


async def test_a_wrong_from_state_is_a_409_over_http(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    r = await client.post(f"{CASES}/{app.case_no}/transitions", json={"code": "T7"},
                          headers=auth_headers("case_supervisor"))
    assert r.status_code == 409


async def test_a_transition_writes_an_audit_row(client, auth_headers, db, tenant, scheme):
    from app.models import AuditLog
    from sqlalchemy import select

    app = await make_case(db, tenant, scheme)
    await client.post(f"{CASES}/{app.case_no}/transitions", json={"code": "T3"},
                      headers=auth_headers("case_supervisor"))
    rows = list((await db.execute(select(AuditLog).where(AuditLog.action == "transition"))).scalars())
    assert len(rows) == 1
    assert rows[0].target_id == app.case_no and rows[0].diff["to"] == "APPROVED"


async def test_openapi_still_generates_with_the_new_routers(client):
    spec = (await client.get("/openapi.json")).json()
    assert f"{CASES}/{{case_no}}/transitions" in spec["paths"]
    assert f"{SCHEMES}/{{code}}" in spec["paths"]
