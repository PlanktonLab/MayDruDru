"""Draft / publish lifecycle (SPEC §6.3)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..dag import paths_from_start, validate_dag
from ..models import Flow, FlowVersion, Step
from .content import build_snapshot


def unfinished_steps(steps, reachable: set[str]) -> list[dict]:
    """Reachable steps whose light variant is not completed (SPEC §6.3: dark is optional)."""
    out = []
    for s in steps:
        if s.id not in reachable:
            continue
        light = next((v for v in s.variants if v.theme == "light"), None)
        if not light or light.status != "completed":
            out.append({"step_id": s.id, "theme": "light", "title": s.title})
    return out


async def validate_flow(db: AsyncSession, flow_id: str) -> dict:
    flow = (await db.execute(
        select(Flow).where(Flow.id == flow_id)
        .options(selectinload(Flow.steps).selectinload(Step.variants), selectinload(Flow.edges))
    )).scalar_one()
    ids = [s.id for s in flow.steps]
    edges = [(e.from_step_id, e.to_step_id) for e in flow.edges]
    starts = [s.id for s in flow.steps if s.is_start]
    ends = [s.id for s in flow.steps if s.is_end]
    errors = validate_dag(ids, edges, starts, ends)
    reachable = paths_from_start(edges, starts[0]) if starts else set()
    unfinished = unfinished_steps(flow.steps, reachable) if starts else []
    # a 終點 the citizen can reach must say which document they hold there —
    # it is how a flow is found for a goal and how a fork is chosen for them
    no_goal = [s for s in flow.steps if s.is_end and s.id in reachable and not s.goal_id]
    publish_errors = errors + [f"終點「{s.title}」還沒指定要取得的目標文件" for s in no_goal] + [f"步驟「{u['title']}」的淺色截圖尚未完成" for u in unfinished]
    return {"ok": not errors, "errors": errors, "publishable": not publish_errors, "publish_errors": publish_errors,
            "unfinished": [{"step_id": u["step_id"], "theme": u["theme"]} for u in unfinished]}


async def publish_flow(db: AsyncSession, flow_id: str, user_id: str) -> FlowVersion:
    flow = await db.get(Flow, flow_id)
    snapshot = await build_snapshot(db, flow_id, strict=True)
    n = (await db.execute(select(func.coalesce(func.max(FlowVersion.version), 0)).where(FlowVersion.flow_id == flow_id))).scalar_one()
    fv = FlowVersion(flow_id=flow_id, tenant_id=flow.tenant_id, version=n + 1, snapshot=snapshot, published_by=user_id)
    db.add(fv)
    await db.flush()
    flow.status = "published"
    flow.current_version_id = fv.id
    await db.commit()
    return fv


async def rollback_flow(db: AsyncSession, flow_id: str, version_id: str) -> FlowVersion:
    flow = await db.get(Flow, flow_id)
    fv = await db.get(FlowVersion, version_id)
    if not fv or fv.flow_id != flow_id:
        raise ValueError("版本不存在")
    flow.current_version_id = fv.id
    flow.status = "published"
    await db.commit()
    return fv


async def unpublish_flow(db: AsyncSession, flow_id: str) -> None:
    flow = await db.get(Flow, flow_id)
    flow.status = "draft"
    await db.commit()
