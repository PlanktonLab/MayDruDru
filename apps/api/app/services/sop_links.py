"""文件類型 ↔ SOP flow 對照（SPEC §8.5、§16 P4）。

一張 `document_type_sop_flows` 把兩條線接起來：方案那一側說「這個案件缺的是
`BILLING_STATEMENT`」，SOP 那一側說「這份東西在玉山 App 是這條流程、在網銀是另一條」。
中間沒有任何硬編對照——新增一個方案、新增一個平台都只是資料（決策 D6）。

三個呼叫端共用這裡的 `resolve_flows()`：LINE 的申請小幫手、apply-web 的教學頁、
退件推播與補件面板。**永遠只回已發布的 flow**：草稿是承辦人還在改的東西，
民眾點進去看到一半的教學比看不到更糟。

對照是**依 code 而不是依 id** 解析的：同一個 `document_type_code` 可能出現在好幾個
方案裡（身分證正面到處都要），民眾問的是「這份文件怎麼拿」，不是「某方案的第 3 列」。

退件碼另外有一欄 `related_sop_flow_ids`：承辦人特別指定過就用它，沒指定就退回
文件類型的對照（`flows_for_rejection()`）。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import DocumentType, DocumentTypeSopFlow, Flow, Platform, RejectionCode, Scheme

__all__ = [
    "document_type_ids",
    "find_demo_credit_record_flow",
    "flow_view",
    "flows_for_rejection",
    "links_for_document_type",
    "replace_links",
    "resolve_flows",
]

DEMO_CREDIT_PLATFORM_MARKERS = ("國泰世華", "CUBE")
DEMO_CREDIT_FLOW_MARKERS = ("消費紀錄", "信用卡")


# ------------------------------------------------------------------ 讀取

async def find_demo_credit_record_flow(db: AsyncSession, tenant_id: str) -> Flow | None:
    """Demo 通知固定使用的已發布國泰信用卡消費紀錄流程。

    這條 Demo 路徑刻意不依賴 DocumentTypeSopFlow，避免評審操作時因方案對照尚未設定
    而看不到已經存在的教學圖。一般 SOP 入口仍維持資料驅動的文件對照行為。
    """
    platform_match = or_(
        *(Platform.display_name.ilike(f"%{marker}%") for marker in DEMO_CREDIT_PLATFORM_MARKERS),
        *(Platform.brand.ilike(f"%{marker}%") for marker in DEMO_CREDIT_PLATFORM_MARKERS),
    )
    flow_match = or_(*(Flow.name.ilike(f"%{marker}%") for marker in DEMO_CREDIT_FLOW_MARKERS))
    return (
        await db.execute(
            select(Flow)
            .join(Platform, Platform.id == Flow.platform_id)
            .where(
                Flow.tenant_id == tenant_id,
                Platform.tenant_id == tenant_id,
                Flow.status == "published",
                platform_match,
                flow_match,
            )
            .order_by(Flow.name, Flow.id)
            .limit(1)
        )
    ).scalar_one_or_none()


async def document_type_ids(db: AsyncSession, tenant_id: str, code: str) -> list[str]:
    """這個 tenant 裡所有叫這個 code 的文件類型。跨方案，因為民眾問的是文件不是方案。"""
    if not code:
        return []
    rows = (
        await db.execute(
            select(DocumentType.id)
            .join(Scheme, Scheme.id == DocumentType.scheme_id)
            .where(Scheme.tenant_id == tenant_id, DocumentType.code == code)
        )
    ).scalars().all()
    return [str(r) for r in rows]


async def links_for_document_type(
    db: AsyncSession, tenant_id: str, document_type_id: str
) -> list[DocumentTypeSopFlow]:
    """單一文件類型（依 id）的對照列，依 sort_order 排。"""
    rows = (
        await db.execute(
            select(DocumentTypeSopFlow)
            .where(
                DocumentTypeSopFlow.tenant_id == tenant_id,
                DocumentTypeSopFlow.document_type_id == document_type_id,
            )
            .order_by(DocumentTypeSopFlow.sort_order, DocumentTypeSopFlow.id)
        )
    ).scalars().all()
    return list(rows)


async def resolve_flows(
    db: AsyncSession,
    tenant_id: str,
    document_type_code: str,
    *,
    platform_id: str | None = None,
    flow_ids: list[str] | None = None,
) -> list[Flow]:
    """這份文件有哪些**已發布**的教學流程。

    `flow_ids` 是「承辦人指定了這幾條」的插隊路線（退件碼的 `related_sop_flow_ids`）；
    給了就只看那幾條，仍然照樣過濾未發布與跨機關的列。沒給才去查對照表。

    `platform_id` 是硬過濾：民眾已經說了「我用 App」，就不要再把網銀版塞給他。
    回傳依對照表的 sort_order，同分時依 flow 名稱，讓兩次呼叫的順序一樣。
    """
    order: dict[str, int] = {}
    if flow_ids:
        order = {fid: i for i, fid in enumerate(flow_ids) if fid}
    else:
        dt_ids = await document_type_ids(db, tenant_id, document_type_code)
        if not dt_ids:
            return []
        q = select(DocumentTypeSopFlow).where(
            DocumentTypeSopFlow.tenant_id == tenant_id,
            DocumentTypeSopFlow.document_type_id.in_(dt_ids),
        )
        if platform_id:
            q = q.where(DocumentTypeSopFlow.platform_id == platform_id)
        links = (await db.execute(q.order_by(DocumentTypeSopFlow.sort_order, DocumentTypeSopFlow.id))).scalars().all()
        for i, link in enumerate(links):
            order.setdefault(link.flow_id, i)
    if not order:
        return []

    q_flow = select(Flow).where(
        Flow.tenant_id == tenant_id,
        Flow.id.in_(list(order)),
        Flow.status == "published",
    )
    if platform_id:
        q_flow = q_flow.where(Flow.platform_id == platform_id)
    flows = list((await db.execute(q_flow)).scalars().all())
    flows.sort(key=lambda f: (order.get(f.id, 10_000), f.name, f.id))
    return flows


async def flows_for_rejection(
    db: AsyncSession,
    tenant_id: str,
    *,
    document_type_code: str,
    rejection: RejectionCode | None = None,
    platform_id: str | None = None,
) -> list[Flow]:
    """退件通知要連到哪幾條教學。

    承辦人在退件碼上挑過 flow 就用那幾條；沒挑（或挑的那幾條都還沒發布）就退回
    文件類型的對照。**不會兩邊都空著就放棄**——退件卻不告訴民眾去哪裡拿，
    等於把問題原封不動丟回去。
    """
    picked = [str(f) for f in (rejection.related_sop_flow_ids or [])] if rejection is not None else []
    if picked:
        flows = await resolve_flows(db, tenant_id, document_type_code, platform_id=platform_id, flow_ids=picked)
        if flows:
            return flows
    return await resolve_flows(db, tenant_id, document_type_code, platform_id=platform_id)


async def flow_view(db: AsyncSession, flow: Flow) -> dict[str, Any]:
    """公開形狀：flow 的 id、名字與它所屬的平台。沒有草稿、沒有內部欄位。"""
    platform = await db.get(Platform, flow.platform_id)
    return {
        "flow_id": flow.id,
        "flow_name": flow.name,
        "platform": (
            {
                "id": platform.id,
                "display_name": platform.display_name,
                "brand": platform.brand,
                "channel": platform.channel,
            }
            if platform is not None
            else None
        ),
    }


# ------------------------------------------------------------------ 寫入

async def replace_links(
    db: AsyncSession,
    tenant_id: str,
    document_type: DocumentType,
    pairs: list[dict[str, str]],
) -> list[DocumentTypeSopFlow]:
    """整批換掉一個文件類型的對照（PUT 的語意）。

    逐列比對而不是「全刪再全建」：主鍵換掉會讓稽核日誌對不上同一列，
    而且 `(document_type, flow, platform)` 的唯一鍵在同一個交易裡先刪後建也容易撞。
    `flow_id` 或 `platform_id` 缺一不可的列直接跳過——半組對照連不到任何東西。
    """
    wanted: list[tuple[str, str]] = []
    for pair in pairs:
        flow_id = str(pair.get("flow_id") or "").strip()
        platform_id = str(pair.get("platform_id") or "").strip()
        if not flow_id or not platform_id or (flow_id, platform_id) in wanted:
            continue
        wanted.append((flow_id, platform_id))

    existing = await links_for_document_type(db, tenant_id, document_type.id)
    by_key = {(row.flow_id, row.platform_id): row for row in existing}

    kept: list[DocumentTypeSopFlow] = []
    for order, key in enumerate(wanted):
        row = by_key.pop(key, None)
        if row is None:
            row = DocumentTypeSopFlow(
                tenant_id=tenant_id,
                document_type_id=document_type.id,
                flow_id=key[0],
                platform_id=key[1],
            )
            db.add(row)
        row.sort_order = order
        kept.append(row)
    for orphan in by_key.values():
        await db.delete(orphan)
    await db.flush()
    return kept
