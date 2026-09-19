"""LINE 的 SOP 教學對話（SPEC §8.4 `sop_session`、§16 P4 的驗收條件）。

一整段生命週期：開場（一條／多條流程）→ 下一步 → 我卡住了（傳截圖）→ 換流程 →
結束，外加三條退出的路（rich menu、30 分鐘逾時、引擎說走不下去），
以及退件推播的「教我準備」。

每一條都走 `handlers.build_event_reply()`——那是 webhook 真正呼叫的函式，
測試因此驗的是「民眾會收到什麼」，不是某個內部函式的回傳值。
"""

from __future__ import annotations

import io
from datetime import UTC, datetime, timedelta

import pytest
from app.ai.session_graph import SessionStore
from app.models import DocumentType, Platform
from app.services import contents
from app.services.line import conversation, flex, handlers, sop
from PIL import Image

from tests.sop_helpers import link_document_type, make_platform, make_published_flow

USER = "Usop0000000000000000000000000001"
DOC = "BILLING_STATEMENT"


def png(color: tuple[int, int, int] = (250, 250, 250)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (48, 72), color).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def screenshot() -> bytes:
    return png()


def event(kind: str, **payload):
    base = {"type": kind, "source": {"type": "user", "userId": USER}, "replyToken": "rt"}
    base.update(payload)
    return base


def postback_event(action: str, **params):
    return event("postback", postback={"data": flex.postback(action, **params)})


def text_event(text: str):
    return event("message", message={"type": "text", "text": text})


def image_event(message_id: str = "img-1"):
    return event("message", message={"type": "image", "id": message_id})


def texts(messages) -> str:
    return "\n".join(m.get("text", "") for m in messages if m.get("type") == "text")


def images(messages) -> list[dict]:
    return [
        m for m in messages
        if m.get("type") == "image" or (m.get("type") == "flex" and (m.get("contents") or {}).get("type") == "carousel")
    ]


def quick_actions(message) -> list[str]:
    return [i["action"]["data"] for i in (message.get("quickReply") or {}).get("items", [])]


async def reply(db, tenant, evt, **kw):
    messages = await handlers.build_event_reply(db, tenant.id, evt, **kw)
    await db.commit()
    return messages


async def say(db, tenant, key, **variables) -> str:
    return await contents.tf(db, tenant.id, key, **variables)


async def state_of(db, tenant) -> conversation.State:
    return await conversation.get(db, tenant.id, USER)


@pytest.fixture
async def mapped_flow(db, tenant, scheme, fake_storage, screenshot):
    """一份文件對照到一條兩步的已發布流程，第一步認得測試用的那張截圖。"""
    flow = await make_published_flow(
        db, tenant.id, titles=("開啟 App", "進入帳單明細"), storage=fake_storage, recognises=screenshot
    )
    await link_document_type(db, tenant.id, scheme.id, DOC, flow)
    return flow


# ------------------------------------------------------------------ 開場

async def test_application_helper_lists_every_published_guide_for_the_selected_platform(
    db, tenant, mapped_flow, fake_storage
):
    second = await make_published_flow(
        db, tenant.id, platform=await db.get(Platform, mapped_flow.platform_id),
        name="下載存款明細", storage=fake_storage,
    )
    opened = await reply(db, tenant, postback_event("sop_start"))
    platform_action = quick_actions(opened[0])[0]
    assert platform_action == f"action=sop_platform&platform={mapped_flow.platform_id}"

    listed = await reply(db, tenant, postback_event("sop_platform", platform=mapped_flow.platform_id))
    body = texts(listed)
    assert mapped_flow.name in body and second.name in body
    actions = quick_actions(listed[0])
    assert f"action=sop_open&flow={mapped_flow.id}" in actions
    assert f"action=sop_open&flow={second.id}" in actions


async def test_application_helper_accepts_a_typed_platform_name(db, tenant, mapped_flow):
    await reply(db, tenant, postback_event("sop_start"))
    platform = await db.get(Platform, mapped_flow.platform_id)
    tutorial = await reply(db, tenant, text_event(platform.display_name))
    assert await say(db, tenant, "line.sop.all_steps_started", document=mapped_flow.name) in texts(tutorial)
    assert images(tutorial)
    assert (await state_of(db, tenant)).flow == sop.SESSION_FLOW


async def test_a_platform_with_one_guide_skips_the_guide_picker(db, tenant, mapped_flow):
    messages = await reply(db, tenant, postback_event("sop_platform", platform=mapped_flow.platform_id))
    assert await say(db, tenant, "line.sop.all_steps_started", document=mapped_flow.name) in texts(messages)
    assert images(messages)
    assert not any(action.startswith("action=sop_open") for action in quick_actions(messages[-1]))


async def test_picking_a_document_with_one_flow_starts_the_session(db, tenant, mapped_flow, line_sender):
    messages = await reply(db, tenant, postback_event("sop_document", doc=DOC))

    body = texts(messages)
    assert await say(db, tenant, "line.sop.all_steps_started", document="BILLING_STATEMENT") in body
    # SPEC §8.4「敏感提醒」：第一則回覆就要帶到
    assert await say(db, tenant, "security.screenshot_notice") in body
    assert images(messages), "完整步驟應該放在 carousel"
    assert quick_actions(images(messages)[0]) == [
        "action=sop_stuck", "action=sop_switch", "action=sop_exit",
    ]
    bubbles = images(messages)[0]["contents"]["contents"]
    assert len(bubbles) == 2
    assert all(bubble.get("hero", {}).get("url") for bubble in bubbles)

    state = await state_of(db, tenant)
    assert state.flow == "sop_session" and state.sop_session_id


async def test_the_session_row_expires_in_thirty_minutes(db, tenant, mapped_flow):
    before = datetime.now(UTC)
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    row = await conversation._row(db, tenant.id, USER)
    delta = conversation._aware(row.expires_at) - before
    assert timedelta(minutes=29) < delta <= timedelta(minutes=31)


async def test_a_document_with_two_flows_asks_which_platform_first(db, tenant, scheme, fake_storage):
    app_flow = await make_published_flow(db, tenant.id, name="App 版", storage=fake_storage)
    web = await make_platform(db, tenant.id, display_name="示範銀行網銀", channel="web")
    web_flow = await make_published_flow(db, tenant.id, platform=web, name="網頁版", storage=fake_storage)
    await link_document_type(db, tenant.id, scheme.id, DOC, app_flow)
    await link_document_type(db, tenant.id, scheme.id, DOC, web_flow)

    messages = await reply(db, tenant, postback_event("sop_document", doc=DOC))
    assert await say(db, tenant, "line.sop.ask_platform", document="BILLING_STATEMENT") in texts(messages)
    actions = quick_actions(messages[0])
    assert all(a.startswith("action=sop_open") for a in actions) and len(actions) == 2
    # 還沒選之前不該有 session
    assert (await state_of(db, tenant)).is_idle

    chosen = await reply(db, tenant, postback_event("sop_open", flow=web_flow.id, doc=DOC))
    assert images(chosen)
    assert (await state_of(db, tenant)).flow == "sop_session"


async def test_a_document_without_a_mapping_says_so_and_stays_idle(db, tenant, scheme):
    messages = await reply(db, tenant, postback_event("sop_document", doc=DOC))
    assert await say(db, tenant, "line.sop.no_flow", document="BILLING_STATEMENT") in texts(messages)
    assert (await state_of(db, tenant)).is_idle


async def test_sop_open_with_an_unknown_flow_returns_to_the_picker(db, tenant, mapped_flow):
    messages = await reply(db, tenant, postback_event("sop_open", flow="nope", doc=DOC))
    assert texts(messages) == await say(db, tenant, "line.sop.ask_platform_general")


async def test_the_picker_uses_the_document_label_when_the_scheme_sets_one(db, tenant, scheme, mapped_flow):
    from sqlalchemy import select

    row = (await db.execute(select(DocumentType).where(DocumentType.code == DOC))).scalar_one()
    row.label = "信用卡帳單扣款紀錄"
    await db.commit()
    messages = await reply(db, tenant, postback_event("sop_document", doc=DOC))
    assert "信用卡帳單扣款紀錄" in texts(messages)


# ------------------------------------------------------------------ 進行中

async def test_next_advances_one_step(db, tenant, mapped_flow):
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    messages = await reply(db, tenant, postback_event("sop_next"))
    assert "進入帳單明細" in texts(messages)
    assert (await state_of(db, tenant)).flow == "sop_session"


async def test_next_written_as_words_does_the_same_thing(db, tenant, mapped_flow):
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    messages = await reply(db, tenant, text_event("下一步"))
    assert "進入帳單明細" in texts(messages)


async def test_stuck_asks_for_a_screenshot(db, tenant, mapped_flow):
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    messages = await reply(db, tenant, postback_event("sop_stuck"))
    assert texts(messages) == await say(db, tenant, "line.sop.stuck_ask_screenshot")
    assert (await state_of(db, tenant)).flow == "sop_session"


async def test_a_screenshot_inside_the_session_is_located_and_never_stored(
    db, tenant, mapped_flow, line_sender, fake_storage, screenshot
):
    line_sender.content = screenshot
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    await reply(db, tenant, postback_event("sop_next"))
    before = list(fake_storage.writes)

    messages = await reply(db, tenant, image_event("stuck-1"))
    assert line_sender.fetched[-1] == "stuck-1"
    assert images(messages) or texts(messages), "傳了截圖就一定要有回應"
    # SPEC §11 紅線 3：截圖只在記憶體
    assert fake_storage.writes == before


async def test_switch_ends_the_session_and_asks_again(db, tenant, mapped_flow):
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    session_id = (await state_of(db, tenant)).sop_session_id

    messages = await reply(db, tenant, postback_event("sop_switch"))
    assert await say(db, tenant, "line.sop.switch") in texts(messages)
    assert all(a.startswith("action=sop_platform") for a in quick_actions(messages[0]))
    assert (await state_of(db, tenant)).flow == sop.PICKER_FLOW
    assert await SessionStore.load(tenant.id, session_id) is None


async def test_exit_ends_the_session_and_drops_the_redis_state(db, tenant, mapped_flow, session_redis):
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    assert session_redis.sessions(), "開場之後 Redis 裡應該有一個 session"

    messages = await reply(db, tenant, postback_event("sop_exit"))
    assert texts(messages) == await say(db, tenant, "line.sop.ended")
    assert (await state_of(db, tenant)).is_idle
    assert session_redis.sessions() == []


async def test_exit_written_as_words_does_the_same_thing(db, tenant, mapped_flow, session_redis):
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    await reply(db, tenant, text_event("結束"))
    assert (await state_of(db, tenant)).is_idle
    assert session_redis.sessions() == []


async def test_free_text_the_classifier_cannot_place_goes_to_the_engine(db, tenant, mapped_flow):
    """認不出來的字交給引擎自己比對，不是硬塞一個動作。教學狀態要留著。"""
    messages = await reply(db, tenant, text_event("這邊有點看不太懂耶"))
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    messages = await reply(db, tenant, text_event("嗯嗯"))
    assert messages
    assert (await state_of(db, tenant)).flow == "sop_session"


# ------------------------------------------------------------------ 退出

@pytest.mark.parametrize("action", [a for a, _ in flex.MAIN_MENU])
async def test_any_rich_menu_button_exits_the_session(db, tenant, mapped_flow, session_redis, action):
    """SPEC §8.4：按了主選單就是要做別的事，教學要收掉。"""
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    assert session_redis.sessions()

    await reply(db, tenant, postback_event(action))
    assert session_redis.sessions() == []
    assert (await state_of(db, tenant)).flow != "sop_session"


async def test_the_thirty_minute_sweep_deletes_the_redis_session(db, tenant, mapped_flow, session_redis):
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    assert len(session_redis.sessions()) == 1

    later = datetime.now(UTC) + timedelta(minutes=conversation.DEFAULT_TTL_MINUTES + 1)
    removed = await conversation.sweep_expired(db, now=later, drop_session=SessionStore.delete)
    assert removed == 1
    assert session_redis.sessions() == []
    assert (await state_of(db, tenant)).is_idle


async def test_the_sweep_without_a_dropper_still_clears_the_rows(db, tenant, mapped_flow, session_redis):
    """`drop_session` 是選填的——沒給就只清資料庫，Redis 的 TTL 自己會收。"""
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    later = datetime.now(UTC) + timedelta(minutes=31)
    assert await conversation.sweep_expired(db, now=later) == 1
    assert len(session_redis.sessions()) == 1


async def test_a_failing_dropper_does_not_break_the_sweep(db, tenant, mapped_flow):
    await reply(db, tenant, postback_event("sop_document", doc=DOC))

    async def boom(tenant_id: str, session_id: str) -> None:
        raise RuntimeError("redis 掛了")

    later = datetime.now(UTC) + timedelta(minutes=31)
    assert await conversation.sweep_expired(db, now=later, drop_session=boom) == 1


async def test_text_after_the_session_expired_says_so(db, tenant, mapped_flow, session_redis):
    await reply(db, tenant, postback_event("sop_document", doc=DOC))
    session_redis.values.clear()      # Redis 那一半不見了，資料庫那一列還在
    messages = await reply(db, tenant, text_event("下一步"))
    assert texts(messages) == await say(db, tenant, "line.sop.expired")
    assert (await state_of(db, tenant)).is_idle


async def test_a_stale_row_without_a_session_id_is_cleaned_up(db, tenant, scheme):
    await conversation.set_state(db, tenant.id, USER, "sop_session", "running", {})
    await db.commit()
    messages = await reply(db, tenant, text_event("下一步"))
    assert texts(messages) == await say(db, tenant, "line.sop.expired")
    assert (await state_of(db, tenant)).is_idle


# --------------------------------------------------------- 退件推播的入口

async def test_sop_prepare_from_a_push_opens_the_session_for_that_document(db, tenant, mapped_flow):
    messages = await reply(db, tenant, postback_event("sop_prepare", case_no="HC-2026-000001", doc=DOC))
    assert images(messages)
    assert (await state_of(db, tenant)).flow == "sop_session"


async def test_sop_prepare_without_a_document_falls_back_to_the_picker(db, tenant, mapped_flow):
    messages = await reply(db, tenant, postback_event("sop_prepare", case_no="HC-2026-000001"))
    assert texts(messages) == await say(db, tenant, "line.sop.ask_document")


# ------------------------------------------------------------ idle 圖片定位

async def test_an_idle_screenshot_that_matches_opens_a_session(
    db, tenant, mapped_flow, line_sender, fake_storage, screenshot
):
    line_sender.content = screenshot
    before = list(fake_storage.writes)
    messages = await reply(db, tenant, image_event())

    assert await say(db, tenant, "security.screenshot_notice") in texts(messages)
    assert (await state_of(db, tenant)).flow == "sop_session", "定位命中就直接進入教學"
    assert fake_storage.writes == before, "市民截圖永不落地（SPEC §11 紅線 3）"


async def test_an_idle_screenshot_that_misses_offers_the_picker(db, tenant, scheme, line_sender):
    """一條已發布的流程都沒有，所以一定定位不到。"""
    messages = await reply(db, tenant, image_event())
    assert await say(db, tenant, "line.sop.not_recognized") in texts(messages)
    assert all(a.startswith("action=sop_platform") for a in quick_actions(messages[-1]))
    assert (await state_of(db, tenant)).flow == sop.PICKER_FLOW


async def test_an_image_we_cannot_fetch_still_gets_an_answer(db, tenant, mapped_flow, line_sender):
    line_sender.fail_with = RuntimeError("blob API 掛了")
    messages = await reply(db, tenant, image_event())
    assert await say(db, tenant, "line.sop.not_recognized") in texts(messages)
    assert (await state_of(db, tenant)).flow == sop.PICKER_FLOW


async def test_an_image_event_without_an_id_is_not_fetched(db, tenant, scheme, line_sender):
    messages = await reply(db, tenant, event("message", message={"type": "image"}))
    assert line_sender.fetched == []
    assert await say(db, tenant, "line.sop.not_recognized") in texts(messages)


# --------------------------------------------------------------- 單元層面

async def test_document_picker_dedupes_codes_across_schemes(db, tenant, scheme):
    from app.models import Scheme

    other = Scheme(tenant_id=tenant.id, code="OTHER777", name="另一個方案", active=True)
    db.add(other)
    await db.flush()
    db.add(DocumentType(tenant_id=tenant.id, scheme_id=other.id, code=DOC))
    await db.commit()

    picker = await sop.document_picker(db, tenant.id)
    codes = [i["action"]["data"] for i in picker["items"]]
    assert codes.count(f"action=sop_document&doc={DOC}") == 1


async def test_document_picker_skips_inactive_schemes(db, tenant, scheme):
    scheme.active = False
    await db.commit()
    assert await sop.document_picker(db, tenant.id) == {}


async def test_close_is_safe_without_any_session(db, tenant):
    await sop.close(sop.SopTurn(db=db, tenant_id=tenant.id, user_id=USER))
    assert (await state_of(db, tenant)).is_idle
