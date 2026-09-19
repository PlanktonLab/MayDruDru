"""Citizen session engine (SPEC §7.1, §8).

The conversation state machine is a LangGraph graph; one turn = one graph
invocation. State is serialised to Redis by `SessionStore` with the session
TTL (the self-serialised fallback named in SPEC open question 8 — switching to
the Redis checkpointer is a compile-time change). The citizen screenshot is
passed through the run `config`, never through state, so it can never be
persisted.

Every node exits through `_reply`, which carries all persisted keys, so no
exit path can drop session context. A turn holds a short Redis lock so two
concurrent requests for one session cannot overwrite each other's state, and
the DB connection is released before any model call.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal, TypedDict

from langgraph.config import get_config
from langgraph.graph import END, START, StateGraph
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..config import get_settings
from ..db import release_connection
from ..events import log_event
from ..models import Flow, Goal, Step, Tenant, Variant
from ..redis_client import redis
from ..services import guide, webhooks
from ..services.content import (
    card_preview_url,
    card_url,
    find_flow,
    goal_name,
    load_snapshot,
    relevant_edges,
    snapshot_goals,
    snapshot_start,
    snapshot_step,
    step_goal,
    tenant_catalog,
    walk,
)
from ..services.guide import card_for, locate_guidance
from ..services.numbered_card import numbered_card
from ..services.policy import Policy
from . import agents, retrieval
from .retrieval import locate

log = logging.getLogger(__name__)

class SessionState(TypedDict, total=False):
    session_id: str
    tenant_id: str
    external_user_hash: str
    content_mode: str
    source: str
    theme: str
    known_context: dict
    platform_id: str | None
    brand: str | None
    goal_id: str | None
    flow_id: str | None
    flow_version_id: str | None
    step_id: str | None
    path: list[str]
    clarification: dict | None
    clarification_count: int
    completed_flows: list[str]
    completed_goals: list[str]
    created_at: float
    last_active_at: float
    # per-turn
    event: dict
    response: dict
    debug: dict


@dataclass
class TurnContext:
    db: AsyncSession
    screenshot: bytes | None = None
    snapshot_cache: dict | None = None
    policy: Policy = field(default_factory=Policy)


def _ctx() -> TurnContext:
    return get_config()["configurable"]["ctx"]


def _policy() -> Policy:
    return _ctx().policy


PERSISTED_KEYS = [k for k in SessionState.__annotations__ if k not in ("event", "response", "debug")]

MODEL_FAILURE_MESSAGE = "目前無法處理您的訊息，請稍後再試，或轉由人工協助"


def _reply(state: SessionState, response: dict, debug: dict | None = None) -> dict:
    """The one way a node returns: the response plus every persisted key."""
    out = {"response": response, **{k: state.get(k) for k in PERSISTED_KEYS}}
    if debug is not None:
        out["debug"] = debug
    return out


def match_option(options: list[dict], text: str) -> tuple[dict | None, bool]:
    """Match free text to a pending clarification option.

    Returns (option, ambiguous). Blank text never matches; an exact label wins;
    otherwise a partial match (text inside the label or label inside the text)
    counts only when exactly one option matches — several is ambiguous."""
    text = (text or "").strip()
    if not text:
        return None, False
    labelled = [(o, (o.get("label") or "").strip()) for o in options]
    labelled = [(o, label) for o, label in labelled if label]
    exact = [o for o, label in labelled if label == text]
    if len(exact) == 1:
        return exact[0], False
    partial = [o for o, label in labelled if text in label or label in text]
    if len(partial) == 1:
        return partial[0], False
    return None, len(partial) > 1 or len(exact) > 1


# ------------------------------------------------------------------ store

class SessionStore:
    @staticmethod
    def key(tenant_id: str, session_id: str) -> str:
        return f"sess:{tenant_id}:{session_id}"

    @staticmethod
    async def save(state: SessionState) -> None:
        data = {k: state.get(k) for k in PERSISTED_KEYS}
        await redis().set(SessionStore.key(state["tenant_id"], state["session_id"]), json.dumps(data, ensure_ascii=False),
                          ex=get_settings().session_ttl_seconds)

    @staticmethod
    async def load(tenant_id: str, session_id: str) -> SessionState | None:
        raw = await redis().get(SessionStore.key(tenant_id, session_id))
        if not raw:
            return None
        return json.loads(raw)

    @staticmethod
    async def delete(tenant_id: str, session_id: str) -> None:
        await redis().delete(SessionStore.key(tenant_id, session_id))


class SessionLock:
    """Per-session mutex (Redis SET NX PX) around load → run → save. The expiry
    bounds how long a crashed request can block the session; it covers a slow
    turn (several model calls) but not an unbounded one."""

    _RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

    def __init__(self, tenant_id: str, session_id: str):
        self.key = f"sesslock:{tenant_id}:{session_id}"
        self.token = uuid.uuid4().hex

    async def acquire(self) -> bool:
        ttl_ms = int((get_settings().llm_timeout_seconds * 2 + 60) * 1000)
        return bool(await redis().set(self.key, self.token, nx=True, px=ttl_ms))

    async def release(self) -> None:
        await redis().eval(self._RELEASE, 1, self.key, self.token)


# ------------------------------------------------------------------ helpers

async def _snapshot(state: SessionState) -> dict | None:
    """The snapshot of the session's flow — in published mode the version the
    session pinned when the flow started, not whatever is current now."""
    ctx = _ctx()
    if not state.get("flow_id"):
        return None
    if ctx.snapshot_cache and ctx.snapshot_cache.get("flow", {}).get("id") == state["flow_id"]:
        return ctx.snapshot_cache
    loaded = await load_snapshot(ctx.db, state["tenant_id"], state["flow_id"], state["content_mode"],
                                 version_id=state.get("flow_version_id"))
    if not loaded:
        return None
    ctx.snapshot_cache = loaded[0]
    return loaded[0]


def _escalation(state: SessionState, code: str, message: str) -> dict:
    return {"type": "escalation", "session_id": state["session_id"], "code": code, "message": message}


async def _clarify(state: SessionState, kind: str, question: str, options: list[dict]) -> dict:
    s = get_settings()
    count = state.get("clarification_count", 0) + 1
    if count > s.max_clarifications:
        state["clarification"] = None
        await log_event(_ctx().db, state["tenant_id"], state["session_id"], "escalation", flow_id=state.get("flow_id"),
                        payload={"code": errors.CLARIFICATION_LIMIT}, source=state.get("source", "api"))
        return _escalation(state, errors.CLARIFICATION_LIMIT, _policy().text("clarification_limit"))
    state["clarification"] = {"kind": kind, "question": question, "options": options}
    state["clarification_count"] = count
    await log_event(_ctx().db, state["tenant_id"], state["session_id"], "clarification", flow_id=state.get("flow_id"),
                    payload={"kind": kind, "attempt": count}, source=state.get("source", "api"))
    return {"type": "clarification", "session_id": state["session_id"], "kind": kind, "question": question,
            "options": [{k: v for k, v in o.items() if k != "payload"} for o in options], "attempt": count}


def _card_for(step: dict, theme: str) -> tuple[dict | None, str]:
    return card_for(step, theme)


async def _step_response(state: SessionState, snapshot: dict, note: str = "") -> dict:
    step = snapshot_step(snapshot, state["step_id"])
    if not step:
        return _escalation(state, errors.FLOW_NOT_FOUND, "步驟不存在於目前版本")
    card, used_theme = _card_for(step, state.get("theme", "light"))
    # the card counts from where this citizen came in: its place in the session's path, not in the flow
    number = max(1, len(state.get("path", [])))
    if card:
        card = await numbered_card(card, number)
    # a fork only asks when more than one way leads to the citizen's document
    edges = relevant_edges(snapshot, step["id"], state.get("goal_id"))
    titles = {s["id"]: s["title"] for s in snapshot["steps"]}
    branches = [{"edge_id": e["id"], "label": e["label"] or titles.get(e["to"], "下一步"), "to_step_title": titles.get(e["to"], "")} for e in edges] if len(edges) > 1 else []
    state["clarification"] = None
    state["clarification_count"] = 0
    path = state.get("path", [])
    at_end = bool(step.get("is_end")) and (not state.get("goal_id") or step_goal(snapshot, step) in (None, state["goal_id"]))
    return {
        "type": "step", "session_id": state["session_id"], "note": note,
        "flow": {"id": snapshot["flow"]["id"], "name": snapshot["flow"]["name"], "platform_name": snapshot["flow"]["platform_name"],
                 "goal_name": _goal_label(state, snapshot), "version": snapshot.get("version")},
        "step": {"id": step["id"], "title": step["title"], "instruction": step["instruction"], "stuck_hint": step.get("stuck_hint", ""),
                 "is_end": at_end},
        "card": ({"image_url": card_url(card), "preview_url": card_preview_url(card), "width": card.get("width"),
                  "height": card.get("height"), "theme": used_theme, "number": number, "annotations": card.get("annotations", [])} if card else None),
        "progress": {"index": len(path), "total": len(walk(snapshot, state.get("goal_id")))},
        "actions": {"next": len(edges) == 1 or (len(edges) == 0 and at_end), "prev": len(path) > 1,
                    "branches": branches, "restart": True},
    }


def _goal_label(state: SessionState, snapshot: dict) -> str:
    """The document this session is after; a flow that delivers one document
    names it even before the citizen did."""
    goals = snapshot_goals(snapshot)
    return goal_name(snapshot, state.get("goal_id")) or (goals[0]["name"] if len(goals) == 1 else "、".join(g["name"] for g in goals))


async def _completed_response(state: SessionState, snapshot: dict) -> dict:
    ctx = _ctx()
    # the end step says what the citizen holds now; the session's goal is the fallback (an old end without one)
    done_goal = step_goal(snapshot, snapshot_step(snapshot, state["step_id"]) or {}) or state.get("goal_id")
    label = goal_name(snapshot, done_goal) or _goal_label(state, snapshot)
    state["completed_flows"] = [*state.get("completed_flows", []), state["flow_id"]]
    state["completed_goals"] = [*state.get("completed_goals", []), *([done_goal] if done_goal else [])]
    # what else this platform can hand out — other documents, in this flow or another
    _, _, flows = await tenant_catalog(ctx.db, state["tenant_id"], state["content_mode"])
    names = {g.id: g.name for g in (await ctx.db.execute(select(Goal).where(Goal.tenant_id == state["tenant_id"]))).scalars().all()}
    suggestions, seen = [], set(state["completed_goals"])
    for f in flows:
        if f["platform_id"] != state["platform_id"]:
            continue
        for gid in f["goal_ids"]:
            if gid in seen or gid not in names:
                continue
            seen.add(gid)
            suggestions.append({"option_id": gid, "goal_id": gid, "flow_id": f["id"], "label": names[gid]})
    state["clarification"] = {"kind": "next_goal", "question": _policy().text("ask_next_goal"), "options": suggestions} if suggestions else None
    state["step_id"] = None
    state["flow_id"] = None
    state["flow_version_id"] = None
    state["goal_id"] = None
    state["path"] = []
    await log_event(ctx.db, state["tenant_id"], state["session_id"], "completed", flow_id=snapshot["flow"]["id"], source=state.get("source", "api"))
    await webhooks.create_deliveries(ctx.db, state["tenant_id"], "sop.session_completed", {
        "session_id": state["session_id"], "flow_id": snapshot["flow"]["id"], "goal_id": done_goal,
    })
    return {"type": "completed", "session_id": state["session_id"],
            "flow": {"id": snapshot["flow"]["id"], "name": snapshot["flow"]["name"], "goal_name": label},
            "message": _policy().text("completed", goal=label), "suggestions": suggestions}


async def _start_flow(state: SessionState, flow: Flow, goal_id: str | None = None) -> dict:
    ctx = _ctx()
    loaded = await load_snapshot(ctx.db, state["tenant_id"], flow.id, state["content_mode"])
    if not loaded:
        return _escalation(state, errors.FLOW_NOT_PUBLISHED, "此流程尚未發布")
    snapshot, fv_id = loaded
    start = snapshot_start(snapshot)
    if not start:
        return _escalation(state, errors.FLOW_NOT_FOUND, "此流程沒有步驟")
    ctx.snapshot_cache = snapshot
    goals = snapshot_goals(snapshot)
    goal = goal_id or state.get("goal_id")
    if goal not in {g["id"] for g in goals}:  # a flow with one document delivers it whatever was asked
        goal = goals[0]["id"] if len(goals) == 1 else None
    state.update(flow_id=flow.id, flow_version_id=fv_id, step_id=start["id"], path=[start["id"]], goal_id=goal, platform_id=flow.platform_id)
    await log_event(ctx.db, state["tenant_id"], state["session_id"], "flow_started", flow_id=flow.id, step_id=start["id"], source=state.get("source", "api"))
    return await _step_response(state, snapshot)


async def _resolve_flow(state: SessionState) -> dict:
    ctx = _ctx()
    flow = await find_flow(ctx.db, state["tenant_id"], state["platform_id"], state["goal_id"], state["content_mode"])
    if not flow:
        any_flow = await find_flow(ctx.db, state["tenant_id"], state["platform_id"], state["goal_id"], "draft")
        code = errors.FLOW_NOT_PUBLISHED if any_flow else errors.FLOW_NOT_FOUND
        await log_event(ctx.db, state["tenant_id"], state["session_id"], "escalation", payload={"code": code}, source=state.get("source", "api"))
        return _escalation(state, code, "找不到此平台與目標文件對應的已發布流程")
    return await _start_flow(state, flow)


async def _ask_platform(state: SessionState, platforms: list[dict]) -> dict:
    brands: dict[str, list[dict]] = {}
    for p in platforms:
        if p["has_flows"] or state["content_mode"] == "draft":
            brands.setdefault(p["brand"], []).append(p)
    options = [{"option_id": f"brand:{b}", "label": b, "payload": {"brand": b, "platform_ids": [p["id"] for p in ps]}} for b, ps in brands.items()]
    return await _clarify(state, "platform", _policy().text("ask_brand"), options)


async def _ask_channel(state: SessionState, platforms: list[dict], brand: str) -> dict:
    ps = [p for p in platforms if p["brand"] == brand]
    pol = _policy()
    options = [{"option_id": f"platform:{p['id']}", "label": f"{brand} {pol.text('channel_' + p['channel']) or p['channel']}", "payload": {"platform_id": p["id"]}} for p in ps]
    return await _clarify(state, "channel", pol.text("ask_channel", brand=brand), options)


async def _ask_goal(state: SessionState, goals: list[dict]) -> dict:
    options = [{"option_id": f"goal:{g['id']}", "label": g["name"], "payload": {"goal_id": g["id"]}} for g in goals if g["has_flows"] or state["content_mode"] == "draft"]
    return await _clarify(state, "goal", _policy().text("ask_goal"), options)


async def _after_intent(state: SessionState) -> dict:
    ctx = _ctx()
    platforms, goals, _ = await tenant_catalog(ctx.db, state["tenant_id"], state["content_mode"])
    if not state.get("platform_id"):
        if state.get("brand"):
            return await _ask_channel(state, platforms, state["brand"])
        return await _ask_platform(state, platforms)
    if not state.get("goal_id"):
        return await _ask_goal(state, goals)
    return await _resolve_flow(state)


# ------------------------------------------------------------------ nodes

def route(state: SessionState) -> Literal["handle_start", "handle_text", "handle_screenshot", "handle_action"]:
    return {"start": "handle_start", "text": "handle_text", "screenshot": "handle_screenshot", "action": "handle_action"}[state["event"]["kind"]]


async def handle_start(state: SessionState) -> dict:
    kc = state.get("known_context") or {}
    state["platform_id"] = kc.get("platform_id")
    state["goal_id"] = kc.get("goal_id")
    # A channel that already knows which flow to walk (the LINE document picker,
    # a deep link from a rejection notice) says so and skips every question.
    flow_id = kc.get("flow_id")
    if flow_id:
        flow = await _ctx().db.get(Flow, flow_id)
        if flow and flow.tenant_id == state["tenant_id"]:
            return _reply(state, await _start_flow(state, flow, goal_id=state.get("goal_id")))
        return _reply(state, _escalation(state, errors.FLOW_NOT_FOUND, "指定的流程不存在"))
    hint = state["event"].get("hint")
    if hint:
        return await _run_intent(state, hint)
    return _reply(state, await _after_intent(state))


async def _run_intent(state: SessionState, text: str) -> dict:
    ctx = _ctx()
    platforms, goals, _ = await tenant_catalog(ctx.db, state["tenant_id"], state["content_mode"])
    known = {k: v for k, v in {"platform_id": state.get("platform_id"), "goal_id": state.get("goal_id")}.items() if v}
    await release_connection(ctx.db)
    try:
        intent, usage = await agents.parse_intent(text, [{k: p[k] for k in ("id", "display_name", "brand", "channel", "aliases")} for p in platforms],
                                                  [{k: g[k] for k in ("id", "name", "aliases")} for g in goals], known,
                                                  tenant_id=state["tenant_id"], ref_id=state["session_id"])
    except Exception:
        log.exception("intent parsing failed (session %s)", state["session_id"])
        return _reply(state, _escalation(state, errors.MODEL_FAILURE, MODEL_FAILURE_MESSAGE))
    s = get_settings()
    pid = {p["id"] for p in platforms}
    gid = {g["id"] for g in goals}
    if intent.platform_id in pid and intent.platform_confidence >= s.intent_confidence_threshold:
        state["platform_id"] = intent.platform_id
    if intent.goal_id in gid and intent.goal_confidence >= s.intent_confidence_threshold:
        state["goal_id"] = intent.goal_id
    if intent.brand and not state.get("platform_id"):
        state["brand"] = intent.brand
    debug = {"intent": intent.model_dump(), "usage": [usage]}
    return _reply(state, await _after_intent(state), debug)


async def handle_text(state: SessionState) -> dict:
    text = (state["event"].get("text") or "").strip()
    pending = state.get("clarification")
    if pending:
        option, ambiguous = match_option(pending.get("options", []), text)
        if option:
            state["event"] = {"kind": "action", "action": "choose_option", "option_id": option["option_id"]}
            return await handle_action(state)
        if ambiguous or not text:
            question = pending.get("question") or "請從下列選項中選擇一項"
            return _reply(state, await _clarify(state, pending.get("kind", ""), question, pending.get("options", [])))
    if not text:  # nothing to parse: repeat where the citizen is
        snapshot = await _snapshot(state) if state.get("step_id") else None
        return _reply(state, await _step_response(state, snapshot) if snapshot else await _after_intent(state))
    return await _run_intent(state, text)


async def _apply_option(state: SessionState, option_id: str) -> dict:
    pending = state.get("clarification") or {}
    opt = next((o for o in pending.get("options", []) if o["option_id"] == option_id), None)
    if not opt:
        return _escalation(state, errors.INVALID_ACTION, "選項不存在或已過期")
    kind = pending.get("kind")
    payload = opt.get("payload", {})
    if kind == "platform":
        state["brand"] = payload["brand"]
        if len(payload["platform_ids"]) == 1:
            state["platform_id"] = payload["platform_ids"][0]
        state["clarification"] = None
        return await _after_intent(state)
    if kind == "channel":
        state["platform_id"] = payload["platform_id"]
        state["clarification"] = None
        return await _after_intent(state)
    if kind == "goal":
        state["goal_id"] = payload["goal_id"]
        state["clarification"] = None
        return await _after_intent(state)
    if kind == "branch":
        return await _move_to(state, payload["to"], via_edge=True)
    if kind == "candidate":
        snapshot = await _switch_flow_if_needed(state, payload["flow_id"])
        if snapshot is None:
            return _escalation(state, errors.FLOW_NOT_PUBLISHED, "候選畫面所屬流程未發布")
        state["step_id"] = payload["step_id"]
        state["path"] = [*state.get("path", []), payload["step_id"]]
        return await _step_response(state, snapshot, note=_policy().text("candidate_confirmed"))
    if kind == "next_goal":
        ctx = _ctx()
        flow = await ctx.db.get(Flow, payload.get("flow_id") or opt.get("flow_id"))
        if not flow:
            return _escalation(state, errors.FLOW_NOT_FOUND, "流程不存在")
        state["clarification"] = None
        return await _start_flow(state, flow, goal_id=opt.get("goal_id"))
    return _escalation(state, errors.INVALID_ACTION, "無法處理此選項")


async def _switch_flow_if_needed(state: SessionState, flow_id: str) -> dict | None:
    ctx = _ctx()
    if state.get("flow_id") != flow_id:
        loaded = await load_snapshot(ctx.db, state["tenant_id"], flow_id, state["content_mode"])
        if not loaded:
            return None
        snapshot, fv_id = loaded
        ctx.snapshot_cache = snapshot
        goals = {g["id"] for g in snapshot_goals(snapshot)}
        goal = state.get("goal_id") if state.get("goal_id") in goals else (next(iter(goals)) if len(goals) == 1 else None)
        state.update(flow_id=flow_id, flow_version_id=fv_id, goal_id=goal, platform_id=snapshot["flow"]["platform_id"], path=[])
        return snapshot
    return await _snapshot(state)


async def _move_to(state: SessionState, step_id: str, via_edge: bool = False) -> dict:
    snapshot = await _snapshot(state)
    if not snapshot:
        return _escalation(state, errors.FLOW_NOT_FOUND, "目前沒有進行中的流程")
    state["step_id"] = step_id
    state["path"] = [*state.get("path", []), step_id]
    await log_event(_ctx().db, state["tenant_id"], state["session_id"], "step_advanced", flow_id=state["flow_id"], step_id=step_id, source=state.get("source", "api"))
    return await _step_response(state, snapshot)


async def handle_action(state: SessionState) -> dict:
    ev = state["event"]
    action = ev.get("action")
    resp: dict
    if action == "choose_option":
        resp = await _apply_option(state, ev.get("option_id") or "")
    elif action == "restart":
        if state.get("flow_id"):
            snapshot = await _snapshot(state)
            start = snapshot_start(snapshot) if snapshot else None
            if start:
                state["step_id"] = start["id"]
                state["path"] = [start["id"]]
                resp = await _step_response(state, snapshot)
            else:
                resp = _escalation(state, errors.FLOW_NOT_FOUND, "流程不存在")
        else:
            state.update(platform_id=(state.get("known_context") or {}).get("platform_id"), goal_id=(state.get("known_context") or {}).get("goal_id"),
                         brand=None, clarification=None, clarification_count=0)
            resp = await _after_intent(state)
    elif not state.get("flow_id") or not state.get("step_id"):
        resp = _escalation(state, errors.INVALID_ACTION, "目前沒有進行中的流程，請先描述您要取得的文件")
    else:
        snapshot = await _snapshot(state)
        if not snapshot:
            resp = _escalation(state, errors.FLOW_NOT_PUBLISHED, "流程版本已不存在")
        elif action == "next":
            edges = relevant_edges(snapshot, state["step_id"], state.get("goal_id"))
            step = snapshot_step(snapshot, state["step_id"])
            if len(edges) == 1:
                resp = await _move_to(state, edges[0]["to"])
            elif len(edges) == 0:
                resp = await _completed_response(state, snapshot) if step and step.get("is_end") else _escalation(state, errors.FLOW_NOT_FOUND, "流程在此中斷（沒有後續步驟）")
            else:
                titles = {s["id"]: s["title"] for s in snapshot["steps"]}
                options = [{"option_id": f"edge:{e['id']}", "label": e["label"] or titles.get(e["to"], ""), "payload": {"to": e["to"]}} for e in edges]
                resp = await _clarify(state, "branch", _policy().text("ask_branch"), options)
        elif action == "prev":
            path = state.get("path", [])
            if len(path) > 1:
                path = path[:-1]
                state["path"] = path
                state["step_id"] = path[-1]
            resp = await _step_response(state, snapshot)
        elif action == "choose_branch":
            edge = next((e for e in relevant_edges(snapshot, state["step_id"], state.get("goal_id")) if e["id"] == ev.get("edge_id")), None)
            resp = await _move_to(state, edge["to"]) if edge else _escalation(state, errors.INVALID_ACTION, "分岔不存在")
        else:
            resp = _escalation(state, errors.INVALID_ACTION, "未知動作")
    return _reply(state, resp)


async def handle_screenshot(state: SessionState) -> dict:
    ctx = _ctx()
    png, ctx.screenshot = ctx.screenshot, None  # the context never holds the bytes past this point
    if not png:
        return _reply(state, _escalation(state, errors.SCREENSHOT_UNRECOGNIZED, "沒有收到圖片"))
    await log_event(ctx.db, state["tenant_id"], state["session_id"], "stuck_upload", flow_id=state.get("flow_id"), step_id=state.get("step_id"), source=state.get("source", "api"))
    try:
        snapshot = await _snapshot(state) if state.get("flow_id") else None
        res = await locate(ctx.db, state["tenant_id"], png, flow_id=state.get("flow_id"), platform_id=state.get("platform_id"),
                           content_mode=state["content_mode"], session_id=state["session_id"],
                           flow_version_id=state.get("flow_version_id"), step_id=state.get("step_id"), goal_id=state.get("goal_id"),
                           snapshot=snapshot, threshold=ctx.policy.locate_threshold, low=ctx.policy.locate_low)
    except Exception:
        log.exception("screenshot localisation failed (session %s)", state["session_id"])
        return _reply(state, _escalation(state, errors.MODEL_FAILURE, MODEL_FAILURE_MESSAGE))
    finally:
        del png  # drop the only reference as early as possible
    state["theme"] = res.theme or state.get("theme", "light")
    debug = {"locate": {**res.public(), "scope": res.scope, "description": res.description}, "usage": res.usage}
    await log_event(ctx.db, state["tenant_id"], state["session_id"], "locate_result", flow_id=res.flow_id or state.get("flow_id"), step_id=res.step_id,
                    payload={"ok": res.ok, "outcome": res.outcome, "confidence": res.confidence, "scope": res.scope}, source=state.get("source", "api"))
    await _count_drift(ctx.db, state, res)
    g = await locate_guidance(ctx.db, state["tenant_id"], res, content_mode=state["content_mode"], theme=state["theme"],
                              session_flow_id=state.get("flow_id"), session_goal_id=state.get("goal_id"), policy=ctx.policy)
    debug["guidance"] = g.to_dict()
    screen = {"outcome": res.outcome, "action": g.action, "kind": res.kind, "photographed": res.photographed, "platform_guess": res.platform_guess,
              "platform_id": g.platform_id, "platform_name": g.platform_name, "advice": g.advice}

    if g.action == guide.SEND and g.flow_id and g.step_id:
        snapshot = await _switch_flow_if_needed(state, g.flow_id)
        if snapshot is None:
            resp = _escalation(state, errors.FLOW_NOT_PUBLISHED, "定位到的流程未發布")
        else:
            state["step_id"] = g.step_id
            state["path"] = [*state.get("path", []), g.step_id]
            note = ctx.policy.text("located_note", confidence=f"{res.confidence:.0%}")
            if res.difference:
                note += f"；{res.difference}"
            resp = await _step_response(state, snapshot, note=note)
    elif g.action == guide.ASK and g.ask_kind == "candidate" and g.options:
        options = [{"option_id": f"cand:{o['step_id']}", "label": o["label"], "image_url": o.get("image_url"),
                    "payload": {"flow_id": o["flow_id"], "step_id": o["step_id"]}} for o in g.options]
        resp = await _clarify(state, "candidate", g.ask, options)
    elif g.action == guide.RESTART and g.flow_id and g.step_id:
        # a known platform but a page outside the flow, a home screen, a photo: start (over) from step 1
        snapshot = await _switch_flow_if_needed(state, g.flow_id)
        if snapshot is None:
            resp = _escalation(state, errors.FLOW_NOT_PUBLISHED, "流程未發布")
        else:
            state["step_id"] = g.step_id
            state["path"] = [g.step_id]
            resp = await _step_response(state, snapshot, note=g.advice)
    elif g.action == guide.ASK and g.ask_kind == "platform" and g.options:
        options = [{"option_id": f"platform:{o['platform_id']}", "label": o["label"], "payload": {"platform_id": o["platform_id"]}}
                   for o in g.options if o.get("platform_id")]
        resp = await _clarify(state, "channel", f"{g.advice} {g.ask}".strip(), options)
    elif g.action == guide.ASK and g.ask_kind == "goal" and g.options:
        options = [{"option_id": f"flow:{o['flow_id']}", "label": o["label"], "payload": {"flow_id": o["flow_id"]}} for o in g.options if o.get("flow_id")]
        resp = await _clarify(state, "next_goal", f"{g.advice} {g.ask}".strip(), options)
    else:
        code = {retrieval.OFF_FLOW: errors.SCREEN_OFF_FLOW, retrieval.NOT_APP_SCREEN: errors.SCREEN_NOT_APP,
                retrieval.NOT_A_SCREENSHOT: errors.SCREEN_NOT_SCREENSHOT, retrieval.UNREADABLE: errors.SCREEN_UNREADABLE,
                retrieval.UNKNOWN_PLATFORM: errors.PLATFORM_UNKNOWN}.get(g.outcome, errors.SCREENSHOT_UNRECOGNIZED)
        resp = _escalation(state, code, g.advice or "無法辨識這張截圖屬於哪個畫面")
    resp = {**resp, "screen": screen}
    return _reply(state, resp, debug)


async def _count_drift(db: AsyncSession, state: SessionState, res) -> None:
    """疑似改版計數：a known flow where location fails, or a hit with low
    confidence, bumps the counters that the canvas/dashboard surface."""
    try:
        if state.get("flow_id") and (not res.ok):
            f = await db.get(Flow, state["flow_id"])
            if f:
                f.drift_count += 1
            if state.get("step_id"):
                st = await db.get(Step, state["step_id"])
                if st:
                    st.drift_count += 1
        if res.step_id and not res.ok:
            v = await db.get(Variant, res.variant_id) if res.variant_id else None
            if v:
                v.drift_count += 1
        await db.commit()
    except Exception:
        log.warning("drift counter update failed", exc_info=True)
        await db.rollback()


def build_session_graph():
    g = StateGraph(SessionState)
    for name, fn in (("handle_start", handle_start), ("handle_text", handle_text), ("handle_screenshot", handle_screenshot), ("handle_action", handle_action)):
        g.add_node(name, fn)
        g.add_edge(name, END)
    g.add_conditional_edges(START, route)
    return g.compile()


_graph = None


def graph():
    global _graph
    if _graph is None:
        _graph = build_session_graph()
    return _graph


# ------------------------------------------------------------------ engine API

class SessionEngine:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def start(self, tenant_id: str, external_user_hash: str, *, hint: str | None, known_context: dict | None,
                    content_mode: str = "published", theme: str = "light", source: str = "api") -> dict:
        state: SessionState = {
            "session_id": uuid.uuid4().hex, "tenant_id": tenant_id, "external_user_hash": external_user_hash,
            "content_mode": content_mode, "source": source, "theme": theme, "known_context": known_context or {},
            "platform_id": None, "brand": None, "goal_id": None, "flow_id": None, "flow_version_id": None, "step_id": None,
            "path": [], "clarification": None, "clarification_count": 0, "completed_flows": [], "completed_goals": [],
            "created_at": time.time(), "last_active_at": time.time(),
        }
        await log_event(self.db, tenant_id, state["session_id"], "session_created", payload={"content_mode": content_mode}, source=source)
        return await self._turn(state, {"kind": "start", "hint": hint})

    async def handle(self, tenant_id: str, session_id: str, event: dict, screenshot: bytes | None = None) -> dict:
        lock = SessionLock(tenant_id, session_id)
        if not await lock.acquire():
            # Escalation is the only public response type that carries a code;
            # SESSION_BUSY tells the channel to retry shortly, not to hand off.
            return {"type": "escalation", "session_id": session_id, "code": errors.SESSION_BUSY,
                    "message": "上一則訊息仍在處理中，請稍候再試"}
        try:
            state = await SessionStore.load(tenant_id, session_id)
            if not state:
                raise errors.ApiError(404, errors.SESSION_EXPIRED, "session 不存在或已過期")
            return await self._turn(state, event, screenshot)
        finally:
            await lock.release()

    async def status(self, tenant_id: str, session_id: str) -> dict:
        state = await SessionStore.load(tenant_id, session_id)
        if not state:
            raise errors.ApiError(404, errors.SESSION_EXPIRED, "session 不存在或已過期")
        return {k: state.get(k) for k in ("session_id", "content_mode", "theme", "platform_id", "goal_id", "flow_id", "flow_version_id", "step_id", "path", "clarification_count", "completed_flows", "created_at", "last_active_at")}

    async def _turn(self, state: SessionState, event: dict, screenshot: bytes | None = None) -> dict:
        t0 = time.perf_counter()
        tenant = await self.db.get(Tenant, state["tenant_id"])
        overrides = (state.get("known_context") or {}).get("policy")
        # 語句表從 `contents` 讀（SPEC §8.5）：承辦人在後台改的字，下一回合就生效。
        policy = await Policy.load(self.db, state["tenant_id"], tenant.settings if tenant else None,
                                   overrides if isinstance(overrides, dict) else None)
        ctx = TurnContext(db=self.db, screenshot=screenshot, policy=policy)
        state["event"] = event
        state["response"] = {}
        state["debug"] = {}
        out = await graph().ainvoke(state, config={"configurable": {"ctx": ctx}})
        new_state: SessionState = {k: out.get(k, state.get(k)) for k in PERSISTED_KEYS}
        new_state["last_active_at"] = time.time()
        await SessionStore.save(new_state)
        response = out.get("response") or _escalation(state, errors.MODEL_FAILURE, "沒有產生回應")
        if state.get("source") == "playground":
            response = {**response, "_debug": {**(out.get("debug") or {}), "elapsed_ms": int((time.perf_counter() - t0) * 1000), "state": self._public_state(new_state)}}
        return response

    @staticmethod
    def _public_state(state: SessionState) -> dict:
        return {k: state.get(k) for k in ("platform_id", "brand", "goal_id", "flow_id", "flow_version_id", "step_id", "path", "theme", "clarification_count")}
