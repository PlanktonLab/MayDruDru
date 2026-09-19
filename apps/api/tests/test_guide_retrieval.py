"""The generic guidance layer and the retrieval ladder, without a database:
scoring, fusion, the outcome decision, and what each outcome turns into."""

import pytest
from app.ai import retrieval
from app.ai.agents import screen_keywords
from app.ai.retrieval import LocateResult, decide, fuse, lexical_scores, step_prior
from app.services import guide
from app.services.guide import (
    ASK,
    HANDOFF,
    RESTART,
    SEND,
    Guidance,
    decide_guidance,
    locate_guidance,
    phrase_guidance,
    resolve_intent,
    step_messages,
    step_rows,
)
from app.services.policy import Policy

from tests.test_assistant import (
    FLOW,
    FLOWS,
    GOALS,
    MULTI,
    MULTI_FLOWS,
    MULTI_GOALS,
    MULTI_PLATFORMS,
    MULTI_SNAPSHOT,
    PLATFORMS,
    SNAPSHOT,
)

# ------------------------------------------------------------------ retrieval scoring

def _entry(vid, step, words, dist, flow=FLOW):
    return {"variant_id": vid, "step_id": step, "flow_id": flow, "keywords": words, "distance": dist, "step_title": step, "flow_name": flow}


def test_lexical_score_prefers_the_page_that_shares_rare_words():
    entries = [_entry("a", "s1", ["帳務總覽", "臺幣總額", "更多", "設定"], 0.2),
               _entry("b", "s2", ["刷卡消費明細", "分期紀錄", "更多", "設定"], 0.2),
               _entry("c", "s3", ["消費明細", "點數折抵", "更多", "設定"], 0.2)]
    scores = lexical_scores(["刷卡消費明細", "全部信用卡", "更多"], entries)
    assert scores[1] > scores[0] and scores[1] > scores[2]
    # a word shared by every page (the tab bar) is worth little on its own
    common = lexical_scores(["更多"], entries)
    assert common == pytest.approx([common[0]] * 3) and common[0] < 0.2
    # nested strings match: 交易紀錄 ⊂ 共 8 筆交易紀錄
    nested = lexical_scores(["交易紀錄"], [*entries, _entry("d", "s4", ["共 8 筆交易紀錄"], 0.1)])
    assert nested[3] > 0.3 and nested[:3] == [0.0, 0.0, 0.0]
    assert lexical_scores([], entries) == [0.0, 0.0, 0.0]


def test_fusion_lets_words_overrule_a_near_tie_in_vectors_and_the_prior_break_ties():
    entries = [_entry("a", "s1", ["帳務總覽"], 0.20), _entry("b", "s2", ["刷卡消費明細"], 0.21), _entry("c", "s3", ["消費明細"], 0.22)]
    top = fuse(entries, lexical_scores(["刷卡消費明細"], entries), k=3)
    assert top[0]["variant_id"] == "b" and top[0]["lexical"] > 0
    # same words everywhere: the session's expected step wins
    top = fuse(entries, [0.0, 0.0, 0.0], prior={"s3": 0.15}, k=3)
    assert top[0]["variant_id"] == "c"
    assert fuse([], [], k=3) == []


def test_step_prior_covers_current_and_next_steps_then_the_rest_of_the_flow():
    prior = step_prior(SNAPSHOT, "s2", None)
    assert prior["s2"] > prior["s3"] > prior["s4"] > prior["s1"] > 0
    assert step_prior(None, "s2", None) == {}


def test_screen_keywords_drop_personal_data_and_duplicates():
    d = {"structural_texts": ["帳務總覽", "王小明", "更多", " 更多 "], "visible_keywords": ["帳務總覽", "NT$1,234", "設定"]}
    assert screen_keywords(d, ["王小明", "NT$1,234"]) == ["帳務總覽", "更多", "設定"]


def _res(**kw):
    base = dict(ok=False)
    base.update(kw)
    return LocateResult(**base)


def test_decide_walks_the_ladder():
    d = lambda r, known=False: decide(r, threshold=0.6, low=0.35, platform_known=known)
    assert d(_res(step_id="s", confidence=0.9, relation="same_screen", kind="home_screen")) == retrieval.LOCATED  # a confident match wins
    assert d(_res(kind="unreadable")) == retrieval.UNREADABLE
    assert d(_res(kind="not_a_screen")) == retrieval.NOT_A_SCREENSHOT
    assert d(_res(kind="home_screen", step_id="s", confidence=0.5)) == retrieval.NOT_APP_SCREEN
    assert d(_res(kind="app_screen", relation="not_app")) == retrieval.UNKNOWN_PLATFORM  # the describer's kind decides what the picture is
    assert d(_res(step_id="s", confidence=0.45, relation="same_screen")) == retrieval.AMBIGUOUS
    assert d(_res(step_id="s", confidence=0.45, relation="same_app_other_screen")) == retrieval.OFF_FLOW
    assert d(_res(confidence=0.2, relation="different_app"), known=True) == retrieval.OFF_FLOW
    assert d(_res(confidence=0.2, relation="different_app", platform_id="p1")) == retrieval.OFF_FLOW
    assert d(_res(confidence=0.2, relation="different_app")) == retrieval.UNKNOWN_PLATFORM


def test_public_view_has_no_screen_description_beyond_structure():
    r = _res(outcome="located", description={"navigation": "王小明 的帳戶"}, screen={"structural_texts": ["帳務總覽"]}, candidates=[{"variant_id": "v", "keywords": ["x"], "replica_png_key": "k"}])
    pub = r.public()
    assert "description" not in pub and pub["screen"] == {"structural_texts": ["帳務總覽"]}
    assert set(pub["candidates"][0]) == {"variant_id", "step_id", "flow_id", "step_title", "flow_name", "preview_url", "score"}


# ------------------------------------------------------------------ guide

def test_policy_merges_tenant_settings_legacy_block_and_overrides():
    p = Policy.from_settings({"assistant": {"name": "舊名", "goal_noun": "申請"}, "policy": {"name": "小幫手", "delivery": "one_by_one", "locate_threshold": "0.7",
                                                                                      "on_off_flow": "nonsense", "templates": {"busy": "等等", "x": ""}}},
                             {"language": "en", "locate_low": 0.9})
    assert p.name == "小幫手" and p.goal_noun == "申請" and p.delivery == "one_by_one" and p.on_off_flow == "restart"
    assert p.locate_threshold == 0.7 and p.locate_low == 0.7  # low is capped at the threshold
    assert p.templates == {"busy": "等等"} and p.language == "en"
    assert Policy.from_settings(None).to_dict()["name"] == "線上客服"


def test_policy_text_uses_overrides_then_language_builtin_then_zh():
    p = Policy(language="en", templates={"ask_platform": "Which one, {name}?"})
    assert p.text("ask_platform") == "Which one, Support assistant?"
    assert p.text("kind_home_screen") == "the phone's home screen"
    assert p.text("step_head", index=2, total=5, title="Login") == "Step 2/5: Login"
    assert Policy(language="vi").text("busy") == Policy().text("busy")  # no Vietnamese set: zh-TW as the last resort
    assert Policy().text("located", flow="F", index=3) == "您目前在「F」的步驟 3「」。"  # a missing placeholder never fails
    assert Policy(name="小幫手").display_name == "小幫手" and Policy(language="en").noun == "document"


def test_step_rows_and_messages_follow_the_goal():
    rows = step_rows(MULTI_SNAPSHOT, "g3")
    assert [r["step_id"] for r in rows["steps"]] == ["m1", "m2", "m5"] and rows["flow"]["showing_steps_for"] == "帳戶餘額"
    assert not any("branches" in r for r in rows["steps"])
    rows = step_rows(MULTI_SNAPSHOT)
    assert [b["to_step_id"] for b in rows["steps"][1]["branches"]] == ["m3", "m5"]


async def test_step_messages_number_from_where_the_citizen_is():
    batch = await step_messages(SNAPSHOT, ["s3", "s4", "zzz"], "dark", start_number=1)
    assert [m["kind"] for m in batch.messages] == ["image", "text"]
    assert batch.messages[0]["alt"] == "步驟 3／4：選擇帳戶" and batch.messages[0]["number"] == 1
    assert batch.messages[1]["number"] == 2 and "下載" in batch.messages[1]["text"]
    assert batch.unknown == ["zzz"] and batch.textual == ["步驟 4／4：下載 PDF"]


def _patch_catalog(monkeypatch, platforms, goals, flows, snapshots):
    async def catalog(db, tenant_id, content_mode="published"):
        return platforms, goals, flows

    async def snapshot(db, tenant_id, flow_id, content_mode, version_id=None):
        return (snapshots[flow_id], "v1") if flow_id in snapshots else None

    async def find(db, tenant_id, platform_id, goal_id, content_mode):
        for f in flows:
            if f["platform_id"] == platform_id and goal_id in f["goal_ids"]:
                class F:  # the engine only reads .id
                    id = f["id"]
                return F()
        return None

    async def noop(*a, **k):
        return None

    monkeypatch.setattr(guide, "tenant_catalog", catalog)
    monkeypatch.setattr(guide, "load_snapshot", snapshot)
    monkeypatch.setattr(guide, "find_flow", find)
    monkeypatch.setattr(guide, "release_connection", noop)


async def test_resolve_intent_with_the_fake_model(monkeypatch):
    _patch_catalog(monkeypatch, PLATFORMS, GOALS, FLOWS, {FLOW: SNAPSHOT})
    out = await resolve_intent(None, "t1", "我用國泰的 app 要存款證明", None)
    assert out.platform_id == "p1" and out.goal_id == "g1" and out.flow_id == FLOW and out.needs == []
    # a platform that delivers one goal only: no need to ask which
    out = await resolve_intent(None, "t1", "國泰 app 怎麼用", None)
    assert out.goal_id == "g1" and out.flow_id == FLOW
    out = await resolve_intent(None, "t1", "我要證明", None)
    assert out.platform_id is None and out.needs == ["platform", "goal"]
    # what the channel already knows wins
    out = await resolve_intent(None, "t1", "隨便", {"platform_id": "p1", "goal_id": "g1"})
    assert out.flow_id == FLOW


async def test_guidance_for_each_outcome(monkeypatch):
    _patch_catalog(monkeypatch, PLATFORMS, GOALS, FLOWS, {FLOW: SNAPSHOT})
    kw = dict(content_mode="published", theme="light", session_flow_id=None, session_goal_id=None)

    g = await locate_guidance(None, "t1", _res(outcome="located", step_id="s2", flow_id=FLOW, platform_id="p1", confidence=0.9, difference="彈出了提示"), **kw)
    assert g.step_ids == ["s2", "s3", "s4"] and g.step_index == 2 and g.total_steps == 4 and "彈出了提示" in g.advice

    g = await locate_guidance(None, "t1", _res(outcome="ambiguous", step_id="s2", flow_id=FLOW, candidates=[
        {"variant_id": "v", "step_id": "s2", "flow_id": FLOW, "step_title": "進入證明申請", "flow_name": "F", "preview_url": "http://p"}]), **kw)
    assert g.ask and g.options[0]["image_url"] == "http://p" and g.options[0]["step_id"] == "s2"

    # off the flow, platform known: restart the platform's only flow from step 1
    g = await locate_guidance(None, "t1", _res(outcome="off_flow", platform_id="p1"), **kw)
    assert g.restart and g.flow_id == FLOW and g.step_ids == ["s1", "s2", "s3", "s4"] and "首頁" in g.advice and g.platform_name == "國泰世華 App"

    # a home screen with no platform in sight: ask which app, listing only what has flows
    g = await locate_guidance(None, "t1", _res(outcome="not_app_screen", kind="home_screen"), **kw)
    assert not g.restart and g.ask and [o["label"] for o in g.options] == ["國泰世華 App"] and "主畫面" in g.advice

    g = await locate_guidance(None, "t1", _res(outcome="unknown_platform", platform_guess="LINE Pay"), **kw)
    assert "LINE Pay" in g.advice and g.options and g.outcome == "unknown_platform"

    g = await locate_guidance(None, "t1", _res(outcome="not_a_screenshot", kind="not_a_screen", platform_id="p1"), **kw)
    assert "截圖" in g.advice and g.restart  # still sends step 1 of the known platform

    g = await locate_guidance(None, "t1", _res(outcome="unreadable", kind="unreadable", quality_issues=["過暗"]), **kw)
    assert "過暗" in g.advice and not g.options and not g.step_ids

    # a located step in a flow that is no longer published is treated as off the flow
    g = await locate_guidance(None, "t1", _res(outcome="located", step_id="x", flow_id="gone", platform_id="p1"), **kw)
    assert g.outcome == "off_flow"


async def test_guidance_off_flow_with_several_flows_asks_which_goal(monkeypatch):
    two = [*MULTI_FLOWS, {"id": "f9", "name": "玉山網銀 另一條", "platform_id": "p2", "goal_ids": ["g2"], "status": "published"}]
    _patch_catalog(monkeypatch, MULTI_PLATFORMS, MULTI_GOALS, two, {MULTI: MULTI_SNAPSHOT})
    g = await locate_guidance(None, "t1", _res(outcome="off_flow", platform_id="p2"), content_mode="published", theme="light",
                              session_flow_id=None, session_goal_id=None, goal_noun="服務")
    assert not g.restart and "服務" in g.ask and [o["flow_id"] for o in g.options] == [MULTI, "f9"]
    # but with the session already in one of them, that one restarts, toward the session's goal
    g = await locate_guidance(None, "t1", _res(outcome="off_flow", platform_id="p2"), content_mode="published", theme="light",
                              session_flow_id=MULTI, session_goal_id="g3")
    assert g.restart and g.step_ids == ["m1", "m2", "m5"]


def test_guidance_to_dict_drops_empties_and_private_facts():
    assert Guidance(outcome="unreadable", advice="x", _kind="k").to_dict() == {"outcome": "unreadable", "advice": "x"}


async def test_policy_changes_what_an_outcome_turns_into(monkeypatch):
    _patch_catalog(monkeypatch, PLATFORMS, GOALS, FLOWS, {FLOW: SNAPSHOT})
    kw = dict(content_mode="published", session_flow_id=None, session_goal_id=None)
    off = _res(outcome="off_flow", platform_id="p1")
    assert (await decide_guidance(None, "t1", off, policy=Policy(on_off_flow="restart"), **kw)).action == RESTART
    g = await decide_guidance(None, "t1", off, policy=Policy(on_off_flow="ask_goal"), **kw)
    assert g.action == ASK and g.ask_kind == "goal" and g.options[0]["flow_id"] == FLOW and not g.step_ids
    g = await decide_guidance(None, "t1", off, policy=Policy(on_off_flow="handoff", handoff_message="請撥 1999"), **kw)
    assert g.action == HANDOFF and not g.step_ids
    assert "請撥 1999" in phrase_guidance(g, Policy(on_off_flow="handoff", handoff_message="請撥 1999")).advice
    amb = _res(outcome="ambiguous", step_id="s2", flow_id=FLOW, candidates=[{"variant_id": "v", "step_id": "s2", "flow_id": FLOW, "step_title": "x", "flow_name": "F"}])
    assert (await decide_guidance(None, "t1", amb, policy=Policy(on_ambiguous="best_guess"), **kw)).action == SEND
    assert (await decide_guidance(None, "t1", amb, policy=Policy(), **kw)).action == ASK
    home = _res(outcome="not_app_screen", kind="home_screen", platform_id="p1")
    assert (await decide_guidance(None, "t1", home, policy=Policy(on_not_app_screen="ask_platform"), **kw)).action == ASK
    # the same decision, phrased in another language
    g = await locate_guidance(None, "t1", home, policy=Policy(language="en"), **kw)
    assert g.action == RESTART and g.advice.startswith("This picture is the phone's home screen.") and "step 1" in g.advice
    g = await locate_guidance(None, "t1", home, policy=Policy(templates={"not_app_screen": "喂，{what}啦。"}), **kw)
    assert g.advice.startswith("喂，手機主畫面啦。")
