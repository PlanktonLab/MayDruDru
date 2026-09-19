from app.ai.checks import check_replica, focus_area

STRUCT = {
    "structural_texts": ["帳戶總覽", "交易明細"],
    "sensitive_texts": ["王小明", "NT$1,234", "2026/09/01", "全家便利商店"],
    "focus_mappings": [{"focus_box_id": "fb1", "element_description": "標題", "texts": ["信用卡帳單"]}],
}
BOXES = [{"id": "fb1", "type": "keep_text", "x": 0, "y": 0, "w": 0.5, "h": 0.1}]


def html(body: str) -> str:
    return f"<html><head><style>.x{{color:red}}</style></head><body>{body}</body></html>"


def test_clean_replica_passes():
    r = check_replica(html("<h1>帳戶總覽</h1><p>信用卡帳單</p><p>示範商店</p>"), structure=STRUCT, focus_boxes=BOXES,
                      kept_texts=["帳戶總覽", "信用卡帳單"], rendered_width=390, expected_width=390)
    assert r["ok"], r


def test_leak_detected():
    r = check_replica(html("<p>信用卡帳單</p><p>王小明</p>"), structure=STRUCT, focus_boxes=BOXES, kept_texts=[], rendered_width=390, expected_width=390)
    assert not r["ok"] and "王小明" in r["leaked"]


def test_keep_text_must_be_present():
    r = check_replica(html("<p>帳戶總覽</p>"), structure=STRUCT, focus_boxes=BOXES, kept_texts=[], rendered_width=390, expected_width=390)
    assert "信用卡帳單" in r["missing"]


def test_external_resources_rejected():
    r = check_replica(html('<p>信用卡帳單</p><img src="https://x.y/a.png">'), structure=STRUCT, focus_boxes=BOXES, kept_texts=[], rendered_width=390, expected_width=390)
    assert any("安全檢查" in p for p in r["problems"])
    r2 = check_replica(html('<p>信用卡帳單</p><script>1</script>'), structure=STRUCT, focus_boxes=BOXES, kept_texts=[], rendered_width=390, expected_width=390)
    assert not r2["ok"]


def test_width_mismatch():
    r = check_replica(html("<p>信用卡帳單</p>"), structure=STRUCT, focus_boxes=BOXES, kept_texts=[], rendered_width=420, expected_width=390)
    assert any("寬度" in p for p in r["problems"])


def test_sensitive_inside_keep_box_allowed():
    s = {**STRUCT, "sensitive_texts": ["信用卡帳單"]}
    r = check_replica(html("<p>信用卡帳單</p>"), structure=s, focus_boxes=BOXES, kept_texts=[], rendered_width=390, expected_width=390)
    assert r["ok"]


def test_focus_area():
    assert abs(focus_area([{"w": 0.5, "h": 0.5}, {"w": 0.2, "h": 0.5}]) - 0.35) < 1e-9


# ---------------------------------------------------------------- static safety

import pytest
from app.ai.checks import LEAK_PROBLEM_PREFIX, needs_scrub, scrub_pii, unsafe_html_problems

BENIGN = """<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=390">
<style>.screen{width:390px;font-family:"Noto Sans TC",sans-serif}.ph{background:#e6e9ec;border-radius:6px}</style></head>
<body><div class="screen"><h1>交易紀錄</h1><span class="ph" style="width:120px;height:11px"></span>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 20"><defs><path id="c" d="M10 2 2 10l8 8"/></defs><use href="#c"/></svg>
<img src="data:image/png;base64,iVBORw0KGgo=" alt=""><p>one = two, onboard</p></div></body></html>"""


def test_benign_replica_is_safe():
    assert unsafe_html_problems(BENIGN) == []


@pytest.mark.parametrize("snippet", [
    "<script>alert(1)</script>",
    "<SCRIPT src=x></SCRIPT>",
    '<svg><script>alert(1)</script></svg>',
    '<img src="data:image/png;base64,AA" onerror="alert(1)">',
    "<div onclick=alert(1)>x</div>",
    '<svg onload="x()"></svg>',
    '<img alt=">" src=x onerror=alert(1)>',
    '<base href="https://evil.example/">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<object data="x.swf"></object>',
    '<embed src="x.swf">',
    '<form action="/x"><input></form>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="jav&#x09;ascript:alert(1)">x</a>',
    '<iframe srcdoc="<p>x</p>"></iframe>',
    '<div srcdoc="x"></div>',
    "<img src=x.png>",
    '<img src="/local.png">',
    '<a href="https://example.com">x</a>',
    '<link rel="stylesheet" href="a.css">',
    "<style>@import 'a.css';</style>",
    '<div style="background:url(https://x.example/a.png)"></div>',
    '<img srcset="a.png 2x">',
    '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
    '<svg><a xlink:href="https://evil.example"><text>x</text></a></svg>',
    "<p>//cdn.example.com/lib.js</p>",
])
def test_unsafe_patterns_rejected(snippet):
    doc = BENIGN.replace("</div></body>", snippet + "</div></body>")
    assert unsafe_html_problems(doc), snippet


def test_check_replica_reports_unsafe_html():
    r = check_replica(html('<p>信用卡帳單</p><div onmouseover="x()">a</div>'), structure=STRUCT, focus_boxes=BOXES, kept_texts=[],
                      rendered_width=390, expected_width=390)
    assert not r["ok"] and any("安全檢查" in p for p in r["problems"])


# ---------------------------------------------------------------- PII scrub

def test_scrub_pii_removes_verbatim_data_and_is_idempotent():
    r = check_replica(html("<p>信用卡帳單</p><p>王小明</p>"), structure=STRUCT, focus_boxes=BOXES, kept_texts=[], rendered_width=390, expected_width=390)
    r["visual"] = {"score": 0.5, "issues": ["右上角仍顯示 NT$1,234"], "privacy_leak": True}
    assert needs_scrub(STRUCT, r)
    structure, report = scrub_pii(STRUCT, r)
    assert "sensitive_texts" not in structure and structure["structural_texts"] == STRUCT["structural_texts"]
    assert "leaked" not in report
    flat = repr(report)
    for secret in STRUCT["sensitive_texts"]:
        assert secret not in flat
    assert any(p.startswith(LEAK_PROBLEM_PREFIX) for p in report["problems"])
    assert report["missing"] == r["missing"]  # keep_text contents are intentionally kept
    assert not needs_scrub(structure, report)
    assert scrub_pii(structure, report) == (structure, report)
    assert "sensitive_texts" in STRUCT  # inputs untouched


def test_scrub_pii_handles_missing_parts():
    assert scrub_pii(None, None) == (None, None)


BLOCK_STRUCT = {
    **STRUCT,
    "focus_mappings": [*STRUCT["focus_mappings"], {"focus_box_id": "fb2", "element_description": "廣告橫幅", "texts": ["限時優惠", "立即申辦"]}],
}
BLOCK_BOXES = [*BOXES, {"id": "fb2", "type": "block", "x": 0, "y": 0.5, "w": 1, "h": 0.4}]


def test_block_box_content_must_not_be_replicated():
    r = check_replica(html("<p>信用卡帳單</p><p>限時優惠 立即申辦</p>"), structure=BLOCK_STRUCT, focus_boxes=BLOCK_BOXES,
                      kept_texts=[], rendered_width=390, expected_width=390)
    assert not r["ok"] and any("遮蔽框" in p and "限時優惠" in p for p in r["problems"])
    ok = check_replica(html("<p>信用卡帳單</p><div class=\"ph\"></div>"), structure=BLOCK_STRUCT, focus_boxes=BLOCK_BOXES,
                       kept_texts=[], rendered_width=390, expected_width=390)
    assert ok["ok"], ok


def test_focus_area_ignores_block_boxes():
    assert focus_area(BLOCK_BOXES) == focus_area(BOXES)
