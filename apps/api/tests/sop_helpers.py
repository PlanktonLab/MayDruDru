"""P4 測試用的積木：真的建一條已發布的 SOP 流程。

`ai/session_graph.py` 與 `services/sop_public.py` 讀的是 **FlowVersion 的快照**，
不是 live 的資料表，所以測試也得走一次 `services/publish.py::publish_flow()`。
手寫一份假快照會讓測試在「快照長什麼樣」這件事上跟正式環境分岔，
那正是最容易出錯、也最該被測到的地方。
"""

from __future__ import annotations

from typing import Any

from app.models import (
    DocumentType,
    DocumentTypeSopFlow,
    Edge,
    Flow,
    Goal,
    Platform,
    Step,
    Variant,
)
from app.services.publish import publish_flow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def make_platform(
    db: AsyncSession, tenant_id: str, *, display_name: str = "示範銀行 App",
    brand: str = "示範銀行", channel: str = "mobile_app",
) -> Platform:
    row = Platform(tenant_id=tenant_id, display_name=display_name, brand=brand, channel=channel)
    db.add(row)
    await db.flush()
    return row


async def make_goal(db: AsyncSession, tenant_id: str, name: str = "信用卡帳單") -> Goal:
    row = Goal(tenant_id=tenant_id, name=name)
    db.add(row)
    await db.flush()
    return row


async def make_published_flow(
    db: AsyncSession,
    tenant_id: str,
    *,
    platform: Platform | None = None,
    goal: Goal | None = None,
    name: str = "查信用卡帳單",
    titles: tuple[str, ...] = ("開啟 App", "進入帳單明細"),
    storage: Any = None,
    recognises: bytes | None = None,
) -> Flow:
    """一條 n 步的直線流程，每一步都有一張完成的淺色 step card，然後發布。

    最後一步是終點並指向 `goal`——`publish_flow()` 會擋下沒有目標文件的終點，
    而那個 goal_id 正是「這條流程能交出哪一份文件」的唯一來源。

    `storage`（`fake_storage` fixture）給了就把每一步的復刻圖放進去：定位的重排
    那一段真的會去讀圖，讀不到就只會得到「復刻圖暫時無法取得」。
    `recognises` 是一張截圖，給了就把它的雜湊寫進**第一步**的關鍵字裡——
    fake 供應商的重排器認的就是那個雜湊，於是這條流程的第一步變成「認得出這張圖」。
    """
    from app.ai.fake import _img_hash

    platform = platform or await make_platform(db, tenant_id)
    goal = goal or await make_goal(db, tenant_id)
    flow = Flow(tenant_id=tenant_id, platform_id=platform.id, name=name)
    db.add(flow)
    await db.flush()

    fingerprint = _img_hash(recognises) if recognises else ""
    steps: list[Step] = []
    for index, title in enumerate(titles):
        last = index == len(titles) - 1
        step = Step(
            flow_id=flow.id, title=title, instruction=f"{title}的操作說明",
            canvas_x=index * 300, canvas_y=0,
            is_start=index == 0, is_end=last, goal_id=goal.id if last else None,
        )
        db.add(step)
        await db.flush()
        keywords = [title, name]
        if fingerprint and index == 0:
            keywords.append(fingerprint)
        replica_key = f"replicas/{step.id}.png"
        db.add(
            Variant(
                step_id=step.id, theme="light", status="completed",
                stepcard_key=f"cards/{step.id}.png", stepcard_preview_key=f"previews/{step.id}.jpg",
                stepcard_width=600, stepcard_height=900,
                replica_png_key=replica_key,
                description=f"{title} 的畫面 {fingerprint if fingerprint and index == 0 else ''}".strip(),
                keywords=keywords,
            )
        )
        if storage is not None:
            storage.seed(replica_key, recognises or b"\x89PNG\r\n\x1a\n")
        steps.append(step)
    for a, b in zip(steps, steps[1:]):
        db.add(Edge(flow_id=flow.id, from_step_id=a.id, to_step_id=b.id))
    await db.commit()

    await publish_flow(db, flow.id, "u" * 32)
    await db.refresh(flow)
    return flow


async def link_document_type(
    db: AsyncSession, tenant_id: str, scheme_id: str, code: str, flow: Flow
) -> DocumentTypeSopFlow:
    """把方案裡的某個文件類型接到一條流程上（`document_type_sop_flows` 的一列）。"""
    document_type = (
        await db.execute(
            select(DocumentType).where(DocumentType.scheme_id == scheme_id, DocumentType.code == code)
        )
    ).scalar_one()
    row = DocumentTypeSopFlow(
        tenant_id=tenant_id, document_type_id=document_type.id,
        flow_id=flow.id, platform_id=flow.platform_id,
    )
    db.add(row)
    await db.commit()
    return row


def card_keys(snapshot: dict[str, Any]) -> list[str]:
    """快照裡每一步的 step card key，順序就是步驟順序。"""
    return [
        variant.get("stepcard_key", "")
        for step in snapshot.get("steps", [])
        for variant in (step.get("variants") or {}).values()
    ]
