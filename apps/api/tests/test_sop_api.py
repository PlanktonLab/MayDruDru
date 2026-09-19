"""`/api/sop/*`（匿名）、`/v1/sop/*`（API key）與後台的對照 API（SPEC §8.5、§10.1、§10.2）。

重點在三件事：

* 匿名的門**只看得到已發布的流程**，而且不需要任何認證；
* `/v1` 的平路徑與 `/v1/sop/…` 是同一個函式，回傳必須一模一樣（決策 D28）；
* `POST /api/sop/locate` 的截圖**不落地**——測試直接斷言一次 MinIO 寫入都沒有。
"""

from __future__ import annotations

import io

import pytest
from app.models import ApiKey, DocumentType, RejectionCode
from app.security import hash_api_key
from app.services.publish import unpublish_flow
from PIL import Image
from sqlalchemy import select

from tests.sop_helpers import link_document_type, make_platform, make_published_flow

DOC = "BILLING_STATEMENT"


def png_bytes(color: tuple[int, int, int] = (240, 240, 240)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (48, 72), color).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def screenshot() -> bytes:
    return png_bytes()


async def _api_key(db, tenant) -> str:
    plaintext = "k" * 40
    db.add(ApiKey(tenant_id=tenant.id, name="test", key_hash=hash_api_key(plaintext), prefix=plaintext[:8]))
    await db.commit()
    return plaintext


# ------------------------------------------------------------------ 目錄

async def test_catalog_platforms_only_lists_platforms_with_published_flows(apply_client, db, default_tenant):
    empty = await apply_client.get("/api/sop/catalog/platforms")
    assert empty.status_code == 200 and empty.json() == []

    flow = await make_published_flow(db, default_tenant.id)
    rows = (await apply_client.get("/api/sop/catalog/platforms")).json()
    assert [r["id"] for r in rows] == [flow.platform_id]
    assert rows[0]["has_flows"] is True


async def test_catalog_goals_and_flows(apply_client, db, default_tenant):
    flow = await make_published_flow(db, default_tenant.id)
    goals = (await apply_client.get("/api/sop/catalog/goals")).json()
    assert [g["name"] for g in goals] == ["信用卡帳單"]

    flows = (await apply_client.get("/api/sop/catalog/flows")).json()
    assert [f["id"] for f in flows] == [flow.id]
    filtered = (await apply_client.get(f"/api/sop/catalog/flows?platform_id={flow.platform_id}")).json()
    assert [f["id"] for f in filtered] == [flow.id]
    assert (await apply_client.get("/api/sop/catalog/flows?platform_id=nope")).json() == []


async def test_catalog_document_types_only_lists_types_with_a_published_mapping(
    apply_client, db, default_tenant, default_scheme
):
    flow = await make_published_flow(db, default_tenant.id)
    await link_document_type(db, default_tenant.id, default_scheme.id, DOC, flow)
    rows = (await apply_client.get("/api/sop/catalog/document-types")).json()
    assert rows == [{"code": DOC, "label": DOC}]


async def test_a_draft_flow_never_shows_up_on_the_anonymous_door(apply_client, db, default_tenant):
    flow = await make_published_flow(db, default_tenant.id)
    await unpublish_flow(db, flow.id)
    assert (await apply_client.get("/api/sop/catalog/flows")).json() == []
    assert (await apply_client.get("/api/sop/catalog/platforms")).json() == []


# ------------------------------------------------------------------ 步驟卡

async def test_flow_steps_returns_the_cards_in_order(apply_client, db, default_tenant):
    flow = await make_published_flow(db, default_tenant.id, titles=("一", "二", "三"))
    body = (await apply_client.get(f"/api/sop/flows/{flow.id}/steps")).json()
    assert [s["title"] for s in body["steps"]] == ["一", "二", "三"]
    assert body["flow"]["name"] == flow.name
    assert [m["kind"] for m in body["messages"]] == ["image"] * 3
    assert all(m["url"] for m in body["messages"])
    assert body["messages"][0]["number"] == 1 and body["messages"][2]["number"] == 3


async def test_flow_steps_can_start_partway(apply_client, db, default_tenant):
    flow = await make_published_flow(db, default_tenant.id, titles=("一", "二", "三"))
    full = (await apply_client.get(f"/api/sop/flows/{flow.id}/steps")).json()
    second = full["steps"][1]["step_id"]
    partial = (await apply_client.get(f"/api/sop/flows/{flow.id}/steps?from_step_id={second}")).json()
    assert [m["step_id"] for m in partial["messages"]] == [s["step_id"] for s in full["steps"][1:]]


async def test_flow_steps_rejects_a_step_from_another_flow(apply_client, db, default_tenant):
    flow = await make_published_flow(db, default_tenant.id)
    other = await make_published_flow(
        db, default_tenant.id, platform=await make_platform(db, default_tenant.id, display_name="另一個"), name="另一條"
    )
    other_step = (await apply_client.get(f"/api/sop/flows/{other.id}/steps")).json()["steps"][0]["step_id"]
    r = await apply_client.get(f"/api/sop/flows/{flow.id}/steps?from_step_id={other_step}")
    assert r.status_code == 404


async def test_flow_steps_404s_for_a_draft_flow(apply_client, db, default_tenant):
    flow = await make_published_flow(db, default_tenant.id)
    await unpublish_flow(db, flow.id)
    assert (await apply_client.get(f"/api/sop/flows/{flow.id}/steps")).status_code == 404


async def test_flow_steps_404s_for_an_unknown_flow(apply_client, db, default_tenant):
    assert (await apply_client.get("/api/sop/flows/nope/steps")).status_code == 404


# --------------------------------------------------------------- 文件類型對照

async def test_document_type_flows_is_anonymous_and_shaped_for_the_front_end(
    apply_client, db, default_tenant, default_scheme
):
    flow = await make_published_flow(db, default_tenant.id)
    await link_document_type(db, default_tenant.id, default_scheme.id, DOC, flow)
    rows = (await apply_client.get(f"/api/sop/document-types/{DOC}/flows")).json()
    assert len(rows) == 1
    assert rows[0]["flow_id"] == flow.id and rows[0]["flow_name"] == flow.name
    assert rows[0]["platform"]["display_name"] == "示範銀行 App"


async def test_document_type_flows_is_empty_when_nothing_is_mapped(apply_client, db, default_tenant, default_scheme):
    assert (await apply_client.get(f"/api/sop/document-types/{DOC}/flows")).json() == []


async def test_document_type_flows_can_filter_by_platform(apply_client, db, default_tenant, default_scheme):
    app_flow = await make_published_flow(db, default_tenant.id, name="App")
    web = await make_platform(db, default_tenant.id, display_name="網頁版", channel="web")
    web_flow = await make_published_flow(db, default_tenant.id, platform=web, name="Web")
    await link_document_type(db, default_tenant.id, default_scheme.id, DOC, app_flow)
    await link_document_type(db, default_tenant.id, default_scheme.id, DOC, web_flow)
    rows = (await apply_client.get(f"/api/sop/document-types/{DOC}/flows?platform_id={web.id}")).json()
    assert [r["flow_id"] for r in rows] == [web_flow.id]


async def test_document_type_flows_prefers_the_rejection_codes_picks(
    apply_client, db, default_tenant, default_scheme
):
    mapped = await make_published_flow(db, default_tenant.id, name="對照表的")
    picked = await make_published_flow(
        db, default_tenant.id, platform=await make_platform(db, default_tenant.id, display_name="承辦挑的"), name="承辦挑的"
    )
    await link_document_type(db, default_tenant.id, default_scheme.id, DOC, mapped)
    db.add(RejectionCode(tenant_id=default_tenant.id, scheme_id=default_scheme.id, code="BAD_BILL",
                         related_sop_flow_ids=[picked.id]))
    await db.commit()

    url = f"/api/sop/document-types/{DOC}/flows?scheme={default_scheme.code}&rejection_code=BAD_BILL"
    assert [r["flow_id"] for r in (await apply_client.get(url)).json()] == [picked.id]
    # 退件碼不存在時就當成沒挑過，照樣給文件類型的對照
    missing = f"/api/sop/document-types/{DOC}/flows?scheme={default_scheme.code}&rejection_code=NOPE"
    assert [r["flow_id"] for r in (await apply_client.get(missing)).json()] == [mapped.id]


# ------------------------------------------------------------------ locate

async def test_locate_answers_with_an_outcome_and_never_stores_the_screenshot(
    apply_client, db, default_tenant, fake_storage, screenshot
):
    await make_published_flow(db, default_tenant.id, storage=fake_storage, recognises=screenshot)
    r = await apply_client.post(
        "/api/sop/locate", files={"file": ("s.png", screenshot, "image/png")}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["outcome"] and "guidance" in body and "cards" in body
    # SPEC §11 紅線 3：市民截圖只在記憶體——一次寫入都沒有
    assert fake_storage.writes == [] and fake_storage.deleted == []


async def test_locate_accepts_the_optional_scope_fields(
    apply_client, db, default_tenant, fake_storage, screenshot
):
    flow = await make_published_flow(db, default_tenant.id, storage=fake_storage, recognises=screenshot)
    r = await apply_client.post(
        "/api/sop/locate",
        files={"file": ("s.png", screenshot, "image/png")},
        data={"platform_id": flow.platform_id, "flow_id": flow.id},
    )
    assert r.status_code == 200
    assert fake_storage.writes == []


async def test_locate_refuses_something_that_is_not_an_image(apply_client, db, default_tenant, fake_storage):
    r = await apply_client.post("/api/sop/locate", files={"file": ("s.png", b"not a png", "image/png")})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "image_invalid"


async def test_locate_of_an_unknown_flow_id_just_drops_the_scope(
    apply_client, db, default_tenant, fake_storage, screenshot
):
    """給了一個不存在的 flow_id 不該是 500——把它當成「沒有範圍」繼續找就好。"""
    await make_published_flow(db, default_tenant.id, storage=fake_storage, recognises=screenshot)
    r = await apply_client.post(
        "/api/sop/locate", files={"file": ("s.png", screenshot, "image/png")}, data={"flow_id": "nope"}
    )
    assert r.status_code == 200


# ------------------------------------------------------------- /v1/sop 別名

async def test_the_v1_sop_aliases_answer_exactly_like_the_flat_paths(client, db, tenant):
    flow = await make_published_flow(db, tenant.id)
    key = await _api_key(db, tenant)
    headers = {"X-API-Key": key}

    flat = await client.get(f"/v1/flows/{flow.id}/steps", headers=headers)
    prefixed = await client.get(f"/v1/sop/flows/{flow.id}/steps", headers=headers)
    assert flat.status_code == prefixed.status_code == 200
    assert flat.json() == prefixed.json()

    for path in ("/catalog/platforms", "/catalog/goals", "/catalog/document-types", "/catalog/flows"):
        a = await client.get(f"/v1{path}", headers=headers)
        b = await client.get(f"/v1/sop{path}", headers=headers)
        assert a.json() == b.json()


async def test_the_v1_sop_aliases_still_need_an_api_key(client, db, tenant):
    flow = await make_published_flow(db, tenant.id)
    assert (await client.get(f"/v1/sop/flows/{flow.id}/steps")).status_code in (401, 403)
    assert (await client.get("/v1/sop/catalog/platforms", headers={"X-API-Key": "bad"})).status_code in (401, 403)


async def test_v1_sop_document_type_flows(client, db, tenant, scheme):
    flow = await make_published_flow(db, tenant.id)
    await link_document_type(db, tenant.id, scheme.id, DOC, flow)
    key = await _api_key(db, tenant)
    rows = (await client.get(f"/v1/sop/document-types/{DOC}/flows", headers={"X-API-Key": key})).json()
    assert [r["flow_id"] for r in rows] == [flow.id]


async def test_v1_sop_sessions_walk_a_flow(client, db, tenant, session_redis):
    """`known_context.flow_id` 指名流程時，引擎一題都不問就從第一步開始。"""
    flow = await make_published_flow(db, tenant.id, titles=("一", "二"))
    key = await _api_key(db, tenant)
    headers = {"X-API-Key": key}
    created = await client.post(
        "/v1/sop/sessions", headers=headers,
        json={"external_user_id": "U1", "known_context": {"platform_id": flow.platform_id, "flow_id": flow.id}},
    )
    assert created.status_code == 200
    body = created.json()
    assert body["type"] == "step" and body["step"]["title"] == "一"
    nxt = await client.post(f"/v1/sop/sessions/{body['session_id']}/actions",
                            headers=headers, json={"action": "next"})
    assert nxt.json()["step"]["title"] == "二"


# ------------------------------------------------------------------ 後台

BASE = "/api/admin/schemes"


async def test_admin_can_read_and_replace_the_mapping(admin_client, auth_headers, db, tenant, scheme):
    flow = await make_published_flow(db, tenant.id)
    url = f"{BASE}/{scheme.code}/document-types/{DOC}/sop-flows"
    headers = auth_headers("admin")

    assert (await admin_client.get(url, headers=headers)).json() == []
    put = await admin_client.put(url, headers=headers,
                                 json={"links": [{"flow_id": flow.id, "platform_id": flow.platform_id}]})
    assert put.status_code == 200
    assert [r["flow_id"] for r in put.json()] == [flow.id]
    assert [r["flow_id"] for r in (await admin_client.get(url, headers=headers)).json()] == [flow.id]

    cleared = await admin_client.put(url, headers=headers, json={"links": []})
    assert cleared.json() == []


async def test_the_mapping_endpoints_require_admin(admin_client, auth_headers, db, tenant, scheme):
    url = f"{BASE}/{scheme.code}/document-types/{DOC}/sop-flows"
    assert (await admin_client.get(url, headers=auth_headers("case_reviewer"))).status_code == 403
    assert (await admin_client.put(url, headers=auth_headers("viewer"), json={"links": []})).status_code == 403
    assert (await admin_client.get(url)).status_code == 401


async def test_the_mapping_404s_for_an_unknown_document_type(admin_client, auth_headers, db, tenant, scheme):
    url = f"{BASE}/{scheme.code}/document-types/NO_SUCH/sop-flows"
    assert (await admin_client.get(url, headers=auth_headers("admin"))).status_code == 404


async def test_the_mapping_404s_for_an_unknown_scheme(admin_client, auth_headers, db, tenant, scheme):
    url = f"{BASE}/NOPE/document-types/{DOC}/sop-flows"
    assert (await admin_client.get(url, headers=auth_headers("admin"))).status_code == 404


async def test_replacing_the_mapping_writes_an_audit_row(admin_client, auth_headers, db, tenant, scheme):
    from app.models import AuditLog

    flow = await make_published_flow(db, tenant.id)
    url = f"{BASE}/{scheme.code}/document-types/{DOC}/sop-flows"
    await admin_client.put(url, headers=auth_headers("admin"),
                           json={"links": [{"flow_id": flow.id, "platform_id": flow.platform_id}]})
    rows = (await db.execute(select(AuditLog).where(AuditLog.target_type == "document_type_sop_flows"))).scalars().all()
    assert len(rows) == 1 and rows[0].action == "update"
    assert rows[0].diff["count"] == 1 and rows[0].diff["document_type"] == DOC


async def test_the_generic_child_route_still_lists_sop_flows(admin_client, auth_headers, db, tenant, scheme):
    """四段的對照路徑不該搶走 `/{code}/{kind}` 那個通用殼的路由。"""
    flow = await make_published_flow(db, tenant.id)
    await link_document_type(db, tenant.id, scheme.id, DOC, flow)
    rows = (await admin_client.get(f"{BASE}/{scheme.code}/sop-flows", headers=auth_headers("admin"))).json()
    assert [r["flow_id"] for r in rows] == [flow.id]


@pytest.fixture
async def default_scheme(db, default_tenant):
    """匿名端點看的是 `slug="default"` 的 tenant（決策 D18），方案得掛在它底下。"""
    from app.models import Scheme

    row = Scheme(tenant_id=default_tenant.id, code="DEFAULT115", name="預設方案")
    db.add(row)
    await db.flush()
    db.add(DocumentType(tenant_id=default_tenant.id, scheme_id=row.id, code=DOC, must_mask=True))
    await db.commit()
    return row
