"""Programmatic checks on a replica (SPEC §7.3). Any failure feeds the
generate → check → regenerate loop with concrete feedback.

Two layers:

* `unsafe_html_problems` — static safety. Runs before the HTML ever reaches
  the renderer (and on admin-edited HTML). A replica must be inert markup +
  inline CSS: no script, no event handlers, no navigation/embedding elements,
  no URLs other than inline images and in-document fragments.
* `check_replica` — the full report after rendering: safety again, leaked data
  strings, keep_text presence, rendered width, document shape.
"""

from __future__ import annotations

import html as html_mod
import re
from html.parser import HTMLParser

# Elements that execute code, load or embed other documents, submit, or change
# how the document resolves URLs. Matched on the parsed tag name (HTML and SVG).
BLOCKED_TAGS = frozenset({
    "script", "iframe", "frame", "frameset", "object", "embed", "applet", "portal",
    "form", "base", "link", "audio", "video", "source", "track", "noscript",
})
# Attributes that carry a URL. Only inline raster images (src) and in-document
# fragments (href="#id", used by SVG <use>) are allowed.
URL_ATTRS = frozenset({
    "src", "href", "xlink:href", "action", "formaction", "poster", "background", "data",
    "codebase", "cite", "longdesc", "lowsrc", "dynsrc", "ping", "manifest", "usemap", "archive",
})
SAFE_DATA_IMAGE = re.compile(r"^data:image/(png|jpe?g|gif|webp|avif);", re.I)
# CSS that loads resources or runs code (style elements and style attributes).
UNSAFE_CSS = re.compile(r"url\s*\(|@import|expression\s*\(|-moz-binding|behavior\s*:|javascript:", re.I)
SCRIPT_SCHEME = re.compile(r"(java|vb)script:|livescript:", re.I)
# Raw-text backstops for markup the parser might read differently from a browser.
RAW_PATTERNS = (
    re.compile(r"<\s*script\b", re.I),
    re.compile(r"<[^>]*[\s/\"']on[a-z]+\s*=", re.I),
    re.compile(r"\bsrcdoc\s*=", re.I),
    re.compile(r"<\s*meta\b[^>]*http-equiv", re.I),
)
EXTERNAL_URL = re.compile(r"(https?:)?//[a-z0-9][\w.-]*\.[a-z]{2,}", re.I)
XMLNS_ATTR = re.compile(r"""\sxmlns(:\w+)?\s*=\s*("[^"]*"|'[^']*')""", re.I)
CONTROL_CHARS = re.compile(r"[\x00-\x20]+")

LEAK_PROBLEM_PREFIX = "復刻中出現原圖的資料字串，必須移除或換成假資料："
BLOCK_PROBLEM_PREFIX = "遮蔽框（block）內的內容必須整塊換成單一色塊，不可重製其文字："
REDACTED = "＊＊＊"

# ---- 平台脈絡 (SPEC §6.5): 示範資料 and the shared component library
DEMO_DATA_PROBLEM = "資料區域沒有使用平台的示範資料（%s），這些值必須逐字出現"
COMPONENT_CHANGED_PROBLEM = "共用元件「%s」被改動"
COMPONENT_MISSING_PROBLEM = "未使用共用元件「%s」"
# which Agent A flag makes a component of that kind mandatory on a screen
COMPONENT_REQUIRED_BY = {"tab_bar": "has_tab_bar", "nav_bar": "has_nav_bar", "header": "has_nav_bar"}
COMPONENT_MARK = re.compile(r"""data-component\s*=\s*["']?([A-Za-z0-9_-]{1,64})""", re.I)
VOID_TAGS = frozenset({"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"})
# state markers Agent B is allowed to move between items of a shared component
STATE_ATTRS = frozenset({"aria-current", "aria-selected"})
STATE_CLASSES = frozenset({"selected"})


class _SafetyScanner(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.problems: list[str] = []
        self._in_style = False

    def _add(self, msg: str) -> None:
        if msg not in self.problems:
            self.problems.append(msg)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in BLOCKED_TAGS:
            self._add(f"不得使用 <{tag}> 元素")
        if tag == "style":
            self._in_style = True
        names = {n.lower(): (v or "") for n, v in attrs}
        if tag == "meta" and "http-equiv" in names:
            self._add("不得使用 <meta http-equiv>")
        if tag in ("animate", "set", "animatemotion", "animatetransform"):
            target = names.get("attributename", "").strip().lower()
            if target in ("href", "xlink:href") or target.startswith("on"):
                self._add(f"不得以 SVG <{tag}> 改寫 {target}")
        for name, value in names.items():
            compact = CONTROL_CHARS.sub("", value)
            if name.startswith("on"):
                self._add(f"不得使用事件處理屬性（{name}）")
            elif name == "srcdoc":
                self._add("不得使用 srcdoc 屬性")
            elif name == "srcset":
                self._add("不得使用 srcset 屬性")
            elif name == "style" and UNSAFE_CSS.search(value):
                self._add("style 屬性不得含 url()、@import 或 expression()")
            elif name in URL_ATTRS:
                fragment = name in ("href", "xlink:href") and compact.startswith("#")
                inline_image = name == "src" and SAFE_DATA_IMAGE.match(compact)
                if not (fragment or inline_image):
                    self._add(f"{name} 只能是頁內錨點或 data:image（目前為「{value[:40]}」）")
            if SCRIPT_SCHEME.search(compact):
                self._add("不得使用 javascript: 網址")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() == "style":
            self._in_style = False

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "style":
            self._in_style = False

    def handle_data(self, data: str) -> None:
        if self._in_style and UNSAFE_CSS.search(data):
            self._add("<style> 內不得含 url()、@import 或 expression()")


def unsafe_html_problems(html: str) -> list[str]:
    """Static safety check for replica HTML. Returns zh-TW problems; an empty
    list means the markup is inert (no script, handlers, embedding, forms,
    base/meta refresh, javascript: or external URLs). Safe to call on
    admin-edited HTML before storing or rendering it."""
    scanner = _SafetyScanner()
    try:
        scanner.feed(html)
        scanner.close()
    except Exception:  # HTMLParser is lenient; treat anything it chokes on as unsafe
        scanner.problems.append("HTML 無法解析")
    problems = scanner.problems
    decoded = html_mod.unescape(html)
    for pattern in RAW_PATTERNS:
        if pattern.search(html) or pattern.search(decoded):
            problems.append("HTML 含可執行內容（script、事件處理屬性、srcdoc 或 meta http-equiv）")
            break
    if SCRIPT_SCHEME.search(CONTROL_CHARS.sub("", decoded)) and "不得使用 javascript: 網址" not in problems:
        problems.append("不得使用 javascript: 網址")
    if EXTERNAL_URL.search(XMLNS_ATTR.sub("", decoded)):
        problems.append("HTML 引用了外部網址，必須完全自包含")
    return list(dict.fromkeys(problems))


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s).lower()


def _visible_text(html: str) -> str:
    """Whitespace-free lowercase text of the document body (styles and tags gone)."""
    body = _norm(re.sub(r"<style.*?</style>", "", html, flags=re.S | re.I))
    return re.sub(r"<[^>]+>", "", body)


class _Normalizer(HTMLParser):
    """Re-serialises markup so that indentation, attribute order, quoting and
    the selected-state markers cannot be mistaken for an edit to a snippet."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []

    def _tag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        parts = []
        for name, value in attrs:
            name = name.lower()
            if name in STATE_ATTRS:
                continue
            value = value or ""
            if name == "class":
                tokens = [t for t in value.split() if t not in STATE_CLASSES]
                if not tokens:
                    continue
                value = " ".join(sorted(tokens))
            parts.append(f'{name}="{html_mod.escape(value, quote=True)}"')
        self.out.append(f"<{tag.lower()}{''.join(' ' + p for p in sorted(parts))}>")

    def handle_starttag(self, tag: str, attrs) -> None:
        self._tag(tag, attrs)

    def handle_startendtag(self, tag: str, attrs) -> None:
        self._tag(tag, attrs)
        if tag.lower() not in VOID_TAGS:  # <path/> and <path></path> are the same element
            self.out.append(f"</{tag.lower()}>")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() not in VOID_TAGS:
            self.out.append(f"</{tag.lower()}>")

    def handle_data(self, data: str) -> None:
        text = re.sub(r"\s+", " ", data).strip()
        if text:
            self.out.append(text)


def normalize_component_html(html: str) -> str:
    """Canonical form used to compare a stored component snippet with what came
    back from Agent B. Ignores whitespace, attribute order and the
    `selected` class / `aria-current` markers (the one edit Agent B may make)."""
    n = _Normalizer()
    try:
        n.feed(html)
        n.close()
    except Exception:
        return re.sub(r"\s+", " ", html).strip()
    return "".join(n.out)


def demo_data_problems(html: str, *, focus_boxes: list[dict], demo_data: list[dict]) -> list[str]:
    """示範資料 check (SPEC §6.5). Deliberately conservative on both sides: only a
    replica the clerk marked as showing data (at least one `data_region` focus
    box) is checked at all, and it only has to carry *some* of the persona — a
    transaction list never shows every field, so demanding each one would fault
    honest screens. What this catches is Agent B ignoring the persona outright."""
    values = [str((f or {}).get("value") or "").strip() for f in demo_data or []]
    values = [v for v in values if v]
    if not values or not any((b or {}).get("type") == "data_region" for b in focus_boxes or []):
        return []
    body = _visible_text(html)
    if any(_norm(v) in body for v in values):
        return []
    return [DEMO_DATA_PROBLEM % "、".join(values[:4])]


def component_problems(html: str, *, structure: dict, components: list[dict]) -> list[str]:
    """共用元件 check (SPEC §6.5). A snippet that is present must be byte-for-byte
    the stored one once normalised; a snippet whose kind the structure analysis
    says the screen has (tab bar / nav bar) must not be missing."""
    if not components:
        return []
    marks = {m.lower() for m in COMPONENT_MARK.findall(html)}
    normalized = normalize_component_html(html)
    problems = []
    for c in components:
        cid = str((c or {}).get("id") or "").lower()
        name = c.get("name") or c.get("kind") or cid
        if cid and cid in marks:
            if normalize_component_html(c.get("html") or "") not in normalized:
                problems.append(COMPONENT_CHANGED_PROBLEM % name)
        elif (structure or {}).get(COMPONENT_REQUIRED_BY.get(c.get("kind") or "", "")):
            problems.append(COMPONENT_MISSING_PROBLEM % name)
    return problems


def check_replica(html: str, *, structure: dict, focus_boxes: list[dict], kept_texts: list[str],
                  rendered_width: int | None, expected_width: int,
                  demo_data: list[dict] | None = None, components: list[dict] | None = None) -> dict:
    problems: list[str] = []
    body = _visible_text(html)

    # 1. inert and self-contained
    unsafe = unsafe_html_problems(html)
    if unsafe:
        problems.append("HTML 安全檢查未通過：" + "；".join(unsafe[:6]))

    # 2. leaked data strings: anything the analysis flagged as sensitive that is
    #    not on the kept list must be absent from the HTML
    allowed = {_norm(t) for t in kept_texts} | {_norm(t) for t in structure.get("structural_texts", [])}
    # 示範資料 is content the clerk typed for the page (SPEC §6.5) — the check
    # below wants it there, so it can never count as leaked original data.
    allowed |= {_norm(str((f or {}).get("value") or "")) for f in demo_data or []}
    focus_ids = {b["id"] for b in focus_boxes if b.get("type") == "keep_text"}
    for m in structure.get("focus_mappings", []):
        if m.get("focus_box_id") in focus_ids:
            allowed |= {_norm(t) for t in m.get("texts", [])}
    leaked = []
    for t in structure.get("sensitive_texts", []):
        n = _norm(t)
        if len(n) >= 2 and n not in allowed and n in body:
            leaked.append(t)
    if leaked:
        problems.append(LEAK_PROBLEM_PREFIX + "、".join(leaked[:10]))

    # 3. keep_text focus boxes: their texts must be present verbatim
    missing = []
    for m in structure.get("focus_mappings", []):
        if m.get("focus_box_id") in focus_ids:
            for t in m.get("texts", []):
                if len(_norm(t)) >= 1 and _norm(t) not in body:
                    missing.append(t)
    if missing:
        problems.append("keep_text 焦點框內的文字必須逐字出現：" + "、".join(missing[:10]))

    # 3b. block focus boxes (ads, banners): nothing the analysis read inside
    #     them may survive — the whole region becomes one plain block
    block_ids = {b["id"] for b in focus_boxes if b.get("type") == "block"}
    blocked = []
    for m in structure.get("focus_mappings", []):
        if m.get("focus_box_id") in block_ids:
            for t in m.get("texts", []):
                n = _norm(t)
                if len(n) >= 2 and n not in allowed and n in body:
                    blocked.append(t)
    if blocked:
        problems.append(BLOCK_PROBLEM_PREFIX + "、".join(blocked[:10]))

    # 4. rendered width matches the baseline
    if rendered_width is not None and abs(rendered_width - expected_width) > 4:
        problems.append(f"渲染寬度 {rendered_width}px 與基準 {expected_width}px 不符，根元素必須固定 {expected_width}px 寬")

    if "<html" not in html.lower() or "</html>" not in html.lower():
        problems.append("必須輸出完整的 HTML 文件（含 <html> 與 </html>）")

    # 5. platform context: the demo-data persona and the shared component library
    problems += demo_data_problems(html, focus_boxes=focus_boxes, demo_data=demo_data or [])
    problems += component_problems(html, structure=structure, components=components or [])

    return {"ok": not problems, "problems": problems, "leaked": leaked, "missing": missing, "rendered_width": rendered_width}


def _redact(value, secrets: list[str]):
    if isinstance(value, str):
        for s in secrets:
            value = value.replace(s, REDACTED)
        return value
    if isinstance(value, list):
        return [_redact(v, secrets) for v in value]
    if isinstance(value, dict):
        return {k: _redact(v, secrets) for k, v in value.items()}
    return value


def scrub_pii(structure: dict | None, check_report: dict | None) -> tuple[dict | None, dict | None]:
    """Drop the verbatim personal data that review needed but nothing after
    approval does: `structure.sensitive_texts`, `check_report.leaked`, and any
    occurrence of those strings inside the report's other text (problems,
    visual issues). Returns new objects; idempotent."""
    secrets: list[str] = []
    for t in [*((structure or {}).get("sensitive_texts") or []), *((check_report or {}).get("leaked") or [])]:
        if isinstance(t, str) and t.strip() and t not in secrets:
            secrets.append(t)
    secrets.sort(key=len, reverse=True)  # longer first so substrings don't break them up
    new_structure = None if structure is None else {k: v for k, v in structure.items() if k != "sensitive_texts"}
    new_report = None
    if check_report is not None:
        new_report = _redact({k: v for k, v in check_report.items() if k != "leaked"}, secrets)
        new_report["problems"] = [
            LEAK_PROBLEM_PREFIX + "（明細已於審核通過後移除）" if isinstance(p, str) and p.startswith(LEAK_PROBLEM_PREFIX) else p
            for p in new_report.get("problems") or []
        ]
    return new_structure, new_report


def needs_scrub(structure: dict | None, check_report: dict | None) -> bool:
    return bool((structure or {}).get("sensitive_texts")) or "leaked" in (check_report or {}) or any(
        isinstance(p, str) and p.startswith(LEAK_PROBLEM_PREFIX) and not p.endswith("（明細已於審核通過後移除）")
        for p in (check_report or {}).get("problems") or [])


def focus_area(boxes: list[dict]) -> float:
    """Area the clerk asked to *keep* — `block` boxes hide content, so they do
    not count against the focus limit."""
    return sum(float(b.get("w", 0)) * float(b.get("h", 0)) for b in boxes if (b or {}).get("type") != "block")
