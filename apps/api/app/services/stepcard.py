"""Step Card renderer (SPEC §9): the replica in a soft frame, a large step
number and title, then one row per annotation — a line icon for its type and
a short label. Each type keeps its editor colour (the boxes drawn in the admin
sheet), so the icon, its highlight on the replica and the editor all read as
the same thing.

Where things sit is a *layout* (SPEC §9.1): the canvas, the replica frame
and one text group (title, then the list) with its alignment rules. The
tenant keeps a template per channel; a step stores only the keys it changes
(see card_context.merge_layout). `default_layout` derives the built-in
template from the Figma design (Plankton, node 404:23) and the replica size.
Every layout value goes into the page as a CSS custom property, and the text
group lays itself out with CSS — the list is as wide as its widest row, so
the browser measures the text and the editor never has to — which is what
lets the editor move blocks live by changing the properties instead of
re-rendering the page."""

from __future__ import annotations

import html as h
from functools import cache
from pathlib import Path

LIMITS = {"title": 12, "instruction": 40, "label": 30}

# Same colours as the annotation tools in the editor (frontend/src/index.css --ann-*).
TYPE_COLOR = {"tap": "#2f6fed", "capture": "#f59e0b", "input": "#10b981", "gesture": "#8b5cf6", "note": "#6b7280"}

PALETTE = {
    "light": {"bg": "#f2f2f7", "ink": "#1d1d1f", "num": "#8e8e93", "frame": "#ffffff", "shadow": "rgba(0,0,0,.05)", "note": TYPE_COLOR["note"], "mask": "#0b0b0f"},
    "dark": {"bg": "#000000", "ink": "#f5f5f7", "num": "#8e8e93", "frame": "#1c1c1e", "shadow": "rgba(0,0,0,.6)", "note": "#a1a1a6", "mask": "#000000"},
}

# Design sizes (px on the Figma frame, where the phone replica is 472 wide).
D_FRAME_W, D_TEXT_W, D_PAD, D_GAP = 472, 1192, 128, 128
DEFAULT_ROWS = 5  # rows the default layout leaves room for
GRID = 8  # every default value lands on this grid, the same one the editor snaps to
# The focus mask: everything but the annotated regions goes dark (and, if wanted, soft), so the eye lands
# where the step happens. With the mask on, the hole *is* the highlight: the capture fill and the rings'
# outer glow step back (--soft-opacity / --ring-glow) so the region is not wrapped in three layers of chrome.
DEFAULT_MASK = {"enabled": False, "opacity": 0.4, "pad": 6, "radius": 12, "blur": 0}


def _g(v: float, lo: int = 0) -> int:
    """Nearest multiple of the 8 px grid, never below `lo`."""
    return max(lo, int(round(v / GRID)) * GRID)

ICON_DIR = Path(__file__).with_name("stepcard_icons")

# The swipe glyph (mirrored by frontend/src/components/variant/GestureGlyph.tsx):
# no arrows — a thin ring where the finger first touches, a trail that gathers
# colour along the path, and a solid touch dot where the finger ends. A long
# press is the dot held still with two ripples. GESTURE_T is the trail's
# thickness and the dot's diameter, in replica px (the phone replica is 390 wide).
GESTURE_T = 28
GESTURE_DEFAULT_LEN = 64  # trail length for old gesture boxes that never had one


def default_layout(replica_w: int, replica_h: int, channel: str = "mobile_app") -> dict:
    """The design's layout for a replica of this size: phone replicas sit beside
    the text on a 4:3 board, web pages above it. Every value is snapped to the
    8 px grid. The text group sits at a fixed spot (where a five-row group
    would be centred on the frame), so every step of a flow opens with its
    title in the same place, and everything shares one left edge — the Apple
    poster way. The window is placed by rule, not by its `y`: centred on the
    board beside the text, or on the safe margin above it, so screenshots of
    another height still land in the same place."""
    horizontal = channel == "mobile_app"
    s = replica_w / (D_FRAME_W if horizontal else D_TEXT_W)
    pad, gap = _g(D_PAD * s, GRID), _g(D_GAP * s, GRID)
    title_size, list_size, icon, row_gap = (_g(v * s, GRID) for v in (96, 48, 96, 48))
    head_h, head_gap = _g(title_size * 1.2 * 2, GRID), _g(64 * s, GRID)
    list_h = DEFAULT_ROWS * icon + (DEFAULT_ROWS - 1) * row_gap
    if horizontal:
        text_w = _g(D_TEXT_W * s, GRID)
        cw = _g(replica_w + gap + text_w + pad * 2)
        ch = max(_g(cw * 3 / 4), _g(replica_h + pad * 2))
        tx, ty = _g(pad + replica_w + gap), max(pad, _g((ch - head_h - head_gap - list_h) / 2))
        frame = {"x": pad, "y": max(0, _g((ch - replica_h) / 2)), "w": replica_w}
    else:
        text_w = replica_w
        tx, ty = pad, _g(pad + replica_h + gap)
        cw = _g(replica_w + pad * 2)
        ch = _g(ty + head_h + head_gap + list_h + pad)
        frame = {"x": pad, "y": pad, "w": replica_w}
    # h 0: the window shows the whole replica, whatever its height; the rule then places it
    frame |= {"h": 0, "zoom": 1.0, "ox": 0, "oy": 0, "align": "free", "valign": "middle" if horizontal else "top"}
    return {
        "v": 2,
        "canvas": {"w": cw, "h": ch, "margin": pad},
        "frame": frame,
        "text": {"x": tx, "y": ty, "w": text_w, "align": "left", "valign": "free", "gap": head_gap},
        "title": {"size": title_size, "number": True, "gap": 0},
        "list": {"size": list_size, "icon": icon, "gap": row_gap},
        "mask": dict(DEFAULT_MASK),
    }


@cache
def _icon_svg(name: str) -> str:
    return (ICON_DIR / f"{name}.svg").read_text()


def _gesture_icon(direction: str) -> str:
    """The list icon for a gesture: the same comet as the glyph on the replica —
    a touch dot with two fading dots behind it, turned to the swipe's direction;
    a long press is the dot inside two ripples."""
    if direction == "long_press":
        body = ('<circle cx="48" cy="48" r="13" fill="currentColor"/>'
                '<circle cx="48" cy="48" r="24" stroke="currentColor" stroke-width="6" fill="none" opacity=".55"/>'
                '<circle cx="48" cy="48" r="38" stroke="currentColor" stroke-width="5" fill="none" opacity=".25"/>')
    else:
        rot = {"up": 0, "down": 180, "left": -90, "right": 90}.get(direction, 0)
        body = (f'<g transform="rotate({rot} 48 48)"><circle cx="48" cy="24" r="13" fill="currentColor"/>'
                '<circle cx="48" cy="52" r="9" fill="currentColor" opacity=".5"/>'
                '<circle cx="48" cy="74" r="6" fill="currentColor" opacity=".25"/></g>')
    return f'<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">{body}</svg>'


def _icon(a: dict) -> str:
    t = a.get("type", "note")
    t = t if t in TYPE_COLOR else "note"
    if t == "gesture":
        return f'<span class="ic t-gesture">{_gesture_icon(a.get("direction", ""))}</span>'
    return f'<span class="ic t-{t}">{_icon_svg(t)}</span>'


def _is_hold(a: dict) -> bool:
    """A long press: asked for, or an old point with no direction. A zero-length swipe still draws as a swipe."""
    d = a.get("direction", "")
    return d == "long_press" or (not d and not float(a.get("w", 0) or 0) and not float(a.get("h", 0) or 0))


def _gesture_box(a: dict, fw: int, fh: int) -> tuple[float, float, float, float]:
    """The swipe glyph's box on the replica: the trail's bounding box grown by
    the touch dot. Old rectangular gesture boxes get a trail through their
    centre along their longer side."""
    x, y, w, hh = (float(a.get(k, 0) or 0) for k in ("x", "y", "w", "h"))
    px, py, pw, ph = x * fw, y * fh, w * fw, hh * fh
    t = GESTURE_T
    if _is_hold(a):
        d = t * 2.8
        return px + pw / 2 - d / 2, py + ph / 2 - d / 2, d, d
    d = a.get("direction", "")
    vertical = True if d in ("up", "down") else False if d in ("left", "right") else ph >= pw
    if vertical:
        return px + pw / 2 - t / 2, py - t / 2, t, (ph or GESTURE_DEFAULT_LEN) + t
    return px - t / 2, py + ph / 2 - t / 2, (pw or GESTURE_DEFAULT_LEN) + t, t


# Default drawn size (CSS px) for annotations placed as a single point.
POINT_SIZE = {"tap": (48, 48), "input": (200, 40)}


def _px_box(a: dict, fw: int, fh: int) -> tuple[float, float, float, float] | None:
    """Where an annotation lands on the replica, in replica px. None when the
    type draws nothing (`note`) or a capture has no area to highlight."""
    t = a.get("type", "note")
    if t not in ("tap", "input", "gesture", "capture"):
        return None  # note: text-only, nothing drawn
    if t == "gesture":
        return _gesture_box(a, fw, fh)
    x, y, w, hh = (float(a.get(k, 0) or 0) for k in ("x", "y", "w", "h"))
    px, py, pw, ph = x * fw, y * fh, w * fw, hh * fh
    if t == "capture":
        if not (pw and ph):
            return None
    elif w == 0 and hh == 0:
        # a point marks the centre of the target, the way the editor draws it
        pw, ph = POINT_SIZE[t]
        px, py = px - pw / 2, py - ph / 2
    else:
        pw, ph = pw or POINT_SIZE[t][0], ph or POINT_SIZE[t][1]
    return px, py, pw, ph


def focus_boxes(annotations: list[dict], fw: int, fh: int, pad: float = 0) -> list[tuple[float, float, float, float]]:
    """The regions the step is about, in replica px, each grown by `pad`. The
    editor's 自動聚焦 computes the same union to frame the shot."""
    out = []
    for a in annotations:
        b = _px_box(a, fw, fh)
        if b:
            out.append((b[0] - pad, b[1] - pad, b[2] + pad * 2, b[3] + pad * 2))
    return out


def _mask_svg(annotations: list[dict], fw: int, fh: int) -> str:
    """The focus sheet: a blur layer and a dark layer over the replica, both
    cut by one SVG mask with a rounded hole per focus region. The holes are
    rects whose geometry is CSS — grown by --mask-pad, rounded by
    --mask-radius — and the blur reads --mask-blur, so the editor changes all
    three live through the custom properties, like every other layout value.
    Drawn once and switched on or off through --mask-display."""
    boxes = [b for b in focus_boxes(annotations, fw, fh) if b[2] > 0 and b[3] > 0]
    if not boxes:
        return ""
    holes = "".join(
        f'<rect class="hole" style="x:calc({x:g}px - var(--mask-pad));y:calc({y:g}px - var(--mask-pad));'
        f'width:calc({w:g}px + var(--mask-pad) * 2);height:calc({h:g}px + var(--mask-pad) * 2)"/>'
        for x, y, w, h in boxes)
    return (f'<div class="blr"></div>'
            f'<svg class="msk" width="{fw}" height="{fh}" viewBox="0 0 {fw} {fh}">'
            f'<defs><mask id="mk" maskUnits="userSpaceOnUse" x="0" y="0" width="{fw}" height="{fh}">'
            f'<rect width="{fw}" height="{fh}" fill="#fff"/>{holes}</mask></defs>'
            f'<rect class="dim" width="{fw}" height="{fh}" mask="url(#mk)"/></svg>')


def _overlay(a: dict, fw: int, fh: int) -> str:
    t = a.get("type", "note")
    b = _px_box(a, fw, fh)
    if b is None:
        return ""
    px, py, pw, ph = b
    box = f"left:{px:g}px;top:{py:g}px;width:{pw:g}px;height:{ph:g}px"
    if t == "tap":
        return f'<div class="ring t-tap" style="{box}"></div>'
    if t == "input":
        ex = h.escape(a.get("example_text", ""))
        return f'<div class="ring box t-input" style="{box}">{f"<span class=ex>{ex}</span>" if ex else ""}</div>'
    if t == "capture":
        return f'<div class="soft t-capture" style="{box}"></div>'
    if _is_hold(a):
        return f'<div class="gest t-gesture hold" style="{box}"><span class="r2"></span><span class="r1"></span><span class="en"></span></div>'
    d = a.get("direction", "")
    if d not in ("up", "down", "left", "right"):
        d = "down" if ph > pw else "right"
    return f'<div class="gest t-gesture {d}" style="{box}"><span class="trk"></span><span class="st"></span><span class="en"></span></div>'


def _placed(rule: str, free: str, size: str, extent: str) -> str:
    """Where a block's edge sits: at its own coordinate (`free`), or by rule on
    the canvas — against the safe margin, or centred on the canvas itself.

    Centring is centring: a block taller than the space between the margins
    still gets equal air above and below, because the margin is a guide, not a
    frame that crops (SPEC §9.1). The only clamp is the canvas's own edge, so a
    block taller than the whole canvas runs off the bottom — which the page
    grows to hold — instead of off the top, which would be cut away."""
    pad = "var(--canvas-margin)"
    return {
        "start": pad,
        "center": f"max(0px, ({extent} - {size}) / 2)",
        "end": f"max(0px, {extent} - {pad} - {size})",
    }.get(rule, free)


def layout_vars(layout: dict, replica_w: int) -> dict[str, str]:
    """The CSS custom properties a layout sets on :root. The editor writes the
    same names into the live preview."""
    c, f, t, ti, li = layout["canvas"], layout["frame"], layout["text"], layout["title"], layout["list"]
    m = layout.get("mask") or DEFAULT_MASK
    centred = t.get("align", "left") == "center"
    # the window is placed by its own x / y, or by a rule on the canvas — so replicas of
    # another height keep the same place on the card (and the text anchored to it follows)
    fx = _placed({"left": "start", "center": "center", "right": "end"}.get(f.get("align", "free"), ""),
                 f"{f['x']}px", "var(--frame-w)", "var(--canvas-w)")
    fy = _placed({"top": "start", "middle": "center", "bottom": "end"}.get(f.get("valign", "free"), ""),
                 f"{f['y']}px", "var(--frame-h)", "var(--canvas-h)")
    return {
        "--canvas-w": f"{c['w']}px", "--canvas-h": f"{c['h']}px", "--canvas-margin": f"{c.get('margin', 64)}px",
        "--frame-x": fx, "--frame-y": fy, "--frame-k": f"{f['w'] / replica_w:.4f}", "--frame-w": f"{f['w']}px",
        # the frame is the window; zoom and offset move the replica inside it, overlays and all
        "--frame-h": f"{f['h']}px" if f.get("h") else "calc(var(--replica-h) * var(--frame-k))",
        "--frame-zoom": f"{float(f.get('zoom', 1) or 1):.4f}",
        "--frame-ox": f"{f.get('ox', 0) or 0}px", "--frame-oy": f"{f.get('oy', 0) or 0}px",
        "--mask-display": "block" if m.get("enabled") else "none",
        "--mask-opacity": f"{float(m.get('opacity', 0.4)):.3f}",
        "--mask-pad": f"{m.get('pad', 6)}px", "--mask-radius": f"{m.get('radius', 12)}px", "--mask-blur": f"{m.get('blur', 0)}px",
        "--soft-opacity": "0" if m.get("enabled") else "1",
        "--ring-glow": "0px" if m.get("enabled") else "6px",
        # the text group: one anchor, one axis; the list is as wide as its widest row
        "--text-x": f"{t['x']}px", "--text-y": f"{t['y']}px", "--text-w": f"{t['w']}px", "--text-gap": f"{t.get('gap', 48)}px",
        "--text-align": "center" if centred else "left", "--text-items": "center" if centred else "flex-start",
        # vertical: the group's own y, or its top / middle / bottom on the frame's
        "--text-top": {"top": "var(--frame-y)", "middle": "calc(var(--frame-y) + var(--frame-h) / 2)",
                       "bottom": "calc(var(--frame-y) + var(--frame-h))"}.get(t.get("valign", "free"), "var(--text-y)"),
        "--text-shift": {"middle": "translateY(-50%)", "bottom": "translateY(-100%)"}.get(t.get("valign", "free"), "none"),
        "--title-size": f"{ti['size']}px", "--number-display": "block" if ti.get("number", True) else "none",
        "--number-gap": f"{ti.get('gap', 0)}px",
        "--list-size": f"{li['size']}px", "--list-icon": f"{li['icon']}px", "--list-gap": f"{li['gap']}px",
    }


def build_card_html(*, replica_html: str, replica_w: int, replica_h: int, annotations: list[dict],
                    title: str, instruction: str, theme: str = "light", layout: dict | None = None,
                    channel: str = "mobile_app", step_number: int | None = None) -> tuple[str, int]:
    """Returns (card_html, card_css_width). `instruction` only shows when no
    annotation has a label, so a card never ends up with a bare title. The
    canvas height is a minimum: a long label list extends the page rather
    than being cut off. The step number goes in as one CSS value
    (--step-num) that the `.num` block prints, so a copy of the page with
    another number is a one-token change (see numbered_card.py)."""
    c = PALETTE["dark" if theme == "dark" else "light"]
    layout = layout or default_layout(replica_w, replica_h, channel)
    overlays = "".join(_overlay(a, replica_w, replica_h) for a in annotations)
    mask = _mask_svg(annotations, replica_w, replica_h)
    rows = [(a, a.get("label", "").strip()) for a in annotations if a.get("label", "").strip()]
    if rows:
        body = "".join(f'<li>{_icon(a)}<span>{h.escape(label)}</span></li>' for a, label in rows)
        body, sub = f'<ul class="pts">{body}</ul>', ""  # the list measures itself: as wide as its widest row
    else:
        body, sub = "", f'<p class="sub">{h.escape(instruction)}</p>' if instruction.strip() else ""
    number = '<div class="num"></div>' if step_number else ""
    colors = "".join(f".t-{t}{{--c:{col}}}" for t, col in TYPE_COLOR.items()) + f".ic.t-note{{--c:{c['note']}}}"
    root = ";".join(f"{k}:{v}" for k, v in layout_vars(layout, replica_w).items())
    srcdoc = h.escape(replica_html, quote=True)
    return (f"""<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><style>
:root{{--replica-w:{replica_w}px;--replica-h:{replica_h}px;--step-num:"{step_number or ''}";{root}}}
html,body{{margin:0;background:{c['bg']};font-family:"Noto Sans TC","Noto Sans CJK TC","PingFang TC",-apple-system,sans-serif;color:{c['ink']};-webkit-font-smoothing:antialiased}}
body{{position:relative;width:var(--canvas-w);min-height:var(--canvas-h)}}
{colors}
.frame{{position:absolute;left:var(--frame-x);top:var(--frame-y);width:var(--frame-w);height:var(--frame-h);border-radius:calc(var(--frame-w) * 24 / 472);overflow:hidden;background:{c['frame']};box-shadow:0 0 calc(var(--frame-w) * 80 / 472) {c['shadow']}}}
.inner{{position:relative;width:var(--replica-w);height:var(--replica-h);transform-origin:0 0;transform:translate(calc(var(--frame-ox) * var(--frame-k) * var(--frame-zoom)),calc(var(--frame-oy) * var(--frame-k) * var(--frame-zoom))) scale(calc(var(--frame-k) * var(--frame-zoom)))}}
.inner iframe{{border:0;width:var(--replica-w);height:var(--replica-h);display:block}}
.msk{{position:absolute;left:0;top:0;display:var(--mask-display);pointer-events:none}}
.msk .dim{{fill:{c['mask']};opacity:var(--mask-opacity)}}
.msk .hole{{fill:#000;rx:var(--mask-radius)}}
.blr{{position:absolute;inset:0;display:var(--mask-display);pointer-events:none;-webkit-backdrop-filter:blur(var(--mask-blur));backdrop-filter:blur(var(--mask-blur));-webkit-mask:url(#mk);mask:url(#mk)}}
.ov{{position:absolute;inset:0;pointer-events:none}}
.ring{{position:absolute;border:3px solid var(--c);border-radius:999px;box-sizing:border-box;box-shadow:0 0 0 var(--ring-glow) color-mix(in srgb,var(--c) 16%,transparent)}}
.ring.box{{border-radius:12px;display:flex;align-items:center;padding:0 12px}}
.ex{{font-size:15px;font-weight:600;color:var(--c)}}
.soft{{position:absolute;border-radius:16px;opacity:var(--soft-opacity);background:color-mix(in srgb,var(--c) 16%,transparent);box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--c) 55%,transparent)}}
.gest{{position:absolute;--t:{GESTURE_T}px}}
.gest span{{position:absolute;display:block;box-sizing:border-box;border-radius:999px}}
.gest .trk{{inset:0;background:linear-gradient(var(--dir),transparent,color-mix(in srgb,var(--c) 45%,transparent))}}
.gest .st{{width:var(--t);height:var(--t);border:2.5px solid color-mix(in srgb,var(--c) 70%,transparent)}}
.gest .en{{width:var(--t);height:var(--t);background:var(--c);box-shadow:0 0 0 2.5px rgba(255,255,255,.85),0 2px 6px rgba(0,0,0,.18)}}
.gest.up{{--dir:to top}}.gest.up .st{{left:0;bottom:0}}.gest.up .en{{left:0;top:0}}
.gest.down{{--dir:to bottom}}.gest.down .st{{left:0;top:0}}.gest.down .en{{left:0;bottom:0}}
.gest.left{{--dir:to left}}.gest.left .st{{right:0;top:0}}.gest.left .en{{left:0;top:0}}
.gest.right{{--dir:to right}}.gest.right .st{{left:0;top:0}}.gest.right .en{{right:0;top:0}}
.gest.hold .en,.gest.hold .r1,.gest.hold .r2{{left:50%;top:50%;transform:translate(-50%,-50%)}}
.gest.hold .r1{{width:calc(var(--t) * 1.9);height:calc(var(--t) * 1.9);border:2.5px solid color-mix(in srgb,var(--c) 55%,transparent)}}
.gest.hold .r2{{width:calc(var(--t) * 2.8);height:calc(var(--t) * 2.8);border:2px solid color-mix(in srgb,var(--c) 28%,transparent)}}
.text{{position:absolute;left:var(--text-x);top:var(--text-top);width:var(--text-w);display:flex;flex-direction:column;align-items:var(--text-items);gap:var(--text-gap);transform:var(--text-shift)}}
.head{{width:100%;text-align:var(--text-align);font-size:var(--title-size);line-height:1.2}}
.num{{display:var(--number-display);font-weight:800;color:{c['num']};margin-bottom:var(--number-gap)}}
.num::before{{content:var(--step-num)}}
h1{{margin:0;font-size:inherit;font-weight:700;letter-spacing:.03em}}
.sub{{margin:.4em 0 0;font-size:calc(var(--title-size) * 40 / 96);line-height:1.5;color:{c['num']}}}
.pts{{width:max-content;max-width:100%;box-sizing:border-box;list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--list-gap);font-size:var(--list-size)}}
.pts li{{display:flex;align-items:center;gap:calc(var(--list-icon) / 3);line-height:1.35;font-weight:500;letter-spacing:.03em;text-align:left}}
.ic{{flex:none;display:block;width:var(--list-icon);height:var(--list-icon);color:var(--c)}}
.ic svg{{display:block;width:100%;height:100%}}
</style></head><body>
<div class="frame"><div class="inner"><iframe sandbox="" srcdoc="{srcdoc}" scrolling="no"></iframe>{mask}<div class="ov">{overlays}</div></div></div>
<div class="text"><div class="head">{number}<h1>{h.escape(title)}</h1>{sub}</div>{body}</div>
</body></html>""", layout["canvas"]["w"])
