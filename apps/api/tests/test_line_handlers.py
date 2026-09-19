"""LINE 事件路由（SPEC §8.4）。

每個 postback action 一個測試（SPEC §14 的要求），再加上文字路由、案件查詢兩段式
驗證、深連結、圖片與未命中訊息。

回覆一律用 content key 對照，不寫死句子——文案改了測試不該紅，但「這句話是從哪個
key 來的」改了就該紅。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.content_registry import get_default
from app.models import CaseVerification, LineUser, UnmatchedMessage
from app.services import contents
from app.services.line import conversation, flex, handlers
from sqlalchemy import select

from tests.test_state_machine import drive, make_case

USER = "Uline0000000000000000000000000001"


def event(kind: str, **payload):
    base = {"type": kind, "source": {"type": "user", "userId": USER}, "replyToken": "reply-token"}
    base.update(payload)
    return base


def postback_event(action: str, **params):
    return event("postback", postback={"data": flex.postback(action, **params)})


def text_event(text: str):
    return event("message", message={"type": "text", "text": text})


def texts(messages) -> str:
    return "\n".join(m.get("text", "") for m in messages if m.get("type") == "text")


def quick_labels(message) -> list[str]:
    return [i["action"]["label"] for i in (message.get("quickReply") or {}).get("items", [])]


def quick_actions(message) -> list[str]:
    return [i["action"]["data"] for i in (message.get("quickReply") or {}).get("items", [])]


async def reply(db, tenant, evt, **kw):
    messages = await handlers.build_event_reply(db, tenant.id, evt, **kw)
    await db.commit()
    return messages


async def say(db, tenant, key, **variables) -> str:
    return await contents.tf(db, tenant.id, key, **variables)


async def verified_case(db, tenant, scheme):
    """一件已經和這個 LINE 使用者綁定的案子。"""
    app = await make_case(db, tenant, scheme)
    db.add(CaseVerification(tenant_id=tenant.id, application_id=app.id, line_user_id=USER))
    await db.commit()
    return app


# ------------------------------------------------------------------ 基本事件

async def test_an_event_without_a_user_id_is_ignored(db, tenant):
    assert await handlers.build_event_reply(db, tenant.id, {"type": "follow", "source": {}}) == []


async def test_follow_welcomes_and_warns_about_screenshots(db, tenant):
    messages = await reply(db, tenant, event("follow"))
    assert texts(messages).startswith(get_default("home.welcome")[:10])
    assert await say(db, tenant, "security.screenshot_notice") in texts(messages)


async def test_follow_records_the_line_user(db, tenant):
    await reply(db, tenant, event("follow"))
    row = (await db.execute(select(LineUser).where(LineUser.line_user_id == USER))).scalar_one()
    assert row.followed_at is not None and row.blocked_at is None


async def test_unfollow_marks_the_user_blocked_and_says_nothing(db, tenant):
    await reply(db, tenant, event("follow"))
    assert await reply(db, tenant, event("unfollow")) == []
    row = (await db.execute(select(LineUser).where(LineUser.line_user_id == USER))).scalar_one()
    assert row.blocked_at is not None


async def test_a_sticker_gets_the_non_text_reply(db, tenant):
    messages = await reply(db, tenant, event("message", message={"type": "sticker"}))
    assert texts(messages) == await say(db, tenant, "error.non_text_message")


async def test_an_unknown_event_type_is_ignored(db, tenant):
    assert await reply(db, tenant, event("join")) == []


# --------------------------------------------------------- postback 對照表

async def test_every_action_in_the_table_is_reachable(db, tenant, scheme):
    """表上的每一個 action 都要真的跑得起來，不能留下會拋例外的分支。"""
    for action in handlers.ACTIONS:
        messages = await reply(db, tenant, postback_event(action))
        assert isinstance(messages, list)


async def test_case_status_asks_for_the_case_number(db, tenant):
    messages = await reply(db, tenant, postback_event("case_status"))
    assert texts(messages) == await say(db, tenant, "case.ask_case_id")
    state = await conversation.get(db, tenant.id, USER)
    assert (state.flow, state.step) == (handlers.VERIFY_FLOW, handlers.STEP_CASE_NO)


async def test_case_status_offers_a_way_out(db, tenant):
    messages = await reply(db, tenant, postback_event("case_status"))
    assert quick_actions(messages[0]) == [flex.postback("cancel")]


async def test_refresh_case_shows_the_timeline_for_a_linked_case(db, tenant, scheme):
    app = await verified_case(db, tenant, scheme)
    messages = await reply(db, tenant, postback_event("refresh_case", case_no=app.case_no))
    assert messages[0]["type"] == "flex"
    assert app.case_no in messages[0]["altText"]


async def test_refresh_case_refuses_a_case_the_user_never_verified(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    messages = await reply(db, tenant, postback_event("refresh_case", case_no=app.case_no))
    assert texts(messages) == await say(db, tenant, "case.verify_failed")


async def test_my_cases_is_empty_before_any_verification(db, tenant):
    messages = await reply(db, tenant, postback_event("my_cases"))
    assert texts(messages) == await say(db, tenant, "mycase.empty")


async def test_my_cases_with_one_case_shows_that_case(db, tenant, scheme):
    app = await verified_case(db, tenant, scheme)
    messages = await reply(db, tenant, postback_event("my_cases"))
    assert app.case_no in messages[0]["altText"]


async def test_my_cases_with_two_cases_shows_a_list(db, tenant, scheme):
    await verified_case(db, tenant, scheme)
    await verified_case(db, tenant, scheme)
    messages = await reply(db, tenant, postback_event("my_cases"))
    rows = messages[0]["contents"]["body"]["contents"]
    assert len([r for r in rows if r.get("action")]) == 2


async def test_faq_menu_lists_questions_and_category_quick_replies(db, tenant):
    from app.models import Faq

    db.add(Faq(tenant_id=tenant.id, category="流程", question="審查要多久？", answer="約 5 個工作天。",
               keywords=["審查", "多久"]))
    await db.commit()
    messages = await reply(db, tenant, postback_event("faq"))
    assert "審查要多久？" in texts(messages)
    assert quick_actions(messages[0]) == [flex.postback("faq_category", category="流程")]


async def test_faq_category_answers_with_the_entries(db, tenant):
    from app.models import Faq

    db.add(Faq(tenant_id=tenant.id, category="流程", question="審查要多久？", answer="約 5 個工作天。"))
    await db.commit()
    messages = await reply(db, tenant, postback_event("faq_category", category="流程"))
    assert "約 5 個工作天。" in texts(messages)


async def test_an_empty_faq_category_says_so(db, tenant):
    messages = await reply(db, tenant, postback_event("faq_category", category="沒有這一類"))
    assert texts(messages) == await say(db, tenant, "faq.category_empty")


async def test_scheme_info_sends_an_intro_and_a_carousel(db, tenant, scheme):
    messages = await reply(db, tenant, postback_event("scheme_info"))
    assert texts(messages) == await say(db, tenant, "subsidy.menu_intro")
    assert messages[1]["contents"]["type"] == "carousel"


async def test_scheme_info_with_no_active_scheme_says_so(db, tenant):
    messages = await reply(db, tenant, postback_event("scheme_info"))
    assert texts(messages) == await say(db, tenant, "subsidy.empty")


async def test_scheme_category_with_no_match_names_the_category(db, tenant, scheme):
    messages = await reply(db, tenant, postback_event("scheme_category", category="創業"))
    assert texts(messages) == await say(db, tenant, "subsidy.category_empty", category="創業")


async def test_scheme_detail_returns_one_card(db, tenant, scheme):
    messages = await reply(db, tenant, postback_event("scheme_detail", scheme=scheme.code))
    assert messages[0]["contents"]["type"] == "bubble"
    assert messages[0]["altText"] == scheme.name


async def test_scheme_detail_with_an_unknown_code(db, tenant, scheme):
    messages = await reply(db, tenant, postback_event("scheme_detail", scheme="NOPE"))
    assert texts(messages) == await say(db, tenant, "subsidy.not_found")


async def test_scheme_latest_and_closing_use_the_carousel(db, tenant, scheme):
    from datetime import date

    scheme.application_start = date(2026, 1, 1)
    scheme.application_end = date(2030, 1, 1)
    await db.commit()
    for action in ("scheme_latest", "scheme_closing"):
        messages = await reply(db, tenant, postback_event(action))
        assert messages[0]["contents"]["type"] == "carousel"


async def test_sop_start_asks_which_document(db, tenant, scheme):
    """決策 D20：六題資格問卷收掉，改成直接問要準備哪一份文件。"""
    messages = await reply(db, tenant, postback_event("sop_start"))
    assert texts(messages) == await say(db, tenant, "line.sop.ask_document")
    assert all(d.startswith("action=sop_prepare") for d in quick_actions(messages[0]))


async def test_sop_prepare_stores_a_pending_row_for_p4(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    messages = await reply(db, tenant, postback_event("sop_prepare", case_no=app.case_no, doc="ID_CARD_FRONT"))
    state = await conversation.get(db, tenant.id, USER)
    assert state.flow == "sop_pending"
    assert state.value("case_no") == app.case_no and state.value("doc") == "ID_CARD_FRONT"
    assert messages[0]["type"] == "flex"     # 先回清單，P4 才接 SOP session


async def test_checklist_renders_the_document_types(db, tenant, scheme):
    messages = await reply(db, tenant, postback_event("checklist", scheme=scheme.code))
    rows = messages[0]["contents"]["body"]["contents"]
    tappable = [r for r in rows if r.get("action")]
    assert len(tappable) == len(scheme.document_types)


async def test_checklist_without_a_scheme_asks_for_one(db, tenant, scheme):
    messages = await reply(db, tenant, postback_event("checklist"))
    assert texts(messages) == await say(db, tenant, "apply.need_subsidy_first")


async def test_apply_toggle_ticks_and_unticks(db, tenant, scheme):
    evt = postback_event("apply_toggle", scheme=scheme.code, doc="ID_CARD_FRONT")
    await reply(db, tenant, evt)
    state = await conversation.get(db, tenant.id, USER)
    assert state.value("checked") == ["ID_CARD_FRONT"]
    await reply(db, tenant, evt)
    state = await conversation.get(db, tenant.id, USER)
    assert state.value("checked") == []


async def test_switching_scheme_resets_the_ticks(db, tenant, scheme):
    """勾選是綁在某一個方案上的；換方案就從頭開始，不會把別人的清單帶過來。"""
    from app.models import DocumentType, Scheme

    other = Scheme(tenant_id=tenant.id, code="OTHER115", name="另一個方案")
    db.add(other)
    await db.flush()
    db.add(DocumentType(tenant_id=tenant.id, scheme_id=other.id, code="AFFIDAVIT", required=True))
    await db.commit()

    await reply(db, tenant, postback_event("apply_toggle", scheme=scheme.code, doc="ID_CARD_FRONT"))
    await reply(db, tenant, postback_event("apply_toggle", scheme=other.code, doc="AFFIDAVIT"))
    state = await conversation.get(db, tenant.id, USER)
    assert state.value("checked") == ["AFFIDAVIT"]
    assert state.value("scheme") == other.code


async def test_an_unknown_scheme_does_not_disturb_the_current_ticks(db, tenant, scheme):
    await reply(db, tenant, postback_event("apply_toggle", scheme=scheme.code, doc="ID_CARD_FRONT"))
    await reply(db, tenant, postback_event("apply_toggle", scheme="NOPE", doc="X"))
    state = await conversation.get(db, tenant.id, USER)
    assert state.value("checked") == ["ID_CARD_FRONT"]


async def test_contact_uses_every_contact_key(db, tenant):
    messages = await reply(db, tenant, postback_event("contact"))
    body = texts(messages)
    for key in ("contact.title", "contact.unit", "contact.phone", "contact.hours", "contact.footer_note"):
        assert await say(db, tenant, key) in body


async def test_cancel_clears_the_conversation(db, tenant):
    await reply(db, tenant, postback_event("case_status"))
    messages = await reply(db, tenant, postback_event("cancel"))
    assert texts(messages) == await say(db, tenant, "error.cancelled")
    assert (await conversation.get(db, tenant.id, USER)).is_idle


async def test_sop_exit_also_clears_the_conversation(db, tenant):
    await reply(db, tenant, postback_event("case_status"))
    await reply(db, tenant, postback_event("sop_exit"))
    assert (await conversation.get(db, tenant.id, USER)).is_idle


async def test_sop_session_buttons_fall_back_to_the_picker(db, tenant, scheme):
    for action in ("sop_next", "sop_stuck", "sop_switch"):
        messages = await reply(db, tenant, postback_event(action))
        assert texts(messages) == await say(db, tenant, "line.sop.ask_document")


async def test_security_check_keeps_the_hotline(db, tenant):
    messages = await reply(db, tenant, postback_event("security_check"))
    assert await say(db, tenant, "security.disclaimer") in texts(messages)


async def test_an_unknown_action_falls_back_to_the_main_menu(db, tenant):
    messages = await reply(db, tenant, postback_event("no_such_action"))
    assert texts(messages) == await say(db, tenant, "home.unknown")
    assert len(quick_labels(messages[0])) == len(flex.MAIN_MENU)


# ------------------------------------------------------------------ 文字路由

@pytest.mark.parametrize(
    "text,expected_key",
    [
        ("我的案件到哪了", "case.ask_case_id"),
        ("聯絡你們", "contact.title"),
        ("取消", "error.cancelled"),
        ("你好", "home.welcome"),
    ],
)
async def test_text_routes_by_intent(db, tenant, scheme, text, expected_key):
    messages = await reply(db, tenant, text_event(text))
    assert await say(db, tenant, expected_key) in texts(messages)


async def test_cancel_wins_over_an_active_flow(db, tenant):
    await reply(db, tenant, postback_event("case_status"))
    messages = await reply(db, tenant, text_event("取消"))
    assert texts(messages) == await say(db, tenant, "error.cancelled")


async def test_an_active_flow_wins_over_keywords(db, tenant, scheme):
    """流程進行中打的字是答案，不是新的問題——否則末四碼會被當成別的意圖。"""
    app = await make_case(db, tenant, scheme)
    await reply(db, tenant, postback_event("case_status"))
    messages = await reply(db, tenant, text_event(app.case_no))
    assert texts(messages) == await say(db, tenant, "case.ask_phone")


async def test_a_bare_case_number_jumps_straight_to_the_last4_step(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    messages = await reply(db, tenant, text_event(app.case_no))
    assert texts(messages) == await say(db, tenant, "case.ask_phone")
    state = await conversation.get(db, tenant.id, USER)
    assert state.step == handlers.STEP_LAST4


async def test_a_deep_link_jumps_to_the_last4_step(db, tenant, scheme):
    """apply-web 送件完成頁的 `?case=HC-…`（SPEC §8.4 綁定入口）。"""
    app = await make_case(db, tenant, scheme)
    messages = await reply(db, tenant, text_event(f"case={app.case_no}"))
    assert texts(messages) == await say(db, tenant, "case.ask_phone")
    state = await conversation.get(db, tenant.id, USER)
    assert state.value("case_no") == app.case_no


async def test_a_faq_keyword_answers_before_giving_up(db, tenant):
    from app.models import Faq

    db.add(Faq(tenant_id=tenant.id, category="流程", question="補助什麼時候撥款？",
               answer="核定後約兩週。", keywords=["撥款", "什麼時候"]))
    await db.commit()
    messages = await reply(db, tenant, text_event("撥款什麼時候會下來"))
    assert "核定後約兩週。" in texts(messages)


async def test_an_unmatched_message_is_stored_with_a_hashed_user_id(db, tenant):
    await reply(db, tenant, text_event("我想問一件完全無關的事情"))
    row = (await db.execute(select(UnmatchedMessage))).scalars().one()
    assert row.text == "我想問一件完全無關的事情"
    assert row.line_user_id_hash and USER not in row.line_user_id_hash
    assert len(row.line_user_id_hash) == 64
    assert row.intent_result["intent"] == "unknown"


async def test_an_unmatched_message_still_offers_the_menu(db, tenant):
    messages = await reply(db, tenant, text_event("我想問一件完全無關的事情"))
    assert texts(messages) == await say(db, tenant, "home.unknown")
    assert len(quick_labels(messages[0])) == len(flex.MAIN_MENU)


# ------------------------------------------------------------- 案件查詢流程

async def test_a_bad_case_number_is_refused_by_format(db, tenant):
    await reply(db, tenant, postback_event("case_status"))
    messages = await reply(db, tenant, text_event("abc"))
    assert texts(messages) == await say(db, tenant, "error.invalid_case_id")


async def test_the_case_number_step_never_says_whether_the_case_exists(db, tenant, scheme):
    """先確認案號真偽等於送一個猜案號的介面出去。"""
    real = await make_case(db, tenant, scheme)
    await reply(db, tenant, postback_event("case_status"))
    first = await reply(db, tenant, text_event(real.case_no))
    await reply(db, tenant, postback_event("case_status"))
    second = await reply(db, tenant, text_event("HC-2026-999999"))
    assert texts(first) == texts(second)


async def test_a_bad_last4_is_refused_by_format(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await reply(db, tenant, postback_event("case_status"))
    await reply(db, tenant, text_event(app.case_no))
    messages = await reply(db, tenant, text_event("12"))
    assert texts(messages) == await say(db, tenant, "error.invalid_phone")


async def test_the_happy_path_binds_the_case_and_shows_the_timeline(db, tenant, scheme, fake_redis):
    app = await make_case(db, tenant, scheme)
    await reply(db, tenant, postback_event("case_status"))
    await reply(db, tenant, text_event(app.case_no))
    messages = await reply(db, tenant, text_event("5678"), redis=fake_redis)
    assert messages[0]["type"] == "flex"
    assert await say(db, tenant, "case.link_success") in texts(messages)
    binding = (await db.execute(select(CaseVerification))).scalars().one()
    assert binding.application_id == app.id and binding.line_user_id == USER
    assert (await conversation.get(db, tenant.id, USER)).is_idle


async def test_verifying_twice_does_not_bind_twice(db, tenant, scheme, fake_redis):
    app = await make_case(db, tenant, scheme)
    for _ in range(2):
        await reply(db, tenant, postback_event("case_status"))
        await reply(db, tenant, text_event(app.case_no))
        await reply(db, tenant, text_event("5678"), redis=fake_redis)
    assert len((await db.execute(select(CaseVerification))).scalars().all()) == 1


async def test_a_wrong_last4_gets_the_uniform_failure(db, tenant, scheme, fake_redis):
    app = await make_case(db, tenant, scheme)
    await reply(db, tenant, postback_event("case_status"))
    await reply(db, tenant, text_event(app.case_no))
    messages = await reply(db, tenant, text_event("0000"), redis=fake_redis)
    assert texts(messages) == await say(db, tenant, "case.verify_failed")
    assert (await db.execute(select(CaseVerification))).scalars().all() == []


async def test_an_unknown_case_answers_exactly_like_a_wrong_last4(db, tenant, scheme, fake_redis):
    app = await make_case(db, tenant, scheme)
    await reply(db, tenant, postback_event("case_status"))
    await reply(db, tenant, text_event(app.case_no))
    wrong = texts(await reply(db, tenant, text_event("0000"), redis=fake_redis))
    await reply(db, tenant, postback_event("case_status"))
    await reply(db, tenant, text_event("HC-2026-999999"))
    missing = texts(await reply(db, tenant, text_event("1234"), redis=fake_redis))
    assert wrong == missing


async def test_too_many_failures_lock_out_and_say_for_how_long(db, tenant, scheme, fake_redis):
    from app.services import application as case_service

    app = await make_case(db, tenant, scheme)
    for _ in range(case_service.VERIFY_MAX_FAILURES):
        await reply(db, tenant, postback_event("case_status"))
        await reply(db, tenant, text_event(app.case_no))
        await reply(db, tenant, text_event("0000"), redis=fake_redis)
    await reply(db, tenant, postback_event("case_status"))
    await reply(db, tenant, text_event(app.case_no))
    messages = await reply(db, tenant, text_event("5678"), redis=fake_redis)
    minutes = case_service.VERIFY_LOCK_SECONDS // 60
    assert texts(messages) == await say(db, tenant, "case.verify_locked", minutes=minutes)
    assert str(minutes) in texts(messages)


async def test_an_unknown_step_resets_the_flow(db, tenant):
    await conversation.set_state(db, tenant.id, USER, handlers.VERIFY_FLOW, "no_such_step")
    await db.commit()
    messages = await reply(db, tenant, text_event("任何字"))
    assert texts(messages) == await say(db, tenant, "home.unknown")
    assert (await conversation.get(db, tenant.id, USER)).is_idle


# --------------------------------------------------------------------- 圖片

async def test_an_image_gets_the_safety_notice_then_the_question(db, tenant, scheme):
    messages = await reply(db, tenant, event("message", message={"type": "image", "id": "1"}))
    assert texts(messages).startswith(await say(db, tenant, "security.screenshot_notice"))
    assert await say(db, tenant, "line.sop.not_recognized") in texts(messages)
    assert all(d.startswith("action=sop_prepare") for d in quick_actions(messages[-1]))


# --------------------------------------------------------------- 對話逾時

async def test_a_conversation_expires_after_thirty_minutes(db, tenant):
    await conversation.set_state(db, tenant.id, USER, handlers.VERIFY_FLOW, handlers.STEP_CASE_NO)
    await db.commit()
    later = datetime.now(UTC) + timedelta(minutes=conversation.DEFAULT_TTL_MINUTES + 1)
    assert (await conversation.get(db, tenant.id, USER, now=later)).is_idle


async def test_an_expired_conversation_no_longer_captures_text(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await conversation.set_state(db, tenant.id, USER, handlers.VERIFY_FLOW, handlers.STEP_LAST4,
                                 {"case_no": app.case_no})
    await db.commit()
    later = datetime.now(UTC) + timedelta(minutes=conversation.DEFAULT_TTL_MINUTES + 1)
    messages = await reply(db, tenant, text_event("我的案件"), now=later)
    assert texts(messages) != await say(db, tenant, "case.ask_phone")


async def test_the_sweeper_deletes_expired_rows(db, tenant):
    from app.models import LineConversation

    await conversation.set_state(db, tenant.id, USER, handlers.VERIFY_FLOW, handlers.STEP_CASE_NO)
    await db.commit()
    later = datetime.now(UTC) + timedelta(minutes=conversation.DEFAULT_TTL_MINUTES + 1)
    assert await conversation.sweep_expired(db, now=later) == 1
    assert (await db.execute(select(LineConversation))).scalars().all() == []


async def test_the_sweeper_leaves_live_rows_alone(db, tenant):
    await conversation.set_state(db, tenant.id, USER, handlers.VERIFY_FLOW, handlers.STEP_CASE_NO)
    await db.commit()
    assert await conversation.sweep_expired(db) == 0


async def test_each_interaction_pushes_the_deadline_back(db, tenant):
    from app.models import LineConversation

    await reply(db, tenant, postback_event("case_status"))
    first = (await db.execute(select(LineConversation))).scalar_one().expires_at
    later = datetime.now(UTC) + timedelta(minutes=5)
    await reply(db, tenant, postback_event("case_status"), now=later)
    second = (await db.execute(select(LineConversation))).scalar_one().expires_at
    assert second > first


# ------------------------------------------------------------- 時間軸對照

@pytest.mark.parametrize("status", sorted(flex.STATUS_STEP))
async def test_every_status_maps_onto_a_public_step(db, tenant, scheme, status):
    app = await make_case(db, tenant, scheme)
    app.status = status
    await db.commit()
    message = await flex.case_timeline_message(db, tenant.id, app)
    markers = [
        row["contents"][0]["text"]
        for row in message["contents"]["body"]["contents"]
        if row.get("layout") == "baseline" and row["contents"][0]["text"] in
        (flex.MARKER_DONE, flex.MARKER_CURRENT, flex.MARKER_BLOCKED, flex.MARKER_UPCOMING)
    ]
    assert len(markers) == len(flex.TIMELINE_STEP_KEYS) + 1  # 五個階段 + 狀態列那一顆點


async def test_needs_revision_is_shown_as_blocked(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")
    message = await flex.case_timeline_message(db, tenant.id, app)
    assert flex.MARKER_BLOCKED in str(message)


async def test_a_disbursed_case_has_no_current_step_left(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T3", "T6", "T7")
    message = await flex.case_timeline_message(db, tenant.id, app)
    steps = [r for r in message["contents"]["body"]["contents"] if r.get("layout") == "baseline"]
    assert all(r["contents"][0]["text"] != flex.MARKER_UPCOMING for r in steps[1:])
