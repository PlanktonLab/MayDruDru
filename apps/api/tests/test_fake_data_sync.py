"""假資料同步 (SPEC §6.5): sorting a replica's report into 沿用 / 新增, and
folding the clerk's picks back into the platform's 示範資料."""

import pytest
from app.ai.html_text import replace_texts
from app.schemas import FakeDataPick, FakeDataSyncIn
from app.services.demo_data import annotate, merge, regenerate_feedback, unreviewed_count, value_changes
from pydantic import ValidationError

DEMO = [
    {"key": "user_name", "label": "使用者姓名", "value": "示範小明"},
    {"key": "vendor", "label": "廠商名稱", "value": "示範科技"},
]


# ---------------------------------------------------------------- the report

def test_a_value_from_the_shared_set_is_marked_reused():
    rows = annotate([{"key": "user_name", "label": "姓名", "value": "示範小明"}], DEMO)
    assert rows == [{"key": "user_name", "label": "使用者姓名", "value": "示範小明", "source": "shared"}]
    assert unreviewed_count(rows) == 0


def test_a_value_the_agent_invented_is_marked_new():
    rows = annotate([{"key": "", "label": "刷卡時間", "value": "2019/03/02 14:20"}], DEMO)
    assert rows[0]["source"] == "new" and rows[0]["key"] == ""
    assert unreviewed_count(rows) == 1


def test_the_shared_set_is_recognised_by_value_when_the_agent_forgets_the_key():
    rows = annotate([{"key": "", "label": "廠商", "value": "示範科技"}], DEMO)
    assert rows[0]["source"] == "shared" and rows[0]["key"] == "vendor"


def test_an_unknown_key_does_not_pass_as_reused():
    rows = annotate([{"key": "made_up", "label": "訂單編號", "value": "A0001"}], DEMO)
    assert rows[0] == {"key": "", "label": "訂單編號", "value": "A0001", "source": "new"}


def test_repeated_and_empty_rows_are_dropped():
    rows = annotate([{"label": "刷卡時間", "value": "14:20"}, {"label": "刷卡時間", "value": "14:20"},
                     {"label": "", "value": ""}, None], DEMO)
    assert len(rows) == 1


def test_a_replica_from_before_the_structured_report_still_reads():
    rows = annotate(["示範科技", "2019/01/01"], DEMO)
    assert [r["source"] for r in rows] == ["shared", "new"]
    assert rows[1] == {"key": "", "label": "", "value": "2019/01/01", "source": "new"}


def test_long_values_are_trimmed_to_what_the_shared_set_accepts():
    rows = annotate([{"label": "備" * 60, "value": "值" * 80}], [])
    assert len(rows[0]["label"]) == 40 and len(rows[0]["value"]) == 60


# ---------------------------------------------------------------- adopting

def test_adopting_a_new_field_appends_it_with_a_usable_key():
    out = merge(DEMO, [{"key": "", "label": "刷卡時間", "value": "2019/03/02 14:20"}])
    assert [f["key"] for f in out] == ["user_name", "vendor", "field3"]
    assert out[-1]["label"] == "刷卡時間"
    FakeDataPick(label=out[-1]["label"], value=out[-1]["value"])


def test_an_ascii_label_keeps_its_own_key():
    out = merge([], [{"key": "", "label": "Order No", "value": "A0001"}])
    assert out[0]["key"] == "order_no"


def test_editing_a_shared_value_rewrites_that_field_instead_of_adding_one():
    out = merge(DEMO, [{"key": "user_name", "label": "使用者姓名", "value": "示範大明"}])
    assert len(out) == 2
    assert out[0] == {"key": "user_name", "label": "使用者姓名", "value": "示範大明"}


def test_adopting_a_name_the_shared_set_already_has_updates_it():
    """Two screens both report 刷卡時間; the platform must end up with one."""
    once = merge(DEMO, [{"key": "", "label": "刷卡時間", "value": "14:20"}])
    twice = merge(once, [{"key": "", "label": "刷卡時間", "value": "09:05"}])
    assert len(twice) == len(once)
    assert [f for f in twice if f["label"] == "刷卡時間"][0]["value"] == "09:05"


def test_differently_named_fields_each_get_their_own_key():
    out = merge([], [{"key": "", "label": "Note", "value": "a"}, {"key": "", "label": "Memo", "value": "b"}])
    assert len({f["key"] for f in out}) == 2


def test_one_name_is_one_field_even_within_a_batch():
    """The report often repeats a name (three 店名); the shared set keeps one."""
    out = merge([], [{"key": "", "label": "店名", "value": "示範商店 A"}, {"key": "", "label": "店名", "value": "示範商店 B"}])
    assert len(out) == 1 and out[0]["value"] == "示範商店 B"


def test_a_pick_with_no_name_is_ignored():
    assert merge(DEMO, [{"key": "", "label": "  ", "value": "x"}]) == DEMO


# ---------------------------------------------------------------- redoing the screen

def test_the_redo_feedback_names_every_agreed_value():
    text = regenerate_feedback([{"label": "刷卡時間", "value": "14:20"}, {"label": "姓名", "value": "示範小明"}])
    assert "刷卡時間：14:20" in text and "姓名：示範小明" in text


def test_a_redo_with_nothing_to_say_is_empty_so_the_api_can_refuse_it():
    assert regenerate_feedback([]) == ""
    assert regenerate_feedback([{"label": "", "value": "x"}]) == ""


# ---------------------------------------------------------------- the request body

def test_a_pick_must_be_named_and_stay_within_the_shared_limits():
    with pytest.raises(ValidationError):
        FakeDataPick(label="", value="x")
    with pytest.raises(ValidationError):
        FakeDataPick(label="金額", value="9" * 61)
    assert FakeDataSyncIn().adopt == [] and FakeDataSyncIn().regenerate is False
    assert FakeDataPick(label="金額").replaces == ""


# ---------------------------------------------------------------- correcting a value in place

PAGE = ('<html><head><style>.t::after{content:"2019/05/02"}</style></head><body>'
        '<div class="row" title="2019/05/02 14:34:00"><span>交易時間</span><span>2019/05/02 14:34:00</span></div>'
        '<div>金額 NT$ 5,267</div></body></html>')


def test_a_corrected_value_is_swapped_into_the_page_text_only():
    out, applied = replace_texts(PAGE, [("2019/05/02 14:34:00", "2026/05/02 14:34:00")])
    assert applied == ["2019/05/02 14:34:00"]
    assert "<span>2026/05/02 14:34:00</span>" in out
    assert 'title="2019/05/02 14:34:00"' in out          # attributes are not text
    assert 'content:"2019/05/02"' in out                  # the stylesheet is not text


def test_a_value_that_is_not_on_the_page_verbatim_reports_nothing_applied():
    """The caller falls back to redrawing the screen with the model."""
    out, applied = replace_texts(PAGE, [("NT$5267", "NT$9000")])
    assert applied == [] and out == PAGE


def test_the_new_text_cannot_smuggle_markup_in():
    out, applied = replace_texts(PAGE, [("交易時間", "<script>x</script>")])
    assert applied and "<script>" not in out and "&lt;script&gt;" in out


def test_nothing_to_change_leaves_the_page_untouched():
    assert replace_texts(PAGE, [("2019/05/02 14:34:00", "2019/05/02 14:34:00")]) == (PAGE, [])
    assert replace_texts("", [("a", "b")]) == ("", [])


REPORT = [
    {"key": "user_name", "label": "使用者姓名", "value": "示範小明", "source": "shared"},
    {"key": "", "label": "交易日期時間", "value": "2019/05/02 14:34:00", "source": "new"},
]


def test_the_words_to_swap_come_from_what_the_pick_says_it_replaces():
    """The clerk may rename the field, so the pick names the old text itself."""
    picks = [{"key": "", "label": "刷卡時間", "value": "2026/05/02 14:34:00", "replaces": "2019/05/02 14:34:00"}]
    assert value_changes(REPORT, picks) == [{"old": "2019/05/02 14:34:00", "new": "2026/05/02 14:34:00"}]


def test_without_replaces_the_row_is_found_by_key_then_by_name():
    assert value_changes(REPORT, [{"key": "user_name", "label": "使用者姓名", "value": "示範大明"}]) == \
        [{"old": "示範小明", "new": "示範大明"}]
    assert value_changes(REPORT, [{"key": "", "label": "交易日期時間", "value": "2026/05/02 14:34:00"}]) == \
        [{"old": "2019/05/02 14:34:00", "new": "2026/05/02 14:34:00"}]


def test_adopting_a_value_unchanged_changes_nothing_on_the_page():
    assert value_changes(REPORT, [{"key": "user_name", "label": "使用者姓名", "value": "示範小明"}]) == []
    assert value_changes([], [{"key": "", "label": "新欄位", "value": "x"}]) == []
