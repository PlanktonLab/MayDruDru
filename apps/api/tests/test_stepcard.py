import re

from app.services.stepcard import GRID, build_card_html, default_layout, focus_boxes, layout_vars

ANN = [
    {"id": "1", "type": "tap", "number": 1, "label": "點這裡", "x": 0.1, "y": 0.2, "w": 0.2, "h": 0.05},
    {"id": "2", "type": "input", "number": 2, "label": "輸入月份", "x": 0.1, "y": 0.4, "w": 0.5, "h": 0.06, "example_text": "2026/09"},
    {"id": "3", "type": "gesture", "number": 3, "label": "下滑", "x": 0.4, "y": 0.8, "w": 0.2, "h": 0.1, "direction": "down"},
    {"id": "4", "type": "note", "number": 4, "label": "只是說明", "x": 0.5, "y": 0.5, "w": 0, "h": 0},
]


def test_card_lists_labels_with_type_icons_and_a_step_number():
    html, w = build_card_html(replica_html="<html><body>x</body></html>", replica_w=390, replica_h=800, annotations=ANN,
                              title="開啟帳戶", instruction="點選帳戶", step_number=3)
    assert w == default_layout(390, 800)["canvas"]["w"] > 390
    assert 'srcdoc="' in html and "&lt;html&gt;" in html  # replica is escaped into the iframe
    # the number is one CSS value the .num block prints, so another number is a one-token change
    assert '<div class="num"></div><h1>開啟帳戶</h1>' in html and '--step-num:"3";' in html and ".num::before{content:var(--step-num)}" in html
    # one row per labelled annotation: the type's icon, then the label; the instruction gives way to the list
    assert '<span>點這裡</span></li>' in html and '<span>只是說明</span></li>' in html and "點選帳戶" not in html
    assert html.count('<span class="ic t-') == 4 and html.count("<svg") == 5  # four icons and the focus mask
    # the gesture icon is the same comet as the glyph on the replica, turned to its direction
    assert '<span class="ic t-gesture"><svg' in html and 'rotate(180 48 48)' in html
    # icons and highlights share the editor colour of their type
    assert ".t-tap{--c:#2f6fed}" in html and 'class="ring t-tap"' in html and 'class="ring box t-input"' in html
    assert html.count('class="ring') == 2 and "2026/09" in html
    # the swipe: a trail through the box's centre, start ring at the top, touch dot at the bottom; no arrow glyph
    assert 'class="gest t-gesture down"' in html and '<span class="trk"></span><span class="st"></span><span class="en"></span>' in html
    assert "↓" not in html


def test_card_without_labels_shows_the_instruction_and_no_number():
    html, _ = build_card_html(replica_html="<html></html>", replica_w=390, replica_h=800, annotations=[], title="t", instruction="點選帳戶")
    assert '<p class="sub">點選帳戶</p>' in html and 'class="num"' not in html and "<ul" not in html and '--step-num:"";' in html


def test_layout_goes_in_as_css_custom_properties():
    layout = default_layout(390, 800)
    layout["frame"] = {"x": 10, "y": 20, "w": 780}  # replica drawn at twice its size
    layout["title"]["number"] = False
    html, w = build_card_html(replica_html="<html></html>", replica_w=390, replica_h=800, annotations=[], title="t", instruction="i", layout=layout)
    assert w == layout["canvas"]["w"]
    assert "--frame-x:10px;--frame-y:20px;--frame-k:2.0000;" in html and "--number-display:none" in html
    layout["title"]["gap"] = 24
    assert layout_vars(layout, 390)["--number-gap"] == "24px"
    assert "--replica-w:390px;--replica-h:800px;" in html
    assert set(layout_vars(layout, 390)) == {
        "--canvas-w", "--canvas-h", "--canvas-margin", "--frame-x", "--frame-y", "--frame-k", "--frame-w",
        "--frame-h", "--frame-zoom", "--frame-ox", "--frame-oy",
        "--mask-display", "--mask-opacity", "--mask-pad", "--mask-radius", "--mask-blur", "--soft-opacity", "--ring-glow",
        "--text-x", "--text-y", "--text-w", "--text-gap", "--text-align", "--text-items", "--text-top", "--text-shift",
        "--title-size", "--number-display", "--number-gap", "--list-size", "--list-icon", "--list-gap"}
    # a frame with no height of its own falls back to the replica's, at the frame's scale
    assert layout_vars(layout, 390)["--frame-h"] == "calc(var(--replica-h) * var(--frame-k))"


def test_text_group_alignment_is_a_rule_the_page_lays_out_itself():
    layout = default_layout(390, 800)
    html, _ = build_card_html(replica_html="<html></html>", replica_w=390, replica_h=800, annotations=ANN, title="t", instruction="i", layout=layout)
    # title and list are one positioned group; the list is as wide as its widest row and never wider than the group
    assert '<div class="text"><div class="head">' in html and '</div><ul class="pts">' in html
    assert ".pts{width:max-content;max-width:100%;" in html and "text-align:left}" in html
    left = layout_vars(layout, 390)
    assert left["--text-align"] == "left" and left["--text-items"] == "flex-start"
    assert left["--text-top"] == "var(--text-y)" and left["--text-shift"] == "none"  # free: at its own y
    # centred: the title centres in the group and the list container centres under it, rows still left-aligned;
    # middle: the group's middle sits on the frame's, whatever the frame's height
    layout["text"] |= {"align": "center", "valign": "middle"}
    centred = layout_vars(layout, 390)
    assert centred["--text-align"] == "center" and centred["--text-items"] == "center"
    assert centred["--text-top"] == "calc(var(--frame-y) + var(--frame-h) / 2)" and centred["--text-shift"] == "translateY(-50%)"
    layout["text"]["valign"] = "bottom"
    assert layout_vars(layout, 390)["--text-shift"] == "translateY(-100%)"


def test_default_layout_puts_web_pages_above_the_text():
    mobile, web = default_layout(390, 844, "mobile_app"), default_layout(1280, 700, "web")
    assert mobile["text"]["x"] > mobile["frame"]["x"] + mobile["frame"]["w"]  # beside
    assert abs(mobile["canvas"]["h"] - mobile["canvas"]["w"] * 3 / 4) <= GRID  # 4:3, to the nearest grid step
    assert web["text"]["y"] > web["frame"]["y"] + 700 and web["text"]["x"] == web["frame"]["x"]  # below
    assert web["canvas"]["w"] <= 2400  # the renderer's limit
    tall = default_layout(390, 3000)
    assert tall["canvas"]["h"] >= 3000 and tall["frame"]["y"] >= 0


def test_the_frame_is_placed_by_rule_so_replicas_of_any_height_land_alike():
    layout = default_layout(390, 844)
    layout["frame"] |= {"x": 10, "y": 20, "align": "free", "valign": "free"}
    free = layout_vars(layout, 390)
    assert free["--frame-x"] == "10px" and free["--frame-y"] == "20px"  # its own coordinates
    # by rule: against the safe margin, or centred on the canvas — in CSS, so the height the
    # window ends up with (--frame-h, the replica's own when h is 0) is what centres it
    layout["frame"] |= {"align": "center", "valign": "middle"}
    ruled = layout_vars(layout, 390)
    # centred on the canvas, not between the margins: a tall window still gets equal air above and
    # below (the margin is a guide), and only the canvas's top edge clamps it
    assert ruled["--frame-x"] == "max(0px, (var(--canvas-w) - var(--frame-w)) / 2)"
    assert ruled["--frame-y"] == "max(0px, (var(--canvas-h) - var(--frame-h)) / 2)"
    layout["frame"] |= {"align": "left", "valign": "top"}
    assert layout_vars(layout, 390)["--frame-x"] == "var(--canvas-margin)" == layout_vars(layout, 390)["--frame-y"]
    layout["frame"] |= {"align": "right", "valign": "bottom"}
    edges = layout_vars(layout, 390)
    assert edges["--frame-x"] == "max(0px, var(--canvas-w) - var(--canvas-margin) - var(--frame-w))"
    assert edges["--frame-y"] == "max(0px, var(--canvas-h) - var(--canvas-margin) - var(--frame-h))"
    # the text group anchored to the window reads the same properties, so it follows the rule
    layout["text"]["valign"] = "middle"
    assert layout_vars(layout, 390)["--text-top"] == "calc(var(--frame-y) + var(--frame-h) / 2)"
    html, _ = build_card_html(replica_html="<html></html>", replica_w=390, replica_h=844, annotations=[], title="t",
                              instruction="i", layout=layout)
    assert "--canvas-margin:104px" in html and "--frame-w:390px" in html and "width:var(--frame-w)" in html


def test_replica_iframe_is_sandboxed():
    html, _ = build_card_html(replica_html="<html><body><script>1</script></body></html>", replica_w=390, replica_h=800,
                              annotations=[], title="t", instruction="i")
    assert re.search(r'<iframe sandbox="" srcdoc=', html)
    assert "<script>" not in html  # the replica only exists escaped inside srcdoc


def test_point_annotations_are_centred_on_the_point():
    points = [
        {"type": "tap", "label": "", "x": 0.5, "y": 0.25, "w": 0, "h": 0},
        {"type": "input", "label": "", "x": 0.5, "y": 0.5, "w": 0, "h": 0},
        {"type": "gesture", "label": "", "x": 0.5, "y": 0.75, "w": 0, "h": 0, "direction": "up"},
        {"type": "capture", "label": "", "x": 0.5, "y": 0.5, "w": 0, "h": 0},
    ]
    html, _ = build_card_html(replica_html="<html></html>", replica_w=400, replica_h=800, annotations=points, title="t", instruction="i")
    # tap: 48px ring centred on (200, 200)
    assert 'class="ring t-tap" style="left:176px;top:176px;width:48px;height:48px"' in html
    # input: 200x40 centred on (200, 400)
    assert 'class="ring box t-input" style="left:100px;top:380px;width:200px;height:40px"' in html
    # gesture: a zero-length upward swipe still draws a 64px trail from (200, 600), 28px thick, grown by the touch dot
    assert 'class="gest t-gesture up" style="left:186px;top:586px;width:28px;height:92px"' in html
    assert 'class="soft"' not in html  # a zero-size capture has nothing to highlight


def test_default_layout_lands_on_the_grid_with_a_shared_left_edge_and_a_safe_margin():
    for w, hh, channel in ((390, 844, "mobile_app"), (1280, 700, "web"), (430, 932, "mobile_app")):
        l = default_layout(w, hh, channel)
        values = [l["canvas"]["w"], l["canvas"]["h"], l["canvas"]["margin"], l["frame"]["x"], l["frame"]["y"],
                  l["text"]["x"], l["text"]["y"], l["text"]["w"], l["text"]["gap"], l["title"]["size"],
                  l["list"]["size"], l["list"]["icon"], l["list"]["gap"]]
        assert all(v % GRID == 0 for v in values), (channel, values)
        assert l["v"] == 2 and l["text"] == {**l["text"], "align": "left", "valign": "free"}  # one left edge, title at a fixed spot
        assert l["canvas"]["margin"] > 0 and l["frame"]["x"] >= l["canvas"]["margin"]
        # the frame starts unzoomed, showing the whole replica whatever its height (h 0), placed by rule
        assert l["frame"] == {"x": l["frame"]["x"], "y": l["frame"]["y"], "w": w, "h": 0, "zoom": 1.0, "ox": 0, "oy": 0,
                              "align": "free", "valign": "middle" if channel == "mobile_app" else "top"}
        assert l["mask"] == {"enabled": False, "opacity": 0.4, "pad": 6, "radius": 12, "blur": 0}
        assert l["title"] == {"size": l["title"]["size"], "number": True, "gap": 0}


def test_frame_zoom_and_offset_go_in_as_css_custom_properties():
    layout = default_layout(390, 844)
    layout["frame"] |= {"w": 390, "h": 500, "zoom": 2.0, "ox": -40, "oy": -300}
    vars_ = layout_vars(layout, 390)
    assert vars_["--frame-h"] == "500px" and vars_["--frame-zoom"] == "2.0000"
    assert vars_["--frame-ox"] == "-40px" and vars_["--frame-oy"] == "-300px"
    html, _ = build_card_html(replica_html="<html></html>", replica_w=390, replica_h=844, annotations=[], title="t",
                              instruction="i", layout=layout)
    # the replica moves and scales inside the frame; the overlays ride along because they share .inner
    assert "--frame-zoom:2.0000" in html and "height:var(--frame-h)" in html
    assert "scale(calc(var(--frame-k) * var(--frame-zoom)))" in html


def test_focus_mask_covers_everything_but_the_annotated_regions():
    on = default_layout(400, 800)
    on["mask"] |= {"enabled": True, "opacity": 0.6, "pad": 10, "radius": 20, "blur": 8}
    html, _ = build_card_html(replica_html="<html></html>", replica_w=400, replica_h=800, annotations=ANN, title="t",
                              instruction="i", layout=on)
    # a blur sheet and a dark sheet, both cut by one SVG mask with a hole per drawable annotation
    assert '<div class="blr"></div><svg class="msk"' in html and '<mask id="mk"' in html and 'mask="url(#mk)"' in html
    assert "--mask-display:block" in html and "--mask-opacity:0.600" in html
    assert "--mask-pad:10px" in html and "--mask-radius:20px" in html and "--mask-blur:8px" in html
    # with the mask on the hole is the highlight: no capture fill, no ring glow
    assert "--soft-opacity:0" in html and "--ring-glow:0px" in html
    # the holes' geometry is CSS that reads the padding and corner, so the editor changes them live; `note` never makes a hole
    assert html.count('<rect class="hole"') == 3
    assert 'style="x:calc(40px - var(--mask-pad));y:calc(160px - var(--mask-pad));width:calc(80px + var(--mask-pad) * 2);height:calc(40px + var(--mask-pad) * 2)"' in html
    assert ".msk .hole{fill:#000;rx:var(--mask-radius)}" in html and "backdrop-filter:blur(var(--mask-blur))" in html

    off = default_layout(400, 800)
    html_off, _ = build_card_html(replica_html="<html></html>", replica_w=400, replica_h=800, annotations=ANN, title="t",
                                  instruction="i", layout=off)
    assert '<svg class="msk"' in html_off and "--mask-display:none" in html_off  # drawn once, switched by the var
    assert "--mask-pad:6px" in html_off and "--mask-blur:0px" in html_off
    assert "--soft-opacity:1" in html_off and "--ring-glow:6px" in html_off  # without it, the highlights carry the card

    # nothing to focus on: no mask at all
    only_note = [{"type": "note", "label": "x", "x": 0.5, "y": 0.5, "w": 0, "h": 0}]
    html_none, _ = build_card_html(replica_html="<html></html>", replica_w=400, replica_h=800, annotations=only_note,
                                   title="t", instruction="i", layout=on)
    assert '<svg class="msk"' not in html_none and 'class="blr"' not in html_none


def test_focus_boxes_pad_the_drawn_regions_and_skip_notes():
    boxes = focus_boxes(ANN, 400, 800, 10)
    assert len(boxes) == 3
    assert boxes[0] == (0.1 * 400 - 10, 0.2 * 800 - 10, 0.2 * 400 + 20, 0.05 * 800 + 20)
    # the downward swipe in ANN: trail through the box centre (x=200), from y=640 for 80px, 28px thick, plus the dot and the pad
    assert boxes[2] == (200 - 14 - 10, 640 - 14 - 10, 28 + 20, 80 + 28 + 20)


def test_long_press_draws_ripples_around_the_touch_point():
    html, _ = build_card_html(replica_html="<html></html>", replica_w=400, replica_h=800, title="t", instruction="i",
                              annotations=[{"type": "gesture", "label": "長按", "x": 0.5, "y": 0.5, "w": 0, "h": 0, "direction": "long_press"}])
    d = 28 * 2.8
    assert f'class="gest t-gesture hold" style="left:{200 - d / 2:g}px;top:{400 - d / 2:g}px;width:{d:g}px;height:{d:g}px"' in html
    assert '<span class="r2"></span><span class="r1"></span><span class="en"></span>' in html


def test_sized_annotations_keep_their_box():
    html, _ = build_card_html(replica_html="<html></html>", replica_w=400, replica_h=800, title="t", instruction="i",
                              annotations=[{"type": "tap", "label": "", "x": 0.1, "y": 0.1, "w": 0.25, "h": 0.05}])
    assert 'class="ring t-tap" style="left:40px;top:80px;width:100px;height:40px"' in html
