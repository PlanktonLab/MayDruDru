"""Session engine helpers that don't need Redis or a database."""

from app.ai.session_graph import PERSISTED_KEYS, _reply, match_option

OPTIONS = [
    {"option_id": "goal:1", "label": "信用卡消費紀錄"},
    {"option_id": "goal:2", "label": "信用卡帳單"},
    {"option_id": "goal:3", "label": "存摺封面"},
    {"option_id": "goal:4", "label": "  "},
]


def test_blank_text_never_matches():
    assert match_option(OPTIONS, "") == (None, False)
    assert match_option(OPTIONS, "   \n") == (None, False)


def test_exact_label_wins_over_partial_matches():
    # "信用卡帳單" is also a substring-compatible partial of nothing else, but "信用卡" alone is ambiguous
    assert match_option(OPTIONS, " 信用卡帳單 ") == (OPTIONS[1], False)


def test_unique_partial_match_accepted():
    assert match_option(OPTIONS, "存摺") == (OPTIONS[2], False)
    assert match_option(OPTIONS, "我要存摺封面") == (OPTIONS[2], False)


def test_ambiguous_partial_match_is_reported():
    assert match_option(OPTIONS, "信用卡") == (None, True)


def test_no_match():
    assert match_option(OPTIONS, "駕照") == (None, False)


def test_reply_carries_every_persisted_key():
    state = {k: f"v-{k}" for k in PERSISTED_KEYS}
    state.update(event={"kind": "text"}, response={"old": True}, debug={"old": True})
    out = _reply(state, {"type": "escalation"})
    assert out["response"] == {"type": "escalation"}
    assert all(out[k] == f"v-{k}" for k in PERSISTED_KEYS)
    assert "known_context" in out and "flow_version_id" in out
    assert "debug" not in out and "event" not in out
    assert _reply(state, {}, {"intent": 1})["debug"] == {"intent": 1}
