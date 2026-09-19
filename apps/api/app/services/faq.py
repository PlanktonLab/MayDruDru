"""常見問題（SPEC §8.1 `/help`、§8.6、§9.7、§10.1）。

這支模組有兩個呼叫面，共用同一張 `faqs` 表：

* **評分**（`score` / `search` / `best`）——LINE bot 聽懂一句話時用的，回傳帶分數的命中。
* **瀏覽**（`browse` / `matches`）——`/api/apply/faqs` 給市民的清單，做的是單純的子字串
  過濾，沒有門檻也沒有分數：市民是在「翻」FAQ，不是在問問題，翻到就該看得到。
* **CRUD**（`list_faqs` 以下）——後台維護。

比對規則是 youth-line-bot `faqService.scoreFaq` 的移植，連權重都一樣：
每個命中的關鍵字值 3 分（長度 ≥ 3）或 2 分，整句問題被包含在使用者的話裡再加 5 分，
**有命中才加上 `priority`**——無條件加優先權會讓每一條 FAQ 都跨過門檻，
於是「今天天氣如何」也會得到一個很有自信的錯答案。

`search()` 是 P4 換成 embedding 檢索的接縫（決策 D27），現在真的換了：呼叫端把問句
的向量算好交進來（`vector=`），有向量、底層又是 Postgres + pgvector 時走餘弦距離，
其餘情況（沒有向量、SQLite 測試庫、整張表還沒 embed 過）**自動落回關鍵字**，
介面與回傳形狀完全一樣。

向量是算出來的，算它要呼叫模型；但 `routers/apply.py` 會 import 這個模組，而
CLAUDE.md 規則 3 禁止那條路徑碰到 `app/ai`（import-linter 連間接匯入都擋）。所以
這裡**不 import `app.ai`**，而是把 embedding 函式當參數收進來：真正接上模型的是
`app/ai/intent.py` 與 `scripts/embed_faqs.py`（決策 D29）。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Faq, Scheme
from . import audit
from .actors import Actor
from .versioning import bump, check_version

__all__ = [
    "FAQ_NOT_FOUND",
    "MAX_RESULTS",
    "MIN_SCORE",
    "VECTOR_MIN_SIMILARITY",
    "Embedder",
    "FaqMatch",
    "best",
    "browse",
    "categories",
    "create",
    "delete",
    "embed_text",
    "get",
    "keyword_search",
    "list_faqs",
    "matches",
    "reembed_all",
    "score",
    "search",
    "set_active",
    "update",
    "vector_search",
]

FAQ_NOT_FOUND = "找不到這則常見問題"
MIN_SCORE = 2
LONG_KEYWORD = 3
MAX_RESULTS = 50
_SCAN_LIMIT = 500
# 餘弦相似度低於這條線的命中不算數。關鍵字版的門檻是分數 2，這一條是它的向量版：
# 沒有門檻的話「今天天氣如何」也會找到一個最接近的 FAQ，然後自信地答錯。
VECTOR_MIN_SIMILARITY = 0.55

# 一段文字 → 向量。呼叫端提供（見模組 docstring 的決策 D29）。
type Embedder = Callable[[str], Awaitable[list[float]]]


@dataclass(frozen=True)
class FaqMatch:
    faq: Faq
    score: int
    #: keyword（關鍵字加權）或 vector（pgvector 餘弦）。看得出這一筆是怎麼中的。
    source: str = "keyword"


def score(faq: Faq, text: str) -> int:
    """一條 FAQ 對一句話的分數。沒有任何命中就是 0，不看優先權。"""
    normalised = (text or "").lower()
    total = 0
    matched = False
    for keyword in faq.keywords or []:
        k = str(keyword).lower().strip()
        if not k or k not in normalised:
            continue
        matched = True
        total += 3 if len(k) >= LONG_KEYWORD else 2
    if faq.question and faq.question.lower() in normalised:
        matched = True
        total += 5
    if not matched:
        return 0
    return total + int(faq.priority or 0)


def embed_text(faq: Faq) -> str:
    """要被 embed 的那一段字：問句 + 關鍵字 + 答案。

    只 embed 問句會讓「補助什麼時候撥款」找不到一則標題是「撥款時程」的條目；
    連答案一起 embed 則讓民眾用答案裡的詞（機關名、表單名）問也找得到。
    """
    parts = [faq.question or "", " ".join(str(k) for k in (faq.keywords or [])), faq.answer or ""]
    return "\n".join(p for p in parts if p.strip())


def _is_postgres(db: AsyncSession) -> bool:
    bind = db.get_bind()
    return getattr(getattr(bind, "dialect", None), "name", "") == "postgresql"


async def vector_search(
    db: AsyncSession, tenant_id: str, vector: list[float], *, limit: int = 3
) -> list[FaqMatch]:
    """pgvector 餘弦檢索。不是 Postgres、或整張表都還沒 embed 過，就回空清單。

    回空不是錯誤，是「這條路現在走不通」的訊號——`search()` 接著走關鍵字。
    """
    if not vector or not _is_postgres(db):
        return []
    distance = Faq.embedding.cosine_distance(vector)
    try:
        rows = (
            await db.execute(
                select(Faq, distance.label("distance"))
                .where(Faq.tenant_id == tenant_id, Faq.active.is_(True), Faq.embedding.is_not(None))
                .order_by(distance)
                .limit(max(1, limit))
            )
        ).all()
    except Exception:  # 欄位維度對不上、擴充沒裝——一律當成「這條路走不通」
        return []
    hits: list[FaqMatch] = []
    for row, dist in rows:
        similarity = 1.0 - float(dist)
        if similarity < VECTOR_MIN_SIMILARITY:
            continue
        hits.append(FaqMatch(faq=row, score=int(round(similarity * 100)), source="vector"))
    return hits


def keyword_search(rows: Sequence[Faq], q: str, *, limit: int = 3) -> list[FaqMatch]:
    """關鍵字加權（youth-line-bot `scoreFaq` 的移植），純計算、不碰資料庫。"""
    scored = [FaqMatch(faq=row, score=score(row, q), source="keyword") for row in rows]
    hits = sorted((m for m in scored if m.score >= MIN_SCORE), key=lambda m: m.score, reverse=True)
    return hits[:limit]


async def search(
    db: AsyncSession,
    tenant_id: str,
    q: str,
    *,
    limit: int = 3,
    vector: list[float] | None = None,
) -> list[FaqMatch]:
    """依分數排序的命中：有向量先走語意檢索，沒中才落回關鍵字（SPEC §9.7）。

    兩條路的回傳形狀一樣，`FaqMatch.source` 說得出這一筆是怎麼中的。
    """
    if not (q or "").strip():
        return []
    if vector:
        hits = await vector_search(db, tenant_id, vector, limit=limit)
        if hits:
            return hits
    rows = (
        await db.execute(select(Faq).where(Faq.tenant_id == tenant_id, Faq.active.is_(True)))
    ).scalars().all()
    return keyword_search(rows, q, limit=limit)


async def best(db: AsyncSession, tenant_id: str, q: str, *, vector: list[float] | None = None) -> Faq | None:
    hits = await search(db, tenant_id, q, limit=1, vector=vector)
    return hits[0].faq if hits else None


async def reembed_all(
    db: AsyncSession,
    embed: Embedder,
    *,
    tenant_id: str | None = None,
    only_missing: bool = False,
) -> int:
    """整批重算 FAQ 向量，回傳寫了幾列（`scripts/embed_faqs.py` 的本體）。

    一筆算不出來就跳過那一筆繼續跑：一則問句讓模型出錯，不該讓剩下兩百則都沒有向量。
    `only_missing=True` 只補還沒有向量的列，適合平常加完 FAQ 之後順手跑一次。
    """
    q = select(Faq)
    if tenant_id:
        q = q.where(Faq.tenant_id == tenant_id)
    if only_missing:
        q = q.where(Faq.embedding.is_(None))
    rows = (await db.execute(q.order_by(Faq.id))).scalars().all()
    written = 0
    for row in rows:
        text = embed_text(row)
        if not text.strip():
            continue
        try:
            row.embedding = await embed(text)
        except Exception:
            continue
        written += 1
    await db.flush()
    return written


# ------------------------------------------------------------------- 瀏覽

def matches(faq: Faq, needle: str) -> bool:
    """問題、答案或任一關鍵字含有這段文字（不分大小寫）。"""
    low = needle.lower()
    if low in (faq.question or "").lower() or low in (faq.answer or "").lower():
        return True
    return any(low in str(k).lower() for k in (faq.keywords or []))


async def browse(
    db: AsyncSession,
    tenant_id: str,
    *,
    q: str = "",
    scheme_code: str = "",
    limit: int = MAX_RESULTS,
) -> list[Faq]:
    """依優先度排序的 FAQ 清單。指定方案時同時回通用題目（`scheme_id` 為空的那些）。

    比對刻意在 Python 端做而不是 SQL：`keywords` 是 JSON 欄位，SQLite 與 Postgres 對它
    的文字化結果不同（前者會把中文轉成 `\\uXXXX`），在資料庫裡比會在兩種引擎上得到
    不同答案。FAQ 是一張小表，讀出來再比反而是最可預期的作法。
    """
    where = [Faq.tenant_id == tenant_id, Faq.active.is_(True)]
    if scheme_code:
        scheme_id = (
            await db.execute(select(Scheme.id).where(Scheme.tenant_id == tenant_id, Scheme.code == scheme_code))
        ).scalar_one_or_none()
        where.append(or_(Faq.scheme_id == scheme_id, Faq.scheme_id.is_(None)))
    rows: Sequence[Faq] = (
        await db.execute(
            select(Faq).where(*where).order_by(Faq.priority.desc(), Faq.id).limit(_SCAN_LIMIT)
        )
    ).scalars().all()
    needle = q.strip()
    if needle:
        rows = [f for f in rows if matches(f, needle)]
    return list(rows[:limit])


# ------------------------------------------------------------------- CRUD

async def list_faqs(
    db: AsyncSession,
    tenant_id: str,
    *,
    category: str | None = None,
    q: str | None = None,
    active_only: bool = False,
    limit: int = 200,
) -> list[Faq]:
    where = [Faq.tenant_id == tenant_id]
    if category:
        where.append(Faq.category == category)
    if active_only:
        where.append(Faq.active.is_(True))
    if q:
        needle = f"%{q.strip().lower()}%"
        where.append(func.lower(Faq.question).like(needle))
    rows = (
        await db.execute(
            select(Faq).where(*where).order_by(Faq.priority.desc(), Faq.category, Faq.question).limit(limit)
        )
    ).scalars().all()
    return list(rows)


async def categories(db: AsyncSession, tenant_id: str) -> list[str]:
    rows = (
        await db.execute(
            select(Faq.category).where(Faq.tenant_id == tenant_id, Faq.active.is_(True)).distinct()
        )
    ).scalars().all()
    return sorted(c for c in rows if c)


async def get(db: AsyncSession, tenant_id: str, faq_id: str) -> Faq:
    row = (
        await db.execute(select(Faq).where(Faq.tenant_id == tenant_id, Faq.id == faq_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, FAQ_NOT_FOUND)
    return row


async def create(db: AsyncSession, tenant_id: str, payload: dict[str, Any], *, actor: Actor | None = None) -> Faq:
    row = Faq(tenant_id=tenant_id, question=str(payload.get("question", "")).strip())
    _apply(row, payload)
    db.add(row)
    await db.flush()
    await audit.log(db, actor, "create", "faq", row.id, {"question": row.question}, tenant_id=tenant_id)
    return row


async def update(
    db: AsyncSession,
    tenant_id: str,
    faq_id: str,
    payload: dict[str, Any],
    *,
    actor: Actor | None = None,
    expected_version: int | None = None,
) -> Faq:
    row = await get(db, tenant_id, faq_id)
    check_version(row, expected_version)
    before = {"question": row.question, "answer": row.answer, "active": row.active}
    _apply(row, payload)
    bump(row)
    await db.flush()
    after = {"question": row.question, "answer": row.answer, "active": row.active}
    await audit.log(db, actor, "update", "faq", row.id, audit.diff_of(before, after), tenant_id=tenant_id)
    return row


async def set_active(
    db: AsyncSession, tenant_id: str, faq_id: str, active: bool, *, actor: Actor | None = None
) -> Faq:
    row = await get(db, tenant_id, faq_id)
    row.active = active
    bump(row)
    await db.flush()
    await audit.log(db, actor, "update", "faq", row.id, {"active": {"to": active}}, tenant_id=tenant_id)
    return row


async def delete(db: AsyncSession, tenant_id: str, faq_id: str, *, actor: Actor | None = None) -> None:
    row = await get(db, tenant_id, faq_id)
    await db.delete(row)
    await audit.log(db, actor, "delete", "faq", faq_id, {"question": row.question}, tenant_id=tenant_id)
    await db.flush()


_FIELDS = ("code", "category", "question", "answer", "keywords", "priority", "active", "scheme_id", "source")


def _apply(row: Faq, payload: dict[str, Any]) -> None:
    for name in _FIELDS:
        if name not in payload:
            continue
        value = payload[name]
        if name == "keywords":
            value = [str(k).strip() for k in (value or []) if str(k).strip()]
        if name == "priority":
            value = int(value or 0)
        setattr(row, name, value)
