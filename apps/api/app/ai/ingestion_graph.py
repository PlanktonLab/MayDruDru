"""Variant ingestion pipeline as a LangGraph graph (SPEC §6.2, §7.1).

    analyze → generate → safety_check ─┬─ unsafe & tries<N ──→ generate
                 ▲                     ├─ unsafe & exhausted → reject_unsafe → END (failed)
                 │                     └─ safe → render → check ─┬─ fail & tries<N ─→ generate
                 │                                               ├─ ok (visual review on) → visual_check ─┬─ bad & tries<N → generate
                 │                                               │                                        └─ else ─┐
                 │                                               └─ ok / exhausted ────────────────────────────────┴→ mark_pending
                 │                                                                                                      │
                 │                                                                              review (interrupt) ◀────┘
                 │                                                                          approve │    │ regenerate
                 └──────────────────────────────── human feedback ───────────────────────────────────────┘
                                                                                                    ▼
                                                                                         finalize → END

A review that only corrects 假資料 values (`revalue`) skips `generate`
entirely: the values are swapped in the replica's text and it goes straight to
`safety_check` → `render`, so a wording fix costs no model call and cannot move
the layout. If the old text is not on the page verbatim, it falls back to
`generate` like any other feedback.

`safety_check` is static and runs before `render`, so markup that could execute
(script, handlers, embedding, external URLs) never reaches the renderer.
Side effects (renderer, storage writes) live in their own nodes so the
review node — which re-runs from its start on resume — only interrupts.
Nothing image-shaped is kept in state; nodes re-read from object storage.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from sqlalchemy import select, update

from .. import storage
from ..config import get_settings
from ..db import sessionmaker
from ..models import Flow, Platform, PlatformComponent, Step, StyleDoc, StyleDocVersion, Variant
from ..renderer_client import render_html
from ..services import demo_data as demo_data_service
from . import agents
from .checks import check_replica, scrub_pii, unsafe_html_problems
from .html_text import replace_texts
from .llm import embed

log = logging.getLogger(__name__)


class IngestState(TypedDict, total=False):
    variant_id: str
    tenant_id: str
    platform_id: str
    platform_name: str
    theme: str
    width: int
    focus_boxes: list[dict]
    prompt_notes: str
    style_doc: dict
    demo_data: list[dict]
    components: list[dict]
    structure: dict
    html: str
    kept_texts: list[str]
    fake_data: list[dict]
    check: dict
    visual: dict
    attempts: int
    feedback: str
    replica_html_key: str
    replica_png_key: str
    replica_w: int
    replica_h: int
    decision: str
    # the replica was text-patched, not redrawn: there is nothing new for the
    # model's visual self-check to look at
    skip_visual: bool
    checks_exhausted: bool
    unsafe: bool
    error: str


async def _set(variant_id: str, **fields):
    async with sessionmaker()() as db:
        v = await db.get(Variant, variant_id)
        if v:
            for k, val in fields.items():
                setattr(v, k, val)
            await db.commit()


async def transition(variant_id: str, from_statuses: tuple[str, ...], **values) -> bool:
    """Conditional status write: applies `values` only while the variant is in
    one of `from_statuses`. Returns whether it applied."""
    async with sessionmaker()() as db:
        res = await db.execute(update(Variant).where(Variant.id == variant_id, Variant.status.in_(from_statuses)).values(**values))
        await db.commit()
        return res.rowcount > 0


async def _original(variant_id: str) -> bytes:
    async with sessionmaker()() as db:
        v = await db.get(Variant, variant_id)
        key = v.original_key if v else None
    if not key:
        raise RuntimeError("原圖不存在（可能已過期刪除）")
    return await asyncio.to_thread(storage.get_original, key)


# ------------------------------------------------------------------ nodes

async def analyze(state: IngestState) -> dict:
    await _set(state["variant_id"], status="processing", progress="結構分析中", error="")
    original = await _original(state["variant_id"])
    out, _ = await agents.analyze_structure(original, state["focus_boxes"], state.get("style_doc"),
                                            tenant_id=state["tenant_id"], variant_id=state["variant_id"], theme=state["theme"],
                                            notes=state.get("prompt_notes", ""))
    structure = out.model_dump()
    await _set(state["variant_id"], structure=structure)
    return {"structure": structure, "attempts": 0, "feedback": ""}


async def generate(state: IngestState) -> dict:
    attempts = state.get("attempts", 0) + 1
    await _set(state["variant_id"], status="processing", progress=f"復刻中（第 {attempts} 次）", attempts=attempts)
    original = await _original(state["variant_id"])
    prev_png = None
    if state.get("feedback") and state.get("html") and state.get("replica_png_key"):
        try:
            prev_png = await asyncio.to_thread(storage.get_private, state["replica_png_key"])
        except Exception:
            log.warning("previous replica render unavailable for variant %s", state["variant_id"], exc_info=True)
    out, _ = await agents.generate_replica(original, state["focus_boxes"], state["structure"], state.get("feedback", ""),
                                          width=state["width"], tenant_id=state["tenant_id"],
                                          variant_id=state["variant_id"], theme=state["theme"],
                                          previous_html=state.get("html", "") if state.get("feedback") else "", previous_png=prev_png,
                                          demo_data=state.get("demo_data") or [], components=state.get("components") or [],
                                          notes=state.get("prompt_notes", ""))
    # 假資料同步 (SPEC §6.5): mark each reported value 沿用 or 新增 here, while the
    # 示範資料 this run was given is at hand, and put the report back up for review.
    fake_data = demo_data_service.annotate([f.model_dump() for f in out.fake_data], state.get("demo_data") or [])
    await _set(state["variant_id"], kept_texts=out.kept_texts, fake_data=fake_data, fake_data_reviewed=False)
    return {"html": out.html, "kept_texts": out.kept_texts, "fake_data": fake_data, "attempts": attempts, "skip_visual": False}


async def safety_check(state: IngestState) -> dict:
    """Static check before rendering: unsafe markup never reaches the renderer
    and counts as a failed check in the regenerate loop."""
    problems = unsafe_html_problems(state["html"])
    if not problems:
        return {"unsafe": False}
    report = {"ok": False, "problems": ["HTML 安全檢查未通過：" + "；".join(problems[:6])], "unsafe": True}
    await _set(state["variant_id"], check_report=report)
    exhausted = state.get("attempts", 0) >= get_settings().max_generation_attempts
    # this HTML was never rendered: don't pair it with the previous render when patching
    return {"unsafe": True, "check": report, "checks_exhausted": exhausted, "replica_png_key": None,
            "feedback": "HTML 安全檢查未通過（輸出必須是純 HTML 與內嵌 CSS）：" + "；".join(problems)}


def route_after_safety(state: IngestState) -> Literal["render", "generate", "reject_unsafe"]:
    if not state.get("unsafe"):
        return "render"
    return "reject_unsafe" if state.get("checks_exhausted") else "generate"


async def reject_unsafe(state: IngestState) -> dict:
    await _set(state["variant_id"], status="failed", progress="失敗",
               error="復刻 HTML 多次未通過安全檢查（含 script、事件處理或外部資源），請重新送出處理")
    return {}


async def render(state: IngestState) -> dict:
    await _set(state["variant_id"], progress="渲染中")
    png, w, h = await render_html(state["html"], state["width"], scale=2)
    vid, tid = state["variant_id"], state["tenant_id"]
    html_key, png_key = await asyncio.gather(
        asyncio.to_thread(storage.put_private, f"replicas/{tid}/{vid}/{uuid.uuid4().hex}.html", state["html"].encode(), "text/html"),
        asyncio.to_thread(storage.put_private, f"replicas/{tid}/{vid}/{uuid.uuid4().hex}.png", png, "image/png"),
    )
    await _set(vid, replica_html_key=html_key, replica_png_key=png_key, replica_width=w, replica_height=h)
    return {"replica_html_key": html_key, "replica_png_key": png_key, "replica_w": w, "replica_h": h}


async def check(state: IngestState) -> dict:
    report = check_replica(state["html"], structure=state["structure"], focus_boxes=state["focus_boxes"],
                           kept_texts=state.get("kept_texts", []), rendered_width=state.get("replica_w"),
                           expected_width=state["width"], demo_data=state.get("demo_data") or [],
                           components=state.get("components") or [])
    await _set(state["variant_id"], check_report=report)
    exhausted = (not report["ok"]) and state.get("attempts", 0) >= get_settings().max_generation_attempts
    return {"check": report, "feedback": "" if report["ok"] else "程式化檢查未通過：" + "；".join(report["problems"]),
            "checks_exhausted": exhausted}


def route_after_check(state: IngestState) -> Literal["generate", "visual_check", "mark_pending"]:
    if state.get("checks_exhausted"):
        return "mark_pending"
    if not state["check"]["ok"]:
        return "generate"
    if state.get("skip_visual"):  # a text patch cannot have moved the layout
        return "mark_pending"
    return "visual_check" if get_settings().replica_visual_review else "mark_pending"


async def visual_check(state: IngestState) -> dict:
    """Model-based layout comparison of original vs rendered replica. Low score
    (or a visible privacy leak) feeds concrete fixes back into `generate`."""
    await _set(state["variant_id"], progress="視覺自檢中")
    original = await _original(state["variant_id"])
    replica_png = await asyncio.to_thread(storage.get_private, state["replica_png_key"])
    try:
        rv, _ = await agents.visual_review(original, replica_png, tenant_id=state["tenant_id"], variant_id=state["variant_id"])
    except Exception:  # never block ingestion on the QA call
        log.warning("visual review failed for variant %s", state["variant_id"], exc_info=True)
        report = {"score": None, "issues": ["視覺自檢失敗（模型服務錯誤），請人工比對版面"], "privacy_leak": False, "skipped": True}
        await _set(state["variant_id"], check_report={**state["check"], "visual": report})
        return {"visual": report}
    report = rv.model_dump()
    await _set(state["variant_id"], check_report={**state["check"], "visual": report})
    s = get_settings()
    bad = rv.privacy_leak or rv.score < s.visual_review_min_score
    exhausted = bad and state.get("attempts", 0) >= s.max_generation_attempts
    feedback = ""
    if bad:
        feedback = "視覺自檢未通過（相似度 %.2f）：%s" % (rv.score, "；".join(rv.issues[:8]) or "版面與原圖差異過大")
        if rv.privacy_leak:
            feedback += "；復刻圖上仍看得到原圖的真實資料，必須全部換成假資料或色塊"
    return {"visual": report, "feedback": feedback, "checks_exhausted": exhausted}


def route_after_visual(state: IngestState) -> Literal["generate", "mark_pending"]:
    if state.get("feedback") and not state.get("checks_exhausted"):
        return "generate"
    return "mark_pending"


async def mark_pending(state: IngestState) -> dict:
    note = "（自動檢查達嘗試上限，交由人工判斷）" if state.get("checks_exhausted") else ""
    await _set(state["variant_id"], status="pending_review", progress="待審核" + note)
    return {}


async def review(state: IngestState) -> Command[Literal["finalize", "generate", "safety_check"]]:
    decision = interrupt({"variant_id": state["variant_id"], "replica_png_key": state.get("replica_png_key")})
    # decision: {"decision": "approve" | "regenerate" | "revalue", "feedback": str,
    #            "changes": [{"old": str, "new": str}]  (revalue only)}
    if decision.get("decision") == "approve":
        return Command(goto="finalize", update={"decision": "approve"})
    # The platform context may have moved while the clerk was reviewing — they
    # adopt fake data or save a shared component from this very screen — so what
    # follows reads it again instead of reusing what the run started with.
    update: dict = {"decision": decision.get("decision") or "regenerate", "attempts": 0}
    try:
        update["demo_data"], update["components"] = await _platform_context(state["platform_id"])
    except Exception:
        log.warning("could not refresh platform context for variant %s", state["variant_id"], exc_info=True)
    if decision.get("decision") == "revalue":
        patched = await _swap_values(state, decision.get("changes") or [],
                                     update.get("demo_data") or state.get("demo_data") or [])
        if patched:  # straight to rendering: no model call, no new layout
            return Command(goto="safety_check", update={**update, **patched})
        log.info("variant %s: corrected values are not on the page verbatim, redrawing", state["variant_id"])
    fb = decision.get("feedback", "")
    return Command(goto="generate", update={**update, "feedback": f"審核者回饋：{fb}"})


async def _swap_values(state: IngestState, changes: list[dict], demo_data: list[dict]) -> dict | None:
    """假資料同步 (SPEC §6.5): rewrite the corrected values in the replica itself.
    Returns the state update, or None when the old text is not on the page as
    written and the model has to redraw the screen after all."""
    pairs = [(str(c.get("old") or "").strip(), str(c.get("new") or "").strip()) for c in changes]
    html, applied = replace_texts(state.get("html", ""), pairs)
    if not applied:
        return None
    swapped = dict(p for p in pairs if p[0] in applied)
    rows = [{**r, "value": swapped.get(r.get("value"), r.get("value"))} for r in state.get("fake_data") or []]
    fake_data = demo_data_service.annotate(rows, demo_data)
    await _set(state["variant_id"], status="processing", progress="更新畫面上的假資料",
               fake_data=fake_data, fake_data_reviewed=True)
    return {"html": html, "fake_data": fake_data, "feedback": "", "skip_visual": True}


async def _platform_context(platform_id: str) -> tuple[list[dict], list[dict]]:
    async with sessionmaker()() as db:
        return await platform_context(db, await db.get(Platform, platform_id))


async def finalize(state: IngestState) -> dict:
    """Approval. Everything that can fail (embedding) runs first; then one
    commit records the approval, forgets the original and scrubs verbatim
    personal data; only after that commit is the original object deleted
    (a failed delete is retried by the orphan sweep in `cleanup_originals`)."""
    vid, tid = state["variant_id"], state["tenant_id"]
    await _set(vid, progress="審核通過，整理中")
    async with sessionmaker()() as db:
        v = await db.get(Variant, vid)
        structure, theme = dict(v.structure or {}), v.theme
    # what retrieval gets to see: the description and the screen's own words,
    # with the verbatim personal data Agent A listed taken out of both
    secrets = [t for t in (structure.get("sensitive_texts") or []) if isinstance(t, str) and t.strip()]
    desc = agents.description_text(structure, state.get("platform_name", ""), theme)
    for t in sorted(secrets, key=len, reverse=True):
        desc = desc.replace(t, "")
    keywords = agents.screen_keywords(structure, secrets)
    vector = await embed(desc)

    async with sessionmaker()() as db:
        v = await db.get(Variant, vid)
        original_key = v.original_key
        v.structure, v.check_report = scrub_pii(v.structure, v.check_report)
        v.original_key = None
        v.description = desc
        v.keywords = keywords
        v.embedding = vector
        v.status = "approved"
        v.progress = "已通過"
        v.annotations = []
        v.stepcard_key = None
        v.stepcard_preview_key = None
        await db.commit()
    if original_key:
        try:
            await asyncio.to_thread(storage.delete_original, original_key)
        except Exception:
            log.warning("deleting original %s failed; the orphan sweep will retry", original_key, exc_info=True)

    # Agent C: rewrite the platform style doc
    try:
        await refresh_style_doc(state["platform_id"], tid, vid)
    except Exception:  # style doc failure must not block approval
        log.warning("style doc refresh failed for platform %s", state["platform_id"], exc_info=True)
        await _set(vid, error="Style Doc 更新失敗，下次有變體通過審核時會再更新")
    await transition(vid, ("approved",), status="annotating", progress="待標註")
    return {"decision": "approve"}


async def refresh_style_doc(platform_id: str, tenant_id: str, variant_id: str) -> None:
    """Reads, then releases the DB connection for the model + embedding calls,
    then writes under a row lock so concurrent approvals don't lose versions."""
    async with sessionmaker()() as db:
        platform = await db.get(Platform, platform_id)
        doc = (await db.execute(select(StyleDoc).where(StyleDoc.platform_id == platform_id))).scalar_one_or_none()
        old_ai, human_notes = ((doc.ai_generated or {}), doc.human_notes) if doc else ({}, "")
        v = await db.get(Variant, variant_id)
        replica_key, structure = v.replica_png_key, v.structure or {}
        rows = (await db.execute(
            select(Variant.structure).join(Step, Step.id == Variant.step_id).join(Flow, Flow.id == Step.flow_id)
            .where(Flow.platform_id == platform_id, Variant.status.in_(("approved", "annotating", "rendering", "completed")))
        )).scalars().all()
        platform_name = platform.display_name
    keywords: list[str] = []
    for s in rows:
        for k in (s or {}).get("visible_keywords", []):
            if k not in keywords:
                keywords.append(k)
    replica_png = await asyncio.to_thread(storage.get_private, replica_key)
    out, _ = await agents.update_style_doc(old_ai, replica_png, structure, keywords[:60],
                                           platform_name=platform_name, tenant_id=tenant_id, platform_id=platform_id)
    ai = out.model_dump()
    vector = await embed(agents.styledoc_text(ai, human_notes or "", platform_name))

    async with sessionmaker()() as db:
        doc = (await db.execute(select(StyleDoc).where(StyleDoc.platform_id == platform_id).with_for_update())).scalar_one_or_none()
        if doc is None:
            doc = StyleDoc(platform_id=platform_id)
            db.add(doc)
            await db.flush()
        doc.ai_generated = ai
        doc.version = (doc.version or 0) + 1
        doc.embedding = vector
        db.add(StyleDocVersion(style_doc_id=doc.id, version=doc.version, ai_generated=ai,
                               human_notes=doc.human_notes, reason=f"variant {variant_id} approved"))
        await db.commit()


def build_graph():
    g = StateGraph(IngestState)
    g.add_node("analyze", analyze)
    g.add_node("generate", generate)
    g.add_node("safety_check", safety_check)
    g.add_node("reject_unsafe", reject_unsafe)
    g.add_node("render", render)
    g.add_node("check", check)
    g.add_node("visual_check", visual_check)
    g.add_node("mark_pending", mark_pending)
    g.add_node("review", review)
    g.add_node("finalize", finalize)
    g.add_edge(START, "analyze")
    g.add_edge("analyze", "generate")
    g.add_edge("generate", "safety_check")
    g.add_conditional_edges("safety_check", route_after_safety)
    g.add_edge("reject_unsafe", END)
    g.add_edge("render", "check")
    g.add_conditional_edges("check", route_after_check)
    g.add_conditional_edges("visual_check", route_after_visual)
    g.add_edge("mark_pending", "review")
    g.add_edge("finalize", END)
    return g


async def platform_context(db, platform: Platform) -> tuple[list[dict], list[dict]]:
    """(demo_data, components) every replica of this platform is generated and
    checked against (SPEC §6.5) — the graph and the admin HTML edit share it."""
    components = (await db.execute(
        select(PlatformComponent).where(PlatformComponent.platform_id == platform.id).order_by(PlatformComponent.created_at)
    )).scalars().all()
    return (list(platform.demo_data or []),
            [{"id": c.id, "name": c.name, "kind": c.kind, "html": c.html, "width": c.width, "height": c.height} for c in components])


async def initial_state(variant_id: str) -> IngestState:
    async with sessionmaker()() as db:
        v = await db.get(Variant, variant_id)
        step = await db.get(Step, v.step_id)
        flow = await db.get(Flow, step.flow_id)
        platform = await db.get(Platform, flow.platform_id)
        doc = (await db.execute(select(StyleDoc).where(StyleDoc.platform_id == platform.id))).scalar_one_or_none()
        demo_data, components = await platform_context(db, platform)
        width = 1280 if platform.channel in ("web", "desktop") else 390
        style_doc = dict((doc.ai_generated if doc else {}) or {})
        if components:  # Agent A should know which parts of the screen are shared furniture
            style_doc["shared_components"] = [f"{c['name']}（{c['kind']}）" for c in components]
        return IngestState(
            variant_id=v.id, tenant_id=flow.tenant_id, platform_id=platform.id, platform_name=platform.display_name,
            theme=v.theme, width=width, focus_boxes=list(v.focus_boxes or []), prompt_notes=v.prompt_notes or "",
            style_doc=style_doc, attempts=0, feedback="", demo_data=demo_data, components=components,
        )
