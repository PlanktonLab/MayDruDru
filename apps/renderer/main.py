"""Playwright (Chromium) renderer: HTML in, PNG out.

Replicas and Step Cards are static HTML/CSS, so pages render with JavaScript
disabled and with no network: every request except data: URLs and
about:blank is aborted, and Chromium itself is pointed at a dead proxy with a
resolver that answers nothing, so nothing (WebSocket included) leaves the
container. Fonts are installed in the image (Noto Sans CJK).

Hardening:
- `X-Renderer-Token` must match RENDERER_TOKEN when it is set; ENV=production
  refuses to start without it.
- HTML size, width, height and scale are bounded.
- Every request has an overall deadline; the page/context is always closed so
  the concurrency permit is released. Timeouts answer 504.
- A disconnected browser is relaunched; /health reports 503 while it is down.
"""

import asyncio
import base64
import hmac
import logging
import os
import re
from contextlib import asynccontextmanager

from extract_js import CHOOSE_JS, SERIALIZE_JS
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from playwright.async_api import Browser, Playwright, async_playwright
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeout
from pydantic import BaseModel, Field, field_validator

log = logging.getLogger("renderer")

ENV = os.getenv("ENV", "development").lower()
TOKEN = os.getenv("RENDERER_TOKEN", "")
MAX_HTML_BYTES = int(os.getenv("RENDERER_MAX_HTML_BYTES", str(3 * 1024 * 1024)))
MAX_BODY_BYTES = 2 * MAX_HTML_BYTES + 64 * 1024  # JSON escaping headroom; the html itself is checked exactly below
MAX_PAGE_HEIGHT = int(os.getenv("RENDERER_MAX_PAGE_HEIGHT", "12000"))  # CSS px, full-page screenshots
DEADLINE_SECONDS = float(os.getenv("RENDERER_TIMEOUT_SECONDS", "45"))
CONCURRENCY = int(os.getenv("RENDERER_CONCURRENCY", "4"))
CLOSE_TIMEOUT_SECONDS = 10.0

if ENV in ("prod", "production") and not TOKEN:
    raise RuntimeError("RENDERER_TOKEN 未設定：ENV=production 時 renderer 拒絕啟動")

LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    # defence in depth on top of context.route (which does not cover WebSockets)
    "--proxy-server=http://127.0.0.1:9",
    "--proxy-bypass-list=<-loopback>",
    "--host-resolver-rules=MAP * ~NOTFOUND",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--no-pings",
]

_pw: Playwright | None = None
_browser: Browser | None = None
_launch_lock = asyncio.Lock()
_slots = asyncio.Semaphore(CONCURRENCY)


def _connected() -> bool:
    return _browser is not None and _browser.is_connected()


async def get_browser() -> Browser:
    """Return a connected browser, relaunching it if it crashed or was closed."""
    global _browser
    if _connected():
        return _browser  # type: ignore[return-value]
    async with _launch_lock:
        if _connected():
            return _browser  # type: ignore[return-value]
        if _browser is not None:
            log.warning("browser disconnected; relaunching")
            try:
                await asyncio.wait_for(_browser.close(), CLOSE_TIMEOUT_SECONDS)
            except Exception:
                pass
        _browser = await _pw.chromium.launch(args=LAUNCH_ARGS)  # type: ignore[union-attr]
        return _browser


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pw, _browser
    _pw = await async_playwright().start()
    await get_browser()
    try:
        yield
    finally:
        if _browser is not None:
            try:
                await asyncio.wait_for(_browser.close(), CLOSE_TIMEOUT_SECONDS)
            except Exception:
                pass
        await _pw.stop()


app = FastAPI(title="SOP Tutor Renderer", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.url.path != "/health":
        if TOKEN and not hmac.compare_digest(request.headers.get("x-renderer-token", "").encode(), TOKEN.encode()):
            return JSONResponse({"detail": "invalid renderer token"}, status_code=401)
        length = request.headers.get("content-length")
        if length is not None and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
            return JSONResponse({"detail": "request body too large"}, status_code=413)
    return await call_next(request)


class RenderIn(BaseModel):
    html: str = Field(min_length=1)  # byte size is checked in render_once (413)
    width: int = Field(390, ge=200, le=2400)
    scale: int = Field(2, ge=1, le=3)
    full_page: bool = True
    height: int = Field(100, ge=1, le=4000)


@app.get("/health")
async def health():
    if not _connected():
        try:
            await asyncio.wait_for(get_browser(), 20)
        except Exception:
            log.exception("browser relaunch failed")
    if not _connected():
        return JSONResponse({"ok": False, "browser": "disconnected"}, status_code=503)
    return {"ok": True}


def _allow_only_inline(route):
    request = route.request
    url = request.url
    if request.is_navigation_request() and request.frame.parent_frame is None:
        # <meta http-equiv=refresh> works without JavaScript; a 204 keeps the
        # current document instead of committing an error page.
        return route.fulfill(status=204)
    if url.startswith("data:") or url == "about:blank":
        return route.continue_()
    return route.abort()


async def _wait_for_fonts(page) -> None:
    # Runs through CDP, which still works when page scripts are disabled.
    await page.evaluate("document.fonts ? document.fonts.ready.then(() => true) : true")


async def _render_page(page, body: RenderIn) -> tuple[bytes, int, int]:
    await page.set_content(body.html, wait_until="load")
    await _wait_for_fonts(page)
    await page.wait_for_timeout(50)
    dims = await page.evaluate(
        "() => ({w: Math.ceil(document.documentElement.scrollWidth), h: Math.ceil(document.documentElement.scrollHeight)})")
    if body.full_page and dims["h"] > MAX_PAGE_HEIGHT:
        raise HTTPException(422, f"rendered page too tall ({dims['h']}px > {MAX_PAGE_HEIGHT}px)")
    if body.full_page and dims["h"] > body.height:
        # Chromium does not paint iframes outside the viewport (the Step Card's
        # replica), even in a full-page screenshot: grow the viewport to the page.
        await page.set_viewport_size({"width": body.width, "height": dims["h"]})
        await page.wait_for_timeout(50)
    png = await page.screenshot(full_page=body.full_page, type="png")
    return png, dims["w"], dims["h"]


async def _close_quietly(context) -> None:
    try:
        await asyncio.shield(asyncio.wait_for(context.close(), CLOSE_TIMEOUT_SECONDS))
    except Exception:  # never let cleanup mask the real outcome or keep the permit
        log.warning("context close failed", exc_info=True)


async def render_once(body: RenderIn, deadline: float = DEADLINE_SECONDS) -> tuple[bytes, int, int]:
    if len(body.html.encode("utf-8")) > MAX_HTML_BYTES:
        raise HTTPException(413, "html too large")
    async with _slots:
        browser = await get_browser()
        context = await browser.new_context(
            viewport={"width": body.width, "height": body.height},
            device_scale_factor=body.scale,
            java_script_enabled=False,
            service_workers="block",
            accept_downloads=False,
        )
        try:
            context.set_default_timeout(deadline * 1000)
            await context.route("**/*", _allow_only_inline)
            page = await context.new_page()
            return await asyncio.wait_for(_render_page(page, body), deadline)
        except (TimeoutError, PlaywrightTimeout):
            raise HTTPException(504, "render timed out")
        except PlaywrightError:
            if not _connected():
                raise HTTPException(503, "browser disconnected; retry")
            raise
        finally:
            await _close_quietly(context)


@app.post("/render")
async def render(body: RenderIn):
    png, w, h = await render_once(body)
    return Response(content=png, media_type="image/png", headers={"x-css-width": str(w), "x-css-height": str(h)})


# ---------------------------------------------------------------- /extract

MAX_SNIPPET_CHARS = int(os.getenv("RENDERER_MAX_SNIPPET_CHARS", "200000"))
ATTR_NAME = re.compile(r"^data-[a-z][a-z0-9-]{0,30}$")
ATTR_VALUE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ExtractRect(BaseModel):
    """Fractions of the rendered page (0..1), as drawn on the replica image."""
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class ExtractIn(BaseModel):
    html: str = Field(min_length=1)  # byte size is checked below (413)
    width: int = Field(390, ge=200, le=2400)
    rect: ExtractRect
    scale: int = Field(2, ge=1, le=3)
    attrs: dict[str, str] = Field(default_factory=dict)  # data-* set on the chosen element

    @field_validator("attrs")
    @classmethod
    def _safe_attrs(cls, v: dict[str, str]) -> dict[str, str]:
        if len(v) > 8:
            raise ValueError("too many attrs")
        for name, value in v.items():
            if not ATTR_NAME.match(name) or not ATTR_VALUE.match(value):
                raise ValueError(f"unsupported attribute {name!r}")
        return v


async def _extract_page(page, body: ExtractIn) -> dict:
    await page.set_content(body.html, wait_until="load")
    await _wait_for_fonts(page)
    await page.wait_for_timeout(50)
    dims = await page.evaluate(
        "() => ({w: Math.ceil(document.documentElement.scrollWidth), h: Math.ceil(document.documentElement.scrollHeight)})")
    if dims["h"] > MAX_PAGE_HEIGHT:
        raise HTTPException(422, f"rendered page too tall ({dims['h']}px > {MAX_PAGE_HEIGHT}px)")
    # the whole page has to be in the viewport: elementFromPoint is viewport based
    await page.set_viewport_size({"width": body.width, "height": max(dims["h"], 1)})
    await page.wait_for_timeout(50)

    r = body.rect
    found = await page.evaluate(CHOOSE_JS, {"rx": r.x * dims["w"], "ry": r.y * dims["h"],
                                            "rw": r.w * dims["w"], "rh": r.h * dims["h"]})
    if not found or found["w"] < 1 or found["h"] < 1:
        raise HTTPException(422, "no element found under the rectangle")
    clip = {"x": max(found["x"], 0), "y": max(found["y"], 0),
            "width": min(found["w"], dims["w"]), "height": min(found["h"], dims["h"])}
    png = await page.screenshot(type="png", clip=clip)
    html = await page.evaluate(SERIALIZE_JS, {"attrs": body.attrs})
    if not html:
        raise HTTPException(422, "element disappeared before it could be serialised")
    if len(html) > MAX_SNIPPET_CHARS:
        raise HTTPException(413, "extracted snippet too large")
    return {"html": html, "x": round(found["x"]), "y": round(found["y"]),
            "w": round(found["w"]), "h": round(found["h"]), "tag": found["tag"],
            "thumb_png_base64": base64.b64encode(png).decode()}


@app.post("/extract")
async def extract(body: ExtractIn):
    """Lift one element out of a rendered page: its self-contained HTML plus a
    PNG clip of its box. Same protections as /render (token, sizes, deadline)."""
    deadline = DEADLINE_SECONDS
    if len(body.html.encode("utf-8")) > MAX_HTML_BYTES:
        raise HTTPException(413, "html too large")
    async with _slots:
        browser = await get_browser()
        context = await browser.new_context(
            viewport={"width": body.width, "height": 800},
            device_scale_factor=body.scale,
            java_script_enabled=False,
            service_workers="block",
            accept_downloads=False,
        )
        try:
            context.set_default_timeout(deadline * 1000)
            await context.route("**/*", _allow_only_inline)
            page = await context.new_page()
            return await asyncio.wait_for(_extract_page(page, body), deadline)
        except (TimeoutError, PlaywrightTimeout):
            raise HTTPException(504, "extract timed out")
        except PlaywrightError:
            if not _connected():
                raise HTTPException(503, "browser disconnected; retry")
            raise
        finally:
            await _close_quietly(context)
