"""HTTP client for the Playwright renderer service (renderer/main.py)."""

import base64

import httpx

from .config import get_settings


class RendererError(RuntimeError):
    """The renderer could not produce an image."""


class RendererTimeout(RendererError):
    """The renderer gave up on the page (deadline exceeded) or did not answer in time."""


class RendererRejected(RendererError):
    """The renderer refused the request (bad token, HTML too large, invalid size, page too tall)."""


class RendererUnavailable(RendererError):
    """The renderer is down or its browser is restarting; retrying later may succeed."""


def _detail(r: httpx.Response) -> str:
    try:
        return str(r.json().get("detail", ""))[:300]
    except Exception:
        return r.text[:300]


def _raise_for_status(r: httpx.Response, what: str) -> None:
    if r.status_code == 504:
        raise RendererTimeout(f"{what} timed out: {_detail(r)}")
    if r.status_code in (401, 403):
        raise RendererRejected("renderer rejected the token (check RENDERER_TOKEN on both sides)")
    if 400 <= r.status_code < 500:
        raise RendererRejected(f"renderer rejected the page ({r.status_code}): {_detail(r)}")
    if r.status_code in (502, 503):
        raise RendererUnavailable(f"renderer unavailable ({r.status_code}): {_detail(r)}")
    if r.status_code >= 500:
        raise RendererError(f"renderer failed ({r.status_code})")


async def render_html(html: str, width: int, scale: int = 2, full_page: bool = True, timeout: float = 60.0) -> tuple[bytes, int, int]:
    """Returns (png_bytes, css_width, css_height)."""
    settings = get_settings()
    headers = {"X-Renderer-Token": settings.renderer_token} if settings.renderer_token else {}
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(f"{settings.renderer_url}/render", headers=headers,
                             json={"html": html, "width": width, "scale": scale, "full_page": full_page})
    except httpx.TimeoutException as e:
        raise RendererTimeout("renderer did not respond in time") from e
    except httpx.TransportError as e:
        raise RendererUnavailable(f"renderer unreachable: {e.__class__.__name__}") from e

    _raise_for_status(r, "render")
    w = int(r.headers.get("x-css-width", width))
    h = int(r.headers.get("x-css-height", 0))
    return r.content, w, h


async def extract_element(html: str, width: int, rect: dict, attrs: dict[str, str] | None = None,
                          timeout: float = 60.0) -> tuple[str, int, int, bytes]:
    """Lift one element out of a rendered page (SPEC §6.5): the smallest element
    whose box covers the given rectangle (fractions of the page).
    Returns (snippet_html, css_width, css_height, thumbnail_png)."""
    settings = get_settings()
    headers = {"X-Renderer-Token": settings.renderer_token} if settings.renderer_token else {}
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(f"{settings.renderer_url}/extract", headers=headers,
                             json={"html": html, "width": width, "rect": rect, "attrs": attrs or {}})
    except httpx.TimeoutException as e:
        raise RendererTimeout("renderer did not respond in time") from e
    except httpx.TransportError as e:
        raise RendererUnavailable(f"renderer unreachable: {e.__class__.__name__}") from e

    _raise_for_status(r, "extract")
    try:
        data = r.json()
        return data["html"], int(data["w"]), int(data["h"]), base64.b64decode(data["thumb_png_base64"])
    except Exception as e:
        raise RendererError("renderer returned an unreadable extraction result") from e
