"""FAQ 的語意檢索與關鍵字退路（SPEC §9.7、決策 D27、D29）。

測試庫是 SQLite，pgvector 的 `<=>` 在上面跑不動，所以「向量這條路」用兩種方式驗：
不是 Postgres 時 `vector_search()` 一定回空（而 `search()` 照樣給得出答案），
以及把查詢換掉之後，`search()` 真的會先問向量、有命中就不再碰關鍵字。
"""

from __future__ import annotations

import pytest
from app.models import Faq
from app.services import faq as faq_service


async def make(db, tenant, question, answer, keywords, *, active=True, priority=0) -> Faq:
    row = Faq(tenant_id=tenant.id, question=question, answer=answer, keywords=keywords,
              active=active, priority=priority)
    db.add(row)
    await db.commit()
    return row


@pytest.fixture
async def faqs(db, tenant):
    return {
        "payment": await make(db, tenant, "撥款要多久", "核定後約兩週。", ["撥款", "多久"]),
        "documents": await make(db, tenant, "要準備哪些文件", "身分證與繳費證明。", ["文件", "準備"]),
        "inactive": await make(db, tenant, "已停用的題目", "看不到", ["停用"], active=False),
    }


# ------------------------------------------------------------------ 關鍵字

async def test_keyword_search_still_works_without_a_vector(db, tenant, faqs):
    hits = await faq_service.search(db, tenant.id, "撥款要多久")
    assert [h.faq.id for h in hits] == [faqs["payment"].id]
    assert hits[0].source == "keyword"


async def test_an_inactive_entry_never_comes_back(db, tenant, faqs):
    assert await faq_service.search(db, tenant.id, "停用") == []


async def test_a_question_nothing_matches_returns_nothing(db, tenant, faqs):
    assert await faq_service.search(db, tenant.id, "今天天氣如何") == []
    assert await faq_service.best(db, tenant.id, "今天天氣如何") is None


async def test_blank_queries_short_circuit(db, tenant, faqs):
    assert await faq_service.search(db, tenant.id, "") == []
    assert await faq_service.search(db, tenant.id, "   ") == []


async def test_priority_only_counts_once_something_matched(db, tenant):
    """無條件加優先權會讓每一題都跨過門檻，然後自信地答錯。"""
    high = await make(db, tenant, "很重要的題目", "答案", ["專屬關鍵字"], priority=50)
    assert faq_service.score(high, "完全無關的一句話") == 0
    assert faq_service.score(high, "這裡有專屬關鍵字") == 53


# ------------------------------------------------------------------ 向量

async def test_vector_search_is_a_no_op_on_sqlite(db, tenant, faqs):
    """不是 Postgres 就回空清單——那是「這條路走不通」，不是錯誤。"""
    assert await faq_service.vector_search(db, tenant.id, [0.1] * 8) == []
    assert await faq_service.vector_search(db, tenant.id, []) == []


async def test_search_falls_back_to_keywords_when_vectors_find_nothing(db, tenant, faqs):
    hits = await faq_service.search(db, tenant.id, "撥款要多久", vector=[0.1] * 8)
    assert [h.faq.id for h in hits] == [faqs["payment"].id]
    assert hits[0].source == "keyword"


async def test_a_vector_hit_short_circuits_the_keyword_pass(db, tenant, faqs, monkeypatch):
    async def fake_vector(db_, tenant_id, vector, *, limit=3):
        return [faq_service.FaqMatch(faq=faqs["documents"], score=91, source="vector")]

    monkeypatch.setattr(faq_service, "vector_search", fake_vector)
    hits = await faq_service.search(db, tenant.id, "撥款要多久", vector=[0.1] * 8)
    assert [h.faq.id for h in hits] == [faqs["documents"].id]
    assert hits[0].source == "vector" and hits[0].score == 91


async def test_a_broken_vector_query_is_treated_as_no_hits(db, tenant, faqs, monkeypatch):
    """欄位維度對不上、擴充沒裝——一律當成「走不通」，不是 500。"""
    monkeypatch.setattr(faq_service, "_is_postgres", lambda db_: True)
    hits = await faq_service.search(db, tenant.id, "撥款要多久", vector=[0.1] * 8)
    assert [h.faq.id for h in hits] == [faqs["payment"].id]


async def test_the_similarity_floor_drops_weak_matches(db, tenant, faqs, monkeypatch):
    """相似度低於門檻的命中不算數，否則「今天天氣如何」也會得到一個答案。"""
    monkeypatch.setattr(faq_service, "_is_postgres", lambda db_: True)

    class Row(list):
        pass

    async def execute(q):
        class Result:
            @staticmethod
            def all():
                return [(faqs["payment"], 0.9)]     # similarity 0.1，遠低於門檻
        return Result()

    monkeypatch.setattr(db, "execute", execute)
    assert await faq_service.vector_search(db, tenant.id, [0.1] * 8) == []


# ------------------------------------------------------------------ 批次重算

async def test_reembed_all_writes_a_vector_for_every_entry(db, tenant, faqs):
    from app.ai.llm import embed

    written = await faq_service.reembed_all(db, embed)
    await db.commit()
    assert written == 3        # 停用的題目也要有向量，承辦人隨時可能再啟用
    assert all(row.embedding is not None for row in faqs.values())


async def test_reembed_all_can_stick_to_the_missing_ones(db, tenant, faqs):
    from app.ai.llm import embed

    faqs["payment"].embedding = [0.0] * 1536
    await db.commit()
    assert await faq_service.reembed_all(db, embed, only_missing=True) == 2


async def test_reembed_all_can_be_scoped_to_one_tenant(db, tenant, faqs):
    from app.ai.llm import embed
    from app.models import Tenant

    other = Tenant(name="別的機關", slug="other")
    db.add(other)
    await db.flush()
    await make(db, other, "別人的題目", "答案", ["別人"])
    assert await faq_service.reembed_all(db, embed, tenant_id=tenant.id) == 3


async def test_one_broken_entry_does_not_stop_the_batch(db, tenant, faqs):
    seen: list[str] = []

    async def flaky(text: str) -> list[float]:
        seen.append(text)
        if "撥款" in text:
            raise RuntimeError("這一則算不出來")
        return [0.1] * 4

    assert await faq_service.reembed_all(db, flaky) == 2
    assert len(seen) == 3


async def test_an_empty_entry_is_skipped(db, tenant):
    await make(db, tenant, "", "", [])

    async def embedder(text: str) -> list[float]:
        raise AssertionError("空的條目不該去算向量")

    assert await faq_service.reembed_all(db, embedder) == 0


def test_the_embedded_text_covers_question_keywords_and_answer(db, tenant):
    row = Faq(tenant_id=tenant.id, question="撥款要多久", answer="核定後約兩週。", keywords=["撥款", "多久"])
    text = faq_service.embed_text(row)
    assert "撥款要多久" in text and "核定後約兩週。" in text and "多久" in text


def test_the_embedded_text_of_an_empty_row_is_blank():
    assert faq_service.embed_text(Faq(question="", answer="", keywords=[])).strip() == ""


# --------------------------------------------------------- 瀏覽那一面沒被動到

async def test_browse_is_still_a_plain_substring_filter(db, tenant, faqs):
    """D27：市民是在「翻」FAQ，門檻與分數只對「bot 要不要主動回答」有意義。"""
    rows = await faq_service.browse(db, tenant.id, q="文件")
    assert [r.id for r in rows] == [faqs["documents"].id]
    assert len(await faq_service.browse(db, tenant.id)) == 2
