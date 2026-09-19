"""Flow snapshots: what the citizen-facing engine reads. Published mode reads
the frozen FlowVersion; draft mode builds an equivalent snapshot from the live
tables (Playground only).

Goals live on 終點 steps: a flow delivers whichever documents its end steps
name, and a fork on the canvas may lead to different documents. The helpers at
the bottom answer the two questions the engines ask — which goals lie below a
step, and which of a step's outgoing edges still matter once the citizen has
said what they want — so a multi-goal flow reads as a straight line to
whoever only wants one of its documents.
"""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import storage
from ..models import Flow, FlowVersion, Goal, Platform, Step, Variant


def _variant_public(v: Variant) -> dict | None:
    if v.status != "completed" or not v.stepcard_key:
        return None
    return {
        "variant_id": v.id,
        # Object keys, never URLs: a snapshot is frozen at publish but the
        # public media domain is not, so the URL is built when the card is
        # sent (card_url below). Moving the domain needs no re-publish.
        "stepcard_key": v.stepcard_key,
        "stepcard_preview_key": v.stepcard_preview_key,
        "replica_png_key": v.replica_png_key,
        "width": v.stepcard_width,
        "height": v.stepcard_height,
        "annotations": [{"number": a.get("number"), "type": a.get("type"), "label": a.get("label")} for a in (v.annotations or [])],
    }


def flow_goal_ids(steps: list[Step]) -> list[str]:
    """The distinct goals a flow's 終點 steps name, in canvas order (top-left first)."""
    seen: list[str] = []
    for s in sorted(steps, key=lambda x: (x.canvas_y, x.canvas_x)):
        if s.is_end and s.goal_id and s.goal_id not in seen:
            seen.append(s.goal_id)
    return seen


async def build_snapshot(db: AsyncSession, flow_id: str, *, strict: bool = True) -> dict:
    """strict=True keeps only completed variants (publish); strict=False also
    exposes the replica of not-yet-completed variants for draft previews."""
    flow = (await db.execute(
        select(Flow).where(Flow.id == flow_id)
        .options(selectinload(Flow.steps).selectinload(Step.variants), selectinload(Flow.edges))
    )).scalar_one()
    platform = await db.get(Platform, flow.platform_id)
    goal_ids = flow_goal_ids(flow.steps)
    goals = (await db.execute(select(Goal).where(Goal.id.in_(goal_ids)))).scalars().all() if goal_ids else []
    gname = {g.id: g.name for g in goals}
    steps = []
    for s in sorted(flow.steps, key=lambda x: (not x.is_start, x.canvas_y, x.canvas_x)):
        variants = {}
        for v in s.variants:
            pub = _variant_public(v)
            if pub is None and not strict and v.replica_png_key:
                pub = {"variant_id": v.id, "stepcard_key": None, "stepcard_preview_key": None, "replica_png_key": v.replica_png_key,
                       "width": v.replica_width, "height": v.replica_height, "annotations": [], "draft_only": True}
            if pub:
                variants[v.theme] = pub
        gid = s.goal_id if s.is_end and s.goal_id in gname else None
        steps.append({"id": s.id, "title": s.title, "instruction": s.instruction, "stuck_hint": s.stuck_hint,
                      "is_start": s.is_start, "is_end": s.is_end, "goal_id": gid, "goal_name": gname.get(gid, "") if gid else "",
                      "variants": variants})
    edges = [{"id": e.id, "from": e.from_step_id, "to": e.to_step_id, "label": e.condition_label, "sort": e.sort_order}
             for e in sorted(flow.edges, key=lambda e: (e.sort_order, e.created_at))]
    return {
        "flow": {"id": flow.id, "name": flow.name, "platform_id": platform.id, "platform_name": platform.display_name,
                 "channel": platform.channel, "goals": [{"id": g, "name": gname[g]} for g in goal_ids if g in gname], "status": flow.status},
        "steps": steps, "edges": edges,
    }


async def load_snapshot(db: AsyncSession, tenant_id: str, flow_id: str, content_mode: str,
                        version_id: str | None = None) -> tuple[dict, str | None] | None:
    """Returns (snapshot, flow_version_id) or None if unavailable.

    Published mode reads the frozen FlowVersion: `version_id` when the caller
    pinned one (a session keeps the version it started on, even if the flow is
    re-published or rolled back meanwhile), else the flow's current version.
    The flow itself must still be published."""
    flow = await db.get(Flow, flow_id)
    if not flow or flow.tenant_id != tenant_id:
        return None
    if content_mode == "published":
        if flow.status != "published" or not flow.current_version_id:
            return None
        fv = await db.get(FlowVersion, version_id or flow.current_version_id)
        if not fv or fv.flow_id != flow.id:
            return None
        snap = dict(fv.snapshot)
        snap["version"] = fv.version
        return snap, fv.id
    snap = await build_snapshot(db, flow_id, strict=False)
    snap["version"] = None
    return snap, None


async def _flows_with_goals(db: AsyncSession, tenant_id: str, content_mode: str, platform_id: str | None = None) -> list[tuple[Flow, list[str]]]:
    """Every flow the mode can see, with the goals it delivers. Published mode
    trusts the frozen version (what a session would actually walk); draft mode
    reads the live 終點 steps."""
    q = select(Flow).where(Flow.tenant_id == tenant_id)
    if platform_id:
        q = q.where(Flow.platform_id == platform_id)
    if content_mode == "published":
        q = q.where(Flow.status == "published")
    flows = (await db.execute(q.order_by(Flow.updated_at.desc()))).scalars().all()
    if not flows:
        return []
    out: list[tuple[Flow, list[str]]] = []
    if content_mode == "published":
        vids = [f.current_version_id for f in flows if f.current_version_id]
        versions = {v.id: v for v in (await db.execute(select(FlowVersion).where(FlowVersion.id.in_(vids)))).scalars().all()} if vids else {}
        for f in flows:
            fv = versions.get(f.current_version_id or "")
            out.append((f, [g["id"] for g in snapshot_goals(fv.snapshot)] if fv else []))
        return out
    rows = (await db.execute(select(Step).where(Step.flow_id.in_([f.id for f in flows]), Step.is_end.is_(True)))).scalars().all()
    by_flow: dict[str, list[Step]] = defaultdict(list)
    for s in rows:
        by_flow[s.flow_id].append(s)
    return [(f, flow_goal_ids(by_flow.get(f.id, []))) for f in flows]


async def find_flow(db: AsyncSession, tenant_id: str, platform_id: str, goal_id: str, content_mode: str) -> Flow | None:
    """The most recently touched flow on this platform whose 終點 delivers the goal."""
    for f, goals in await _flows_with_goals(db, tenant_id, content_mode, platform_id):
        if goal_id in goals:
            return f
    return None


async def tenant_catalog(db: AsyncSession, tenant_id: str, content_mode: str = "published") -> tuple[list[dict], list[dict], list[dict]]:
    platforms = (await db.execute(select(Platform).where(Platform.tenant_id == tenant_id).order_by(Platform.brand, Platform.channel))).scalars().all()
    goals = (await db.execute(select(Goal).where(Goal.tenant_id == tenant_id).order_by(Goal.created_at))).scalars().all()
    flows = await _flows_with_goals(db, tenant_id, content_mode)
    flow_platforms = {f.platform_id for f, _ in flows}
    flow_goals = {g for _, gs in flows for g in gs}
    p_out = [{"id": p.id, "display_name": p.display_name, "brand": p.brand, "channel": p.channel, "category": p.category,
              "aliases": p.aliases or [], "has_flows": p.id in flow_platforms} for p in platforms]
    g_out = [{"id": g.id, "name": g.name, "description": g.description, "aliases": g.aliases or [], "has_flows": g.id in flow_goals} for g in goals]
    f_out = [{"id": f.id, "name": f.name, "platform_id": f.platform_id, "goal_ids": gs, "status": f.status} for f, gs in flows]
    return p_out, g_out, f_out


# ------------------------------------------------------------------ snapshot readers

def card_url(card: dict | None) -> str | None:
    """A snapshot card's public image URL, built the moment the card is sent.

    Snapshots published before keys replaced URLs (migration 0010) carried the
    URL itself; reading those still works, and they keep pointing wherever they
    pointed when they were frozen."""
    if not card:
        return None
    return storage.public_url(card.get("stepcard_key")) or card.get("stepcard_url")


def card_preview_url(card: dict | None) -> str | None:
    """The LINE-sized preview beside `card_url`."""
    if not card:
        return None
    return storage.public_url(card.get("stepcard_preview_key")) or card.get("preview_url")


def snapshot_step(snapshot: dict, step_id: str) -> dict | None:
    return next((s for s in snapshot["steps"] if s["id"] == step_id), None)


def snapshot_start(snapshot: dict) -> dict | None:
    return next((s for s in snapshot["steps"] if s.get("is_start")), None) or (snapshot["steps"][0] if snapshot["steps"] else None)


def outgoing(snapshot: dict, step_id: str) -> list[dict]:
    return [e for e in snapshot["edges"] if e["from"] == step_id]


def step_goal(snapshot: dict, step: dict) -> str | None:
    """The goal an end step delivers. Snapshots published before goals moved
    onto steps carried one goal on the flow; every end delivered it."""
    if not step.get("is_end"):
        return None
    return step.get("goal_id") or snapshot["flow"].get("goal_id")


def snapshot_goals(snapshot: dict) -> list[dict]:
    """[{id, name}] the flow delivers — from the flow block, or, for an old
    snapshot, its single goal."""
    flow = snapshot.get("flow", {})
    if flow.get("goals") is not None:
        return list(flow["goals"])
    if flow.get("goal_id"):
        return [{"id": flow["goal_id"], "name": flow.get("goal_name", "")}]
    return []


def goal_name(snapshot: dict, goal_id: str | None) -> str:
    return next((g["name"] for g in snapshot_goals(snapshot) if g["id"] == goal_id), "")


def goals_below(snapshot: dict) -> dict[str, set[str]]:
    """step id -> the goals reachable from it (its own included when it is an end)."""
    adj: dict[str, list[str]] = defaultdict(list)
    for e in snapshot["edges"]:
        adj[e["from"]].append(e["to"])
    own = {s["id"]: step_goal(snapshot, s) for s in snapshot["steps"]}
    memo: dict[str, set[str]] = {}

    def visit(sid: str, trail: set[str]) -> set[str]:
        if sid in memo:
            return memo[sid]
        found: set[str] = {own[sid]} if own.get(sid) else set()
        trail.add(sid)
        for nxt in adj.get(sid, []):
            if nxt in trail:  # a cycle never reaches publish; stay safe anyway
                continue
            found |= visit(nxt, trail)
        trail.discard(sid)
        memo[sid] = found
        return found

    for sid in own:
        visit(sid, set())
    return memo


def relevant_edges(snapshot: dict, step_id: str, goal_id: str | None, below: dict[str, set[str]] | None = None) -> list[dict]:
    """The outgoing edges that still matter to a citizen after a goal is
    chosen: those leading to that goal, plus any leading nowhere in particular
    (a branch with no goal-bearing end — draft content). With no goal, every
    edge matters. One edge left = no question to ask."""
    edges = outgoing(snapshot, step_id)
    if not goal_id or len(edges) < 2:
        return edges
    below = below if below is not None else goals_below(snapshot)
    kept = [e for e in edges if goal_id in below.get(e["to"], set()) or not below.get(e["to"])]
    return kept or edges


def walk(snapshot: dict, goal_id: str | None = None, start_id: str | None = None) -> list[dict]:
    """Steps in the order a citizen meets them from `start_id` (the flow's
    start by default), following the edges that matter for `goal_id`. Without
    a goal it is the whole flow, breadth-first by edge order, then any step the
    edges never reach."""
    by_id = {s["id"]: s for s in snapshot["steps"]}
    start = by_id.get(start_id) if start_id else snapshot_start(snapshot)
    below = goals_below(snapshot) if goal_id else None
    order: list[dict] = []
    seen: set[str] = set()
    queue = [start["id"]] if start else []
    while queue:
        sid = queue.pop(0)
        if sid in seen or sid not in by_id:
            continue
        seen.add(sid)
        order.append(by_id[sid])
        queue.extend(e["to"] for e in relevant_edges(snapshot, sid, goal_id, below))
    if not goal_id and not start_id:
        order.extend(s for s in snapshot["steps"] if s["id"] not in seen)
    return order


def straight_from(snapshot: dict, step_id: str, goal_id: str | None = None) -> list[str]:
    """Step ids from `step_id` onward while there is exactly one edge that
    matters — up to the next real fork or the end."""
    below = goals_below(snapshot) if goal_id else None
    ids = [step_id]
    seen = {step_id}
    while True:
        edges = relevant_edges(snapshot, ids[-1], goal_id, below)
        if len(edges) != 1 or edges[0]["to"] in seen:
            return ids
        ids.append(edges[0]["to"])
        seen.add(edges[0]["to"])
