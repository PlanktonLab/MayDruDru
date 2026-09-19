"""Step Cards numbered for the conversation, not the flow (SPEC §9).

The worker draws every card with the step's place in the flow. A citizen who
joins midway — located by a screenshot, or asking what comes next — should
count from one, so the card they get carries its place in *their* sequence.
The base card's page is kept beside its PNG with the number as one CSS value;
a card numbered n is that page with the value swapped, rendered once and
cached under a key next to the base card. Anything missing or failing falls
back to the base card: numbering never stands between a citizen and a step.
"""

from __future__ import annotations

import asyncio
import logging
import re

from .. import storage
from ..ai.image_utils import make_preview
from ..config import get_settings
from ..renderer_client import render_html

log = logging.getLogger("sop.stepcard")

LINE_PREVIEW_EDGE = 240  # LINE's preview image limit (longest edge)
_NUM = re.compile(r'--step-num:"\d*"')
_WIDTH = re.compile(r"--canvas-w:(\d+)px")


def html_key_for(card_key: str | None) -> str | None:
    """The base card's page, private, next to its PNG: cards/{t}/{sha}.png -> cardhtml/{t}/{sha}.html."""
    if not card_key or not card_key.startswith("cards/"):
        return None
    return "cardhtml/" + card_key[len("cards/"):].rsplit(".", 1)[0] + ".html"


def numbered_keys(card_key: str, n: int) -> tuple[str, str]:
    """Public keys of the copy numbered `n`: the PNG and its LINE preview."""
    stem = card_key[len("cards/"):].rsplit(".", 1)[0]
    return f"cards/{stem}-n{n}.png", f"previews/{stem}-n{n}.jpg"


def with_step_number(html: str, n: int) -> str | None:
    """The page with its number swapped for `n`; None when the page shows no
    number, or already shows this one."""
    m = _NUM.search(html)
    if not m or m.group(0) in ('--step-num:""', f'--step-num:"{n}"') or "--number-display:none" in html:
        return None
    return html[:m.start()] + f'--step-num:"{n}"' + html[m.end():]


async def numbered_card(card: dict, n: int) -> dict:
    """`card` (a snapshot variant) with its image and preview keys pointing at
    the copy numbered `n`; the card itself when that copy cannot be made."""
    key = card.get("stepcard_key")
    if not key or n < 1:
        return card
    s = get_settings()
    png_key, jpg_key = numbered_keys(key, n)
    try:
        if not await asyncio.to_thread(storage.exists, s.s3_bucket_public, png_key):
            html_key = html_key_for(key)
            if not html_key or not await asyncio.to_thread(storage.exists, s.s3_bucket_private, html_key):
                return card
            html = with_step_number((await asyncio.to_thread(storage.get_private, html_key)).decode(), n)
            if html is None:
                return card
            m = _WIDTH.search(html)
            png, _, _ = await render_html(html, int(m.group(1)) if m else 1600, scale=2)
            preview = await asyncio.to_thread(make_preview, png, LINE_PREVIEW_EDGE)
            await asyncio.to_thread(storage.put, s.s3_bucket_public, png_key, png, "image/png")
            await asyncio.to_thread(storage.put, s.s3_bucket_public, jpg_key, preview, "image/jpeg")
    except Exception:
        log.warning("could not number card %s as %s; sending the base card", key, n, exc_info=True)
        return card
    return {**card, "stepcard_key": png_key, "stepcard_preview_key": jpg_key}
