"""The generic building blocks of citizen guidance.

Every channel — the tool-calling assistant behind the Playground and
`/v1/chat`, the deterministic Session API, the stateless `/v1/locate`,
`/v1/intent` and `/v1/flows/{id}/steps` endpoints — is a thin layer over the
functions here. Nothing in this module knows what kind of organisation the
tenant is, what its goals are called, what language its citizens speak or
what it wants done with a stray screenshot: the `Policy` (services.policy)
supplies all of that, the catalog supplies the platforms and goals, the
snapshots supply the steps.

Pieces:

* `card_for`, `step_rows`, `step_messages` — reading a flow for a citizen:
  which card to show, the ordered steps toward one goal, and the messages
  (one image per step, text when a step has no card yet) a channel sends.
* `resolve_intent` — the citizen's words → platform / goal / flow, or what
  is still missing.
* `decide_guidance` — the screenshot outcome (see `ai.retrieval`) plus the
  policy → a structured decision: the action to take, the steps to send,
  the options to offer. No wording.
* `phrase_guidance` — the decision → the sentences, from the policy's
  templates. `locate_guidance` does both.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import agents, retrieval
from ..ai.retrieval import LocateResult
from ..config import get_settings
from ..db import release_connection
from .content import (
    card_preview_url,
    card_url,
    find_flow,
    goal_name,
    load_snapshot,
    relevant_edges,
    snapshot_goals,
    snapshot_start,
    snapshot_step,
    straight_from,
    tenant_catalog,
    walk,
)
from .numbered_card import numbered_card
from .policy import Policy

CHANNEL_LABEL = {"mobile_app": "手機 App", "web": "網頁版", "desktop": "電腦版"}

# what a decision tells the channel to do
SEND = "send"          # send step_ids from where the citizen is
RESTART = "restart"    # send step_ids from the start of flow_id
ASK = "ask"            # put `ask` + `options` to the citizen
RETAKE = "retake"      # ask for a better picture (advice only)
HANDOFF = "handoff"    # the policy says to stop and hand over
ACTIONS = (SEND, RESTART, ASK, RETAKE, HANDOFF)


# ------------------------------------------------------------------ reading a flow

def card_for(step: dict, theme: str) -> tuple[dict | None, str]:
    """The variant to show for `theme`: dark when asked and present, else
    light, else whatever exists."""
    variants = step.get("variants", {})
    if theme == "dark" and "dark" in variants:
        return variants["dark"], "dark"
    if "light" in variants:
        return variants["light"], "light"
    if variants:
        t = next(iter(variants))
        return variants[t], t
    return None, theme


def goal_for(snapshot: dict, goal_id: str | None, fallback: str | None = None) -> str | None:
    """The goal to walk this flow for: the one asked when the flow delivers
    it, else the flow's only goal, else `fallback` when the flow delivers it."""
    goals = [g["id"] for g in snapshot_goals(snapshot)]
    if goal_id in goals:
        return goal_id
    if len(goals) == 1:
        return goals[0]
    return fallback if fallback in goals else None


def step_rows(snapshot: dict, goal_id: str | None = None) -> dict:
    """The flow as a channel or a model reads it: ordered steps toward
    `goal_id` (other goals' branches dropped), each with its cards and the
    forks that still need the citizen's answer."""
    order = walk(snapshot, goal_id)
    titles = {s["id"]: s["title"] for s in snapshot["steps"]}
    rows = []
    for i, s in enumerate(order, 1):
        edges = relevant_edges(snapshot, s["id"], goal_id)
        row = {"index": i, "step_id": s["id"], "title": s["title"], "instruction": s["instruction"],
               "has_card": any(v.get("stepcard_key") for v in s.get("variants", {}).values()),
               "is_start": bool(s.get("is_start")), "is_end": bool(s.get("is_end"))}
        if s.get("is_end") and s.get("goal_name"):
            row["delivers"] = s["goal_name"]
        if len(edges) > 1:
            row["branches"] = [{"label": e["label"] or titles.get(e["to"], ""), "to_step_id": e["to"], "to_step_title": titles.get(e["to"], "")}
                               for e in edges]
        rows.append(row)
    flow = {"id": snapshot["flow"]["id"], "name": snapshot["flow"]["name"], "platform_id": snapshot["flow"]["platform_id"],
            "platform": snapshot["flow"]["platform_name"], "goals": [g["name"] for g in snapshot_goals(snapshot)]}
    if goal_id:
        flow["showing_steps_for"] = goal_name(snapshot, goal_id) or goal_id
    return {"flow": flow, "steps": rows}


@dataclass
class StepBatch:
    messages: list[dict] = field(default_factory=list)
    sent: list[str] = field(default_factory=list)     # heads of the cards sent
    textual: list[str] = field(default_factory=list)  # steps that had no card and went out as text
    unknown: list[str] = field(default_factory=list)  # step ids that are not in the flow


async def step_messages(snapshot: dict, step_ids: list[str], theme: str, *, goal_id: str | None = None,
                        start_number: int = 1, policy: Policy | None = None) -> StepBatch:
    """One message per step: the Step Card image numbered for this
    conversation (a citizen who joins midway counts from one), or the step's
    text when it has no card yet."""
    policy = policy or Policy()
    order = [s["id"] for s in walk(snapshot, goal_id)]
    total = len(order)
    out = StepBatch()
    flow_id = snapshot["flow"]["id"]
    for sid in step_ids:
        step = snapshot_step(snapshot, sid)
        if not step:
            out.unknown.append(sid)
            continue
        n = order.index(sid) + 1 if sid in order else 0
        head = policy.text("step_head", index=n, total=total, title=step["title"]) if n else step["title"]
        card, used_theme = card_for(step, theme)
        number = start_number + len(out.sent) + len(out.textual)
        if card and card_url(card):
            card = await numbered_card(card, number)
            url = card_url(card)
            out.messages.append({"kind": "image", "url": url, "preview_url": card_preview_url(card) or url,
                                 "width": card.get("width"), "height": card.get("height"), "theme": used_theme, "number": number,
                                 "alt": head, "flow_id": flow_id, "step_id": sid, "title": step["title"], "instruction": step["instruction"]})
            out.sent.append(head)
        else:
            out.messages.append({"kind": "text", "text": f"{head}\n{step['instruction']}", "number": number, "flow_id": flow_id, "step_id": sid,
                                 "title": step["title"], "instruction": step["instruction"]})
            out.textual.append(head)
    return out


# ------------------------------------------------------------------ intent

@dataclass
class IntentOutcome:
    platform_id: str | None = None
    brand: str | None = None
    goal_id: str | None = None
    flow_id: str | None = None
    needs: list[str] = field(default_factory=list)  # platform | channel | goal | flow
    reason: str = ""
    intent: dict = field(default_factory=dict)
    usage: list[dict] = field(default_factory=list)

    def public(self) -> dict:
        return {"platform_id": self.platform_id, "brand": self.brand, "goal_id": self.goal_id, "flow_id": self.flow_id,
                "needs": self.needs, "reason": self.reason}


async def resolve_intent(db: AsyncSession, tenant_id: str, text: str, known: dict | None, *, content_mode: str = "published",
                         ref_id: str = "") -> IntentOutcome:
    """Words → platform / goal / published flow. `known` carries what the
    channel already knows (platform_id, goal_id); anything still missing is
    listed in `needs` so the channel can ask."""
    s = get_settings()
    platforms, goals, flows = await tenant_catalog(db, tenant_id, content_mode)
    known = {k: v for k, v in (known or {}).items() if v}
    await release_connection(db)
    intent, usage = await agents.parse_intent(text, [{k: p[k] for k in ("id", "display_name", "brand", "channel", "aliases")} for p in platforms],
                                              [{k: g[k] for k in ("id", "name", "aliases")} for g in goals], known,
                                              tenant_id=tenant_id, ref_id=ref_id)
    out = IntentOutcome(intent=intent.model_dump(), usage=[usage], reason=intent.reason)
    pid = {p["id"] for p in platforms}
    gid = {g["id"] for g in goals}
    out.platform_id = known.get("platform_id") if known.get("platform_id") in pid else None
    out.goal_id = known.get("goal_id") if known.get("goal_id") in gid else None
    if not out.platform_id and intent.platform_id in pid and intent.platform_confidence >= s.intent_confidence_threshold:
        out.platform_id = intent.platform_id
    if not out.goal_id and intent.goal_id in gid and intent.goal_confidence >= s.intent_confidence_threshold:
        out.goal_id = intent.goal_id
    if intent.brand and not out.platform_id:
        out.brand = intent.brand
    if not out.platform_id:
        out.needs.append("channel" if out.brand else "platform")
    if not out.goal_id:
        # a platform with one goal only delivers that one: no need to ask
        if out.platform_id:
            here = {g for f in flows if f["platform_id"] == out.platform_id for g in f["goal_ids"]}
            if len(here) == 1:
                out.goal_id = next(iter(here))
        if not out.goal_id:
            out.needs.append("goal")
    if out.platform_id and out.goal_id:
        flow = await find_flow(db, tenant_id, out.platform_id, out.goal_id, content_mode)
        if flow:
            out.flow_id = flow.id
        else:
            out.needs.append("flow")
    return out


# ------------------------------------------------------------------ screenshot outcome → decision → words

@dataclass
class Guidance:
    """What a channel does with a screenshot outcome. `decide_guidance` fills
    the structure, `phrase_guidance` the sentences."""
    outcome: str
    action: str = ""                       # SEND | RESTART | ASK | RETAKE | HANDOFF
    advice: str = ""                       # one line for the citizen (or for the model to rephrase)
    ask: str = ""                          # a question to put to the citizen, when action is ASK
    options: list[dict] = field(default_factory=list)   # [{label, ...}] for `ask`
    ask_kind: str = ""                     # candidate | platform | goal — what the options are
    flow_id: str | None = None
    flow_name: str = ""
    step_id: str | None = None
    step_title: str = ""
    step_index: int | None = None
    total_steps: int | None = None
    step_ids: list[str] = field(default_factory=list)  # the steps to send next, in order
    restart: bool = False                  # step_ids start the flow over
    platform_id: str | None = None
    platform_name: str = ""
    # facts phrase_guidance needs, kept off the public dict
    _seen: str = ""
    _kind: str = ""
    _photographed: bool = False
    _issues: list[str] = field(default_factory=list)
    _difference: str = ""

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if not k.startswith("_") and v not in (None, "", [], False)}


async def decide_guidance(db: AsyncSession, tenant_id: str, res: LocateResult, *, content_mode: str, policy: Policy | None = None,
                          session_flow_id: str | None = None, session_goal_id: str | None = None,
                          snapshots: dict[str, dict] | None = None) -> Guidance:
    """The fallback ladder, decided under the policy: every outcome ends in
    one action — send from here, restart a flow, ask with options, ask for a
    better picture, or hand off. `snapshots` is a per-turn cache the caller
    may share (flow_id → snapshot)."""
    policy = policy or Policy()
    snapshots = snapshots if snapshots is not None else {}

    async def snap(flow_id: str | None) -> dict | None:
        if not flow_id:
            return None
        if flow_id not in snapshots:
            loaded = await load_snapshot(db, tenant_id, flow_id, content_mode)
            snapshots[flow_id] = loaded[0] if loaded else None
        return snapshots[flow_id]

    platforms, _, flows = await tenant_catalog(db, tenant_id, content_mode)
    pname = {p["id"]: p["display_name"] for p in platforms}
    g = Guidance(outcome=res.outcome, platform_id=res.platform_id if res.platform_id in pname else None,
                 _seen=res.platform_guess or "", _kind=res.kind, _photographed=res.photographed, _issues=list(res.quality_issues),
                 _difference=res.difference)
    g.platform_name = pname.get(g.platform_id or "", "")
    o = res.outcome

    if o in (retrieval.LOCATED, retrieval.AMBIGUOUS) and res.flow_id and res.step_id:
        s = await snap(res.flow_id)
        if s is None:
            g.outcome, o = retrieval.OFF_FLOW, retrieval.OFF_FLOW  # a step in a flow that is no longer published
        else:
            step = snapshot_step(s, res.step_id)
            goal = goal_for(s, session_goal_id if res.flow_id == session_flow_id else None)
            order = [x["id"] for x in walk(s, goal)]
            g.flow_id, g.flow_name, g.step_id, g.step_title = res.flow_id, s["flow"]["name"], res.step_id, step["title"] if step else ""
            g.step_index = order.index(res.step_id) + 1 if res.step_id in order else None
            g.total_steps = len(order)
            g.step_ids = straight_from(s, res.step_id, goal)
            if o == retrieval.LOCATED or policy.on_ambiguous == "best_guess":
                g.action = SEND
            else:
                g.action, g.ask_kind = ASK, "candidate"
                g.options = [{"label": f"{c['flow_name']}：{c['step_title']}", "flow_id": c["flow_id"], "step_id": c["step_id"],
                              "image_url": c.get("preview_url")} for c in res.candidates[:4]]
            return g

    # not a step. What platform are we talking about, and can we restart something?
    here = [f for f in flows if g.platform_id and f["platform_id"] == g.platform_id]
    target = session_flow_id if session_flow_id and any(f["id"] == session_flow_id for f in here) else (here[0]["id"] if len(here) == 1 else None)
    s = await snap(target)
    if s is not None:
        start = snapshot_start(s)
        goal = goal_for(s, session_goal_id if target == session_flow_id else None)
        if start:
            g.flow_id, g.flow_name, g.step_id, g.step_title = target, s["flow"]["name"], start["id"], start["title"]
            g.step_index, g.total_steps = 1, len(walk(s, goal))
            g.step_ids, g.restart = straight_from(s, start["id"], goal), True
    can_restart = bool(g.step_ids)
    supported = [{"label": p["display_name"], "platform_id": p["id"]} for p in platforms if p["has_flows"]]
    goals_here = [{"label": f["name"], "flow_id": f["id"]} for f in here]

    def ask(kind: str, options: list[dict]) -> None:
        g.action, g.ask_kind, g.options = ASK, kind, options
        g.step_ids, g.restart = [], False

    if o == retrieval.OFF_FLOW:
        if policy.on_off_flow == "handoff":
            g.action = HANDOFF
        elif policy.on_off_flow == "restart" and can_restart:
            g.action = RESTART
        elif goals_here:
            ask("goal", goals_here)
        elif can_restart:
            g.action = RESTART
        else:
            ask("platform", supported)
    elif o == retrieval.NOT_APP_SCREEN:
        if policy.on_not_app_screen == "handoff":
            g.action = HANDOFF
        elif policy.on_not_app_screen == "restart" and can_restart:
            g.action = RESTART
        else:
            ask("platform", supported)
    elif o == retrieval.NOT_A_SCREENSHOT:
        g.action = RESTART if can_restart else RETAKE
    elif o == retrieval.UNREADABLE:
        g.action = HANDOFF if policy.on_unreadable == "handoff" else RETAKE
        g.step_ids, g.restart = [], False
    else:  # UNKNOWN_PLATFORM
        if policy.on_unknown_platform == "handoff":
            g.action = HANDOFF
        else:
            ask("platform", supported)
    if g.action in (HANDOFF, ASK) and g.action != RESTART:
        g.step_ids, g.restart = [], False
    return g


def phrase_guidance(g: Guidance, policy: Policy | None = None) -> Guidance:
    """Fill `advice` and `ask` from the policy's templates. Idempotent."""
    p = policy or Policy()
    o = g.outcome
    where = f"「{g.platform_name}」" if g.platform_name else p.text("this_app")
    parts: list[str] = []
    if o == retrieval.LOCATED:
        parts.append(p.text("located", flow=g.flow_name, index=g.step_index, step=g.step_title))
        if g._difference:
            parts.append(p.text("located_difference", difference=g._difference))
    elif o == retrieval.AMBIGUOUS:
        if g.action == ASK:
            g.ask = p.text("ambiguous_ask")
        else:
            parts.append(p.text("located", flow=g.flow_name, index=g.step_index, step=g.step_title))
    elif o == retrieval.OFF_FLOW:
        parts.append(p.text("off_flow", where=where))
        if g.action == RESTART:
            parts.append(p.text("off_flow_restart", where=where, step=g.step_title))
        elif g.action == ASK:
            g.ask = p.text("off_flow_ask", where=where) if g.ask_kind == "goal" else p.text("ask_platform")
    elif o == retrieval.NOT_APP_SCREEN:
        parts.append(p.text("not_app_screen", what=p.kind_label(g._kind)))
        if g.action == RESTART:
            parts.append(p.text("not_app_restart", platform=g.platform_name, step=g.step_title))
        elif g.action == ASK:
            g.ask = p.text("ask_platform")
    elif o == retrieval.NOT_A_SCREENSHOT:
        parts.append(p.text("not_a_screenshot"))
        if g.action == RESTART:
            parts.append(p.text("restart_lead", platform=g.platform_name, step=g.step_title))
    elif o == retrieval.UNREADABLE:
        parts.append(p.text("unreadable", issues="、".join(g._issues) if g._issues else p.text("unreadable_default_issue")))
    else:  # UNKNOWN_PLATFORM
        parts.append(p.text("unknown_platform_seen", seen=g._seen) if g._seen else p.text("unknown_platform_unseen"))
        if g.action == ASK:
            g.ask = p.text("ask_platform")
    if g.action == HANDOFF:
        parts.append(p.handoff_line)
    if g._photographed and o != retrieval.LOCATED:
        parts.append(p.text("photographed"))
    g.advice = " ".join(x for x in parts if x).strip()
    return g


async def locate_guidance(db: AsyncSession, tenant_id: str, res: LocateResult, *, content_mode: str, theme: str = "light",
                          session_flow_id: str | None = None, session_goal_id: str | None = None, goal_noun: str | None = None,
                          policy: Policy | None = None, snapshots: dict[str, dict] | None = None) -> Guidance:
    """Decide, then phrase. `goal_noun` is accepted for callers that predate
    the policy object."""
    policy = policy or Policy()
    if goal_noun and not policy.goal_noun:
        policy.goal_noun = goal_noun
    g = await decide_guidance(db, tenant_id, res, content_mode=content_mode, policy=policy, session_flow_id=session_flow_id,
                              session_goal_id=session_goal_id, snapshots=snapshots)
    return phrase_guidance(g, policy)


def assistant_profile(settings: dict | None) -> dict:
    """The resolved policy as a dict (kept for callers of the first version)."""
    return Policy.from_settings(settings).to_dict()
