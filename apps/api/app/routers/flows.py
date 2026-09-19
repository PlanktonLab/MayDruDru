"""Canvas, flows, steps, edges, publish & versions."""

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import storage
from ..db import get_db
from ..deps import CurrentUser, current_user, get_owned, require_cap
from ..jobs import enqueue
from ..models import Edge, Flow, FlowVersion, Goal, Platform, Step, Variant
from ..schemas import (
    CanvasOut,
    EdgeIn,
    EdgeOut,
    EdgePatch,
    FlowIn,
    FlowOut,
    FlowPatch,
    FlowVersionOut,
    LayoutIn,
    LayoutItem,
    RenderCardsOut,
    StepDuplicateIn,
    StepIn,
    StepOut,
    StepPatch,
    ValidationOut,
)
from ..services.assets import (
    PURGE_FAILED_MESSAGE,
    AssetPurgeError,
    purge_variant_assets,
    variants_of_flow,
    variants_of_step,
)
from ..services.content import flow_goal_ids
from ..services.publish import publish_flow, rollback_flow, unpublish_flow, validate_flow
from .catalog_admin import goal_out, platform_outs
from .variant_views import SUMMARY_COLUMNS, variant_summary
from .variants import EDITABLE_AFTER_REVIEW, start_job

log = logging.getLogger("sop.flows")
router = APIRouter(prefix="/api", tags=["flows"])

FLOW_NOT_FOUND = "找不到此流程"
STEP_NOT_FOUND = "找不到此步驟"
EDGE_NOT_FOUND = "找不到此連線"
START_STEP_POSITION = (80.0, 120.0)
CARD_TEXT_FIELDS = ("title", "instruction")  # printed on the Step Card
DUPLICABLE_STATUSES = ("annotating", "completed")
# desensitised outputs a duplicate may share; never structure, check_report, originals, thread or review history
DUPLICATED_FIELDS = ("replica_width", "replica_height", "kept_texts", "fake_data", "fake_data_reviewed", "annotations", "stepcard_key",
                     "stepcard_preview_key", "stepcard_width", "stepcard_height", "stepcard_layout", "description", "embedding")


def _step_out(s: Step) -> StepOut:
    return StepOut(id=s.id, flow_id=s.flow_id, title=s.title, instruction=s.instruction, stuck_hint=s.stuck_hint, canvas_x=s.canvas_x,
                   canvas_y=s.canvas_y, is_start=s.is_start, is_end=s.is_end, goal_id=s.goal_id if s.is_end else None, drift_count=s.drift_count,
                   variants=[variant_summary(v) for v in sorted(s.variants, key=lambda v: v.theme != "light")])


def _edge_out(e: Edge) -> EdgeOut:
    return EdgeOut(id=e.id, flow_id=e.flow_id, from_step_id=e.from_step_id, to_step_id=e.to_step_id, condition_label=e.condition_label, sort_order=e.sort_order)


def _flow_out(f: Flow, version: int | None, goal_ids: list[str]) -> FlowOut:
    return FlowOut(id=f.id, platform_id=f.platform_id, goal_ids=goal_ids, name=f.name, status=f.status, current_version_id=f.current_version_id,
                   current_version=version, drift_count=f.drift_count, updated_at=f.updated_at)


async def _flow_response(db: AsyncSession, f: Flow) -> FlowOut:
    version = None
    if f.current_version_id:
        version = (await db.execute(select(FlowVersion.version).where(FlowVersion.id == f.current_version_id))).scalar_one_or_none()
    ends = (await db.execute(select(Step).where(Step.flow_id == f.id, Step.is_end.is_(True)))).scalars().all()
    return _flow_out(f, version, flow_goal_ids(ends))


async def _own_flow(db: AsyncSession, user: CurrentUser, flow_id: str) -> Flow:
    return await get_owned(db, Flow, flow_id, user, FLOW_NOT_FOUND)


async def _own_step(db: AsyncSession, user: CurrentUser, step_id: str) -> Step:
    return await get_owned(db, Step, step_id, user, STEP_NOT_FOUND, options=(selectinload(Step.variants),))


async def _reload_step_out(db: AsyncSession, user: CurrentUser, step_id: str) -> StepOut:
    db.expunge_all()  # pick up variants created or changed in this request
    return _step_out(await _own_step(db, user, step_id))


async def _purge_or_503(variants: list[Variant]) -> None:
    try:
        await purge_variant_assets(variants)
    except AssetPurgeError:
        log.exception("asset purge failed")
        raise HTTPException(503, PURGE_FAILED_MESSAGE)


# ------------------------------------------------------------------ canvas

@router.get("/canvas", response_model=CanvasOut)
async def get_canvas(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    tid = user.tenant_id
    platforms = (await db.execute(select(Platform).where(Platform.tenant_id == tid))).scalars().all()
    goals = (await db.execute(select(Goal).where(Goal.tenant_id == tid))).scalars().all()
    flows = (await db.execute(
        select(Flow, FlowVersion.version).outerjoin(FlowVersion, FlowVersion.id == Flow.current_version_id).where(Flow.tenant_id == tid)
    )).all()
    steps = (await db.execute(
        select(Step).join(Flow, Flow.id == Step.flow_id).where(Flow.tenant_id == tid)
        .options(selectinload(Step.variants).load_only(*SUMMARY_COLUMNS))
    )).scalars().all()
    edges = (await db.execute(select(Edge).join(Flow, Flow.id == Edge.flow_id).where(Flow.tenant_id == tid))).scalars().all()
    by_flow: dict[str, list[Step]] = {}
    for s in steps:
        by_flow.setdefault(s.flow_id, []).append(s)
    return CanvasOut(platforms=await platform_outs(db, platforms), goals=[goal_out(g) for g in goals],
                     flows=[_flow_out(f, version, flow_goal_ids(by_flow.get(f.id, []))) for f, version in flows], steps=[_step_out(s) for s in steps],
                     edges=[_edge_out(e) for e in edges])


def layout_positions(items: list[LayoutItem]) -> dict[str, tuple[float, float]]:
    """Step id -> position; a later item for the same step wins."""
    return {it.id: (it.x, it.y) for it in items}


@router.put("/canvas/layout")
async def save_layout(body: LayoutIn, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    positions = layout_positions(body.items)
    if positions:
        steps = (await db.execute(
            select(Step).join(Flow, Flow.id == Step.flow_id).where(Step.id.in_(positions), Flow.tenant_id == user.tenant_id)
        )).scalars().all()
        for s in steps:
            s.canvas_x, s.canvas_y = positions[s.id]
        await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ flows

async def _ensure_goal(db: AsyncSession, user: CurrentUser, goal_id: str) -> None:
    g = await db.get(Goal, goal_id)
    if not g or g.tenant_id != user.tenant_id:
        raise HTTPException(400, "goal 不存在")


async def default_goal_for_end(db: AsyncSession, tenant_id: str, flow_id: str, except_step_id: str | None = None) -> str | None:
    """What a step most likely delivers when it becomes a 終點 and nobody said:
    the goal every other end of the flow already names, else the tenant's only
    goal. Anything less certain stays blank for the clerk to pick."""
    ends = (await db.execute(select(Step.goal_id).where(Step.flow_id == flow_id, Step.is_end.is_(True), Step.goal_id.is_not(None),
                                                       Step.id != (except_step_id or "")))).scalars().all()
    used = set(ends)
    if len(used) == 1:
        return next(iter(used))
    if used:
        return None
    goals = (await db.execute(select(Goal.id).where(Goal.tenant_id == tenant_id).limit(2))).scalars().all()
    return goals[0] if len(goals) == 1 else None


@router.post("/flows", response_model=FlowOut)
async def create_flow(body: FlowIn, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    p = await db.get(Platform, body.platform_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(400, "platform 不存在")
    f = Flow(tenant_id=user.tenant_id, platform_id=body.platform_id, name=body.name)
    db.add(f)
    await db.flush()
    # every flow starts with one start step so the DAG is never empty
    x, y = START_STEP_POSITION
    start = Step(flow_id=f.id, title="起點", instruction="", canvas_x=x, canvas_y=y, is_start=True)
    db.add(start)
    await db.flush()
    for theme in ("light", "dark"):
        db.add(Variant(step_id=start.id, theme=theme))
    await db.commit()
    return _flow_out(f, None, [])


@router.patch("/flows/{flow_id}", response_model=FlowOut)
async def patch_flow(flow_id: str, body: FlowPatch, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    f = await _own_flow(db, user, flow_id)
    data = body.model_dump(exclude_none=True)
    for k, v in data.items():
        setattr(f, k, v)
    await db.commit()
    return await _flow_response(db, f)


@router.delete("/flows/{flow_id}")
async def delete_flow(flow_id: str, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    f = await _own_flow(db, user, flow_id)
    await _purge_or_503(await variants_of_flow(db, f.id))
    await db.delete(f)
    await db.commit()
    return {"ok": True}


@router.get("/flows/{flow_id}/validate", response_model=ValidationOut)
async def validate(flow_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await _own_flow(db, user, flow_id)
    return ValidationOut(**await validate_flow(db, flow_id))


@router.post("/flows/{flow_id}/publish", response_model=FlowOut)
async def publish(flow_id: str, user: CurrentUser = Depends(require_cap("sop_review")), db: AsyncSession = Depends(get_db)):
    f = await _own_flow(db, user, flow_id)
    v = await validate_flow(db, flow_id)
    if not v["publishable"]:
        raise HTTPException(422, {"errors": v["publish_errors"], "unfinished": v["unfinished"]})
    await publish_flow(db, flow_id, user.id)
    await db.refresh(f)
    return await _flow_response(db, f)


@router.post("/flows/{flow_id}/unpublish", response_model=FlowOut)
async def unpublish(flow_id: str, user: CurrentUser = Depends(require_cap("sop_review")), db: AsyncSession = Depends(get_db)):
    f = await _own_flow(db, user, flow_id)
    await unpublish_flow(db, flow_id)
    await db.refresh(f)
    return await _flow_response(db, f)


def renderable_variants(variants: list[Variant]) -> list[Variant]:
    """The steps a whole-flow re-render touches: reviewed, with a replica, and
    not in the hands of a background job. Everything else is left alone."""
    return [v for v in variants if v.status in EDITABLE_AFTER_REVIEW and v.replica_html_key]


@router.post("/flows/{flow_id}/render-cards", response_model=RenderCardsOut)
async def render_cards(flow_id: str, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    """Render every step's card again — after a template change, or new demo
    data. Each step keeps its own layout patch; only the picture is redone."""
    await _own_flow(db, user, flow_id)
    variants = await variants_of_flow(db, flow_id)
    todo = renderable_variants(variants)
    for v in todo:
        await start_job(db, v, "rendering", "排隊產生 Step Card", "render_stepcard", v.id)
    return RenderCardsOut(queued=len(todo), skipped=len(variants) - len(todo))


@router.get("/flows/{flow_id}/versions", response_model=list[FlowVersionOut])
async def versions(flow_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await _own_flow(db, user, flow_id)
    rows = (await db.execute(select(FlowVersion).where(FlowVersion.flow_id == flow_id).order_by(FlowVersion.version.desc()))).scalars().all()
    return [FlowVersionOut(id=r.id, version=r.version, created_at=r.created_at, published_by=r.published_by, step_count=len(r.snapshot.get("steps", []))) for r in rows]


@router.post("/flows/{flow_id}/rollback/{version_id}", response_model=FlowOut)
async def rollback(flow_id: str, version_id: str, user: CurrentUser = Depends(require_cap("sop_review")), db: AsyncSession = Depends(get_db)):
    f = await _own_flow(db, user, flow_id)
    try:
        await rollback_flow(db, flow_id, version_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    await db.refresh(f)
    return await _flow_response(db, f)


# ------------------------------------------------------------------ steps

@router.post("/steps", response_model=StepOut)
async def create_step(body: StepIn, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    await _own_flow(db, user, body.flow_id)
    data = body.model_dump()
    if data["is_start"]:  # a flow has exactly one start; only the first may claim it
        has_start = (await db.execute(select(Step.id).where(Step.flow_id == body.flow_id, Step.is_start.is_(True)).limit(1))).first()
        data["is_start"] = has_start is None
    if data["goal_id"]:
        await _ensure_goal(db, user, data["goal_id"])
    elif data["is_end"]:
        data["goal_id"] = await default_goal_for_end(db, user.tenant_id, body.flow_id)
    s = Step(**data)
    db.add(s)
    await db.flush()
    for theme in ("light", "dark"):
        db.add(Variant(step_id=s.id, theme=theme))
    await db.commit()
    return await _reload_step_out(db, user, s.id)


@router.get("/steps/{step_id}", response_model=StepOut)
async def get_step(step_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return _step_out(await _own_step(db, user, step_id))


def card_text_changed(step: Step, data: dict) -> bool:
    return any(k in data and data[k] != getattr(step, k) for k in CARD_TEXT_FIELDS)


async def _rerender_cards(db: AsyncSession, variants: list[Variant]) -> None:
    """Queue a Step Card render for completed variants after their text changed.
    If the queue is down the variants fall back to annotating so the clerk can
    render again by hand."""
    todo = [v for v in variants if v.status == "completed"]
    if not todo:
        return
    for v in todo:
        v.status, v.progress, v.error = "rendering", "排隊產生 Step Card", ""
    await db.commit()
    failed = []
    for v in todo:
        try:
            await enqueue("render_stepcard", v.id)
        except Exception:
            log.exception("enqueue render_stepcard failed for variant %s", v.id)
            failed.append(v)
    if failed:
        for v in failed:
            v.status, v.progress = "annotating", "文字已修改，需重新產生 Step Card"
        await db.commit()
        raise HTTPException(503, "背景工作佇列暫時無法使用，請稍後再試")


@router.patch("/steps/{step_id}", response_model=StepOut)
async def patch_step(step_id: str, body: StepPatch, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    s = await _own_step(db, user, step_id)
    data = body.model_dump(exclude_none=True)
    if "goal_id" in body.model_fields_set:  # an explicit null clears the goal
        data["goal_id"] = body.goal_id
    rerender = card_text_changed(s, data)
    if data.get("is_start"):
        others = (await db.execute(select(Step).where(Step.flow_id == s.flow_id, Step.id != s.id, Step.is_start.is_(True)))).scalars().all()
        for o in others:
            o.is_start = False
    if data.get("goal_id"):
        await _ensure_goal(db, user, data["goal_id"])
    elif data.get("is_end") and not s.is_end and not s.goal_id and "goal_id" not in data:
        data["goal_id"] = await default_goal_for_end(db, user.tenant_id, s.flow_id, except_step_id=s.id)
    for k, v in data.items():
        setattr(s, k, v)
    await db.commit()
    if rerender:
        await _rerender_cards(db, list(s.variants))
    return _step_out(s)


@router.delete("/steps/{step_id}")
async def delete_step(step_id: str, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    s = await _own_step(db, user, step_id)
    await _purge_or_503(await variants_of_step(db, s.id))
    await db.delete(s)
    await db.commit()
    return {"ok": True}


async def _copy_private(src_key: str, tenant_id: str, variant_id: str) -> str:
    """Each variant owns its replica objects, so deleting one never breaks a copy."""
    ext = src_key.rsplit(".", 1)[-1]
    data = await asyncio.to_thread(storage.get_private, src_key)
    content_type = "text/html" if ext == "html" else "image/png"
    return await asyncio.to_thread(storage.put_private, f"replicas/{tenant_id}/{variant_id}/{uuid.uuid4().hex}.{ext}", data, content_type)


async def _duplicate_variant(src: Variant, new_step_id: str, tenant_id: str) -> Variant:
    nv = Variant(id=uuid.uuid4().hex, step_id=new_step_id, theme=src.theme)
    if src.status not in DUPLICABLE_STATUSES or not (src.replica_html_key and src.replica_png_key):
        return nv
    for field in DUPLICATED_FIELDS:
        setattr(nv, field, getattr(src, field))
    nv.replica_html_key = await _copy_private(src.replica_html_key, tenant_id, nv.id)
    nv.replica_png_key = await _copy_private(src.replica_png_key, tenant_id, nv.id)
    nv.status, nv.progress = src.status, src.progress
    return nv


@router.post("/steps/{step_id}/duplicate", response_model=StepOut)
async def duplicate_step(step_id: str, body: StepDuplicateIn, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    """Copy a step (text + desensitised replica, annotations and Step Card) into a
    flow — for shared steps like 登入 / 首頁 (SPEC §6.1)."""
    s = await _own_step(db, user, step_id)
    await _own_flow(db, user, body.target_flow_id)
    n = Step(flow_id=body.target_flow_id, title=s.title, instruction=s.instruction, stuck_hint=s.stuck_hint,
             canvas_x=body.canvas_x if body.canvas_x is not None else s.canvas_x + 40,
             canvas_y=body.canvas_y if body.canvas_y is not None else s.canvas_y + 40)
    db.add(n)
    await db.flush()
    try:
        copies = [await _duplicate_variant(v, n.id, user.tenant_id) for v in s.variants]
    except Exception:
        log.exception("replica copy failed while duplicating step %s", s.id)
        raise HTTPException(503, "儲存服務暫時無法使用，請稍後再試")
    db.add_all(copies)
    await db.commit()
    return await _reload_step_out(db, user, n.id)


# ------------------------------------------------------------------ edges

@router.post("/edges", response_model=EdgeOut)
async def create_edge(body: EdgeIn, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    await _own_flow(db, user, body.flow_id)
    a, b = await db.get(Step, body.from_step_id), await db.get(Step, body.to_step_id)
    if not a or not b or a.flow_id != body.flow_id or b.flow_id != body.flow_id:
        raise HTTPException(400, "邊的兩端必須是同一個 flow 的步驟")
    if a.id == b.id:
        raise HTTPException(400, "不可連到自己")
    dup = (await db.execute(select(Edge).where(Edge.from_step_id == a.id, Edge.to_step_id == b.id))).scalar_one_or_none()
    if dup:
        return _edge_out(dup)
    e = Edge(**body.model_dump())
    db.add(e)
    await db.commit()
    return _edge_out(e)


@router.patch("/edges/{edge_id}", response_model=EdgeOut)
async def patch_edge(edge_id: str, body: EdgePatch, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    e = await get_owned(db, Edge, edge_id, user, EDGE_NOT_FOUND)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(e, k, v)
    await db.commit()
    return _edge_out(e)


@router.delete("/edges/{edge_id}")
async def delete_edge(edge_id: str, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    e = await get_owned(db, Edge, edge_id, user, EDGE_NOT_FOUND)
    await db.delete(e)
    await db.commit()
    return {"ok": True}
