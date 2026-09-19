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


async def test_available_transitions_depend_on_the_viewers_capabilities(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    reviewer = (await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_reviewer"))).json()
    supervisor = (await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_supervisor"))).json()
    assert [t["code"] for t in reviewer["available_transitions"]] == ["T2"]
    assert sorted(t["code"] for t in supervisor["available_transitions"]) == ["T11", "T2", "T3", "T9"]


async def test_a_terminal_case_offers_no_transitions(client, auth_headers, db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T10")
    body = (await client.get(f"{CASES}/{app.case_no}", headers=auth_headers("case_supervisor"))).json()
    assert body["available_transitions"] == []
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
    assert r.json()["to_status"] == "NEEDS_REVISION"
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
