"""Rewriting a value on a finished replica without asking the model again.

When the reviewer corrects a piece of 假資料 (SPEC §6.5) the page itself is
right — a few words in it are wrong. Redrawing the whole screen costs a model
call, a minute of waiting and a fresh round of visual self-checks, and can come
back with a different layout, so the pipeline first tries the honest thing:
replace those words in the document's text and render again. The model only
gets the job when the old text is not on the page verbatim (it was split across
elements, or written differently).
"""

from __future__ import annotations

import html as html_mod
import re

TAG = re.compile(r"(<[^>]*>)")
TAG_NAME = re.compile(r"</?\s*([a-zA-Z0-9-]+)")
# elements whose content is not visible text (a swap there would edit the CSS)
RAW_TEXT_TAGS = frozenset({"style", "script", "title"})


def replace_texts(html: str, changes: list[tuple[str, str]]) -> tuple[str, list[str]]:
    """Swap whole strings in the document's visible text, leaving tags, styles
    and attributes untouched. Returns the new document and the old strings that
    were actually found — an empty list means nothing on the page matched."""
    wanted = [(old, new) for old, new in changes if old and new and old != new]
    if not wanted or not html:
        return html, []
    parts = TAG.split(html)
    depth = 0
    applied: list[str] = []
    for i, part in enumerate(parts):
        if i % 2:  # a tag
            name = TAG_NAME.match(part)
            if name and name.group(1).lower() in RAW_TEXT_TAGS:
                depth = max(0, depth - 1) if part.lstrip().startswith("</") else depth + 1
            continue
        if depth or not part.strip():
            continue
        for old, new in wanted:
            # the document may carry the value escaped (&amp;) or plain
            for needle in (html_mod.escape(old, quote=False), old):
                if needle in part:
                    part = part.replace(needle, html_mod.escape(new, quote=False))
                    parts[i] = part
                    if old not in applied:
                        applied.append(old)
                    break
    return "".join(parts), applied
