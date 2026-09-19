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

`search()` 是 P4 換成 embedding 檢索的接縫：介面不變，內部先走關鍵字，
向量欄位已經在資料表上（`faqs.embedding`），但這一階段不做任何模型呼叫。
"""

from __future__ import annotations

from collections.abc import Sequence
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
    "FaqMatch",
    "best",
    "browse",
    "categories",
    "create",
    "delete",
    "get",
    "list_faqs",
    "matches",
    "score",
    "search",
    "set_active",
    "update",
]

FAQ_NOT_FOUND = "找不到這則常見問題"
MIN_SCORE = 2
LONG_KEYWORD = 3
MAX_RESULTS = 50
_SCAN_LIMIT = 500


@dataclass(frozen=True)
class FaqMatch:
    faq: Faq
    score: int


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


async def search(db: AsyncSession, tenant_id: str, q: str, *, limit: int = 3) -> list[FaqMatch]:
    """依分數排序的命中。P4 會在這裡先試向量檢索，失敗才落回關鍵字。"""
    if not (q or "").strip():
        return []
    rows = (
        await db.execute(select(Faq).where(Faq.tenant_id == tenant_id, Faq.active.is_(True)))
    ).scalars().all()
    scored = [FaqMatch(faq=row, score=score(row, q)) for row in rows]
    hits = sorted((m for m in scored if m.score >= MIN_SCORE), key=lambda m: m.score, reverse=True)
    return hits[:limit]


async def best(db: AsyncSession, tenant_id: str, q: str) -> Faq | None:
    hits = await search(db, tenant_id, q, limit=1)
    return hits[0].faq if hits else None


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
