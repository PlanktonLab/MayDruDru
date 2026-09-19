"""SOP 的公開讀取面（SPEC §8.5、§10.1、§10.2）。

`/api/sop/*`（匿名、給 apply-web）與 `/v1/sop/*`（API key、給外部頻道）是同一組
功能的兩個門，差別只有「誰在問」。業務邏輯全部集中在這裡，兩個 router 都只剩
「解析參數 → 呼叫這裡 → 回傳」（CLAUDE.md 規則 2）。

四個函式對應四件事：

* `flow_steps()`   一條已發布流程的逐步卡片
* `platforms()`    有教學的平台清單
* `locate()`       一張截圖在哪一步（**bytes 只在記憶體**，SPEC §11 紅線 3）
* `document_type_flows()` 一份文件有哪些教學（`services/sop_links` 的公開形狀）

一律只讀 `content_mode="published"`：草稿是承辦人還在改的東西，公開的門不該看得到。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..ai.retrieval import locate as retrieval_locate
from ..models import RejectionCode, Scheme, Tenant
from . import sop_links
from .content import load_snapshot, tenant_catalog
from .guide import goal_for, locate_guidance, step_messages, step_rows
from .policy import Policy

__all__ = ["document_type_flows", "flow_steps", "locate", "platforms", "policy_for"]

PUBLISHED = "published"


async def policy_for(db: AsyncSession, tenant_id: str) -> Policy:
    """這個機關的語氣與門檻，`sop.template.*` 由承辦人在後台改（SPEC §8.5）。"""
    tenant = await db.get(Tenant, tenant_id)
    return await Policy.load(db, tenant_id, tenant.settings if tenant is not None else None)


# ------------------------------------------------------------------ 流程步驟

async def flow_steps(
    db: AsyncSession,
    tenant_id: str,
    flow_id: str,
    *,
    goal_id: str | None = None,
    from_step_id: str | None = None,
    theme: str = "light",
    number_from: int = 1,
) -> dict[str, Any]:
    """一條已發布流程往某個目標文件的步驟，以及頻道要送出的訊息（一步一張編號卡）。

    `from_step_id` 從中途開始（截圖定位之後接著往下走）。流程沒發布就是 404——
    不是「空的步驟清單」，那會讓呼叫端以為教學存在但沒有內容。
    """
    loaded = await load_snapshot(db, tenant_id, flow_id, PUBLISHED)
    if not loaded:
        raise errors.ApiError(404, errors.FLOW_NOT_PUBLISHED, "flow 不存在或未發布")
    snap, _ = loaded
    goal = goal_for(snap, goal_id)
    rows = step_rows(snap, goal)
    ids = [str(r["step_id"]) for r in rows["steps"]]
    if from_step_id:
        if from_step_id not in ids:
            raise errors.ApiError(404, errors.FLOW_NOT_FOUND, "步驟不在這條流程裡")
        ids = ids[ids.index(from_step_id):]
    batch = await step_messages(
        snap, ids, theme, goal_id=goal, start_number=max(1, number_from),
        policy=await policy_for(db, tenant_id),
    )
    return {**rows, "version": snap.get("version"), "messages": batch.messages}


# ------------------------------------------------------------------ 目錄

async def platforms(db: AsyncSession, tenant_id: str) -> list[dict[str, Any]]:
    """有已發布流程的平台。沒有教學的平台不列出來——列了也點不進去。"""
    rows, _, _ = await tenant_catalog(db, tenant_id, PUBLISHED)
    return [dict(p) for p in rows if p.get("has_flows")]


async def flows(db: AsyncSession, tenant_id: str, *, platform_id: str | None = None) -> list[dict[str, Any]]:
    """已發布的流程清單，可依平台過濾。"""
    _, _, rows = await tenant_catalog(db, tenant_id, PUBLISHED)
    out = [dict(f) for f in rows]
    if platform_id:
        out = [f for f in out if f.get("platform_id") == platform_id]
    return out


async def goals(db: AsyncSession, tenant_id: str) -> list[dict[str, Any]]:
    _, rows, _ = await tenant_catalog(db, tenant_id, PUBLISHED)
    return [dict(g) for g in rows if g.get("has_flows")]


# ------------------------------------------------------------------ 截圖定位

async def locate(
    db: AsyncSession,
    tenant_id: str,
    png: bytes,
    *,
    platform_id: str | None = None,
    flow_id: str | None = None,
    step_id: str | None = None,
    goal_id: str | None = None,
    session_id: str = "",
) -> dict[str, Any]:
    """這張截圖是哪一步，以及接下來該做什麼。

    **圖片只在記憶體**（SPEC §11 紅線 3）：bytes 進來、交給檢索、離開函式前就丟掉，
    中途不寫任何物件儲存、不寫資料庫。`platform_id` 是硬過濾，
    `flow_id`／`step_id`／`goal_id` 只是「民眾剛剛在哪」的先驗，讓排序偏向附近的步驟。
    """
    snapshot: dict[str, Any] | None = None
    if flow_id:
        loaded = await load_snapshot(db, tenant_id, flow_id, PUBLISHED)
        snapshot = loaded[0] if loaded else None
        if snapshot is None:
            flow_id = None
    policy = await policy_for(db, tenant_id)
    try:
        res = await retrieval_locate(
            db, tenant_id, png, flow_id=flow_id, platform_id=platform_id, content_mode=PUBLISHED,
            session_id=session_id, step_id=step_id, goal_id=goal_id, snapshot=snapshot,
            threshold=policy.locate_threshold, low=policy.locate_low,
        )
    finally:
        del png  # 盡早放掉唯一一個參照
    guidance = await locate_guidance(
        db, tenant_id, res, content_mode=PUBLISHED, theme=res.theme,
        session_flow_id=flow_id, session_goal_id=goal_id, policy=policy,
    )
    out: dict[str, Any] = {**res.public(), "guidance": guidance.to_dict()}
    # 定位到了就順手把那一步之後的卡片附上，呼叫端不必再問一次。
    cards: list[dict[str, Any]] = []
    if guidance.flow_id and guidance.step_ids:
        try:
            steps = await flow_steps(
                db, tenant_id, guidance.flow_id, goal_id=goal_id,
                from_step_id=guidance.step_ids[0], theme=res.theme,
            )
            cards = [m for m in steps["messages"]][:5]
        except errors.ApiError:
            cards = []
    out["cards"] = cards
    return out


# ------------------------------------------------------------- 文件類型對照

async def document_type_flows(
    db: AsyncSession,
    tenant_id: str,
    code: str,
    *,
    platform_id: str | None = None,
    scheme_code: str = "",
    rejection_code: str = "",
) -> list[dict[str, Any]]:
    """一份文件有哪些已發布的教學。

    帶了 `rejection_code` 就先看承辦人在那個退件碼上挑過哪幾條（`related_sop_flow_ids`），
    沒挑才退回文件類型本身的對照（`sop_links.flows_for_rejection`）。
    """
    rejection: RejectionCode | None = None
    if rejection_code and scheme_code:
        rejection = await _rejection(db, tenant_id, scheme_code, rejection_code)
    found = await sop_links.flows_for_rejection(
        db, tenant_id, document_type_code=code, rejection=rejection, platform_id=platform_id
    )
    return [await sop_links.flow_view(db, f) for f in found]


async def _rejection(db: AsyncSession, tenant_id: str, scheme_code: str, code: str) -> RejectionCode | None:
    return (
        await db.execute(
            select(RejectionCode)
            .join(Scheme, Scheme.id == RejectionCode.scheme_id)
            .where(Scheme.tenant_id == tenant_id, Scheme.code == scheme_code, RejectionCode.code == code)
        )
    ).scalar_one_or_none()
