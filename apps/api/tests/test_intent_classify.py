"""意圖分類：LLM 那一層、規則 fallback、以及 FAQ 候選（SPEC §9.1、§9.7、紅線 6）。

紅線 6 說的是「系統永不因為 LLM 失敗而無回應」，所以這一份測試有一半在**弄壞模型**：
逾時、丟例外、選清單外的東西、信心不足——每一種都要能落回規則，
再落回快速回覆選單。
"""

from __future__ import annotations

import asyncio

import pytest
from app.ai import intent as intent_module
from app.ai.intent import (
    FAQ_INTENT,
    IntentCandidate,
    classify,
    classify_rules,
    classify_session_rules,
)
from app.ai.schemas import IntentClassification
from app.models import Faq
from app.services import contents
from app.services.line import flex, handlers

USER = "Uintent00000000000000000000000001"

MENU = [
    IntentCandidate("case_status", "案件查詢"),
    IntentCandidate("my_cases", "我的案件"),
    IntentCandidate("scheme_info", "補助資訊"),
    IntentCandidate("contact", "聯絡我們"),
]


def patch_model(monkeypatch, result: IntentClassification | None = None, *, raises: Exception | None = None,
                delay: float = 0.0):
    """換掉 `structured_call`，讓測試決定模型這次回什麼（或壞成什麼樣）。"""
    calls: list[dict] = []

    async def fake(task, schema, system, text, images=None, **kwargs):
        calls.append({"task": task, "schema": schema, "text": text, "kwargs": kwargs})
        if delay:
            await asyncio.sleep(delay)
        if raises is not None:
            raise raises
        return result, {"task": task, "cost_usd": 0.0}

    monkeypatch.setattr(intent_module, "structured_call", fake)
    return calls


# ------------------------------------------------------------------ 規則層

def test_session_rules_cover_the_four_actions():
    assert classify_session_rules("下一步").intent == "sop_next"
    assert classify_session_rules("我卡住了").intent == "sop_stuck"
    assert classify_session_rules("換流程").intent == "sop_switch"
    assert classify_session_rules("結束").intent == "sop_exit"


def test_session_rules_say_unknown_for_small_talk():
    """單字「好」刻意不算「下一步」——一句閒聊不該把人往下一步推。"""
    for text in ("", "   ", "天氣真好", "謝謝你喔"):
        assert classify_session_rules(text).intent == "unknown"


def test_exit_beats_next_when_both_words_appear():
    assert classify_session_rules("好了，結束吧").intent == "sop_exit"


# ------------------------------------------------------------------ LLM 層

async def test_the_llm_pick_is_used_when_it_is_in_the_list_and_confident(db, tenant, monkeypatch):
    calls = patch_model(monkeypatch, IntentClassification(intent="contact", confidence=0.93))
    decision = await classify(db, tenant.id, "我想找人問", mode="idle", candidates=MENU)
    assert decision.intent == "contact" and decision.source == "llm"
    assert decision.confidence == pytest.approx(0.93)
    assert calls[0]["task"] == "intent" and "候選清單" in calls[0]["text"]


async def test_a_pick_outside_the_candidate_list_is_refused(db, tenant, monkeypatch):
    """模型自己發明一個意圖就等於沒有答案——落回規則。"""
    patch_model(monkeypatch, IntentClassification(intent="launch_missiles", confidence=0.99))
    decision = await classify(db, tenant.id, "聯絡你們", mode="idle", candidates=MENU)
    assert decision.intent == "contact" and decision.source == "rules"


async def test_low_confidence_falls_back_to_the_rules(db, tenant, monkeypatch):
    patch_model(monkeypatch, IntentClassification(intent="my_cases", confidence=0.2))
    decision = await classify(db, tenant.id, "聯絡你們", mode="idle", candidates=MENU)
    assert decision.intent == "contact" and decision.source == "rules"


async def test_low_confidence_with_nothing_the_rules_know_is_unknown(db, tenant, monkeypatch):
    patch_model(monkeypatch, IntentClassification(intent="my_cases", confidence=0.1))
    decision = await classify(db, tenant.id, "隨便打幾個字", mode="idle", candidates=MENU)
    assert decision.is_unknown and decision.source == "rules"


async def test_a_model_timeout_falls_back_to_the_rules(db, tenant, monkeypatch):
    patch_model(monkeypatch, IntentClassification(intent="my_cases", confidence=0.99), delay=0.5)
    decision = await classify(db, tenant.id, "聯絡你們", mode="idle", candidates=MENU, timeout=0.01)
    assert decision.intent == "contact" and decision.source == "rules"


async def test_a_model_exception_falls_back_to_the_rules(db, tenant, monkeypatch):
    patch_model(monkeypatch, raises=RuntimeError("模型掛了"))
    decision = await classify(db, tenant.id, "聯絡你們", mode="idle", candidates=MENU)
    assert decision.intent == "contact" and decision.source == "rules"


async def test_the_model_is_not_called_without_candidates(db, tenant, monkeypatch):
    calls = patch_model(monkeypatch, IntentClassification(intent="contact", confidence=0.9))
    decision = await classify(db, tenant.id, "聯絡你們", mode="sop_session", candidates=[])
    assert calls == []
    assert decision.is_unknown  # session 規則不認得「聯絡你們」


async def test_blank_text_never_reaches_the_model(db, tenant, monkeypatch):
    calls = patch_model(monkeypatch, IntentClassification(intent="contact", confidence=0.9))
    assert (await classify(db, tenant.id, "   ", mode="idle", candidates=MENU)).is_unknown
    assert calls == []


async def test_entities_come_back_whatever_decided(db, tenant, monkeypatch):
    patch_model(monkeypatch, raises=RuntimeError("x"))
    decision = await classify(db, tenant.id, "HC-2026-000123", mode="idle", candidates=MENU)
    assert decision.entities["case_no"] == "HC-2026-000123"
    assert decision.dict()["source"] == "rules"


async def test_session_mode_uses_the_session_rules(db, tenant, monkeypatch):
    patch_model(monkeypatch, raises=RuntimeError("x"))
    session_candidates = [IntentCandidate(a, a) for a in intent_module.SESSION_INTENTS]
    decision = await classify(db, tenant.id, "我卡住了", mode="sop_session", candidates=session_candidates)
    assert decision.intent == "sop_stuck" and decision.source == "rules"


async def test_the_fake_provider_is_deterministic(db, tenant):
    """離線供應商跑同一句話兩次要得到同一個答案，否則測試會時好時壞。"""
    first = await classify(db, tenant.id, "聯絡你們", mode="idle", candidates=MENU)
    second = await classify(db, tenant.id, "聯絡你們", mode="idle", candidates=MENU)
    assert first == second and first.intent == "contact"


async def test_usage_is_recorded_for_every_model_call(db, tenant, llm_usage):
    await classify(db, tenant.id, "聯絡你們", mode="idle", candidates=MENU)
    assert [row["task"] for row in llm_usage] == ["intent"]
    assert llm_usage[0]["tenant_id"] == tenant.id


# ------------------------------------------------------------------ FAQ 候選

async def _faq(db, tenant, question: str, answer: str, keywords: list[str]) -> Faq:
    row = Faq(tenant_id=tenant.id, question=question, answer=answer, keywords=keywords, active=True)
    db.add(row)
    await db.commit()
    return row


async def test_faq_candidates_are_offered_to_the_model_in_idle(db, tenant, monkeypatch):
    row = await _faq(db, tenant, "撥款要多久", "核定後約兩週。", ["撥款", "什麼時候"])
    calls = patch_model(monkeypatch, IntentClassification(intent=FAQ_INTENT, target_id=row.id, confidence=0.9))
    decision = await classify(db, tenant.id, "錢什麼時候下來", mode="idle", candidates=MENU)
    assert decision.intent == FAQ_INTENT and decision.target_id == row.id and decision.source == "llm"
    # FAQ 標題真的進了候選清單（模型看得到它才選得到）
    candidates_part = calls[0]["text"].split("民眾文字")[0]
    assert row.question in candidates_part and row.id in candidates_part


async def test_faq_candidates_are_not_offered_inside_a_session(db, tenant, monkeypatch):
    await _faq(db, tenant, "撥款要多久", "核定後約兩週。", ["撥款"])
    calls = patch_model(monkeypatch, IntentClassification(intent="unknown", confidence=0.0))
    await classify(db, tenant.id, "撥款要多久", mode="sop_session",
                   candidates=[IntentCandidate("sop_next", "下一步")])
    candidates_part = calls[0]["text"].split("民眾文字")[0]
    assert "撥款要多久" not in candidates_part


async def test_the_faq_fallback_kicks_in_when_both_layers_give_up(db, tenant, monkeypatch):
    row = await _faq(db, tenant, "撥款要多久", "核定後約兩週。", ["撥款", "撥款要多久"])
    patch_model(monkeypatch, raises=RuntimeError("x"))
    decision = await classify(db, tenant.id, "請問撥款要多久呢", mode="idle", candidates=MENU)
    assert decision.intent == FAQ_INTENT and decision.target_id == row.id and decision.source == "faq"


async def test_a_broken_faq_lookup_never_breaks_the_classifier(db, tenant, monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("faq 查詢掛了")

    monkeypatch.setattr(intent_module, "faq_candidates", boom)
    patch_model(monkeypatch, raises=RuntimeError("x"))
    decision = await classify(db, tenant.id, "聯絡你們", mode="idle", candidates=MENU)
    assert decision.intent == "contact" and decision.source == "rules"


async def test_a_broken_embedder_still_returns_keyword_candidates(db, tenant, monkeypatch):
    row = await _faq(db, tenant, "撥款要多久", "核定後約兩週。", ["撥款"])

    async def boom(text: str):
        raise RuntimeError("沒有金鑰")

    monkeypatch.setattr(intent_module, "embed", boom)
    found = await intent_module.faq_candidates(db, tenant.id, "撥款")
    assert [c.target_id for c in found] == [row.id]
    assert found[0].hint == "keyword"


# ------------------------------------------------------- 接到 LINE handler 上

def _event(text: str):
    return {"type": "message", "source": {"userId": USER}, "replyToken": "rt",
            "message": {"type": "text", "text": text}}


async def test_idle_text_goes_through_the_classifier_and_reaches_the_action(db, tenant, scheme, monkeypatch):
    patch_model(monkeypatch, IntentClassification(intent="contact", confidence=0.95))
    messages = await handlers.build_event_reply(db, tenant.id, _event("有人在嗎"))
    await db.commit()
    body = "\n".join(m.get("text", "") for m in messages)
    assert await contents.t(db, tenant.id, "contact.title") in body


async def test_an_faq_pick_answers_with_that_entry(db, tenant, scheme, monkeypatch):
    row = await _faq(db, tenant, "撥款要多久", "核定後約兩週。", ["撥款", "什麼時候"])
    patch_model(monkeypatch, IntentClassification(intent=FAQ_INTENT, target_id=row.id, confidence=0.9))
    messages = await handlers.build_event_reply(db, tenant.id, _event("錢什麼時候下來"))
    await db.commit()
    assert "核定後約兩週。" in messages[0]["text"]


async def test_an_faq_pick_that_no_longer_exists_falls_through(db, tenant, scheme, monkeypatch):
    patch_model(monkeypatch, IntentClassification(intent=FAQ_INTENT, target_id="gone", confidence=0.9))
    messages = await handlers.build_event_reply(db, tenant.id, _event("完全無關的一句話"))
    await db.commit()
    assert messages[0]["text"] == await contents.t(db, tenant.id, "home.unknown")


async def test_an_unknown_intent_offers_the_quick_reply_menu(db, tenant, scheme, monkeypatch):
    """紅線 6 的最後一段：兩層都認不出來，就給選單，不是沉默。"""
    patch_model(monkeypatch, raises=RuntimeError("模型掛了"))
    messages = await handlers.build_event_reply(db, tenant.id, _event("我想問一件完全無關的事情"))
    await db.commit()
    assert messages[0]["text"] == await contents.t(db, tenant.id, "home.unknown")
    labels = [i["action"]["label"] for i in messages[0]["quickReply"]["items"]]
    assert len(labels) == len(flex.MAIN_MENU)


async def test_the_unmatched_row_records_which_layer_gave_up(db, tenant, scheme, monkeypatch):
    from app.models import UnmatchedMessage
    from sqlalchemy import select

    patch_model(monkeypatch, raises=RuntimeError("模型掛了"))
    await handlers.build_event_reply(db, tenant.id, _event("我想問一件完全無關的事情"))
    await db.commit()
    row = (await db.execute(select(UnmatchedMessage))).scalars().one()
    assert row.intent_result["intent"] == "unknown" and row.intent_result["source"] == "rules"
    assert USER not in row.line_user_id_hash


async def test_the_idle_candidates_are_built_from_content_keys(db, tenant, scheme):
    found = await handlers._idle_candidates(db, tenant.id)
    by_intent = {c.intent: c.label for c in found}
    assert by_intent["case_status"] == await contents.t(db, tenant.id, "button.case_status")
    assert by_intent["contact"] == await contents.t(db, tenant.id, "button.contact")
    assert all(c.label.strip() for c in found)


def test_the_rules_table_and_the_action_table_agree():
    """文字與按鈕走同一張表；規則吐出來的意圖必須真的有人接。"""
    known = set(handlers.ACTIONS) | {"unknown", "faq"}
    assert {intent for intent, _, _ in intent_module.RULES} <= known
    assert set(intent_module.SESSION_INTENTS) <= set(handlers.ACTIONS)


def test_classify_rules_is_untouched_by_the_new_layer():
    assert classify_rules("我的案件到哪了").intent == "case_status"
    assert classify_rules("").intent == "unknown"
