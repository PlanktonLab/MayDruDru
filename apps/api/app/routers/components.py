"""平台元件庫 (SPEC §6.5).

A reviewer draws a rectangle on an approved replica; the renderer lifts the
smallest element that covers it out of the page as self-contained HTML, and it
is stored under the variant's platform. Agent B then pastes that snippet
verbatim into every other screen of the same platform, so the tab bar (or the
top nav) is identical across a whole batch of screenshots.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..ai.checks import unsafe_html_problems
from ..db import get_db, release_connection
from ..deps import CurrentUser, current_user, get_owned, require
from ..models import Flow, Platform, PlatformComponent, Step, Variant, new_id
from ..renderer_client import RendererRejected, extract_element
from ..schemas import ComponentIn, ComponentOut, ComponentPatch

log = logging.getLogger("sop.components")
router = APIRouter(prefix="/api", tags=["components"])

COMPONENT_NOT_FOUND = "找不到此元件"
VARIANT_NOT_FOUND = "找不到此截圖變體"
PLATFORM_NOT_FOUND = "找不到此平台"
STORAGE_UNAVAILABLE = "儲存服務暫時無法使用，請稍後再試"
MAX_COMPONENTS_PER_PLATFORM = 12


def component_out(c: PlatformComponent) -> ComponentOut:
    return ComponentOut(id=c.id, platform_id=c.platform_id, name=c.name, kind=c.kind, width=c.width, height=c.height,
                        thumb_url=f"/api/components/{c.id}/thumb.png" if c.thumb_key else None,
                        created_by=c.created_by, created_at=c.created_at)


@router.get("/platforms/{platform_id}/components", response_model=list[ComponentOut])
async def list_components(platform_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await get_owned(db, Platform, platform_id, user, PLATFORM_NOT_FOUND)
    rows = (await db.execute(
        select(PlatformComponent).where(PlatformComponent.platform_id == platform_id).order_by(PlatformComponent.created_at)
    )).scalars().all()
    return [component_out(c) for c in rows]


@router.post("/variants/{variant_id}/components", response_model=ComponentOut)
async def create_component(variant_id: str, body: ComponentIn, user: CurrentUser = Depends(require("editor")),
                           db: AsyncSession = Depends(get_db)):
    v = await get_owned(db, Variant, variant_id, user, VARIANT_NOT_FOUND)
    if not v.replica_html_key:
        raise HTTPException(409, "尚無復刻 HTML，無法擷取元件")
    platform_id, channel = (await db.execute(
        select(Platform.id, Platform.channel).join(Flow, Flow.platform_id == Platform.id)
        .join(Step, Step.flow_id == Flow.id).where(Step.id == v.step_id)
    )).one()
    existing = (await db.execute(
        select(PlatformComponent.id).where(PlatformComponent.platform_id == platform_id))).scalars().all()
    if len(existing) >= MAX_COMPONENTS_PER_PLATFORM:
        raise HTTPException(409, f"一個平台最多 {MAX_COMPONENTS_PER_PLATFORM} 個共用元件，請先刪除用不到的")

    try:
        replica_html = (await asyncio.to_thread(storage.get_private, v.replica_html_key)).decode()
    except Exception:
        log.exception("replica html read failed for variant %s", v.id)
        raise HTTPException(503, STORAGE_UNAVAILABLE)

    component_id = new_id()
    width = v.replica_width or (1280 if channel in ("web", "desktop") else 390)
    await release_connection(db)  # don't hold a pooled connection while the renderer works
    try:
        html, w, h, thumb = await extract_element(
            replica_html, width, body.rect.model_dump(),
            {"data-component": component_id, "data-kind": body.kind})
    except RendererRejected as e:
        raise HTTPException(422, f"無法擷取此區域：{e}")
    except Exception:
        log.exception("component extraction failed for variant %s", v.id)
        raise HTTPException(503, "渲染服務暫時無法使用，請稍後再試")

    problems = unsafe_html_problems(html)
    if problems:  # the snippet goes back into future replicas: same rules as a replica
        raise HTTPException(422, {"message": "元件 HTML 未通過安全檢查", "problems": problems})

    try:
        thumb_key = await asyncio.to_thread(
            storage.put_private, f"components/{user.tenant_id}/{component_id}.png", thumb, "image/png")
    except Exception:
        log.exception("component thumbnail upload failed for variant %s", v.id)
        raise HTTPException(503, STORAGE_UNAVAILABLE)

    c = PlatformComponent(id=component_id, tenant_id=user.tenant_id, platform_id=platform_id, name=body.name.strip(),
                          kind=body.kind, html=html, width=w, height=h, thumb_key=thumb_key, created_by=user.id)
    db.add(c)
    await db.commit()
    return component_out(c)


def apply_component_patch(c: PlatformComponent, body: ComponentPatch) -> PlatformComponent:
    """Only the label and the kind are editable; a blank name leaves the old one."""
    if body.name is not None and body.name.strip():
        c.name = body.name.strip()
    if body.kind is not None:
        c.kind = body.kind
    return c


@router.patch("/components/{component_id}", response_model=ComponentOut)
async def patch_component(component_id: str, body: ComponentPatch, user: CurrentUser = Depends(require("editor")),
                          db: AsyncSession = Depends(get_db)):
    c = await get_owned(db, PlatformComponent, component_id, user, COMPONENT_NOT_FOUND)
    apply_component_patch(c, body)
    await db.commit()
    return component_out(c)


@router.get("/components/{component_id}/thumb.png")
async def component_thumb(component_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    c = await get_owned(db, PlatformComponent, component_id, user, COMPONENT_NOT_FOUND)
    if not c.thumb_key:
        raise HTTPException(404, "此元件沒有縮圖")
    try:
        data = await asyncio.to_thread(storage.get_private, c.thumb_key)
    except Exception:
        log.exception("component thumbnail read failed: %s", c.thumb_key)
        raise HTTPException(503, STORAGE_UNAVAILABLE)
    return Response(data, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.delete("/components/{component_id}")
async def delete_component(component_id: str, user: CurrentUser = Depends(require("admin")), db: AsyncSession = Depends(get_db)):
    c = await get_owned(db, PlatformComponent, component_id, user, COMPONENT_NOT_FOUND)
    thumb_key = c.thumb_key
    await db.delete(c)
    await db.commit()
    if thumb_key:  # a failed cleanup only leaves an orphan thumbnail
        try:
            await asyncio.to_thread(storage.delete_private, thumb_key)
        except Exception:
            log.warning("could not delete component thumbnail %s", thumb_key, exc_info=True)
    return {"ok": True}
