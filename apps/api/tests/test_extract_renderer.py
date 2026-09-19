"""Integration check for the renderer's /extract endpoint (SPEC §6.5).

Needs the renderer container (`docker compose up -d renderer`); the whole
module is skipped when it is not reachable, so the offline suite still runs.
"""

import pathlib

import httpx
import pytest
from app.ai.checks import normalize_component_html, unsafe_html_problems
from app.config import get_settings
from app.renderer_client import RendererRejected, extract_element, render_html

MOCKUP = pathlib.Path(__file__).resolve().parents[1] / "app" / "ai" / "examples" / "esun_mockup.html"


def _renderer_up() -> bool:
    try:
        return httpx.get(f"{get_settings().renderer_url}/health", timeout=3).status_code == 200
    except Exception:
        return False


pytestmark = [pytest.mark.skipif(not _renderer_up(), reason="renderer container not running"), pytest.mark.anyio]


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
def mockup() -> str:
    return MOCKUP.read_text(encoding="utf-8")


async def test_extract_picks_the_smallest_element_covering_the_rectangle(mockup):
    """The top nav of the reference mockup: 40px of body padding, then 70px of bar."""
    _, _, page_h = await render_html(mockup, 390, scale=1)
    rect = {"x": 0.1, "y": 50 / page_h, "w": 0.8, "h": 50 / page_h}
    html, w, h, thumb = await extract_element(mockup, 390, rect, {"data-component": "c1", "data-kind": "nav_bar"})

    assert (w, h) == (356, 70)  # the .nav box, not the whole .frame and not the <h1> inside it
    assert html.startswith('<div class="nav"')
    assert 'data-component="c1"' in html and 'data-kind="nav_bar"' in html
    assert "交易紀錄" in html
    # self-contained: the page's stylesheet is gone, its effect is inlined
    assert "linear-gradient" in html and "<style" not in html
    assert unsafe_html_problems(html) == []
    assert thumb.startswith(b"\x89PNG")


async def test_extracted_snippet_renders_to_the_same_box_on_a_bare_page(mockup):
    _, _, page_h = await render_html(mockup, 390, scale=1)
    html, w, h, _ = await extract_element(mockup, 390, {"x": 0.1, "y": 50 / page_h, "w": 0.8, "h": 50 / page_h})
    # a tall spacer lifts the page above the renderer's minimum viewport, so the
    # reported height is really the snippet's own
    spacer = '<div style="height:1000px"></div>'
    standalone = f'<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:390px">{html}{spacer}</body></html>'
    png, _, rendered_h = await render_html(standalone, 390, scale=1)
    assert png.startswith(b"\x89PNG")
    assert rendered_h - 1000 == h  # the snippet carries its own geometry
    assert w == 356


async def test_a_rectangle_over_one_list_row_picks_that_row(mockup):
    _, _, page_h = await render_html(mockup, 390, scale=1)
    top = 40 + 70 + 100  # frame padding + nav + sheet
    html, w, h, _ = await extract_element(mockup, 390, {"x": 0.1, "y": (top + 10) / page_h, "w": 0.8, "h": 50 / page_h})
    assert html.startswith('<div class="row"') and h == 70


async def test_extraction_is_stable_under_normalisation(mockup):
    """Two extractions of the same region must compare equal — the check that
    guards a pasted component would be useless otherwise."""
    _, _, page_h = await render_html(mockup, 390, scale=1)
    rect = {"x": 0.1, "y": 50 / page_h, "w": 0.8, "h": 50 / page_h}
    a, *_ = await extract_element(mockup, 390, rect, {"data-component": "c1", "data-kind": "nav_bar"})
    b, *_ = await extract_element(mockup, 390, rect, {"data-component": "c1", "data-kind": "nav_bar"})
    assert normalize_component_html(a) == normalize_component_html(b)


async def test_unsafe_marker_attributes_are_refused(mockup):
    with pytest.raises(RendererRejected):
        await extract_element(mockup, 390, {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.1}, {"onclick": "alert(1)"})
