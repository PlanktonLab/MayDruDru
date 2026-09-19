"""文件類型 ↔ SOP flow 對照（SPEC §8.5、§16 P4）。

分三段：resolver 本身（`services/sop_links`）、後台的 GET/PUT、以及
退件碼那條「承辦人挑過就用他挑的、沒挑就退回文件類型」的路。
"""

from __future__ import annotations

from app.models import DocumentType, DocumentTypeSopFlow, RejectionCode
from app.services import sop_links
from app.services.publish import unpublish_flow
from sqlalchemy import select

from tests.sop_helpers import link_document_type, make_goal, make_platform, make_published_flow

DOC = "BILLING_STATEMENT"


async def _document_type(db, scheme, code=DOC) -> DocumentType:
    return (
        await db.execute(select(DocumentType).where(DocumentType.scheme_id == scheme.id, DocumentType.code == code))
    ).scalar_one()


# ------------------------------------------------------------------ resolver

async def test_resolve_returns_nothing_when_no_mapping_exists(db, tenant, scheme):
    assert await sop_links.resolve_flows(db, tenant.id, DOC) == []


async def test_resolve_returns_nothing_for_an_unknown_document_type(db, tenant, scheme):
    assert await sop_links.resolve_flows(db, tenant.id, "NO_SUCH_DOC") == []
    assert await sop_links.resolve_flows(db, tenant.id, "") == []


async def test_resolve_finds_the_mapped_flow(db, tenant, scheme):
    flow = await make_published_flow(db, tenant.id)
    await link_document_type(db, tenant.id, scheme.id, DOC, flow)
    found = await sop_links.resolve_flows(db, tenant.id, DOC)
    assert [f.id for f in found] == [flow.id]


async def test_resolve_skips_a_flow_that_is_no_longer_published(db, tenant, scheme):
    """對照還在，但流程被收回草稿——民眾不該點進一條改到一半的教學。"""
    flow = await make_published_flow(db, tenant.id)
    await link_document_type(db, tenant.id, scheme.id, DOC, flow)
    await unpublish_flow(db, flow.id)
    assert await sop_links.resolve_flows(db, tenant.id, DOC) == []


async def test_resolve_filters_by_platform(db, tenant, scheme):
    app_flow = await make_published_flow(db, tenant.id, name="App 版")
    web_platform = await make_platform(db, tenant.id, display_name="示範銀行網銀", channel="web")
    web_flow = await make_published_flow(db, tenant.id, platform=web_platform, name="網頁版")
    await link_document_type(db, tenant.id, scheme.id, DOC, app_flow)
    await link_document_type(db, tenant.id, scheme.id, DOC, web_flow)

    assert len(await sop_links.resolve_flows(db, tenant.id, DOC)) == 2
    only_web = await sop_links.resolve_flows(db, tenant.id, DOC, platform_id=web_platform.id)
    assert [f.id for f in only_web] == [web_flow.id]


async def test_resolve_keeps_the_mapping_order(db, tenant, scheme):
    """後台排出來的順序就是民眾看到的順序，不是資料庫高興的順序。"""
    first = await make_published_flow(db, tenant.id, name="甲")
    second = await make_published_flow(
        db, tenant.id, platform=await make_platform(db, tenant.id, display_name="乙平台"), name="乙"
    )
    document_type = await _document_type(db, scheme)
    await sop_links.replace_links(db, tenant.id, document_type, [
        {"flow_id": second.id, "platform_id": second.platform_id},
        {"flow_id": first.id, "platform_id": first.platform_id},
    ])
    await db.commit()
    assert [f.id for f in await sop_links.resolve_flows(db, tenant.id, DOC)] == [second.id, first.id]


async def test_resolve_matches_the_same_code_across_schemes(db, tenant, scheme):
    """同一個文件代碼出現在兩個方案裡，兩邊的對照都算數——民眾問的是文件，不是方案。"""
    from app.models import Scheme

    other = Scheme(tenant_id=tenant.id, code="OTHER999", name="另一個方案")
    db.add(other)
    await db.flush()
    db.add(DocumentType(tenant_id=tenant.id, scheme_id=other.id, code=DOC))
    await db.commit()

    flow = await make_published_flow(db, tenant.id)
    await link_document_type(db, tenant.id, other.id, DOC, flow)
    assert [f.id for f in await sop_links.resolve_flows(db, tenant.id, DOC)] == [flow.id]


async def test_explicit_flow_ids_win_over_the_mapping(db, tenant, scheme):
    mapped = await make_published_flow(db, tenant.id, name="對照表裡的")
    picked = await make_published_flow(
        db, tenant.id, platform=await make_platform(db, tenant.id, display_name="另一個平台"), name="指定的"
    )
    await link_document_type(db, tenant.id, scheme.id, DOC, mapped)
    found = await sop_links.resolve_flows(db, tenant.id, DOC, flow_ids=[picked.id])
    assert [f.id for f in found] == [picked.id]


async def test_flow_view_carries_the_platform(db, tenant, scheme):
    flow = await make_published_flow(db, tenant.id)
    view = await sop_links.flow_view(db, flow)
    assert view["flow_id"] == flow.id and view["flow_name"] == flow.name
    assert view["platform"]["channel"] == "mobile_app"
    assert view["platform"]["display_name"] == "示範銀行 App"


# ------------------------------------------------------------- 退件碼的退路

async def _rejection(db, tenant, scheme, flow_ids: list[str]) -> RejectionCode:
    row = RejectionCode(
        tenant_id=tenant.id, scheme_id=scheme.id, code="BAD_BILL",
        staff_label="帳單不清楚", related_sop_flow_ids=flow_ids,
    )
    db.add(row)
    await db.commit()
    return row


async def test_a_rejection_code_uses_the_flows_the_clerk_picked(db, tenant, scheme):
    mapped = await make_published_flow(db, tenant.id, name="文件類型的對照")
    picked = await make_published_flow(
        db, tenant.id, platform=await make_platform(db, tenant.id, display_name="承辦挑的平台"), name="承辦挑的"
    )
    await link_document_type(db, tenant.id, scheme.id, DOC, mapped)
    rejection = await _rejection(db, tenant, scheme, [picked.id])
    found = await sop_links.flows_for_rejection(db, tenant.id, document_type_code=DOC, rejection=rejection)
    assert [f.id for f in found] == [picked.id]


async def test_a_rejection_code_without_picks_falls_back_to_the_document_type(db, tenant, scheme):
    mapped = await make_published_flow(db, tenant.id)
    await link_document_type(db, tenant.id, scheme.id, DOC, mapped)
    rejection = await _rejection(db, tenant, scheme, [])
    found = await sop_links.flows_for_rejection(db, tenant.id, document_type_code=DOC, rejection=rejection)
    assert [f.id for f in found] == [mapped.id]


async def test_picks_that_are_all_unpublished_still_fall_back(db, tenant, scheme):
    """承辦人挑的那條後來被收回草稿了——退件卻不告訴民眾去哪裡拿，等於把問題丟回去。"""
    mapped = await make_published_flow(db, tenant.id, name="仍然發布中")
    stale = await make_published_flow(
        db, tenant.id, platform=await make_platform(db, tenant.id, display_name="收回的平台"), name="收回草稿"
    )
    await link_document_type(db, tenant.id, scheme.id, DOC, mapped)
    await unpublish_flow(db, stale.id)
    rejection = await _rejection(db, tenant, scheme, [stale.id])
    found = await sop_links.flows_for_rejection(db, tenant.id, document_type_code=DOC, rejection=rejection)
    assert [f.id for f in found] == [mapped.id]


async def test_no_rejection_object_is_the_same_as_no_picks(db, tenant, scheme):
    mapped = await make_published_flow(db, tenant.id)
    await link_document_type(db, tenant.id, scheme.id, DOC, mapped)
    found = await sop_links.flows_for_rejection(db, tenant.id, document_type_code=DOC, rejection=None)
    assert [f.id for f in found] == [mapped.id]


# ------------------------------------------------------------- replace_links

async def test_replace_links_adds_updates_and_removes_in_one_go(db, tenant, scheme):
    a = await make_published_flow(db, tenant.id, name="甲")
    b = await make_published_flow(
        db, tenant.id, platform=await make_platform(db, tenant.id, display_name="乙平台"), name="乙"
    )
    document_type = await _document_type(db, scheme)

    await sop_links.replace_links(db, tenant.id, document_type, [
        {"flow_id": a.id, "platform_id": a.platform_id},
        {"flow_id": b.id, "platform_id": b.platform_id},
    ])
    await db.commit()
    kept_id = (await sop_links.links_for_document_type(db, tenant.id, document_type.id))[0].id

    await sop_links.replace_links(db, tenant.id, document_type, [
        {"flow_id": a.id, "platform_id": a.platform_id},
    ])
    await db.commit()
    rows = await sop_links.links_for_document_type(db, tenant.id, document_type.id)
    assert [r.flow_id for r in rows] == [a.id]
    # 留下來的那一列是原本那一列，不是「刪掉再建一條新的」——稽核日誌才對得上。
    assert rows[0].id == kept_id


async def test_replace_links_drops_half_filled_and_duplicate_rows(db, tenant, scheme):
    flow = await make_published_flow(db, tenant.id)
    document_type = await _document_type(db, scheme)
    rows = await sop_links.replace_links(db, tenant.id, document_type, [
        {"flow_id": flow.id, "platform_id": flow.platform_id},
        {"flow_id": flow.id, "platform_id": flow.platform_id},   # 重複
        {"flow_id": flow.id, "platform_id": ""},                 # 缺一半
        {"flow_id": "", "platform_id": flow.platform_id},
    ])
    assert len(rows) == 1


async def test_replace_links_with_an_empty_list_clears_everything(db, tenant, scheme):
    flow = await make_published_flow(db, tenant.id)
    document_type = await _document_type(db, scheme)
    await sop_links.replace_links(db, tenant.id, document_type,
                                  [{"flow_id": flow.id, "platform_id": flow.platform_id}])
    await db.commit()
    await sop_links.replace_links(db, tenant.id, document_type, [])
    await db.commit()
    assert (await db.execute(select(DocumentTypeSopFlow))).scalars().all() == []


async def test_document_type_ids_are_scoped_to_the_tenant(db, tenant, scheme):
    from app.models import Scheme, Tenant

    stranger = Tenant(name="別的機關", slug="stranger")
    db.add(stranger)
    await db.flush()
    other = Scheme(tenant_id=stranger.id, code="X1", name="別人的方案")
    db.add(other)
    await db.flush()
    db.add(DocumentType(tenant_id=stranger.id, scheme_id=other.id, code=DOC))
    await db.commit()

    mine = await sop_links.document_type_ids(db, tenant.id, DOC)
    theirs = await sop_links.document_type_ids(db, stranger.id, DOC)
    assert len(mine) == 1 and len(theirs) == 1 and mine != theirs


async def test_make_goal_and_platform_helpers_build_a_publishable_flow(db, tenant):
    """積木自己也要有測試：沒有目標文件的終點是發布不了的。"""
    goal = await make_goal(db, tenant.id, "存摺封面")
    flow = await make_published_flow(db, tenant.id, goal=goal, titles=("一", "二", "三"))
    assert flow.status == "published" and flow.current_version_id
