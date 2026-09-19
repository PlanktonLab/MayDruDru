"""Background jobs (arq). Everything that calls a model or the renderer
lives here, never in the API process.

Every job leaves its row in a terminal or user-actionable state on any exit,
including arq's timeout (which cancels the coroutine with CancelledError, a
BaseException). Job arguments and return values are JSON (see jobs.py)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command
from sqlalchemy import select, update
from sqlalchemy.orm import load_only

from .. import storage
from ..ai import agents
from ..ai.checks import needs_scrub, scrub_pii
from ..ai.image_utils import make_preview
from ..ai.ingestion_graph import build_graph, initial_state, transition
from ..ai.retrieval import locate
from ..config import get_settings
from ..db import sessionmaker
from ..models import EvalCase, EvalRun, Goal, Platform, Variant
from ..renderer_client import render_html
from ..services.card_context import load_card_context
from ..services.numbered_card import LINE_PREVIEW_EDGE, html_key_for
from ..services.stepcard import build_card_html

log = logging.getLogger(__name__)

EVAL_JOB_TIMEOUT_SECONDS = 2 * 60 * 60
EVAL_CONCURRENCY = 3
ORPHAN_MIN_AGE = timedelta(hours=1)
THUMB_EDGE = 800


def _pg_url() -> str:
    return get_settings().database_url_sync


def _error_text(e: BaseException) -> str:
    if isinstance(e, asyncio.CancelledError):
        return "處理逾時或被中斷，請重新送出"
    return repr(e)[:2000]


async def _on_failure(coro) -> None:
    """Run failure bookkeeping even while the job is being cancelled; never
    let the bookkeeping mask the original exception."""
    try:
        await asyncio.shield(coro)
    except BaseException:
        log.exception("failure bookkeeping did not complete")


async def _mark_failed(variant_id: str, err: str) -> None:
    if not await transition(variant_id, ("processing",), status="failed", error=err[:2000], progress="失敗"):
        # the approval was already committed (original gone): keep it, only the follow-up work failed
        await transition(variant_id, ("approved",), status="annotating", error=err[:2000], progress="待標註")


# ------------------------------------------------------------------ variants

async def process_variant(ctx: dict, variant_id: str) -> str:
    """Start (or restart) the ingestion graph for a variant. Runs until the
    review interrupt, then returns; the checkpoint lives in Postgres."""
    thread_id = f"{variant_id}:{uuid.uuid4().hex[:8]}"
    async with sessionmaker()() as db:
        v = await db.get(Variant, variant_id)
        if not v:
            return "no-variant"
        if not v.original_key:
            v.status, v.progress, v.error = "failed", "失敗", "原圖已被移除"
            await db.commit()
            return "no-original"
        previous_thread = v.thread_id
        v.thread_id = thread_id
        v.status = "processing"
        v.progress = "排隊中"
        v.error = ""
        v.check_report = None
        v.review_history = list(v.review_history or [])
        await db.commit()
    try:
        state = await initial_state(variant_id)
        async with AsyncPostgresSaver.from_conn_string(_pg_url()) as saver:
            await saver.setup()
            if previous_thread:  # an abandoned run's state holds verbatim screen text
                await saver.adelete_thread(previous_thread)
            graph = build_graph().compile(checkpointer=saver)
            await graph.ainvoke(state, config={"configurable": {"thread_id": thread_id}})
        return "paused-for-review"
    except BaseException as e:
        await _on_failure(_mark_failed(variant_id, _error_text(e)))
        raise


RESUME_PROGRESS = {"approve": "審核通過，整理中", "revalue": "更新畫面上的假資料"}


async def resume_variant(ctx: dict, variant_id: str, decision: str, feedback: str, user_id: str,
                         changes: list[dict] | None = None) -> str:
    """`changes` carries the corrected 假資料 for a `revalue` review (SPEC §6.5):
    the graph swaps those words in the replica instead of drawing it again."""
    async with sessionmaker()() as db:
        v = await db.get(Variant, variant_id)
        if not v or not v.thread_id:
            return "no-thread"
        thread_id = v.thread_id
        v.review_history = [*(v.review_history or []), {"decision": decision, "feedback": feedback, "by": user_id,
                                                          "at": datetime.now(UTC).isoformat(), "attempt": v.attempts}]
        v.status = "processing"
        v.progress = RESUME_PROGRESS.get(decision, "依回饋重生中")
        await db.commit()
    try:
        async with AsyncPostgresSaver.from_conn_string(_pg_url()) as saver:
            await saver.setup()
            graph = build_graph().compile(checkpointer=saver)
            await graph.ainvoke(Command(resume={"decision": decision, "feedback": feedback, "changes": changes or []}),
                                config={"configurable": {"thread_id": thread_id}})
            if decision == "approve":
                await _drop_thread_after_approval(saver, variant_id, thread_id)
        return "resumed"
    except BaseException as e:
        await _on_failure(_mark_failed(variant_id, _error_text(e)))
        raise


async def _drop_thread_after_approval(saver: AsyncPostgresSaver, variant_id: str, thread_id: str) -> None:
    """The checkpoint holds the analysis with verbatim screen text; once the
    approval is committed nothing needs it."""
    async with sessionmaker()() as db:
        v = await db.get(Variant, variant_id)
        approved = v is not None and v.original_key is None and v.status in ("approved", "annotating")
    if not approved:
        return
    try:
        await saver.adelete_thread(thread_id)
        async with sessionmaker()() as db:
            await db.execute(update(Variant).where(Variant.id == variant_id, Variant.thread_id == thread_id).values(thread_id=None))
            await db.commit()
    except Exception:
        log.warning("could not delete checkpoint thread %s", thread_id, exc_info=True)


async def render_stepcard(ctx: dict, variant_id: str) -> str:
    """Render the Step Card for a variant the API put in `rendering`. Writes are
    conditional on the variant still being `rendering`."""
    try:
        async with sessionmaker()() as db:
            v = await db.get(Variant, variant_id)
            if not v or v.status != "rendering":
                return "skipped"
            cx = await load_card_context(db, v)
            job = dict(html_key=v.replica_html_key, w=v.replica_width, h=v.replica_height, annotations=list(v.annotations or []),
                       theme=v.theme, cx=cx)
            v.progress = "產生 Step Card 中"
            await db.commit()

        replica_html = (await asyncio.to_thread(storage.get_private, job["html_key"])).decode()
        cx = job["cx"]
        card_html, card_w = build_card_html(replica_html=replica_html, replica_w=job["w"], replica_h=job["h"],
                                            annotations=job["annotations"], title=cx.title, instruction=cx.instruction,
                                            theme=job["theme"], layout=cx.layout, step_number=cx.number)
        png, w, h = await render_html(card_html, card_w, scale=2)
        tenant = cx.tenant_id
        key = await asyncio.to_thread(storage.put_public_hashed, f"cards/{tenant}", png, "png", "image/png")
        # the page itself, private, so a copy numbered for a conversation can be drawn later (numbered_card.py)
        await asyncio.to_thread(storage.put_private, html_key_for(key), card_html.encode(), "text/html")
        preview, thumb = await asyncio.gather(asyncio.to_thread(make_preview, png, LINE_PREVIEW_EDGE),
                                              asyncio.to_thread(make_preview, png, THUMB_EDGE))
        pkey = await asyncio.to_thread(storage.put_public_hashed, f"previews/{tenant}", preview, "jpg", "image/jpeg")
        await asyncio.to_thread(_put_thumb, key, thumb)

        applied = await transition(variant_id, ("rendering",), stepcard_key=key, stepcard_preview_key=pkey,
                                   stepcard_width=w * 2, stepcard_height=h * 2, status="completed", progress="已完成", error="")
        return key if applied else "superseded"
    except BaseException as e:
        await _on_failure(transition(variant_id, ("rendering",), status="annotating", progress="Step Card 產生失敗",
                                     error=_error_text(e)))
        raise


def _put_thumb(card_key: str, thumb: bytes) -> None:
    """Canvas thumbnail, public next to its card (same content hash)."""
    tkey = storage.thumb_key_for(card_key)
    bucket = get_settings().s3_bucket_public
    if tkey and not storage.exists(bucket, tkey):
        storage.put(bucket, tkey, thumb, "image/jpeg")


# ------------------------------------------------------------------ evaluation

async def run_eval(ctx: dict, run_id: str) -> str:
    try:
        return await _run_eval(run_id)
    except BaseException as e:
        await _on_failure(_fail_eval(run_id, _error_text(e)[:500]))
        raise


async def _fail_eval(run_id: str, error: str) -> None:
    async with sessionmaker()() as db:
        run = await db.get(EvalRun, run_id)
        if run and run.status == "running":
            run.status = "failed"
            run.summary = {**(run.summary or {}), "error": error}
            run.finished_at = datetime.now(UTC)
            await db.commit()


async def _run_eval(run_id: str) -> str:
    async with sessionmaker()() as db:
        run = await db.get(EvalRun, run_id)
        if not run:
            return "no-run"
        tenant_id = run.tenant_id
        mode = (run.config or {}).get("content_mode", "draft")
        cases = [dict(id=c.id, image_key=c.image_key, platform_id=c.platform_id, step_id=c.step_id, goal_id=c.goal_id, text=c.text)
                 for c in (await db.execute(select(EvalCase).where(EvalCase.tenant_id == tenant_id))).scalars().all()]
        platforms = [{"id": p.id, "display_name": p.display_name, "brand": p.brand, "channel": p.channel, "aliases": p.aliases or []}
                     for p in (await db.execute(select(Platform).where(Platform.tenant_id == tenant_id))).scalars().all()]
        goals = [{"id": g.id, "name": g.name, "aliases": g.aliases or []}
                 for g in (await db.execute(select(Goal).where(Goal.tenant_id == tenant_id))).scalars().all()]

    results: list[dict] = []
    write_lock = asyncio.Lock()
    limit = asyncio.Semaphore(EVAL_CONCURRENCY)

    async def run_case(c: dict) -> None:
        async with limit:
            r = await _eval_case(c, tenant_id=tenant_id, run_id=run_id, mode=mode, platforms=platforms, goals=goals)
        async with write_lock:  # persist as we go so a timeout keeps finished cases
            results.append(r)
            await _save_eval(run_id, results=list(results))

    await asyncio.gather(*(run_case(c) for c in cases))
    order = {c["id"]: i for i, c in enumerate(cases)}
    results.sort(key=lambda r: order.get(r["case_id"], 0))
    await _save_eval(run_id, results=results, summary=_eval_summary(results), status="done",
                     finished_at=datetime.now(UTC))
    return "done"


async def _eval_case(c: dict, *, tenant_id: str, run_id: str, mode: str, platforms: list[dict], goals: list[dict]) -> dict:
    r = {"case_id": c["id"], "expected_platform_id": c["platform_id"], "expected_step_id": c["step_id"], "expected_goal_id": c["goal_id"]}
    try:
        png = await asyncio.to_thread(storage.get_sealed, c["image_key"])
        async with sessionmaker()() as db:  # one session per case: AsyncSession is not concurrency-safe
            res = await locate(db, tenant_id, png, flow_id=None, platform_id=None, content_mode=mode, session_id=f"eval:{run_id}")
        r.update(platform_id=res.platform_id, step_id=res.step_id, confidence=res.confidence, scope=res.scope, ok=res.ok,
                 platform_correct=(res.platform_id == c["platform_id"]), step_correct=(bool(c["step_id"]) and res.step_id == c["step_id"]),
                 usage=res.usage)
    except Exception as e:
        r.update(error=repr(e)[:500], platform_correct=False, step_correct=False)
    if c["text"]:
        try:
            intent, usage = await agents.parse_intent(c["text"], platforms, goals, None, tenant_id=tenant_id, ref_id=f"eval:{run_id}")
            r.update(intent_platform_id=intent.platform_id, intent_goal_id=intent.goal_id,
                     intent_platform_correct=(intent.platform_id == c["platform_id"]),
                     intent_goal_correct=(bool(c["goal_id"]) and intent.goal_id == c["goal_id"]), intent_usage=usage)
        except Exception as e:
            r.update(intent_error=repr(e)[:500])
    return r


async def _save_eval(run_id: str, **fields) -> None:
    async with sessionmaker()() as db:
        run = await db.get(EvalRun, run_id)
        if run and run.status == "running":
            for k, v in fields.items():
                setattr(run, k, v)
            await db.commit()


def _eval_summary(results: list[dict]) -> dict:
    n = len(results) or 1
    with_step = [r for r in results if r.get("expected_step_id")]
    with_text = [r for r in results if "intent_platform_correct" in r]
    usage_all = [u for r in results for u in (r.get("usage") or [])] + [r["intent_usage"] for r in results if r.get("intent_usage")]
    return {
        "cases": len(results),
        "platform_accuracy": sum(1 for r in results if r.get("platform_correct")) / n,
        "step_accuracy": (sum(1 for r in with_step if r.get("step_correct")) / len(with_step)) if with_step else None,
        "intent_platform_accuracy": (sum(1 for r in with_text if r.get("intent_platform_correct")) / len(with_text)) if with_text else None,
        "intent_goal_accuracy": (sum(1 for r in with_text if r.get("intent_goal_correct")) / len(with_text)) if with_text else None,
        "avg_latency_ms": (sum(u.get("latency_ms", 0) for u in usage_all) / len(usage_all)) if usage_all else 0,
        "total_cost_usd": round(sum(u.get("cost_usd", 0) for u in usage_all), 4),
        "total_tokens": sum(u.get("input_tokens", 0) + u.get("output_tokens", 0) for u in usage_all),
    }


# ------------------------------------------------------------------ cron

async def sweep_stale_jobs(ctx: dict) -> dict:
    """Cron: rows left in a job-owned state by a worker that died (or a job
    that never ran) go back to a state a person can act on."""
    s = get_settings()
    now = datetime.now(UTC)
    cutoff = now - timedelta(minutes=s.stale_job_minutes)
    eval_cutoff = now - max(timedelta(minutes=s.stale_job_minutes), timedelta(seconds=EVAL_JOB_TIMEOUT_SECONDS + 600))
    stale = Variant.updated_at < cutoff
    async with sessionmaker()() as db:
        processing = await db.execute(update(Variant).where(Variant.status == "processing", stale).values(
            status="failed", progress="失敗", error="處理逾時（背景工作中斷），請重新送出處理"))
        approved = await db.execute(update(Variant).where(Variant.status == "approved", stale).values(
            status="annotating", progress="待標註", error="審核後整理逾時，Style Doc 可能未更新"))
        rendering = await db.execute(update(Variant).where(Variant.status == "rendering", stale).values(
            status="annotating", progress="Step Card 產生失敗", error="Step Card 產生逾時，請重新產生"))
        evals = await db.execute(update(EvalRun).where(EvalRun.status == "running", EvalRun.started_at < eval_cutoff).values(
            status="failed", finished_at=now))
        await db.commit()
    counts = {"processing": processing.rowcount, "approved": approved.rowcount, "rendering": rendering.rowcount, "eval_runs": evals.rowcount}
    if any(counts.values()):
        log.warning("reset stale jobs: %s", counts)
    return counts


async def cleanup_originals(ctx: dict) -> dict:
    """Cron: enforce SPEC §12 retention for clerk originals.

    1. originals that never progressed within the TTL are deleted;
    2. objects under the originals prefix that no variant references (a failed
       delete after approval, a deleted variant) are deleted once older than
       an hour, so uploads still being committed are left alone;
    3. verbatim personal data left on variants that no longer have an original
       is scrubbed (idempotent).
    A key is cleared from the database only after its object is really gone."""
    s = get_settings()
    counts = {"expired": 0, "orphans": 0, "scrubbed": 0}
    cutoff = datetime.now(UTC) - timedelta(days=s.original_ttl_days)
    async with sessionmaker()() as db:
        expired = (await db.execute(select(Variant.id, Variant.original_key).where(
            Variant.original_key.isnot(None), Variant.status.in_(("uploaded", "focusing", "failed")),
            Variant.original_uploaded_at < cutoff))).all()
    for vid, key in expired:
        try:
            await asyncio.to_thread(storage.delete_original, key)
        except Exception:
            log.warning("could not delete expired original %s", key, exc_info=True)
            continue
        async with sessionmaker()() as db:
            res = await db.execute(update(Variant).where(Variant.id == vid, Variant.original_key == key).values(
                original_key=None, status="not_uploaded", progress="原圖逾期已刪除"))
            await db.commit()
            counts["expired"] += res.rowcount

    objects = await asyncio.to_thread(storage.list_objects, s.s3_bucket_private, storage.ORIGINALS_PREFIX)
    async with sessionmaker()() as db:
        referenced = set((await db.execute(select(Variant.original_key).where(Variant.original_key.isnot(None)))).scalars().all())
    orphan_cutoff = datetime.now(UTC) - ORPHAN_MIN_AGE
    for key, modified in objects:
        if key in referenced or modified is None or modified > orphan_cutoff:
            continue
        try:
            await asyncio.to_thread(storage.delete_original, key)
            counts["orphans"] += 1
        except Exception:
            log.warning("could not delete orphan original %s", key, exc_info=True)

    async with sessionmaker()() as db:
        rows = (await db.execute(select(Variant).options(load_only(Variant.id, Variant.structure, Variant.check_report)).where(
            Variant.original_key.is_(None), Variant.status.in_(("approved", "annotating", "rendering", "completed"))))).scalars().all()
        for v in rows:
            if needs_scrub(v.structure, v.check_report):
                v.structure, v.check_report = scrub_pii(v.structure, v.check_report)
                counts["scrubbed"] += 1
        await db.commit()
    return counts
