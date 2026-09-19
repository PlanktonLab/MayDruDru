"""Goals, platforms and style docs (admin)."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..ai.agents import styledoc_text
from ..ai.llm import embed
from ..db import get_db
from ..deps import CurrentUser, current_user, get_owned, require
from ..models import Flow, Goal, Platform, PlatformComponent, Step, StyleDoc, StyleDocVersion
from ..schemas import GoalIn, GoalOut, PlatformIn, PlatformOut, PlatformPatch, StyleDocOut, StyleDocPatch
from ..services.assets import PURGE_FAILED_MESSAGE, AssetPurgeError, purge_variant_assets, variants_of_platform

log = logging.getLogger("sop.catalog")
router = APIRouter(prefix="/api", tags=["catalog"])

GOAL_NOT_FOUND = "找不到此目標"
PLATFORM_NOT_FOUND = "找不到此平台"


def goal_out(g: Goal) -> GoalOut:
    return GoalOut(id=g.id, name=g.name, description=g.description, aliases=g.aliases or [])


async def platform_outs(db: AsyncSession, platforms: list[Platform]) -> list[PlatformOut]:
    """Style doc versions, flow counts and component counts for many platforms."""
    ids = [p.id for p in platforms]
    if not ids:
        return []
    versions = dict((await db.execute(select(StyleDoc.platform_id, StyleDoc.version).where(StyleDoc.platform_id.in_(ids)))).all())
    counts = dict((await db.execute(
        select(Flow.platform_id, func.count(Flow.id)).where(Flow.platform_id.in_(ids)).group_by(Flow.platform_id))).all())
    components = dict((await db.execute(
        select(PlatformComponent.platform_id, func.count(PlatformComponent.id))
        .where(PlatformComponent.platform_id.in_(ids)).group_by(PlatformComponent.platform_id))).all())
    return [PlatformOut(id=p.id, display_name=p.display_name, brand=p.brand, channel=p.channel, category=p.category, aliases=p.aliases or [],
                        demo_data=p.demo_data or [], style_doc_version=versions.get(p.id) or 0, flow_count=counts.get(p.id, 0),
                        component_count=components.get(p.id, 0)) for p in platforms]


async def _platform_out(db: AsyncSession, p: Platform) -> PlatformOut:
    return (await platform_outs(db, [p]))[0]


@router.get("/goals", response_model=list[GoalOut])
async def list_goals(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Goal).where(Goal.tenant_id == user.tenant_id).order_by(Goal.created_at))).scalars().all()
    return [goal_out(g) for g in rows]


@router.post("/goals", response_model=GoalOut)
async def create_goal(body: GoalIn, user: CurrentUser = Depends(require("admin")), db: AsyncSession = Depends(get_db)):
    g = Goal(tenant_id=user.tenant_id, **body.model_dump())
    db.add(g)
    await db.commit()
    return goal_out(g)


@router.put("/goals/{goal_id}", response_model=GoalOut)
async def update_goal(goal_id: str, body: GoalIn, user: CurrentUser = Depends(require("admin")), db: AsyncSession = Depends(get_db)):
    g = await get_owned(db, Goal, goal_id, user, GOAL_NOT_FOUND)
    for k, v in body.model_dump().items():
        setattr(g, k, v)
    await db.commit()
    return goal_out(g)


@router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str, user: CurrentUser = Depends(require("admin")), db: AsyncSession = Depends(get_db)):
    g = await get_owned(db, Goal, goal_id, user, GOAL_NOT_FOUND)
    n = (await db.execute(select(func.count(func.distinct(Step.flow_id))).join(Flow, Flow.id == Step.flow_id)
                          .where(Step.goal_id == goal_id, Step.is_end.is_(True), Flow.tenant_id == user.tenant_id))).scalar_one()
    if n:
        raise HTTPException(409, f"仍有 {n} 個 flow 的終點指向此目標文件")
    await db.delete(g)
    await db.commit()
    return {"ok": True}


@router.get("/platforms", response_model=list[PlatformOut])
async def list_platforms(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Platform).where(Platform.tenant_id == user.tenant_id).order_by(Platform.brand, Platform.channel))).scalars().all()
    return await platform_outs(db, list(rows))


@router.post("/platforms", response_model=PlatformOut)
async def create_platform(body: PlatformIn, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    p = Platform(tenant_id=user.tenant_id, owner_tenant_id=user.tenant_id, **body.model_dump())
    db.add(p)
    await db.flush()
    db.add(StyleDoc(platform_id=p.id))
    await db.commit()
    return await _platform_out(db, p)


@router.patch("/platforms/{platform_id}", response_model=PlatformOut)
async def patch_platform(platform_id: str, body: PlatformPatch, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    p = await get_owned(db, Platform, platform_id, user, PLATFORM_NOT_FOUND)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    await db.commit()
    return await _platform_out(db, p)


@router.delete("/platforms/{platform_id}")
async def delete_platform(platform_id: str, user: CurrentUser = Depends(require("admin")), db: AsyncSession = Depends(get_db)):
    p = await get_owned(db, Platform, platform_id, user, PLATFORM_NOT_FOUND)
    try:
        await purge_variant_assets(await variants_of_platform(db, p.id))
    except AssetPurgeError:
        log.exception("asset purge failed for platform %s", p.id)
        raise HTTPException(503, PURGE_FAILED_MESSAGE)
    thumbs = (await db.execute(
        select(PlatformComponent.thumb_key).where(PlatformComponent.platform_id == p.id))).scalars().all()
    await db.delete(p)
    await db.commit()
    for key in [k for k in thumbs if k]:  # desensitised images; an orphan is harmless
        try:
            await asyncio.to_thread(storage.delete_private, key)
        except Exception:
            log.warning("could not delete component thumbnail %s", key, exc_info=True)
    return {"ok": True}


@router.get("/platforms/{platform_id}/style-doc", response_model=StyleDocOut)
async def get_style_doc(platform_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await get_owned(db, Platform, platform_id, user, PLATFORM_NOT_FOUND)
    doc = (await db.execute(select(StyleDoc).where(StyleDoc.platform_id == platform_id))).scalar_one_or_none()
    if not doc:
        doc = StyleDoc(platform_id=platform_id)
        db.add(doc)
        await db.commit()
    return StyleDocOut(id=doc.id, platform_id=platform_id, ai_generated=doc.ai_generated or {}, human_notes=doc.human_notes,
                       version=doc.version, has_embedding=doc.embedding is not None, updated_at=doc.updated_at)


@router.patch("/platforms/{platform_id}/style-doc", response_model=StyleDocOut)
async def patch_style_doc(platform_id: str, body: StyleDocPatch, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    p = await get_owned(db, Platform, platform_id, user, PLATFORM_NOT_FOUND)
    doc = (await db.execute(select(StyleDoc).where(StyleDoc.platform_id == platform_id))).scalar_one_or_none()
    if not doc:
        doc = StyleDoc(platform_id=platform_id)
        db.add(doc)
        await db.flush()
    doc.human_notes = body.human_notes
    doc.version = (doc.version or 0) + 1
    doc.embedding = await embed(styledoc_text(doc.ai_generated or {}, doc.human_notes, p.display_name))
    db.add(StyleDocVersion(style_doc_id=doc.id, version=doc.version, ai_generated=doc.ai_generated or {}, human_notes=doc.human_notes, reason="human_notes edited"))
    await db.commit()
    return StyleDocOut(id=doc.id, platform_id=platform_id, ai_generated=doc.ai_generated or {}, human_notes=doc.human_notes,
                       version=doc.version, has_embedding=doc.embedding is not None, updated_at=doc.updated_at)


@router.get("/platforms/{platform_id}/style-doc/versions")
async def style_doc_versions(platform_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await get_owned(db, Platform, platform_id, user, PLATFORM_NOT_FOUND)
    doc = (await db.execute(select(StyleDoc).where(StyleDoc.platform_id == platform_id))).scalar_one_or_none()
    if not doc:
        return []
    rows = (await db.execute(select(StyleDocVersion).where(StyleDocVersion.style_doc_id == doc.id).order_by(StyleDocVersion.version.desc()))).scalars().all()
    return [{"id": r.id, "version": r.version, "ai_generated": r.ai_generated, "human_notes": r.human_notes, "reason": r.reason, "created_at": r.created_at} for r in rows]
