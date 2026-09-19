"""虛擬客服 (Playground chat): the tool loop with the fake model, no Redis or
database — content and side effects are stubbed at the module boundary."""

import pytest
from app.ai import assistant
from app.ai.assistant import ChatEngine, ChatState, greeting
from app.ai.retrieval import LocateResult
from app.services import guide
from app.services.content import straight_from as linear_from
from app.services.content import walk as walk_order

FLOW = "f1"
SNAPSHOT = {
    "flow": {"id": FLOW, "name": "國泰世華 App｜存款證明", "platform_id": "p1", "platform_name": "國泰世華 App", "goals": [{"id": "g1", "name": "存款證明"}], "status": "published"},
    "steps": [
        {"id": "s3", "title": "選擇帳戶", "instruction": "點選要開立證明的帳戶", "stuck_hint": "", "is_start": False, "is_end": False,
         "variants": {"light": {"stepcard_key": "cards/s3.png", "stepcard_preview_key": "previews/s3p.png", "width": 600, "height": 900}}},
        {"id": "s1", "title": "開啟 App", "instruction": "登入後點右下角「更多」", "stuck_hint": "", "is_start": True, "is_end": False,
         "variants": {"light": {"stepcard_key": "cards/s1.png", "stepcard_preview_key": "previews/s1p.png", "width": 600, "height": 900}}},
        {"id": "s2", "title": "進入證明申請", "instruction": "點「存款證明」", "stuck_hint": "", "is_start": False, "is_end": False,
         "variants": {"light": {"stepcard_key": "cards/s2.png", "stepcard_preview_key": "previews/s2p.png", "width": 600, "height": 900},
                      "dark": {"stepcard_key": "cards/s2d.png", "stepcard_preview_key": "previews/s2dp.png", "width": 600, "height": 900}}},
        {"id": "s4", "title": "下載 PDF", "instruction": "按「下載」即可取得", "stuck_hint": "", "is_start": False, "is_end": True, "goal_id": "g1", "goal_name": "存款證明", "variants": {}},
    ],
    "edges": [{"id": "e1", "from": "s1", "to": "s2", "label": "", "sort": 0}, {"id": "e2", "from": "s2", "to": "s3", "label": "", "sort": 0},
              {"id": "e3", "from": "s3", "to": "s4", "label": "", "sort": 0}],
}
PLATFORMS = [{"id": "p1", "display_name": "國泰世華 App", "brand": "國泰世華", "channel": "mobile_app", "category": "bank", "aliases": ["國泰", "cathay"], "has_flows": True},
             {"id": "p2", "display_name": "玉山網銀", "brand": "玉山", "channel": "web", "category": "bank", "aliases": [], "has_flows": False}]
GOALS = [{"id": "g1", "name": "存款證明", "description": "", "aliases": ["餘額證明"], "has_flows": True}]
FLOWS = [{"id": FLOW, "name": "國泰世華 App｜存款證明", "platform_id": "p1", "goal_ids": ["g1"], "status": "published"}]

# One flow, two documents: 登入 → 首頁, then a fork — 帳單 goes one way, 餘額 the other.
MULTI = "f2"
card = lambda n: {"light": {"stepcard_key": f"cards/{n}.png", "stepcard_preview_key": f"previews/{n}p.png", "width": 600, "height": 900}}
MULTI_SNAPSHOT = {
    "flow": {"id": MULTI, "name": "玉山網銀", "platform_id": "p2", "platform_name": "玉山網銀",
             "goals": [{"id": "g2", "name": "信用卡帳單"}, {"id": "g3", "name": "帳戶餘額"}], "status": "published"},
    "steps": [
        {"id": "m1", "title": "登入", "instruction": "", "stuck_hint": "", "is_start": True, "is_end": False, "variants": card("m1")},
        {"id": "m2", "title": "首頁", "instruction": "", "stuck_hint": "", "is_start": False, "is_end": False, "variants": card("m2")},
        {"id": "m3", "title": "信用卡", "instruction": "", "stuck_hint": "", "is_start": False, "is_end": False, "variants": card("m3")},
        {"id": "m4", "title": "帳單明細", "instruction": "", "stuck_hint": "", "is_start": False, "is_end": True, "goal_id": "g2", "goal_name": "信用卡帳單", "variants": card("m4")},
        {"id": "m5", "title": "帳戶總覽", "instruction": "", "stuck_hint": "", "is_start": False, "is_end": True, "goal_id": "g3", "goal_name": "帳戶餘額", "variants": card("m5")},
    ],
    "edges": [{"id": "x1", "from": "m1", "to": "m2", "label": "", "sort": 0}, {"id": "x2", "from": "m2", "to": "m3", "label": "信用卡", "sort": 0},
              {"id": "x3", "from": "m2", "to": "m5", "label": "帳戶", "sort": 1}, {"id": "x4", "from": "m3", "to": "m4", "label": "", "sort": 0}],
}
MULTI_PLATFORMS = [{"id": "p2", "display_name": "玉山網銀", "brand": "玉山", "channel": "web", "category": "bank", "aliases": [], "has_flows": True}]
MULTI_GOALS = [{"id": "g2", "name": "信用卡帳單", "description": "", "aliases": [], "has_flows": True},
               {"id": "g3", "name": "帳戶餘額", "description": "", "aliases": ["餘額"], "has_flows": True}]
MULTI_FLOWS = [{"id": MULTI, "name": "玉山網銀", "platform_id": "p2", "goal_ids": ["g2", "g3"], "status": "published"}]


def _engine(monkeypatch, platforms, goals, flows, snapshots):
    async def catalog(db, tenant_id, content_mode="published"):
        return platforms, goals, flows

    async def snapshot(db, tenant_id, flow_id, content_mode, version_id=None):
        return (snapshots[flow_id], "v1") if flow_id in snapshots else None

    async def noop(*a, **k):
        return None

    async def usage(task, model, u, latency, tenant_id, ref_type="", ref_id=""):
        return {"task": task, "model": model, **u, "latency_ms": latency, "cost_usd": 0}

    monkeypatch.setattr(assistant, "tenant_catalog", catalog)
    monkeypatch.setattr(assistant, "load_snapshot", snapshot)
    monkeypatch.setattr(guide, "tenant_catalog", catalog)
    monkeypatch.setattr(guide, "load_snapshot", snapshot)
    monkeypatch.setattr(assistant, "log_event", noop)
    monkeypatch.setattr(assistant, "release_connection", noop)
    monkeypatch.setattr(assistant, "record_usage", usage)
    monkeypatch.setattr(assistant.ChatStore, "save", staticmethod(noop))
    return ChatEngine(db=None, tenant_name="測試機關")


@pytest.fixture
def engine(monkeypatch):
    return _engine(monkeypatch, PLATFORMS, GOALS, FLOWS, {FLOW: SNAPSHOT})


@pytest.fixture
def multi_engine(monkeypatch):
    return _engine(monkeypatch, MULTI_PLATFORMS, MULTI_GOALS, MULTI_FLOWS, {MULTI: MULTI_SNAPSHOT})


def test_walk_order_follows_edges_not_list_order():
    assert [s["id"] for s in walk_order(SNAPSHOT)] == ["s1", "s2", "s3", "s4"]
    assert linear_from(SNAPSHOT, "s2") == ["s2", "s3", "s4"]


def test_walk_order_for_a_goal_skips_the_other_documents_branch():
    assert [s["id"] for s in walk_order(MULTI_SNAPSHOT)] == ["m1", "m2", "m3", "m5", "m4"]
    assert [s["id"] for s in walk_order(MULTI_SNAPSHOT, "g2")] == ["m1", "m2", "m3", "m4"]
    assert [s["id"] for s in walk_order(MULTI_SNAPSHOT, "g3")] == ["m1", "m2", "m5"]
    # without a goal the fork is a real question; with one it is a straight line
    assert linear_from(MULTI_SNAPSHOT, "m1") == ["m1", "m2"]
    assert linear_from(MULTI_SNAPSHOT, "m1", "g3") == ["m1", "m2", "m5"]


def test_system_prompt_lists_every_document_a_flow_delivers():
    text = assistant.system_prompt("機關", MULTI_PLATFORMS, MULTI_GOALS, MULTI_FLOWS)
    assert "玉山網銀｜信用卡帳單、帳戶餘額" in text


def test_system_prompt_and_greeting_follow_the_policy():
    from app.services.policy import Policy
    pol = Policy(language="vi", name="Trợ lý", goal_noun="giấy tờ", delivery="one_by_one", on_off_flow="handoff", handoff_message="Gọi 1999",
                 extra_rules="不要提到費用", tone="正式")
    text = assistant.system_prompt("機關", PLATFORMS, GOALS, FLOWS, pol)
    assert "Trợ lý" in text and "giấy tờ" in text and "Tiếng Việt" in text and "一次只傳一張" in text and "Gọi 1999" in text
    assert "不要提到費用" in text and "正式" in text and "交由人工" in text
    hello = greeting(PLATFORMS, GOALS, Policy(language="en"))
    assert hello.startswith("Hi, I'm Support assistant") and "國泰世華" in hello
    assert greeting(PLATFORMS, GOALS, Policy(templates={"greeting": "嗨 {brands}"})) == "嗨 國泰世華"


async def test_chat_policy_overrides_reach_the_turn(engine, monkeypatch):
    state = ChatState(chat_id="c11", tenant_id="t1", policy={"language": "en", "delivery": "one_by_one"})
    seen = {}
    real = assistant.system_prompt

    def spy(*a, **k):
        seen["prompt"] = real(*a, **k)
        return seen["prompt"]

    monkeypatch.setattr(assistant, "system_prompt", spy)
    out = await engine._turn(state, "國泰 存款證明", None)
    assert "English" in seen["prompt"] and "一次只傳一張" in seen["prompt"]
    assert out["_debug"]["state"]["language"] == "en" and out["_debug"]["state"]["delivery"] == "one_by_one"
    assert [m for m in out["messages"] if m["kind"] == "image"][0]["alt"] == "Step 1/4: 開啟 App"


async def test_multi_goal_flow_sends_only_the_asked_documents_steps(multi_engine):
    state = ChatState(chat_id="m1", tenant_id="t1")
    out = await multi_engine._turn(state, "玉山網銀 我要看帳戶餘額", None)
    images = [m for m in out["messages"] if m["kind"] == "image"]
    assert [m["step_id"] for m in images] == ["m1", "m2", "m5"]
    assert images[-1]["alt"] == "步驟 3／3：帳戶總覽"
    calls = out["_debug"]["tool_calls"]
    assert calls[0]["name"] == "get_flow_steps" and calls[0]["args"] == {"flow_id": MULTI, "goal_id": "g3"}
    assert "branches" not in calls[0]["result"]  # the fork was decided by the goal, not asked
    assert state.goal_id == "g3"


def test_greeting_names_only_what_has_flows():
    text = greeting(PLATFORMS, GOALS)
    assert "國泰世華" in text and "存款證明" in text and "玉山" not in text
    assert "尚無" not in greeting(PLATFORMS, GOALS)
    assert "還沒有" in greeting([], [])


async def test_text_turn_sends_every_step_card(engine):
    state = ChatState(chat_id="c1", tenant_id="t1")
    out = await engine._turn(state, "我是用國泰世華銀行的 App，該怎麼取得存款證明？", None)
    kinds = [m["kind"] for m in out["messages"]]
    assert kinds == ["text", "image", "image", "image", "text", "text"], kinds
    images = [m for m in out["messages"] if m["kind"] == "image"]
    assert [m["step_id"] for m in images] == ["s1", "s2", "s3"]
    assert images[0]["url"] == "http://m/cards/s1.png" and images[0]["alt"] == "步驟 1／4：開啟 App"
    assert not any(k in images[0] for k in ("caption", "text"))  # a picture alone, no text under it
    # the step without a card is still explained, in words
    assert out["messages"][4]["step_id"] == "s4" and "下載" in out["messages"][4]["text"]
    assert [c["name"] for c in out["_debug"]["tool_calls"]] == ["get_flow_steps", "send_step_cards"]
    assert out["_debug"]["rounds"] == 3 and len(out["_debug"]["usage"]) == 3
    assert state.flow_id == FLOW and state.platform_id == "p1"
    # transcript keeps what happened, in words, for the next turn
    assert state.history[-2]["role"] == "user" and "已傳送" in state.history[-1]["text"]


async def test_unknown_platform_asks_with_choices(engine):
    state = ChatState(chat_id="c2", tenant_id="t1")
    out = await engine._turn(state, "我要申請證明", None)
    assert [m["kind"] for m in out["messages"]] == ["choices"]
    assert [o["label"] for o in out["messages"][0]["options"]] == ["國泰世華"]  # only what has flows
    assert [c["name"] for c in out["_debug"]["tool_calls"]] == ["ask_choice"]
    assert "已詢問" in state.history[-1]["text"]


async def test_screenshot_turn_locates_and_continues_from_there(engine, monkeypatch):
    seen = {}

    async def fake_locate(db, tenant_id, png, **kw):
        seen["png"] = png
        seen["kw"] = kw
        return LocateResult(ok=True, outcome="located", step_id="s2", flow_id=FLOW, platform_id="p1", confidence=0.91, theme="dark", scope="flow",
                            difference="同一頁但尚未捲到底", usage=[{"task": "describe"}, {"task": "rerank"}])

    monkeypatch.setattr(assistant, "locate", fake_locate)
    state = ChatState(chat_id="c3", tenant_id="t1", flow_id=FLOW, platform_id="p1")
    out = await engine._turn(state, "我卡在這裡", b"\x89PNG-fake")
    assert seen["png"] == b"\x89PNG-fake" and seen["kw"]["flow_id"] == FLOW
    images = [m for m in out["messages"] if m["kind"] == "image"]
    assert [m["step_id"] for m in images] == ["s2", "s3"]
    assert images[0]["url"] == "http://m/cards/s2d.png" and state.theme == "dark"  # the screenshot's theme wins
    assert "截圖定位" in state.history[-1]["text"]
    assert not any("PNG" in h["text"] for h in state.history)  # bytes never reach the transcript
    assert {u["task"] for u in out["_debug"]["usage"]} >= {"describe", "rerank", "assistant"}
    assert seen["kw"]["step_id"] is None and seen["kw"]["snapshot"] is SNAPSHOT  # the prior gets the session's flow
    assert state.step_id == "s2"
    loc = out["_debug"]["locate"]
    assert loc["outcome"] == "located" and loc["guidance"]["step_ids"] == ["s2", "s3", "s4"] and "尚未捲到底" in loc["guidance"]["advice"]


async def test_ambiguous_screenshot_asks_with_candidates(engine, monkeypatch):
    async def fake_locate(db, tenant_id, png, **kw):
        return LocateResult(ok=False, outcome="ambiguous", step_id="s3", flow_id=FLOW, confidence=0.45,
                            candidates=[{"variant_id": "v", "step_id": "s3", "flow_id": FLOW, "step_title": "選擇帳戶", "flow_name": "國泰世華 App｜存款證明", "preview_url": "http://m/s3p.png"},
                                        {"variant_id": "w", "step_id": "s2", "flow_id": FLOW, "step_title": "進入證明申請", "flow_name": "國泰世華 App｜存款證明"}])

    monkeypatch.setattr(assistant, "locate", fake_locate)
    state = ChatState(chat_id="c4", tenant_id="t1")
    out = await engine._turn(state, "", b"img")
    kinds = [m["kind"] for m in out["messages"]]
    assert kinds[-1] == "choices"
    choice = out["messages"][-1]
    assert [o["label"] for o in choice["options"]] == ["國泰世華 App｜存款證明：選擇帳戶", "國泰世華 App｜存款證明：進入證明申請"]
    assert state.step_id is None  # a guess is not a position


async def test_off_flow_screenshot_restarts_the_known_flow(engine, monkeypatch):
    async def fake_locate(db, tenant_id, png, **kw):
        return LocateResult(ok=False, outcome="off_flow", platform_id="p1", confidence=0.2, relation="same_app_other_screen")

    monkeypatch.setattr(assistant, "locate", fake_locate)
    state = ChatState(chat_id="c6", tenant_id="t1", flow_id=FLOW, platform_id="p1", step_id="s3")
    out = await engine._turn(state, "", b"img")
    images = [m for m in out["messages"] if m["kind"] == "image"]
    assert [m["step_id"] for m in images] == ["s1", "s2", "s3"]  # from step 1 again
    assert "首頁" in out["messages"][0]["text"] and "不在教學流程" in out["messages"][0]["text"]
    g = out["_debug"]["locate"]["guidance"]
    assert g["restart"] is True and g["platform_name"] == "國泰世華 App"


async def test_home_screen_with_unknown_platform_asks_which_app(engine, monkeypatch):
    async def fake_locate(db, tenant_id, png, **kw):
        return LocateResult(ok=False, outcome="not_app_screen", kind="home_screen", confidence=0.0)

    monkeypatch.setattr(assistant, "locate", fake_locate)
    state = ChatState(chat_id="c7", tenant_id="t1")
    out = await engine._turn(state, "", b"img")
    assert out["messages"][0]["kind"] == "text" and "主畫面" in out["messages"][0]["text"]
    assert out["messages"][-1]["kind"] == "choices" and [o["label"] for o in out["messages"][-1]["options"]] == ["國泰世華 App"]


async def test_unknown_app_names_what_it_saw(engine, monkeypatch):
    async def fake_locate(db, tenant_id, png, **kw):
        return LocateResult(ok=False, outcome="unknown_platform", platform_guess="LINE Pay", photographed=True)

    monkeypatch.setattr(assistant, "locate", fake_locate)
    state = ChatState(chat_id="c8", tenant_id="t1")
    out = await engine._turn(state, "", b"img")
    text = out["messages"][0]["text"]
    assert "LINE Pay" in text and "翻拍" in text
    assert out["messages"][-1]["kind"] == "choices"


async def test_unreadable_picture_asks_for_a_better_one(engine, monkeypatch):
    async def fake_locate(db, tenant_id, png, **kw):
        return LocateResult(ok=False, outcome="unreadable", kind="unreadable", quality_issues=["過暗", "只截到局部"])

    monkeypatch.setattr(assistant, "locate", fake_locate)
    state = ChatState(chat_id="c9", tenant_id="t1")
    out = await engine._turn(state, "", b"img")
    assert [m["kind"] for m in out["messages"]] == ["text"] and "過暗" in out["messages"][0]["text"]


async def test_model_failure_with_a_screenshot_still_answers_it(engine, monkeypatch):
    def boom(messages, catalog):
        raise RuntimeError("down")

    async def fake_locate(db, tenant_id, png, **kw):
        return LocateResult(ok=True, outcome="located", step_id="s3", flow_id=FLOW, platform_id="p1", confidence=0.9)

    monkeypatch.setattr(assistant.fake, "assistant_reply", boom)
    monkeypatch.setattr(assistant, "locate", fake_locate)
    state = ChatState(chat_id="c10", tenant_id="t1")
    out = await engine._turn(state, "", b"img")
    kinds = [m["kind"] for m in out["messages"]]
    assert kinds == ["text", "image", "text"], kinds  # lead-in, step 3's card, step 4 as text
    assert out["messages"][1]["step_id"] == "s3" and state.flow_id == FLOW


async def test_model_failure_becomes_a_polite_message(engine, monkeypatch):
    def boom(messages, catalog):
        raise RuntimeError("down")

    monkeypatch.setattr(assistant.fake, "assistant_reply", boom)
    state = ChatState(chat_id="c5", tenant_id="t1")
    out = await engine._turn(state, "國泰 存款證明", None)
    assert out["messages"] == [{"kind": "text", "text": assistant.MODEL_FAILURE_TEXT}]
