"""Evaluation set (SPEC §11)."""

import asyncio
import logging

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..ai.image_utils import ImageTooLarge, InvalidImage, read_image_upload
from ..config import get_settings
from ..db import get_db
from ..deps import CurrentUser, current_user, get_owned, require_cap
from ..jobs import enqueue
from ..models import EvalCase, EvalRun
from ..schemas import EvalCaseOut, EvalRunIn, EvalRunOut

log = logging.getLogger("sop.evals")
router = APIRouter(prefix="/api/evals", tags=["evals"])

CASE_NOT_FOUND = "找不到此評測樣本"
RUN_NOT_FOUND = "找不到此評測紀錄"
STORAGE_UNAVAILABLE = "儲存服務暫時無法使用，請稍後再試"


def _case_out(c: EvalCase) -> EvalCaseOut:
    return EvalCaseOut(id=c.id, platform_id=c.platform_id, step_id=c.step_id, goal_id=c.goal_id, text=c.text, note=c.note,
                       image_url=f"/api/evals/cases/{c.id}/image.png", created_at=c.created_at)


@router.get("/cases", response_model=list[EvalCaseOut])
async def list_cases(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(EvalCase).where(EvalCase.tenant_id == user.tenant_id).order_by(EvalCase.created_at.desc()))).scalars().all()
    return [_case_out(c) for c in rows]


@router.post("/cases", response_model=EvalCaseOut)
async def create_case(file: UploadFile, platform_id: str = Form(...), step_id: str | None = Form(default=None), goal_id: str | None = Form(default=None),
                      text: str = Form(default=""), note: str = Form(default=""), user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    try:
        png = await read_image_upload(file)
    except ImageTooLarge:
        raise HTTPException(413, "檔案過大")
    except InvalidImage:
        raise HTTPException(400, "無法讀取圖片")
    c = EvalCase(tenant_id=user.tenant_id, image_key="", platform_id=platform_id, step_id=step_id or None, goal_id=goal_id or None, text=text, note=note)
    db.add(c)
    await db.flush()
    try:  # test screenshots may contain personal data: encrypted at rest
        c.image_key = await asyncio.to_thread(storage.put_sealed, f"evals/{user.tenant_id}/{c.id}.bin", png)
    except Exception:
        log.exception("eval case upload failed")
        raise HTTPException(503, STORAGE_UNAVAILABLE)
    await db.commit()
    return _case_out(c)


@router.get("/cases/{case_id}/image.png")
async def case_image(case_id: str, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    c = await get_owned(db, EvalCase, case_id, user, CASE_NOT_FOUND)
    try:
        data = await asyncio.to_thread(storage.get_sealed, c.image_key)
    except Exception:
        log.exception("eval case image read failed: %s", c.id)
        raise HTTPException(503, STORAGE_UNAVAILABLE)
    return Response(data, media_type="image/png", headers={"Cache-Control": "private, no-store"})


@router.delete("/cases/{case_id}")
async def delete_case(case_id: str, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    c = await get_owned(db, EvalCase, case_id, user, CASE_NOT_FOUND)
    try:
        await asyncio.to_thread(storage.delete_private, c.image_key)
    except Exception:
        log.exception("eval case image delete failed: %s", c.id)
        raise HTTPException(503, STORAGE_UNAVAILABLE)
    await db.delete(c)
    await db.commit()
    return {"ok": True}


def _run_out(r: EvalRun) -> EvalRunOut:
    return EvalRunOut(id=r.id, status=r.status, label=r.label, config=r.config, summary=r.summary, results=r.results, started_at=r.started_at, finished_at=r.finished_at)


@router.post("/runs", response_model=EvalRunOut)
async def start_run(body: EvalRunIn, user: CurrentUser = Depends(require_cap("sop_edit")), db: AsyncSession = Depends(get_db)):
    s = get_settings()
    r = EvalRun(tenant_id=user.tenant_id, label=body.label, config={"content_mode": body.content_mode, "provider": s.llm_provider,
                                                                     "models": {t: s.model_for(t) for t in ("describe", "rerank", "intent")},
                                                                     "threshold": s.locate_confidence_threshold})
    db.add(r)
    await db.commit()
    await enqueue("run_eval", r.id)
    return _run_out(r)


@router.get("/runs", response_model=list[EvalRunOut])
async def list_runs(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(EvalRun).where(EvalRun.tenant_id == user.tenant_id).order_by(EvalRun.started_at.desc()).limit(50))).scalars().all()
    return [_run_out(r) for r in rows]


@router.get("/runs/{run_id}", response_model=EvalRunOut)
async def get_run(run_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    r = await get_owned(db, EvalRun, run_id, user, RUN_NOT_FOUND)
    return _run_out(r)
