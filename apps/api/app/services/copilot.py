"""內容助理的業務層（SPEC §8.6 / §9.6）。

`ai/copilot.py` 只會拼提示詞與呼叫模型；這裡負責其餘的一切：讀設定、決定送什麼
出去、把回來的句子組成草稿、落地、寫稽核（決策 D31）。

三條紅線寫在程式碼裡而不是提示詞裡：

1. **只寫 draft**。所有寫入都經 `contents.save_generated_draft()` 與
   `faq.create(active=False)`；這個模組沒有任何一行碰得到 `contents.content`。
   發布是人按的（決策 D8）。
2. **外送資料只有三類**（SPEC §11）：罐頭草稿上下文、方案設定、去識別化後的未命中
   訊息文字。申請案件、證明文件、申請人個資完全不進這個模組的視野——不是「過濾
   掉」，是根本沒有查詢會把它們讀出來。
3. **沒有依據的句子標「待查證」**。模型回的是句子加引用索引，組字的是
   `compose()`：指不出依據的句子一律加後綴。這條規則由伺服器執行，不倚賴模型自律。

方案專屬文案的 key 一律加 `scheme.{代碼}.` 前綴（決策 D30）：`contents` 的自然鍵是
(tenant_id, key)，全域的 `status.APPROVED.public_label` 已經佔了那個名字。
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import copilot as ai_copilot
from ..ai.schemas import ContentDraft, FaqSuggestion, SchemeCopyItem
from ..content_registry import get_definition
from ..models import (
    STATUSES,
    Content,
    CopilotSuggestion,
    Faq,
    KnowledgeDocument,
    Scheme,
    UnmatchedMessage,
)
from . import audit
from . import contents as contents_service
from . import faq as faq_service
from . import scheme as scheme_service
from .actors import Actor

__all__ = [
    "MAX_CLUSTERS",
    "SCHEME_CONTENT_CATEGORY",
    "SUGGESTION_NOT_FOUND",
    "UNVERIFIED_SUFFIX",
    "accept_faq_suggestion",
    "compose",
    "dismiss_faq_suggestion",
    "draft_content",
    "faq_suggestions",
    "list_suggestions",
    "scheme_content_key",
    "scheme_drafts",
    "scrub",
]

UNVERIFIED_SUFFIX = "（待查證）"
SCHEME_CONTENT_CATEGORY = "scheme"
SUGGESTION_NOT_FOUND = "找不到這則建議"
UNMATCHED_SCAN_LIMIT = 300
MAX_CLUSTERS = 8
MIN_CLUSTER_SIZE = 1
MAX_SOURCES = 6

# 去識別化：LINE 的 userId、手機、身分證字號、案號。未命中訊息是民眾自己打的字，
# 他們很常把案號或電話直接打進去，所以在送出去之前一律換成佔位符。
_SCRUB_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bU[0-9a-f]{32}\b"), "[LINE帳號]"),
    (re.compile(r"\b[A-Za-z][12]\d{8}\b"), "[身分證]"),
    (re.compile(r"\b[A-Z]{2}-\d{4}-\d{6}\b"), "[案號]"),
    (re.compile(r"(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)"), "[電話]"),
    (re.compile(r"(?<!\d)0\d{1,2}[-\s]?\d{6,8}(?!\d)"), "[電話]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[Email]"),
)


def scrub(text: str) -> str:
    """把一句民眾打的話裡的識別資訊換掉，然後才准它離開這台機器（SPEC §11）。"""
    out = text or ""
    for pattern, placeholder in _SCRUB_PATTERNS:
        out = pattern.sub(placeholder, out)
    return out.strip()


# ------------------------------------------------------------ 草稿的組裝

def compose(sentences: Sequence[Any], citations: Sequence[Any]) -> str:
    """把模型回的句子串成一段字，指不出依據的句子加上「待查證」。

    `citation_index` 超出引用清單範圍也算沒有依據——一個指向不存在來源的索引，
    和沒有索引是同一回事，而且更值得承辦人員看一眼。
    """
    lines: list[str] = []
    for sentence in sentences:
        text = str(getattr(sentence, "text", "") or "").strip()
        if not text:
            continue
        index = getattr(sentence, "citation_index", None)
        cited = isinstance(index, int) and 0 <= index < len(citations)
        lines.append(text if cited else f"{text}{UNVERIFIED_SUFFIX}")
    return "\n".join(lines)


def _citations_out(citations: Sequence[Any]) -> list[dict[str, str]]:
    return [
        {"source_type": str(c.source_type), "source_id": str(c.source_id), "quote": str(c.quote)}
        for c in citations
    ]


def _unverified_count(sentences: Sequence[Any], citations: Sequence[Any]) -> int:
    total = 0
    for sentence in sentences:
        if not str(getattr(sentence, "text", "") or "").strip():
            continue
        index = getattr(sentence, "citation_index", None)
        if not (isinstance(index, int) and 0 <= index < len(citations)):
            total += 1
    return total


# --------------------------------------------------------------- 來源蒐集

_WORD = re.compile(r"[一-鿿]{2,4}|[A-Za-z0-9]{2,}")


def _terms(text: str) -> set[str]:
    return {w.lower() for w in _WORD.findall(text or "")}


def _overlap(needle: set[str], haystack: str) -> int:
    return len(needle & _terms(haystack))


async def _knowledge_sources(db: AsyncSession, tenant_id: str, needle: str, limit: int = 3) -> list[dict[str, str]]:
    """跟這段文字最相關的幾份知識文件。沒有任何交集的文件不拿進來充數。"""
    rows = (
        await db.execute(select(KnowledgeDocument).where(KnowledgeDocument.tenant_id == tenant_id).limit(200))
    ).scalars().all()
    terms = _terms(needle)
    scored = [(row, _overlap(terms, f"{row.title} {row.content}")) for row in rows]
    best = sorted((r for r in scored if r[1] > 0), key=lambda r: (-r[1], r[0].title))[:limit]
    return [
        {"source_type": "knowledge_document", "source_id": row.id, "quote": _snip(row.content or row.title)}
        for row, _score in best
    ]


async def _content_sources(db: AsyncSession, tenant_id: str, needle: str, limit: int = 3) -> list[dict[str, str]]:
    """已發布的罐頭訊息裡跟這段文字最相關的幾則。助理只能引用機關自己說過的話。"""
    rows = (
        await db.execute(select(Content).where(Content.tenant_id == tenant_id).limit(400))
    ).scalars().all()
    terms = _terms(needle)
    scored = [(row, _overlap(terms, f"{row.title} {row.content}")) for row in rows if (row.content or "").strip()]
    best = sorted((r for r in scored if r[1] > 0), key=lambda r: (-r[1], r[0].key))[:limit]
    return [{"source_type": "content", "source_id": row.key, "quote": _snip(row.content)} for row, _score in best]


async def _scheme_sources(db: AsyncSession, tenant_id: str, needle: str, limit: int = 2) -> list[dict[str, str]]:
    rows = await scheme_service.list_schemes(db, tenant_id, active=True)
    terms = _terms(needle)
    scored = [
        (row, _overlap(terms, f"{row.name} {row.description} {row.eligibility} {row.amount_note}"))
        for row in rows
    ]
    best = sorted((r for r in scored if r[1] > 0), key=lambda r: (-r[1], r[0].code))[:limit]
    return [
        {"source_type": "scheme", "source_id": row.code, "quote": _snip(row.description or row.name)}
        for row, _score in best
    ]


def _snip(text: str, limit: int = 200) -> str:
    compact = " ".join((text or "").split())
    return compact[:limit]


# ---------------------------------------------------- (a) 罐頭訊息草稿

async def draft_content(
    db: AsyncSession,
    tenant_id: str,
    key: str,
    *,
    instruction: str = "",
    tone: str = "",
    actor: Actor | None = None,
) -> dict[str, Any]:
    """助理 (a)：依 key 的說明、語氣與變數產生草稿，寫進 `contents.draft`。"""
    row = await contents_service.get_or_create(db, tenant_id, key)
    definition = get_definition(key)
    needle = f"{row.title} {row.description} {row.content}"
    sources: list[dict[str, str]] = []
    if (row.content or "").strip():
        sources.append({"source_type": "content", "source_id": key, "quote": _snip(row.content)})
    elif definition is not None and definition.default.strip():
        sources.append({"source_type": "content", "source_id": key, "quote": _snip(definition.default)})
    sources += await _knowledge_sources(db, tenant_id, needle)
    sources += await _scheme_sources(db, tenant_id, needle)

    draft, usage = await ai_copilot.draft_content(
        key=key, title=row.title, description=row.description, category=row.category,
        variables=list(row.variables or []), current=row.content,
        default=definition.default if definition else "",
        instruction=instruction, tone=tone, sources=sources[:MAX_SOURCES], tenant_id=tenant_id,
    )
    text = compose(draft.sentences, draft.citations)
    view = await contents_service.save_generated_draft(db, tenant_id, key, text, actor=actor)
    await audit.log(
        db, actor, "copilot.content", "content", key,
        {"tone": tone, "instruction": instruction, "citations": len(draft.citations),
         "unverified": _unverified_count(draft.sentences, draft.citations)},
        tenant_id=tenant_id,
    )
    return {
        "key": key,
        "draft": text,
        "citations": _citations_out(draft.citations),
        "notes": draft.notes,
        "content": view.dict(),
        "usage": usage,
    }


# ------------------------------------------------------------ (b) FAQ 建議

def _suggestion_out(row: CopilotSuggestion) -> dict[str, Any]:
    payload = dict(row.payload or {})
    payload.update({
        "id": row.id,
        "status": row.status,
        "cluster_size": row.sample_count,
        "created_at": row.created_at,
        "target_id": row.target_id,
    })
    return payload


async def list_suggestions(
    db: AsyncSession, tenant_id: str, *, status: str = "pending", limit: int = 50
) -> list[dict[str, Any]]:
    where = [CopilotSuggestion.tenant_id == tenant_id, CopilotSuggestion.kind == "faq"]
    if status:
        where.append(CopilotSuggestion.status == status)
    rows = (
        await db.execute(
            select(CopilotSuggestion).where(*where)
            .order_by(CopilotSuggestion.sample_count.desc(), CopilotSuggestion.id).limit(limit)
        )
    ).scalars().all()
    return [_suggestion_out(row) for row in rows]


async def faq_suggestions(
    db: AsyncSession,
    tenant_id: str,
    *,
    limit: int = MAX_CLUSTERS,
    actor: Actor | None = None,
) -> list[dict[str, Any]]:
    """助理 (b)：把未命中訊息聚類，每一群請模型寫一則 FAQ 建議（SPEC §8.6 b）。

    每次呼叫都重新產生一批 `pending` 建議，舊的 `pending` 先清掉——它們是同一批訊息
    的另一種說法，兩批並排只會讓承辦人員要先分辨哪一批是新的。已採用或已忽略的
    留著，那是紀錄。
    """
    rows = (
        await db.execute(
            select(UnmatchedMessage).where(UnmatchedMessage.tenant_id == tenant_id)
            .order_by(UnmatchedMessage.created_at.desc()).limit(UNMATCHED_SCAN_LIMIT)
        )
    ).scalars().all()
    texts = [scrub(row.text) for row in rows]
    kept = [(i, t) for i, t in enumerate(texts) if t]
    if not kept:
        await _clear_pending(db, tenant_id)
        await audit.log(db, actor, "copilot.faq_suggestions", "faq", "",
                        {"messages": 0, "clusters": 0}, tenant_id=tenant_id)
        return []

    vectors = await ai_copilot.embed_all([t for _i, t in kept])
    groups = ai_copilot.cluster_texts(vectors)
    categories = await faq_service.categories(db, tenant_id)

    await _clear_pending(db, tenant_id)
    made: list[CopilotSuggestion] = []
    for group in groups[:limit]:
        if len(group) < MIN_CLUSTER_SIZE:
            continue
        samples = [kept[i][1] for i in group]
        needle = " ".join(samples)
        sources = (
            await _scheme_sources(db, tenant_id, needle)
            + await _knowledge_sources(db, tenant_id, needle)
            + await _content_sources(db, tenant_id, needle)
        )
        suggestion, _usage = await ai_copilot.suggest_faq(
            samples=samples, sources=sources[:MAX_SOURCES], categories=categories,
            cluster_size=len(group), tenant_id=tenant_id,
        )
        made.append(_persist_suggestion(db, tenant_id, suggestion, samples, actor))
    # 先 flush 再序列化：`id` 與 `created_at` 是 INSERT 時才有的，序列化在前面會
    # 讓每一則建議的 id 都是 null，而 id 正是「採用」那一支端點唯一的入口。
    await db.flush()
    await audit.log(
        db, actor, "copilot.faq_suggestions", "faq", "",
        {"messages": len(kept), "clusters": len(made)}, tenant_id=tenant_id,
    )
    return [_suggestion_out(row) for row in made]


async def _clear_pending(db: AsyncSession, tenant_id: str) -> None:
    rows = (
        await db.execute(
            select(CopilotSuggestion).where(
                CopilotSuggestion.tenant_id == tenant_id,
                CopilotSuggestion.kind == "faq",
                CopilotSuggestion.status == "pending",
            )
        )
    ).scalars().all()
    for row in rows:
        await db.delete(row)
    await db.flush()


def _persist_suggestion(
    db: AsyncSession,
    tenant_id: str,
    suggestion: FaqSuggestion,
    samples: Sequence[str],
    actor: Actor | None,
) -> CopilotSuggestion:
    answer = compose(suggestion.sentences, suggestion.citations)
    row = CopilotSuggestion(
        tenant_id=tenant_id,
        kind="faq",
        status="pending",
        sample_count=len(samples),
        created_by=actor.id if actor else None,
        payload={
            "question": suggestion.question.strip(),
            "answer_draft": answer,
            "citations": _citations_out(suggestion.citations),
            "keywords": [k.strip() for k in suggestion.keywords if k.strip()],
            "category": suggestion.category,
            # 樣本句進資料庫之前就已經去識別化，後台顯示的也是同一份字。
            "sample_messages_masked": list(samples[:5]),
            "unverified": _unverified_count(suggestion.sentences, suggestion.citations),
        },
    )
    db.add(row)
    return row


async def _suggestion(db: AsyncSession, tenant_id: str, suggestion_id: str) -> CopilotSuggestion:
    row = (
        await db.execute(
            select(CopilotSuggestion).where(
                CopilotSuggestion.tenant_id == tenant_id, CopilotSuggestion.id == suggestion_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, SUGGESTION_NOT_FOUND)
    return row


async def accept_faq_suggestion(
    db: AsyncSession, tenant_id: str, suggestion_id: str, *, actor: Actor | None = None
) -> Faq:
    """採用一則建議：建出一則**停用中**的 FAQ（`source=copilot`）。

    停用是刻意的：採用代表「這題值得回答」，不代表「這段答案可以直接對外說」。
    承辦人員改完再按啟用，和罐頭訊息的 draft/publish 是同一套規矩。
    """
    row = await _suggestion(db, tenant_id, suggestion_id)
    if row.status == "accepted":
        raise HTTPException(409, "這則建議已經採用過了")
    payload = dict(row.payload or {})
    created = await faq_service.create(
        db, tenant_id,
        {
            "question": str(payload.get("question") or "").strip(),
            "answer": str(payload.get("answer_draft") or ""),
            "keywords": list(payload.get("keywords") or []),
            "category": str(payload.get("category") or ""),
            "priority": 0,
            "active": False,
            "source": "copilot",
        },
        actor=actor,
    )
    row.status = "accepted"
    row.target_id = created.id
    row.resolved_by = actor.id if actor else None
    row.resolved_at = datetime.now(UTC)
    await db.flush()
    await audit.log(db, actor, "copilot.faq_accept", "faq", created.id,
                    {"suggestion_id": row.id}, tenant_id=tenant_id)
    return created


async def dismiss_faq_suggestion(
    db: AsyncSession, tenant_id: str, suggestion_id: str, *, actor: Actor | None = None
) -> CopilotSuggestion:
    row = await _suggestion(db, tenant_id, suggestion_id)
    row.status = "dismissed"
    row.resolved_by = actor.id if actor else None
    row.resolved_at = datetime.now(UTC)
    await db.flush()
    await audit.log(db, actor, "copilot.faq_dismiss", "faq", row.id, {}, tenant_id=tenant_id)
    return row


# ------------------------------------------------------- (c) 方案文案集

def scheme_content_key(scheme_code: str, suffix: str) -> str:
    """方案專屬文案的 key（決策 D30）。

    `contents` 的自然鍵是 (tenant_id, key)，全域的 `status.APPROVED.public_label`
    已經佔了那個名字，所以方案自己的那一份前面加 `scheme.{代碼}.`。前綴而不是後綴，
    是因為後台列表按 key 排序，同一個方案的文案才會排在一起。
    """
    return f"scheme.{scheme_code}.{suffix}"


_STATUS_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("public_label", "市民在案件進度頁看到的狀態名稱"),
    ("next_action", "案件在這個狀態時，市民進度頁「我現在要做什麼？」的內容"),
    ("notify_headline", "案件轉到這個狀態時，LINE 推播的第一行"),
)


def _scheme_items(scheme: Scheme) -> list[dict[str, Any]]:
    """這個方案要寫哪些文案，以及每一則可以引用什麼。"""
    base = {"source_type": "scheme", "source_id": scheme.code,
            "quote": _snip(scheme.description or scheme.name)}
    items: list[dict[str, Any]] = []
    for status in STATUSES:
        for suffix, purpose in _STATUS_SUFFIXES:
            key = scheme_content_key(scheme.code, f"status.{status}.{suffix}")
            sources = [base]
            fallback = get_definition(f"status.{status}.{suffix}")
            if fallback is not None:
                sources.append({"source_type": "content", "source_id": fallback.key,
                                "quote": _snip(fallback.default)})
            items.append({"key": key, "purpose": f"{scheme.name}／{status}：{purpose}", "sources": sources})
    for code in sorted(scheme.rejection_codes, key=lambda r: (r.sort_order, r.code)):
        if not code.active:
            continue
        for suffix, purpose in (("public_what_wrong", "退件時告訴市民哪裡不對"),
                                ("public_how_to_fix", "退件時告訴市民怎麼修、去哪修")):
            sources = [base, {"source_type": "rejection_code", "source_id": code.code,
                              "quote": _snip(getattr(code, suffix) or code.staff_label)}]
            items.append({
                "key": scheme_content_key(scheme.code, f"rejection.{code.code}.{suffix}"),
                "purpose": f"退件碼 {code.code}：{purpose}",
                "sources": sources,
            })
    for doc in sorted(scheme.document_types, key=lambda d: (d.sort_order, d.code)):
        sources = [base, {"source_type": "document_type", "source_id": doc.code,
                          "quote": _snip(doc.hint or doc.label or doc.code)}]
        items.append({
            "key": scheme_content_key(scheme.code, f"guide.{doc.code}"),
            "purpose": f"文件「{doc.label or doc.code}」的準備指引：是什麼、去哪拿、上傳前要注意什麼"
                       + ("（這份文件必須先遮蔽敏感欄位）" if doc.must_mask else ""),
            "sources": sources,
        })
    return items


async def scheme_drafts(
    db: AsyncSession, tenant_id: str, code: str, *, actor: Actor | None = None
) -> dict[str, Any]:
    """助理 (c)：依方案設定一次產出整套對外文案的草稿（SPEC §8.6 c）。

    寫進 `contents.draft`，`scheme_id` 指回這個方案；一個字都不會發布出去。
    """
    scheme = await scheme_service.get_scheme(db, tenant_id, code)
    items = _scheme_items(scheme)
    wanted = {row["key"]: row for row in items}
    result, usage = await ai_copilot.write_scheme_copy(
        scheme=scheme_service.scheme_summary_view(scheme) | {"eligibility": scheme.eligibility,
                                                             "supplement_days": scheme.supplement_days,
                                                             "max_revisions": scheme.max_revisions},
        items=items, tenant_id=tenant_id,
    )
    drafts: list[dict[str, Any]] = []
    for item in result.items:
        spec = wanted.get(item.key)
        if spec is None:
            continue  # 模型自創的 key 一律丟掉：清單是呼叫端給的，不是它能擴充的
        drafts.append(await _write_scheme_draft(db, tenant_id, scheme, item, spec, actor))
    await audit.log(
        db, actor, "copilot.scheme_drafts", "scheme", scheme.code,
        {"requested": len(items), "written": len(drafts)}, tenant_id=tenant_id,
    )
    return {"scheme_code": scheme.code, "drafts": drafts, "requested": len(items), "usage": usage}


async def _write_scheme_draft(
    db: AsyncSession,
    tenant_id: str,
    scheme: Scheme,
    item: SchemeCopyItem,
    spec: dict[str, Any],
    actor: Actor | None,
) -> dict[str, Any]:
    text = compose(item.sentences, item.citations)
    view = await contents_service.save_generated_draft(
        db, tenant_id, item.key, text, actor=actor,
        category=SCHEME_CONTENT_CATEGORY,
        title=str(spec.get("purpose") or item.key),
        description=f"{scheme.name}（{scheme.code}）的方案專屬文案，由內容助理產生草稿。",
        scheme_id=scheme.id,
    )
    return {
        "key": item.key,
        "draft": text,
        "citations": _citations_out(item.citations),
        "version": view.version,
    }


def draft_preview(draft: ContentDraft) -> str:
    """給測試與工具用的小捷徑：不落地，只看它會寫出什麼字。"""
    return compose(draft.sentences, draft.citations)
