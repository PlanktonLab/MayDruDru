"""常見問題的查詢（SPEC §8.1 `/help`、§10.1 FAQ）。

P3 只做關鍵字比對：問題、答案與 `keywords` 三個欄位任一命中就算。語意搜尋（embedding）
在 P4 接上，屆時這支函式多一條路徑，呼叫端不必改。

比對刻意在 Python 端做而不是 SQL：`keywords` 是 JSON 欄位，SQLite 與 Postgres 對它
的文字化結果不同（前者會把中文轉成 `\\uXXXX`），在資料庫裡比會在兩種引擎上得到
不同答案。FAQ 是一張小表，讀出來再比反而是最可預期的作法。
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Faq, Scheme

__all__ = ["MAX_RESULTS", "matches", "search"]

MAX_RESULTS = 50
_SCAN_LIMIT = 500


def matches(faq: Faq, needle: str) -> bool:
    """問題、答案或任一關鍵字含有這段文字（不分大小寫）。"""
    low = needle.lower()
    if low in (faq.question or "").lower() or low in (faq.answer or "").lower():
        return True
    return any(low in str(k).lower() for k in (faq.keywords or []))


async def search(
    db: AsyncSession,
    tenant_id: str,
    *,
    q: str = "",
    scheme_code: str = "",
    limit: int = MAX_RESULTS,
) -> list[Faq]:
    """依優先度排序的 FAQ。指定方案時同時回通用題目（`scheme_id` 為空的那些）。"""
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
