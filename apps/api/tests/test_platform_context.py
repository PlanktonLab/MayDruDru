"""平台脈絡 (SPEC §6.5): the 示範資料 persona and the shared component library —
prompt sections, programmatic checks and the offline pipeline wiring."""

from datetime import UTC

import pytest
from app.ai import fake
from app.ai.checks import (
    COMPONENT_CHANGED_PROBLEM,
    COMPONENT_MISSING_PROBLEM,
    check_replica,
    component_problems,
    demo_data_problems,
    normalize_component_html,
    unsafe_html_problems,
)
from app.ai.prompts import components_section, demo_data_section
from app.ai.schemas import ReplicaOutput, StructureAnalysis
from app.schemas import PlatformIn, PlatformPatch
from pydantic import ValidationError

DEMO = [
    {"key": "product_name", "label": "商品／服務名稱", "value": "Claude Pro 訂閱"},
    {"key": "vendor", "label": "廠商名稱", "value": "示範科技"},
    {"key": "amount", "label": "金額", "value": "600"},
    {"key": "date", "label": "日期", "value": ""},
]
DATA_BOX = [{"id": "fb1", "type": "data_region", "x": 0, "y": 0.3, "w": 1, "h": 0.2}]
KEEP_BOX = [{"id": "fb2", "type": "keep_text", "x": 0, "y": 0, "w": 1, "h": 0.1}]

TAB_BAR = ('<nav data-component="c1" data-kind="tab_bar" style="display:flex">'
           '<span class="item selected">首頁</span><span class="item">帳戶</span></nav>')
COMPONENT = {"id": "c1", "name": "底部 Tab bar", "kind": "tab_bar", "html": TAB_BAR}


def page(body: str) -> str:
    return f"<html><head><style>.item{{color:red}}</style></head><body>{body}</body></html>"


# ---------------------------------------------------------------- prompt sections

def test_demo_data_section_lists_every_value_and_skips_blanks():
    text = demo_data_section(DEMO)
    assert "Claude Pro 訂閱" in text and "示範科技" in text
    assert "一字不差地照抄" in text
    assert "2020 年以前" in text  # the values outrank the generic fake-data rules
    assert "- 日期（date）" not in text  # no value set: nothing to pin
    assert "示範資料" in text


def test_demo_data_section_empty_when_nothing_is_set():
    assert demo_data_section(None) == ""
    assert demo_data_section([{"key": "amount", "label": "金額", "value": "  "}]) == ""


def test_components_section_carries_the_snippet_and_the_base_width():
    text = components_section([COMPONENT], 390)
    assert TAB_BAR in text and "底部 Tab bar" in text
    assert "390px" in text and "selected" in text
    assert components_section([], 390) == ""


# ---------------------------------------------------------------- 示範資料 check

def test_demo_data_required_when_the_page_has_a_data_region():
    """None of the persona on a screen that shows data: Agent B ignored it."""
    problems = demo_data_problems(page("<p>隨便編的店名</p>"), focus_boxes=DATA_BOX, demo_data=DEMO)
    assert len(problems) == 1 and "Claude Pro 訂閱" in problems[0]


def test_demo_data_satisfied_by_the_values_that_belong_on_that_screen():
    """A transaction list never shows every field, so one is enough."""
    assert demo_data_problems(page("<p>示範科技</p>"), focus_boxes=DATA_BOX, demo_data=DEMO) == []
    assert demo_data_problems(page("<p>Claude Pro 訂閱</p><p>NT$ 600</p>"), focus_boxes=DATA_BOX, demo_data=DEMO) == []


def test_demo_data_ignores_pages_without_a_data_region():
    """A menu or a login screen shows no data — never fault it (the conservative rule)."""
    assert demo_data_problems(page("<p>登入</p>"), focus_boxes=KEEP_BOX, demo_data=DEMO) == []
    assert demo_data_problems(page("<p>登入</p>"), focus_boxes=[], demo_data=DEMO) == []


def test_demo_data_ignores_a_platform_with_nothing_filled_in():
    assert demo_data_problems(page("<p>其他</p>"), focus_boxes=DATA_BOX, demo_data=[]) == []
    assert demo_data_problems(page("<p>其他</p>"), focus_boxes=DATA_BOX,
                              demo_data=[{"key": "vendor", "label": "廠商名稱", "value": ""}]) == []


# ---------------------------------------------------------------- 共用元件 check

def test_normalisation_ignores_layout_attribute_order_and_selected_state():
    moved = ('<nav   data-kind="tab_bar"  data-component="c1" style="display:flex">\n'
             '  <span class="item">首頁</span>\n  <span class="item selected" aria-current="page">帳戶</span>\n</nav>')
    assert normalize_component_html(moved) == normalize_component_html(TAB_BAR)


def test_component_pasted_verbatim_passes():
    assert component_problems(page(TAB_BAR), structure={"has_tab_bar": True}, components=[COMPONENT]) == []


def test_component_edited_is_reported():
    edited = TAB_BAR.replace("帳戶", "我的帳戶")
    assert component_problems(page(edited), structure={"has_tab_bar": True}, components=[COMPONENT]) == \
        [COMPONENT_CHANGED_PROBLEM % "底部 Tab bar"]


def test_component_restyled_is_reported():
    edited = TAB_BAR.replace('style="display:flex"', 'style="display:grid"')
    assert component_problems(page(edited), structure={"has_tab_bar": True}, components=[COMPONENT]) == \
        [COMPONENT_CHANGED_PROBLEM % "底部 Tab bar"]


def test_component_missing_only_when_the_structure_says_the_screen_has_one():
    body = page("<p>沒有 Tab bar 的全螢幕表單</p>")
    assert component_problems(body, structure={"has_tab_bar": True}, components=[COMPONENT]) == \
        [COMPONENT_MISSING_PROBLEM % "底部 Tab bar"]
    assert component_problems(body, structure={"has_tab_bar": False}, components=[COMPONENT]) == []
    assert component_problems(body, structure={}, components=[COMPONENT]) == []


def test_footer_and_other_components_are_never_required():
    footer = {**COMPONENT, "kind": "footer"}
    assert component_problems(page("<p>x</p>"), structure={"has_tab_bar": True, "has_nav_bar": True}, components=[footer]) == []


def test_check_replica_reports_both_platform_context_rules():
    r = check_replica(page(TAB_BAR.replace("帳戶", "設定")), structure={"has_tab_bar": True}, focus_boxes=DATA_BOX,
                      kept_texts=[], rendered_width=390, expected_width=390, demo_data=DEMO, components=[COMPONENT])
    assert not r["ok"]
    assert any("Claude Pro 訂閱" in p for p in r["problems"])
    assert COMPONENT_CHANGED_PROBLEM % "底部 Tab bar" in r["problems"]


def test_check_replica_unchanged_without_platform_context():
    r = check_replica(page("<p>帳戶總覽</p>"), structure={}, focus_boxes=DATA_BOX, kept_texts=[],
                      rendered_width=390, expected_width=390)
    assert r["ok"], r


# ---------------------------------------------------------------- schema validation

def test_demo_data_keys_must_be_unique():
    with pytest.raises(ValidationError):
        PlatformPatch(demo_data=[{"key": "amount", "label": "金額", "value": "1"}, {"key": "amount", "label": "金額", "value": "2"}])


def test_demo_data_is_bounded():
    with pytest.raises(ValidationError):
        PlatformPatch(demo_data=[{"key": f"k{i}", "label": "x", "value": "x"} for i in range(21)])
    with pytest.raises(ValidationError):
        PlatformPatch(demo_data=[{"key": "amount", "label": "金額", "value": "x" * 61}])
    with pytest.raises(ValidationError):
        PlatformPatch(demo_data=[{"key": "Bad Key", "label": "x", "value": "x"}])
    with pytest.raises(ValidationError):  # the label is the field's name; it cannot be blank
        PlatformPatch(demo_data=[{"key": "amount", "label": "", "value": "x"}])


def test_platform_in_defaults_to_no_demo_data():
    assert PlatformIn(display_name="玉山 Wallet", brand="玉山銀行").demo_data == []


# ---------------------------------------------------------------- offline pipeline (LLM_PROVIDER=fake)

def _fake_replica(demo_data, components):
    structure = fake.respond("structure", StructureAnalysis, "", [b"img"], {"focus_boxes": DATA_BOX, "theme": "light"}).model_dump()
    out = fake.respond("replica", ReplicaOutput, "", [b"img"],
                       {"structure": structure, "focus_boxes": DATA_BOX, "width": 390, "theme": "light",
                        "demo_data": demo_data, "components": components})
    return structure, out


def test_fake_structure_reports_shared_furniture():
    s = fake.respond("structure", StructureAnalysis, "", [b"img"], {"focus_boxes": [], "theme": "light"})
    assert s.has_tab_bar and s.has_nav_bar


def test_fake_provider_exercises_the_new_prompt_inputs():
    structure, out = _fake_replica(DEMO, [COMPONENT])
    report = check_replica(out.html, structure=structure, focus_boxes=DATA_BOX, kept_texts=out.kept_texts,
                           rendered_width=390, expected_width=390, demo_data=DEMO, components=[COMPONENT])
    assert report["ok"], report["problems"]
    assert "Claude Pro 訂閱" in out.kept_texts and "示範科技" in [f.value for f in out.fake_data]
    assert unsafe_html_problems(out.html) == []


def test_fake_provider_without_platform_context_still_fails_the_demo_data_rule():
    """The context has to reach Agent B: a replica built without it cannot pass."""
    structure, out = _fake_replica([], [])
    report = check_replica(out.html, structure=structure, focus_boxes=DATA_BOX, kept_texts=out.kept_texts,
                           rendered_width=390, expected_width=390, demo_data=DEMO, components=[COMPONENT])
    assert any("Claude Pro 訂閱" in p for p in report["problems"])
    assert COMPONENT_MISSING_PROBLEM % "底部 Tab bar" in report["problems"]


# ---------------------------------------------------------------- component API surface

def test_a_demo_value_is_never_reported_as_a_leak():
    """The clerk typed it for this page; the same check wants it there."""
    structure = {"sensitive_texts": ["Claude Pro 訂閱"], "structural_texts": []}
    html = page("<p>Claude Pro 訂閱</p><p>示範科技</p>")
    report = check_replica(html, structure=structure, focus_boxes=DATA_BOX, kept_texts=[],
                           rendered_width=390, expected_width=390, demo_data=DEMO, components=[])
    assert report["leaked"] == []
    assert not any(p.startswith("復刻中出現原圖的資料字串") for p in report["problems"])


def test_component_rect_must_have_area_and_stay_inside_the_image():
    from app.schemas import ComponentIn

    ok = ComponentIn(rect={"x": 0.1, "y": 0.8, "w": 0.8, "h": 0.15}, name="底部 Tab bar", kind="tab_bar")
    assert ok.kind == "tab_bar"
    for bad in ({"x": 0, "y": 0, "w": 0, "h": 0.1}, {"x": -0.1, "y": 0, "w": 0.5, "h": 0.1}, {"x": 0, "y": 0, "w": 1.5, "h": 0.1}):
        with pytest.raises(ValidationError):
            ComponentIn(rect=bad, name="x")
    with pytest.raises(ValidationError):
        ComponentIn(rect={"x": 0, "y": 0, "w": 0.5, "h": 0.1}, name="")
    with pytest.raises(ValidationError):
        ComponentIn(rect={"x": 0, "y": 0, "w": 0.5, "h": 0.1}, name="x", kind="sidebar")


def test_component_patch_accepts_a_partial_body_and_rejects_bad_values():
    from app.schemas import ComponentPatch

    assert ComponentPatch().name is None and ComponentPatch().kind is None
    assert ComponentPatch(name="頂部導覽列").kind is None
    for bad in ({"name": ""}, {"name": "x" * 81}, {"kind": "sidebar"}):
        with pytest.raises(ValidationError):
            ComponentPatch(**bad)


def test_component_patch_only_touches_the_fields_that_were_sent():
    from types import SimpleNamespace

    from app.routers.components import apply_component_patch
    from app.schemas import ComponentPatch

    row = SimpleNamespace(name="底部 Tab bar", kind="tab_bar", html="<nav></nav>")
    apply_component_patch(row, ComponentPatch(kind="nav_bar"))
    assert (row.name, row.kind) == ("底部 Tab bar", "nav_bar")
    apply_component_patch(row, ComponentPatch(name="  頂部導覽列  "))
    assert (row.name, row.kind, row.html) == ("頂部導覽列", "nav_bar", "<nav></nav>")
    apply_component_patch(row, ComponentPatch(name="   "))  # whitespace is not a rename
    assert row.name == "頂部導覽列"


def test_component_out_links_the_thumbnail_only_when_there_is_one():
    from datetime import datetime
    from types import SimpleNamespace

    from app.routers.components import component_out

    row = SimpleNamespace(id="c1", platform_id="p1", name="底部 Tab bar", kind="tab_bar", width=390, height=64,
                          thumb_key="components/t1/c1.png", created_by="u1", created_at=datetime.now(UTC))
    assert component_out(row).thumb_url == "/api/components/c1/thumb.png"
    assert component_out(SimpleNamespace(**{**row.__dict__, "thumb_key": None})).thumb_url is None
