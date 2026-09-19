"""Dashboard summary (SPEC §6.4)."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import CurrentUser, current_user
from ..models import EventLog, Flow, LlmUsage, Platform, Step

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
async def summary(days: int = Query(default=30, ge=1, le=365), user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    since = datetime.now(UTC) - timedelta(days=days)
    base = select(EventLog.event_type, func.count(EventLog.id)).where(EventLog.tenant_id == user.tenant_id, EventLog.created_at >= since, EventLog.source != "eval")
    counts = dict((await db.execute(base.group_by(EventLog.event_type))).all())
    sessions = counts.get("session_created", 0)
    completed = counts.get("completed", 0)
    steps = counts.get("step_advanced", 0)
    stuck = counts.get("stuck_upload", 0)
    escalations = counts.get("escalation", 0)
    flows_started = counts.get("flow_started", 0)

    # per-flow drift and per-flow session/complete counts
    flows = (await db.execute(select(Flow.id, Flow.name, Flow.status, Flow.drift_count, Platform.display_name).join(Platform, Platform.id == Flow.platform_id).where(Flow.tenant_id == user.tenant_id))).all()
    per_flow_started = dict((await db.execute(
        select(EventLog.flow_id, func.count(EventLog.id)).where(EventLog.tenant_id == user.tenant_id, EventLog.created_at >= since, EventLog.event_type == "flow_started").group_by(EventLog.flow_id))).all())
    per_flow_completed = dict((await db.execute(
        select(EventLog.flow_id, func.count(EventLog.id)).where(EventLog.tenant_id == user.tenant_id, EventLog.created_at >= since, EventLog.event_type == "completed").group_by(EventLog.flow_id))).all())
    step_drift = (await db.execute(
        select(Step.flow_id, func.sum(Step.drift_count)).join(Flow, Flow.id == Step.flow_id).where(Flow.tenant_id == user.tenant_id).group_by(Step.flow_id))).all()
    step_drift_map = {k: int(v or 0) for k, v in step_drift}
    flow_rows = [{"flow_id": fid, "name": name, "platform_name": pname, "status": status, "drift_count": drift + step_drift_map.get(fid, 0),
                  "started": per_flow_started.get(fid, 0), "completed": per_flow_completed.get(fid, 0)} for fid, name, status, drift, pname in flows]

    usage = (await db.execute(
        select(LlmUsage.task, func.count(LlmUsage.id), func.sum(LlmUsage.input_tokens), func.sum(LlmUsage.cached_tokens), func.sum(LlmUsage.output_tokens),
               func.sum(LlmUsage.cost_usd), func.avg(LlmUsage.latency_ms))
        .where(LlmUsage.tenant_id == user.tenant_id, LlmUsage.created_at >= since).group_by(LlmUsage.task))).all()
    usage_rows = [{"task": t, "calls": c, "input_tokens": int(i or 0), "cached_tokens": int(ca or 0), "output_tokens": int(o or 0),
                   "cost_usd": round(float(cost or 0), 4), "avg_latency_ms": int(lat or 0)} for t, c, i, ca, o, cost, lat in usage]

    # daily series
    day = func.date_trunc(literal_column("'day'"), EventLog.created_at)
    daily = (await db.execute(
        select(day, EventLog.event_type, func.count(EventLog.id))
        .where(EventLog.tenant_id == user.tenant_id, EventLog.created_at >= since, EventLog.source != "eval",
               EventLog.event_type.in_(("session_created", "completed", "stuck_upload", "escalation")))
        .group_by(day, EventLog.event_type).order_by(day))).all()
    series: dict[str, dict] = {}
    for d, t, c in daily:
        key = d.date().isoformat()
        series.setdefault(key, {"date": key, "session_created": 0, "completed": 0, "stuck_upload": 0, "escalation": 0})[t] = c

    return {
        "days": days,
        "sessions": sessions, "flows_started": flows_started, "completed": completed,
        "completion_rate": (completed / flows_started) if flows_started else None,
        "avg_steps": (steps / flows_started) if flows_started else None,
        "stuck_uploads": stuck, "escalations": escalations,
        "escalation_rate": (escalations / sessions) if sessions else None,
        "flows": sorted(flow_rows, key=lambda r: -r["drift_count"]),
        "llm_usage": usage_rows, "llm_cost_usd": round(sum(r["cost_usd"] for r in usage_rows), 4),
        "daily": list(series.values()),
    }
