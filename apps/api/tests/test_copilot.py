"""內容助理 (a)(b)(c)：草稿、FAQ 建議、方案文案集（SPEC §8.6 / §9.6 / P5）。

這一整份測試在守一條紅線：**助理只寫 draft**。每一支端點跑完之後，
`contents.content` 與 `faqs.active` 都必須跟呼叫前一模一樣——發布與啟用是人的動作
（決策 D8）。其餘的測試在守 SPEC §11 的外送資料清單：送出去的句子必須已經去識別化。

`LLM_PROVIDER=fake`（conftest 設定），所以這裡的每一次「模型呼叫」都是
`app/ai/fake.py` 裡那份決定性的替身，斷言的是內容而不是「有回東西」。
"""

from __future__ import annotations

import pytest
from app.ai import copilot as ai_copilot
from app.models import AuditLog, Content, CopilotSuggestion, Faq, LlmUsage, RejectionCode, UnmatchedMessage
from app.services import copilot as copilot_service
from sqlalchemy import select

COPILOT = "/api/admin/copilot"
NON_ADMIN_ROLES = ["viewer", "sop_editor", "sop_reviewer", "case_reviewer", "case_supervisor"]


@pytest.fixture
def usage_db(db, monkeypatch):
    """覆蓋全域的記憶體 usage 替身，讓這三個測試驗證資料庫寫入形狀。"""
    from app.ai import llm

    async def record(task, model, usage, latency_ms, tenant_id, ref_type="", ref_id=""):
        values = llm.usage_record(task, model, usage, latency_ms)
        db.add(LlmUsage(tenant_id=tenant_id, ref_type=ref_type, ref_id=ref_id, **values))
        await db.commit()
        return values

    monkeypatch.setattr(llm, "record_usage", record)
    return db


@pytest.fixture
async def unmatched(db, tenant):
    """三群語意不同的未命中訊息，加上一句夾帶個資的。"""
    texts = [
        "補助什麼時候撥款", "補助的錢什麼時候會撥下來", "請問撥款時間",
        "要準備哪些文件", "文件要準備什麼",
        "我可以申請第二次嗎",
    ]
    rows = [
        UnmatchedMessage(tenant_id=tenant.id, line_user_id_hash="abc123", text=text,
                         intent_result={"intent": "unknown", "confidence": 0.2})
        for text in texts
    ]
    db.add_all(rows)
    await db.commit()
    return rows


@pytest.fixture
async def rejection_codes(db, scheme):
    rows = [
        RejectionCode(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="DOC_MISSING",
                      staff_label="缺件", public_what_wrong="少了一份文件", sort_order=1),
        RejectionCode(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="OVER_MASKED",
                      staff_label="遮太多", public_what_wrong="遮到了要看的欄位", sort_order=2),
        RejectionCode(tenant_id=scheme.tenant_id, scheme_id=scheme.id, code="RETIRED",
                      staff_label="停用中", active=False, sort_order=3),
    ]
    db.add_all(rows)
    await db.commit()
    await db.refresh(scheme)
    return rows


async def audit_actions(db) -> list[str]:
    return [r.action for r in (await db.execute(select(AuditLog))).scalars()]


# ==================================================== 去識別化（SPEC §11）

@pytest.mark.parametrize(("raw", "expected"), [
    ("我是 Ud41d8cd98f00b204e9800998ecf8427e 請幫我查", "[LINE帳號]"),
    ("我的電話 0912345678 麻煩回電", "[電話]"),
    ("身分證 A123456789 要遮嗎", "[身分證]"),
    ("案號 HC-2026-000123 到哪了", "[案號]"),
    ("寄到 ming@example.gov.tw 好嗎", "[Email]"),
])
def test_outbound_text_is_scrubbed_before_it_leaves_the_machine(raw, expected):
    out = copilot_service.scrub(raw)
    assert expected in out


def test_scrubbing_keeps_the_question_readable():
    """去識別化不是把整句砍掉——承辦人員還要看得懂民眾在問什麼。"""
    assert copilot_service.scrub("我的電話 0912345678 什麼時候撥款") == "我的電話 [電話] 什麼時候撥款"


def test_a_sentence_with_no_pii_is_untouched():
    assert copilot_service.scrub("補助什麼時候撥款") == "補助什麼時候撥款"


# ======================================================== 聚類（SPEC §8.6 b）

def test_cosine_of_a_vector_with_itself_is_one():
    assert ai_copilot.cosine([1.0, 0.0, 1.0], [1.0, 0.0, 1.0]) == pytest.approx(1.0)


def test_cosine_of_orthogonal_vectors_is_zero():
    assert ai_copilot.cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_of_mismatched_lengths_is_zero():
    assert ai_copilot.cosine([1.0, 0.0], [1.0]) == 0.0


def test_cosine_of_a_zero_vector_is_zero():
    assert ai_copilot.cosine([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_clustering_puts_identical_vectors_together():
    groups = ai_copilot.cluster_texts([[1.0, 0.0], [1.0, 0.0], [0.0, 1.0]])
    assert [len(g) for g in groups] == [2, 1]
    assert groups[0] == [0, 1]


def test_clustering_keeps_unrelated_vectors_apart():
    groups = ai_copilot.cluster_texts([[1.0, 0.0], [0.0, 1.0], [0.0, -1.0]])
    assert len(groups) == 3


def test_clusters_come_back_largest_first():
    groups = ai_copilot.cluster_texts([[1.0, 0.0], [0.0, 1.0], [0.0, 1.0], [0.0, 1.0]])
    assert [len(g) for g in groups] == [3, 1]


def test_clustering_nothing_gives_nothing():
    assert ai_copilot.cluster_texts([]) == []


async def test_similar_questions_land_in_the_same_cluster():
    """fake provider 的 bigram embedding 也分得出「撥款」與「文件」是兩件事。"""
    texts = ["補助什麼時候撥款", "補助的錢什麼時候會撥下來", "請問撥款時間",
             "要準備哪些文件", "文件要準備什麼", "我可以申請第二次嗎"]
    groups = ai_copilot.cluster_texts(await ai_copilot.embed_all(texts))
    assert [0, 1] in groups          # 兩句在問撥款
    assert [3, 4] in groups          # 兩句在問文件
    assert [5] in groups             # 自成一群


async def test_the_threshold_is_calibrated_on_the_batch_itself():
    """門檻算出來就落在下限與上限之間；fake 與真的 embedding 刻度差很多（見模組說明）。"""
    texts = ["補助什麼時候撥款", "補助的錢什麼時候會撥下來", "要準備哪些文件", "文件要準備什麼"]
    cut = ai_copilot.adaptive_threshold(await ai_copilot.embed_all(texts))
    assert ai_copilot.CLUSTER_FLOOR <= cut <= ai_copilot.CLUSTER_CEILING


def test_too_few_pairs_fall_back_to_the_floor():
    """兩句話沒有分布可言，寧可分成兩群讓人自己合併。"""
    assert ai_copilot.adaptive_threshold([[1.0, 0.0], [0.0, 1.0]]) == ai_copilot.CLUSTER_FLOOR


# ==================================================== 句子與引用的組裝

class _S:
    def __init__(self, text, citation_index=None):
        self.text = text
        self.citation_index = citation_index


def test_a_sentence_without_a_citation_is_marked_unverified():
    assert copilot_service.compose([_S("這句沒有依據")], []) == "這句沒有依據（待查證）"


def test_a_cited_sentence_stands_on_its_own():
    assert copilot_service.compose([_S("這句有依據", 0)], ["x"]) == "這句有依據"


def test_a_citation_index_pointing_nowhere_counts_as_no_citation():
    assert copilot_service.compose([_S("越界", 5)], ["x"]) == "越界（待查證）"


def test_blank_sentences_are_dropped():
    assert copilot_service.compose([_S("  "), _S("留下來", 0)], ["x"]) == "留下來"


# ================================================ (a) 罐頭訊息草稿

async def test_drafting_a_content_writes_the_draft_and_nothing_else(client, auth_headers, db, tenant):
    r = await client.post(f"{COPILOT}/contents/home.welcome/draft", json={}, headers=auth_headers("admin"))
    assert r.status_code == 200, r.text
    row = (await db.execute(select(Content).where(Content.key == "home.welcome"))).scalar_one()
    assert row.draft and row.draft == r.json()["draft"]


async def test_the_copilot_never_touches_the_published_text(client, auth_headers, db, tenant):
    """紅線：助理寫 draft，`content` 與 `published_at` 一個字都不能動（決策 D8）。"""
    before = (await client.get("/api/admin/contents/home.welcome", headers=auth_headers("admin"))).json()
    await client.post(f"{COPILOT}/contents/home.welcome/draft", json={}, headers=auth_headers("admin"))
    row = (await db.execute(select(Content).where(Content.key == "home.welcome"))).scalar_one()
    assert row.content == before["content"]
    assert row.published_at is None


async def test_the_draft_comes_back_with_citations(client, auth_headers, tenant):
    body = (await client.post(f"{COPILOT}/contents/home.welcome/draft", json={},
                              headers=auth_headers("admin"))).json()
    assert body["citations"], body
    assert body["citations"][0]["source_type"] == "content"
    assert body["citations"][0]["source_id"] == "home.welcome"


async def test_the_instruction_reaches_the_draft(client, auth_headers, tenant):
    body = (await client.post(f"{COPILOT}/contents/home.welcome/draft",
                              json={"instruction": "再短一點"}, headers=auth_headers("admin"))).json()
    assert "再短一點" in body["draft"]


async def test_the_tone_reaches_the_draft(client, auth_headers, tenant):
    body = (await client.post(f"{COPILOT}/contents/home.welcome/draft",
                              json={"tone": "親切"}, headers=auth_headers("admin"))).json()
    assert "親切" in body["draft"]


async def test_declared_variables_are_used_in_the_draft(client, auth_headers, tenant, db):
    """宣告了變數卻不用，民眾就會看到一句缺資訊的話。"""
    key = "case.progress"
    row = (await db.execute(select(Content).where(Content.key == key))).scalar_one_or_none()
    variables = list(row.variables) if row else []
    body = (await client.post(f"{COPILOT}/contents/{key}/draft", json={},
                              headers=auth_headers("admin"))).json()
    for name in variables:
        assert f"{{{{{name}}}}}" in body["draft"], name


async def test_a_sentence_the_model_could_not_source_is_marked(client, auth_headers, tenant):
    body = (await client.post(f"{COPILOT}/contents/home.welcome/draft",
                              json={"tone": "親切"}, headers=auth_headers("admin"))).json()
    assert copilot_service.UNVERIFIED_SUFFIX in body["draft"]


async def test_drafting_an_unknown_key_is_a_404(client, auth_headers, tenant):
    r = await client.post(f"{COPILOT}/contents/not.a.real.key/draft", json={}, headers=auth_headers("admin"))
    assert r.status_code == 404


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
async def test_drafting_needs_the_admin_capability(client, auth_headers, role, tenant):
    r = await client.post(f"{COPILOT}/contents/home.welcome/draft", json={}, headers=auth_headers(role))
    assert r.status_code == 403


async def test_drafting_writes_an_audit_row(client, auth_headers, db, tenant):
    await client.post(f"{COPILOT}/contents/home.welcome/draft", json={}, headers=auth_headers("admin"))
    assert "copilot.content" in await audit_actions(db)


async def test_drafting_records_llm_usage(client, auth_headers, usage_db, tenant):
    await client.post(f"{COPILOT}/contents/home.welcome/draft", json={}, headers=auth_headers("admin"))
    rows = (await usage_db.execute(select(LlmUsage))).scalars().all()
    assert [r.task for r in rows] == ["copilot_content"]


# ==================================================== (b) FAQ 建議

async def test_generating_suggestions_groups_the_unmatched_messages(client, auth_headers, unmatched, tenant):
    body = (await client.post(f"{COPILOT}/faq-suggestions", json={}, headers=auth_headers("admin"))).json()
    assert body["items"]
    assert max(item["cluster_size"] for item in body["items"]) >= 2


async def test_a_suggestion_carries_the_masked_samples(client, auth_headers, db, tenant):
    db.add(UnmatchedMessage(tenant_id=tenant.id, text="我的電話 0912345678 什麼時候撥款"))
    await db.commit()
    body = (await client.post(f"{COPILOT}/faq-suggestions", json={}, headers=auth_headers("admin"))).json()
    samples = [s for item in body["items"] for s in item["sample_messages_masked"]]
    assert samples and all("0912345678" not in s for s in samples)
    assert any("[電話]" in s for s in samples)


async def test_a_suggestion_has_a_question_and_an_answer_draft(client, auth_headers, unmatched, tenant):
    item = (await client.post(f"{COPILOT}/faq-suggestions", json={},
                              headers=auth_headers("admin"))).json()["items"][0]
    assert item["question"].strip()
    assert item["answer_draft"].strip()
    assert isinstance(item["citations"], list)


async def test_a_suggestion_marks_the_sentences_it_could_not_source(client, auth_headers, unmatched, tenant):
    item = (await client.post(f"{COPILOT}/faq-suggestions", json={},
                              headers=auth_headers("admin"))).json()["items"][0]
    assert copilot_service.UNVERIFIED_SUFFIX in item["answer_draft"]


async def test_generating_twice_replaces_the_pending_batch(client, auth_headers, db, unmatched, tenant):
    first = (await client.post(f"{COPILOT}/faq-suggestions", json={}, headers=auth_headers("admin"))).json()
    second = (await client.post(f"{COPILOT}/faq-suggestions", json={}, headers=auth_headers("admin"))).json()
    rows = (await db.execute(select(CopilotSuggestion))).scalars().all()
    assert len(rows) == len(second["items"])
    assert {i["id"] for i in first["items"]} & {i["id"] for i in second["items"]} == set()


async def test_no_unmatched_messages_means_no_suggestions(client, auth_headers, tenant, db):
    body = (await client.post(f"{COPILOT}/faq-suggestions", json={}, headers=auth_headers("admin"))).json()
    assert body["items"] == []
    assert "copilot.faq_suggestions" in await audit_actions(db)


async def test_the_limit_caps_how_many_clusters_come_back(client, auth_headers, unmatched, tenant):
    body = (await client.post(f"{COPILOT}/faq-suggestions", json={"limit": 1},
                              headers=auth_headers("admin"))).json()
    assert len(body["items"]) == 1


async def test_pending_suggestions_are_listable(client, auth_headers, unmatched, tenant):
    made = (await client.post(f"{COPILOT}/faq-suggestions", json={}, headers=auth_headers("admin"))).json()
    listed = (await client.get(f"{COPILOT}/faq-suggestions", headers=auth_headers("admin"))).json()
    assert {i["id"] for i in listed["items"]} == {i["id"] for i in made["items"]}


async def test_generating_suggestions_writes_an_audit_row(client, auth_headers, db, unmatched, tenant):
    await client.post(f"{COPILOT}/faq-suggestions", json={}, headers=auth_headers("admin"))
    assert "copilot.faq_suggestions" in await audit_actions(db)


async def test_generating_suggestions_records_llm_usage(client, auth_headers, usage_db, unmatched, tenant):
    await client.post(f"{COPILOT}/faq-suggestions", json={}, headers=auth_headers("admin"))
    rows = (await usage_db.execute(select(LlmUsage))).scalars().all()
    assert rows and {r.task for r in rows} == {"copilot_faq"}


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
async def test_generating_suggestions_needs_the_admin_capability(client, auth_headers, role, tenant):
    r = await client.post(f"{COPILOT}/faq-suggestions", json={}, headers=auth_headers(role))
    assert r.status_code == 403


async def test_accepting_a_suggestion_creates_an_inactive_faq(client, auth_headers, db, unmatched, tenant):
    item = (await client.post(f"{COPILOT}/faq-suggestions", json={},
                              headers=auth_headers("admin"))).json()["items"][0]
    r = await client.post(f"{COPILOT}/faq-suggestions/{item['id']}/accept", headers=auth_headers("admin"))
    assert r.status_code == 201, r.text
    row = (await db.execute(select(Faq))).scalars().one()
    assert row.active is False
    assert row.source == "copilot"
    assert row.question == item["question"]


async def test_accepting_marks_the_suggestion_and_remembers_the_faq(client, auth_headers, db, unmatched, tenant):
    item = (await client.post(f"{COPILOT}/faq-suggestions", json={},
                              headers=auth_headers("admin"))).json()["items"][0]
    created = (await client.post(f"{COPILOT}/faq-suggestions/{item['id']}/accept",
                                 headers=auth_headers("admin"))).json()
    row = await db.get(CopilotSuggestion, item["id"])
    await db.refresh(row)
    assert row.status == "accepted"
    assert row.target_id == created["id"]


async def test_accepting_the_same_suggestion_twice_is_a_409(client, auth_headers, unmatched, tenant):
    item = (await client.post(f"{COPILOT}/faq-suggestions", json={},
                              headers=auth_headers("admin"))).json()["items"][0]
    await client.post(f"{COPILOT}/faq-suggestions/{item['id']}/accept", headers=auth_headers("admin"))
    again = await client.post(f"{COPILOT}/faq-suggestions/{item['id']}/accept", headers=auth_headers("admin"))
    assert again.status_code == 409


async def test_accepting_an_unknown_suggestion_is_a_404(client, auth_headers, tenant):
    r = await client.post(f"{COPILOT}/faq-suggestions/nope/accept", headers=auth_headers("admin"))
    assert r.status_code == 404


async def test_accepting_writes_an_audit_row(client, auth_headers, db, unmatched, tenant):
    item = (await client.post(f"{COPILOT}/faq-suggestions", json={},
                              headers=auth_headers("admin"))).json()["items"][0]
    await client.post(f"{COPILOT}/faq-suggestions/{item['id']}/accept", headers=auth_headers("admin"))
    assert "copilot.faq_accept" in await audit_actions(db)


async def test_dismissing_a_suggestion_takes_it_off_the_pending_list(client, auth_headers, unmatched, tenant):
    item = (await client.post(f"{COPILOT}/faq-suggestions", json={},
                              headers=auth_headers("admin"))).json()["items"][0]
    await client.post(f"{COPILOT}/faq-suggestions/{item['id']}/dismiss", headers=auth_headers("admin"))
    listed = (await client.get(f"{COPILOT}/faq-suggestions", headers=auth_headers("admin"))).json()
    assert item["id"] not in {i["id"] for i in listed["items"]}


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
async def test_accepting_needs_the_admin_capability(client, auth_headers, role, tenant):
    r = await client.post(f"{COPILOT}/faq-suggestions/x/accept", headers=auth_headers(role))
    assert r.status_code == 403


# ==================================================== (c) 方案文案集

async def test_scheme_drafts_cover_every_status(client, auth_headers, scheme, tenant):
    from app.models import STATUSES

    body = (await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts",
                              headers=auth_headers("admin"))).json()
    keys = {d["key"] for d in body["drafts"]}
    for status in STATUSES:
        for suffix in ("public_label", "next_action", "notify_headline"):
            assert f"scheme.{scheme.code}.status.{status}.{suffix}" in keys


async def test_scheme_drafts_cover_the_active_rejection_codes(client, auth_headers, scheme,
                                                              rejection_codes, tenant):
    body = (await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts",
                              headers=auth_headers("admin"))).json()
    keys = {d["key"] for d in body["drafts"]}
    assert f"scheme.{scheme.code}.rejection.DOC_MISSING.public_what_wrong" in keys
    assert f"scheme.{scheme.code}.rejection.DOC_MISSING.public_how_to_fix" in keys
    assert not any("RETIRED" in k for k in keys)        # 停用的退件碼不必再寫文案


async def test_scheme_drafts_cover_every_document_type(client, auth_headers, scheme, tenant):
    body = (await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts",
                              headers=auth_headers("admin"))).json()
    keys = {d["key"] for d in body["drafts"]}
    assert f"scheme.{scheme.code}.guide.ID_CARD_FRONT" in keys
    assert f"scheme.{scheme.code}.guide.BILLING_STATEMENT" in keys


async def test_scheme_content_keys_carry_the_scheme_prefix(scheme):
    """決策 D30：`contents` 的自然鍵是 (tenant_id, key)，全域那一份已經佔了名字。"""
    assert copilot_service.scheme_content_key("HC115", "status.APPROVED.public_label") == \
        "scheme.HC115.status.APPROVED.public_label"


async def test_scheme_draft_rows_point_back_at_the_scheme(client, auth_headers, db, scheme, tenant):
    await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts", headers=auth_headers("admin"))
    rows = (
        await db.execute(select(Content).where(Content.key.like(f"scheme.{scheme.code}.%")))
    ).scalars().all()
    assert rows
    assert all(r.scheme_id == scheme.id for r in rows)
    assert all(r.category == "scheme" for r in rows)


async def test_scheme_drafts_are_drafts_and_nothing_is_published(client, auth_headers, db, scheme, tenant):
    """紅線：助理產出的方案文案一樣只寫 draft。"""
    await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts", headers=auth_headers("admin"))
    rows = (
        await db.execute(select(Content).where(Content.key.like(f"scheme.{scheme.code}.%")))
    ).scalars().all()
    assert all(r.draft for r in rows)
    assert all(r.content == "" for r in rows)
    assert all(r.published_at is None for r in rows)


async def test_scheme_drafts_carry_citations_to_the_scheme(client, auth_headers, scheme, tenant):
    body = (await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts",
                              headers=auth_headers("admin"))).json()
    first = body["drafts"][0]
    assert first["citations"]
    assert first["citations"][0]["source_type"] == "scheme"
    assert first["citations"][0]["source_id"] == scheme.code


async def test_scheme_drafts_report_how_many_were_asked_for(client, auth_headers, scheme, tenant):
    body = (await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts",
                              headers=auth_headers("admin"))).json()
    assert body["requested"] == len(body["drafts"])
    assert body["scheme_code"] == scheme.code


async def test_a_key_the_model_invented_is_dropped(client, auth_headers, db, scheme, tenant, monkeypatch):
    """清單是呼叫端給的，模型不能往裡面加東西。"""
    from app.ai.schemas import DraftSentence, SchemeCopyItem, SchemeCopySet

    async def fake_write(**kwargs):
        return SchemeCopySet(items=[SchemeCopyItem(key="scheme.EVIL.anything",
                                                   sentences=[DraftSentence(text="哈")])]), {}

    monkeypatch.setattr("app.services.copilot.ai_copilot.write_scheme_copy", fake_write)
    body = (await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts",
                              headers=auth_headers("admin"))).json()
    assert body["drafts"] == []
    assert (await db.execute(select(Content).where(Content.key == "scheme.EVIL.anything"))).scalar_one_or_none() is None


async def test_scheme_drafts_for_an_unknown_scheme_are_a_404(client, auth_headers, tenant):
    r = await client.post(f"{COPILOT}/schemes/NOPE/drafts", headers=auth_headers("admin"))
    assert r.status_code == 404


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
async def test_scheme_drafts_need_the_admin_capability(client, auth_headers, role, scheme, tenant):
    r = await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts", headers=auth_headers(role))
    assert r.status_code == 403


async def test_scheme_drafts_write_an_audit_row(client, auth_headers, db, scheme, tenant):
    await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts", headers=auth_headers("admin"))
    assert "copilot.scheme_drafts" in await audit_actions(db)


async def test_scheme_drafts_record_llm_usage(client, auth_headers, usage_db, scheme, tenant):
    await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts", headers=auth_headers("admin"))
    rows = (await usage_db.execute(select(LlmUsage))).scalars().all()
    assert [r.task for r in rows] == ["copilot_scheme"]


async def test_running_the_scheme_copilot_twice_keeps_one_row_per_key(client, auth_headers, db, scheme, tenant):
    """重跑只會換掉草稿，不會在 `contents` 上長出第二列同名的 key。"""
    await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts", headers=auth_headers("admin"))
    await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts", headers=auth_headers("admin"))
    key = f"scheme.{scheme.code}.guide.ID_CARD_FRONT"
    rows = (await db.execute(select(Content).where(Content.key == key))).scalars().all()
    assert len(rows) == 1


async def test_a_scheme_draft_can_then_be_published_by_a_human(client, auth_headers, db, scheme, tenant):
    """助理寫草稿，人按發布——走的是既有的 `/api/admin/contents/{key}/publish`。"""
    await client.post(f"{COPILOT}/schemes/{scheme.code}/drafts", headers=auth_headers("admin"))
    key = f"scheme.{scheme.code}.guide.ID_CARD_FRONT"
    r = await client.post(f"/api/admin/contents/{key}/publish", json={}, headers=auth_headers("admin"))
    assert r.status_code == 200, r.text
    row = (await db.execute(select(Content).where(Content.key == key))).scalar_one()
    assert row.content.strip()
    assert row.draft is None
