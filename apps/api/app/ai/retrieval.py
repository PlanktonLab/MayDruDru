"""Screenshot localisation (SPEC §7.5) with a fallback ladder.

One turn, at most two model calls:

1. **describe** — one vision call tells what the picture is (an app screen, a
   phone's home screen, a photo of a screen, not a screen at all …) and lists
   the screen's own words (structural texts, keywords) plus a style summary.
2. **hybrid candidates** — every variant in scope is scored twice: cosine
   distance of the description embedding (pgvector) and lexical overlap of the
   screen's words with the words stored at ingestion. The two rankings are
   fused (reciprocal rank), the session's current and next steps get a prior,
   and the top k go to the reranker.
3. **rerank** — one visual comparison over that pool; the model also says how
   the citizen's screen relates to the best candidate (same screen, same app
   but another page, different app, not an app).

Scope: a platform the citizen stated is a hard filter; otherwise the whole
tenant is searched, with the session's flow favoured through the prior. The
result carries an `outcome` the channels act on (located / ambiguous /
off_flow / unknown_platform / not_app_screen / not_a_screenshot /
unreadable) so every picture a citizen sends gets an answer.

Published mode only considers steps that exist in the published snapshot a
citizen would actually be shown (the session's pinned version for its flow,
the current version for other flows) and takes the replica/preview from that
snapshot, never from live draft rows. The DB connection is released before
every model call so a turn does not pin a pooled connection during latency.
The citizen image only ever lives in memory."""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..config import get_settings
from ..db import release_connection
from ..models import Flow, FlowVersion, Platform, Step, Variant
from . import agents
from .llm import embed

log = logging.getLogger(__name__)

# what the channels get to act on
LOCATED = "located"                    # a step, above the confidence threshold
AMBIGUOUS = "ambiguous"                # plausible candidates, none certain — ask the citizen
OFF_FLOW = "off_flow"                  # a known platform, but a page no flow teaches — send them to the start
UNKNOWN_PLATFORM = "unknown_platform"  # an app/site the tenant has no content for — ask which platform
NOT_APP_SCREEN = "not_app_screen"      # home screen, lock screen, settings … — tell them to open the app
NOT_A_SCREENSHOT = "not_a_screenshot"  # a photo of something that is not a screen
UNREADABLE = "unreadable"              # too blurry / dark / cropped to tell
OUTCOMES = (LOCATED, AMBIGUOUS, OFF_FLOW, UNKNOWN_PLATFORM, NOT_APP_SCREEN, NOT_A_SCREENSHOT, UNREADABLE)

_SYSTEM_KINDS = ("home_screen", "lock_screen", "system_screen")
_POOL = 12          # candidates kept per ranking before fusion
_PRIOR_STEPS = 3    # how many steps after the current one count as "expected next"


@dataclass
class LocateResult:
    ok: bool
    outcome: str = UNKNOWN_PLATFORM
    step_id: str | None = None
    flow_id: str | None = None
    variant_id: str | None = None
    platform_id: str | None = None  # the step's platform when located, else the best guess
    platform_guess: str = ""        # what the describer thinks the app is (free text)
    confidence: float = 0.0
    theme: str = "light"
    scope: str = ""
    reason: str = ""
    relation: str = ""              # reranker's verdict on the best candidate
    difference: str = ""            # how the citizen's screen differs from the best candidate
    kind: str = "app_screen"        # what the picture is
    photographed: bool = False
    quality_issues: list[str] = field(default_factory=list)
    candidates: list[dict] = field(default_factory=list)  # [{variant_id, step_id, flow_id, step_title, flow_name, preview_url, score, …}]
    screen: dict = field(default_factory=dict)            # what the citizen sees: title, structural texts, elements (no data)
    description: dict = field(default_factory=dict)
    usage: list[dict] = field(default_factory=list)

    def public(self) -> dict:
        """The part an API consumer or the assistant may see."""
        return {"outcome": self.outcome, "ok": self.ok, "confidence": round(self.confidence, 2), "step_id": self.step_id,
                "flow_id": self.flow_id, "platform_id": self.platform_id, "platform_guess": self.platform_guess,
                "kind": self.kind, "photographed": self.photographed, "quality_issues": self.quality_issues,
                "relation": self.relation, "difference": self.difference, "reason": self.reason, "theme": self.theme,
                "screen": self.screen,
                "candidates": [{k: c.get(k) for k in ("variant_id", "step_id", "flow_id", "step_title", "flow_name", "preview_url", "score")}
                               for c in self.candidates]}


# ------------------------------------------------------------------ candidate pool

async def _published_entries(db: AsyncSession, tenant_id: str, *, flow_id: str | None, platform_ids: list[str] | None,
                             pinned: dict[str, str], cache: dict[str, dict]) -> dict[str, dict]:
    """variant_id → candidate fields, for every variant present in the published
    snapshots in scope. `cache` (version_id → snapshot) is shared across calls."""
    from ..services.content import card_preview_url  # local import: services import this module's result type

    q = select(Flow.id, Flow.current_version_id).where(
        Flow.tenant_id == tenant_id, Flow.status == "published", Flow.current_version_id.isnot(None))
    if flow_id:
        q = q.where(Flow.id == flow_id)
    if platform_ids:
        q = q.where(Flow.platform_id.in_(platform_ids))
    wanted = {fid: pinned.get(fid) or current for fid, current in (await db.execute(q)).all()}
    missing = [vid for vid in wanted.values() if vid not in cache]
    if missing:
        for fv in (await db.execute(select(FlowVersion).where(FlowVersion.id.in_(missing)))).scalars().all():
            cache[fv.id] = {"flow_id": fv.flow_id, "snapshot": fv.snapshot}
    entries: dict[str, dict] = {}
    for fid, version_id in wanted.items():
        cached = cache.get(version_id)
        if not cached or cached["flow_id"] != fid:
            continue
        snap = cached["snapshot"]
        for step in snap.get("steps", []):
            for theme, var in (step.get("variants") or {}).items():
                if not var.get("variant_id") or not var.get("replica_png_key") or var.get("draft_only"):
                    continue
                entries[var["variant_id"]] = {
                    "variant_id": var["variant_id"], "step_id": step["id"], "flow_id": fid,
                    "platform_id": snap["flow"]["platform_id"], "step_title": step["title"], "flow_name": snap["flow"]["name"],
                    "theme": theme, "replica_png_key": var["replica_png_key"], "preview_url": card_preview_url(var),
                }
    return entries


async def _scored_entries(db: AsyncSession, tenant_id: str, vec: list[float], *, flow_id: str | None,
                          platform_ids: list[str] | None, content_mode: str, pinned: dict[str, str], cache: dict[str, dict]) -> list[dict]:
    """Every candidate in scope with its vector distance and stored words."""
    dist = Variant.embedding.cosine_distance(vec).label("distance")
    if content_mode == "published":
        entries = await _published_entries(db, tenant_id, flow_id=flow_id, platform_ids=platform_ids, pinned=pinned, cache=cache)
        if not entries:
            return []
        rows = (await db.execute(
            select(Variant.id, Variant.description, Variant.keywords, dist)
            .where(Variant.id.in_(list(entries)), Variant.embedding.isnot(None))
        )).all()
        return [{**entries[vid], "distance": float(d), "description": desc, "keywords": list(kw or [])} for vid, desc, kw, d in rows]

    q = (select(Variant, Step, Flow, dist)
         .join(Step, Step.id == Variant.step_id).join(Flow, Flow.id == Step.flow_id)
         .where(Flow.tenant_id == tenant_id, Variant.status.in_(("approved", "annotating", "rendering", "completed")),
                Variant.embedding.isnot(None), Variant.replica_png_key.isnot(None)))
    if flow_id:
        q = q.where(Flow.id == flow_id)
    if platform_ids:
        q = q.where(Flow.platform_id.in_(platform_ids))
    rows = (await db.execute(q)).all()
    return [{"variant_id": v.id, "step_id": s.id, "flow_id": f.id, "platform_id": f.platform_id, "step_title": s.title,
             "flow_name": f.name, "theme": v.theme, "distance": float(d), "replica_png_key": v.replica_png_key,
             "description": v.description, "keywords": list(v.keywords or []), "preview_url": storage.public_url(v.stepcard_preview_key)}
            for v, s, f, d in rows]


# ------------------------------------------------------------------ scoring

def _norm(t: str) -> str:
    return "".join(ch for ch in t.lower() if not ch.isspace())


def lexical_scores(query_terms: list[str], entries: list[dict]) -> list[float]:
    """How much of the citizen's screen text each candidate shares. A term
    counts fully when a candidate word equals it, less when the word merely
    contains it or is contained in it (Chinese UI strings are short and often
    nested: 「交易紀錄」 ⊂ 「共 8 筆交易紀錄」, but 「消費明細」 ⊂ 「刷卡消費明細」
    names a different page). Terms that appear on most candidates of the pool
    — a tab bar shared by every page — weigh little; rare ones weigh a lot."""
    terms = [t for t in dict.fromkeys(_norm(x) for x in query_terms) if len(t) >= 2]
    if not terms or not entries:
        return [0.0] * len(entries)
    words = [[_norm(w) for w in e.get("keywords") or [] if len(_norm(w)) >= 2] for e in entries]

    def quality(term: str, ws: list[str]) -> float:
        best = 0.0
        for w in ws:
            if w == term:
                return 1.0
            if term in w:
                best = max(best, 0.8)
            elif w in term and len(w) >= 3:
                best = max(best, 0.4)
        return best

    q = [[quality(t, ws) for t in terms] for ws in words]
    n = len(entries)
    df = [sum(1 for row in q if row[j] > 0) for j in range(len(terms))]
    weights = [math.log((n + 1) / (df[j] + 0.5)) + 0.1 for j in range(len(terms))]
    # normalised against the weight a term nobody else has would carry, so a
    # screen that only shares the tab bar with everyone scores low in absolute terms
    ceiling = (math.log((n + 1) / 0.5) + 0.1) * len(terms)
    return [sum(w * qq for w, qq in zip(weights, row)) / ceiling for row in q]


def fuse(entries: list[dict], lexical: list[float], *, prior: dict[str, float] | None = None, k: int = 5) -> list[dict]:
    """Reciprocal-rank fusion of the vector and lexical rankings plus an
    additive prior per step (the session's expected next steps). Returns the
    top k with `score` (0..1-ish) and the parts that made it."""
    if not entries:
        return []
    by_vec = sorted(range(len(entries)), key=lambda i: entries[i]["distance"])
    by_lex = sorted(range(len(entries)), key=lambda i: -lexical[i])
    rank_v = {i: r for r, i in enumerate(by_vec)}
    rank_l = {i: r for r, i in enumerate(by_lex)}
    c = 10.0
    scored = []
    for i, e in enumerate(entries):
        rrf = 1 / (c + rank_v[i]) + (1 / (c + rank_l[i]) if lexical[i] > 0 else 0)
        bonus = (prior or {}).get(e["step_id"], 0.0)
        scored.append({**e, "lexical": round(lexical[i], 3), "score": round(rrf * c / 2 + bonus, 3)})  # rrf*c/2 ∈ (0, 1]
    scored.sort(key=lambda e: -e["score"])
    return scored[:k]


def step_prior(snapshot: dict | None, step_id: str | None, goal_id: str | None) -> dict[str, float]:
    """The session's current step and the few after it are where a stuck
    citizen most likely is."""
    if not snapshot or not step_id:
        return {}
    from ..services.content import straight_from, walk  # local import: services import this module's result type

    prior = {step_id: 0.15}
    for n, sid in enumerate(straight_from(snapshot, step_id, goal_id)[1:_PRIOR_STEPS + 1], 1):
        prior[sid] = 0.12 - 0.03 * n
    for s in walk(snapshot, goal_id):
        prior.setdefault(s["id"], 0.03)  # anywhere in the same flow beats another flow
    return prior


async def _platform_by_name(db: AsyncSession, tenant_id: str, guess: str) -> str | None:
    """A platform whose name, brand or alias the describer's guess mentions."""
    g = _norm(guess)
    if len(g) < 2:
        return None
    rows = (await db.execute(select(Platform).where(Platform.tenant_id == tenant_id))).scalars().all()
    for p in rows:
        for name in [p.display_name, p.brand, *(p.aliases or [])]:
            n = _norm(name or "")
            if len(n) >= 2 and (n in g or g in n):
                return p.id
    return None


async def _fetch_replica(key: str) -> bytes:
    try:
        return await asyncio.to_thread(storage.get_private, key)
    except Exception:
        log.warning("replica %s unavailable for rerank", key, exc_info=True)
        return b""


# ------------------------------------------------------------------ the ladder

def decide(result: LocateResult, *, threshold: float, low: float, platform_known: bool) -> str:
    """Turn what the models said into one outcome. Order matters: a confident
    visual match wins even for a picture that looks like a home screen (the
    first step of a flow may well be one)."""
    if result.step_id and result.confidence >= threshold and result.relation in ("", "same_screen"):
        return LOCATED
    if result.kind == "unreadable":
        return UNREADABLE
    if result.kind == "not_a_screen":
        return NOT_A_SCREENSHOT
    if result.kind in _SYSTEM_KINDS:
        return NOT_APP_SCREEN
    if result.step_id and result.confidence >= low and result.relation in ("", "same_screen"):
        return AMBIGUOUS
    if result.relation == "same_app_other_screen" or platform_known or result.platform_id:
        return OFF_FLOW
    return UNKNOWN_PLATFORM


async def locate(db: AsyncSession, tenant_id: str, png: bytes, *, flow_id: str | None, platform_id: str | None,
                 content_mode: str = "published", session_id: str = "", flow_version_id: str | None = None,
                 step_id: str | None = None, goal_id: str | None = None, snapshot: dict | None = None,
                 threshold: float | None = None, low: float | None = None) -> LocateResult:
    """`flow_version_id`: the published version the session pinned for `flow_id`.
    `step_id`/`goal_id`/`snapshot`: where the citizen is, for the prior.
    `threshold`/`low`: the policy's confidence bars (settings when omitted)."""
    s = get_settings()
    threshold = s.locate_confidence_threshold if threshold is None else threshold
    low = s.locate_low_confidence if low is None else low
    await release_connection(db)
    small = await agents.shrink(png)  # once per turn; describe and rerank both reuse it
    desc, u1 = await agents.describe_screenshot(small, tenant_id=tenant_id, ref_id=session_id, shrunk=True)
    d = desc.model_dump()
    result = LocateResult(ok=False, theme=d.get("theme", "light"), description=d, usage=[u1], kind=d.get("kind", "app_screen"),
                          photographed=bool(d.get("photographed")), quality_issues=list(d.get("quality_issues") or []),
                          platform_guess=d.get("app_guess") or "", platform_id=platform_id,
                          screen={"title": d.get("screen_title", ""), "structural_texts": list(d.get("structural_texts") or []),
                                  "elements": [e for e in (d.get("elements") or [])][:20], "app_guess": d.get("app_guess", "")})
    if result.kind == "unreadable":
        result.outcome, result.reason = UNREADABLE, "；".join(result.quality_issues) or "畫面內容無法辨識"
        return result

    text = agents.description_text(d, "", d.get("theme", ""))
    vec = await embed(text)
    query_terms = agents.screen_keywords(d)

    # scope: a stated platform is a hard filter; otherwise the whole tenant.
    # The platform we report for a non-match is only ever one we can stand
    # behind: the stated one, or one the describer named (logo, app name).
    platform_ids = [platform_id] if platform_id else None
    guessed = await _platform_by_name(db, tenant_id, result.platform_guess) if result.platform_guess else None
    result.platform_id = platform_id or guessed
    result.scope = "platform" if platform_id else "tenant"
    pinned = {flow_id: flow_version_id} if flow_id and flow_version_id else {}
    cache: dict[str, dict] = {}
    entries = await _scored_entries(db, tenant_id, vec, flow_id=None, platform_ids=platform_ids, content_mode=content_mode,
                                    pinned=pinned, cache=cache)
    await release_connection(db)
    if not entries:
        result.outcome = decide(result, threshold=threshold, low=low, platform_known=bool(platform_id))
        result.reason = "目前沒有可比對的教學畫面"
        return result

    prior = step_prior(snapshot, step_id, goal_id) if flow_id else {}
    if flow_id and not prior:
        prior = {e["step_id"]: 0.03 for e in entries if e["flow_id"] == flow_id}
    pool = fuse(entries, lexical_scores(query_terms, entries), prior=prior, k=s.retrieval_top_k)
    result.candidates = pool
    if flow_id:
        result.scope = "flow+" + result.scope

    pngs = await asyncio.gather(*(_fetch_replica(c["replica_png_key"]) for c in pool))
    usable = [(c, p) for c, p in zip(pool, pngs) if p]
    if not usable:
        result.outcome = decide(result, threshold=threshold, low=low, platform_known=bool(platform_id))
        result.reason = "候選畫面的復刻圖暫時無法取得"
        return result

    progress = ""
    if snapshot and step_id:
        from ..services.content import snapshot_step
        cur = snapshot_step(snapshot, step_id)
        if cur:
            progress = f"正在「{snapshot['flow']['name']}」，上一次看到的是步驟「{cur['title']}」"
    rr, u2 = await agents.rerank(small, [{"png": p, "label": f"{c['flow_name']} / {c['step_title']}", "description": c["description"],
                                          "keywords": c.get("keywords") or []} for c, p in usable],
                                 tenant_id=tenant_id, ref_id=session_id, citizen_shrunk=True, progress=progress)
    result.usage.append(u2)
    result.theme = rr.theme or result.theme
    result.relation, result.difference, result.reason = rr.relation, rr.difference, rr.reason
    if 0 <= rr.best_candidate_index < len(usable):
        best = usable[rr.best_candidate_index][0]
        result.step_id, result.flow_id, result.variant_id = best["step_id"], best["flow_id"], best["variant_id"]
        if rr.relation in ("same_screen", "same_app_other_screen") or not result.platform_id:
            # the best candidate's platform counts only when the reranker says it is the same app
            result.platform_id = best["platform_id"] if rr.relation in ("same_screen", "same_app_other_screen") else result.platform_id
        result.confidence = rr.confidence
        # the reranker's pick goes first in the list the citizen may be shown
        result.candidates = [best, *[c for c in pool if c["variant_id"] != best["variant_id"]]]
    result.outcome = decide(result, threshold=threshold, low=low, platform_known=bool(platform_id))
    result.ok = result.outcome == LOCATED
    if result.outcome != LOCATED and result.outcome != AMBIGUOUS:
        # a non-match must not be reported as a step
        result.step_id, result.flow_id, result.variant_id = None, None, None
    return result
