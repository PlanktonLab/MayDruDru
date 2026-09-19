"""Per-variant processing pipeline (SPEC §6.2): upload → focus boxes → process
→ review → annotate → step card.

While a background job owns a variant (JOB_OWNED_STATUSES) every request that
would change it is refused with 409; the worker moves it on."""

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..ai.checks import check_replica, focus_area
from ..ai.image_utils import ImageTooLarge, InvalidImage, dimensions, read_image_upload
from ..ai.ingestion_graph import platform_context
from ..config import get_settings
from ..db import get_db, release_connection
from ..deps import CurrentUser, current_user, get_owned, require, require_any
from ..jobs import enqueue
from ..models import JOB_OWNED_STATUSES, Flow, Platform, Step, Variant
from ..renderer_client import RendererRejected, render_html
from ..schemas import (
    DEMO_DATA_MAX_FIELDS,
    AdvancedEditIn,
    AnnotationsIn,
    CardPreviewIn,
    CardPreviewOut,
    DemoDataField,
    FakeDataSyncIn,
    FocusBoxesIn,
    ReviewIn,
    StepCardLayoutIn,
    VariantOut,
)
from ..services import demo_data as demo_data_service
from ..services.card_context import load_card_context, merge_layout
from ..services.stepcard import LIMITS, build_card_html
from .variant_views import can_see_original_data, variant_out

log = logging.getLogger("sop.variants")
router = APIRouter(prefix="/api", tags=["variants"])

VARIANT_NOT_FOUND = "找不到此截圖變體"
QUEUE_UNAVAILABLE = "背景工作佇列暫時無法使用，請稍後再試"
STORAGE_UNAVAILABLE = "儲存服務暫時無法使用，請稍後再試"
EDITABLE_AFTER_REVIEW = ("annotating", "completed")
JOB_OWNED_MESSAGES = {
    "processing": "AI 復刻處理中，請等處理完成",
    "approved": "審核已通過，系統正在收尾，請稍候",
    "rendering": "Step Card 產生中，請稍候",
}


def ensure_not_job_owned(v: Variant) -> None:
    """409 while a background job owns the variant."""
    if v.status in JOB_OWNED_STATUSES:
        raise HTTPException(409, JOB_OWNED_MESSAGES.get(v.status, "背景處理中，請稍候"))


async def _variant(db: AsyncSession, user: CurrentUser, variant_id: str) -> Variant:
    return await get_owned(db, Variant, variant_id, user, VARIANT_NOT_FOUND)


async def start_job(db: AsyncSession, v: Variant, status: str, progress: str, job: str, *args) -> None:
    """Hand the variant to a worker job; undo the status change if the queue is down."""
    previous = (v.status, v.progress, v.error)
    v.status, v.progress, v.error = status, progress, ""
    await db.commit()
    try:
        await enqueue(job, *args)
    except Exception:
        log.exception("enqueue %s failed for variant %s", job, v.id)
        v.status, v.progress, v.error = previous
        await db.commit()
        raise HTTPException(503, QUEUE_UNAVAILABLE)


async def _private_bytes(read, key: str) -> bytes:
    try:
        return await asyncio.to_thread(read, key)
    except Exception:
        log.exception("private object read failed: %s", key)
        raise HTTPException(503, STORAGE_UNAVAILABLE)


@router.get("/variants/{variant_id}", response_model=VariantOut)
async def get_variant(variant_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return variant_out(await _variant(db, user, variant_id), user)


@router.get("/meta/annotation-types")
async def annotation_types():
    return {"limits": LIMITS, "focus_area_limit": get_settings().focus_box_area_limit}


# ---- 2. upload original

@router.post("/variants/{variant_id}/original", response_model=VariantOut)
async def upload_original(variant_id: str, file: UploadFile, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    try:
        png = await read_image_upload(file)
        w, h = await asyncio.to_thread(dimensions, png)
    except ImageTooLarge:
        raise HTTPException(413, "檔案過大")
    except InvalidImage:
        raise HTTPException(400, "無法讀取圖片")
    try:  # the key is fixed per variant, so a re-upload overwrites the previous original
        key = await asyncio.to_thread(storage.put_original, user.tenant_id, v.id, png)
    except Exception:
        log.exception("original upload failed for variant %s", v.id)
        raise HTTPException(503, STORAGE_UNAVAILABLE)
    v.original_key = key
    v.original_uploaded_at = datetime.now(UTC)
    v.original_uploaded_by = user.id
    v.original_width, v.original_height = w, h
    v.status, v.progress, v.error = "uploaded", "已上傳", ""
    v.focus_boxes = []
    await db.commit()
    return variant_out(v, user)


@router.get("/variants/{variant_id}/original.png")
async def get_original(variant_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Only the uploader and admins may view an original (SPEC §12)."""
    v = await _variant(db, user, variant_id)
    if not v.original_key:
        raise HTTPException(404, "原圖不存在或已刪除")
    if not can_see_original_data(v, user):
        raise HTTPException(403, "只有上傳者與 admin 可檢視原圖")
    data = await _private_bytes(storage.get_original, v.original_key)
    return Response(data, media_type="image/png", headers={"Cache-Control": "private, no-store"})


@router.delete("/variants/{variant_id}/original", response_model=VariantOut)
async def delete_original(variant_id: str, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    if v.original_key:
        try:
            await asyncio.to_thread(storage.delete_original, v.original_key)
        except Exception:
            log.exception("original delete failed for variant %s", v.id)
            raise HTTPException(503, STORAGE_UNAVAILABLE)
    v.original_key = None
    v.original_uploaded_at = None
    if v.status in ("uploaded", "focusing", "failed"):
        v.status, v.progress = "not_uploaded", ""
    await db.commit()
    return variant_out(v, user)


# ---- 3. focus boxes

@router.put("/variants/{variant_id}/focus-boxes", response_model=VariantOut)
async def set_focus_boxes(variant_id: str, body: FocusBoxesIn, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    if not v.original_key:
        raise HTTPException(409, "請先上傳原圖")
    v.focus_boxes = [b.model_dump() for b in body.boxes]
    if body.prompt_notes is not None:
        v.prompt_notes = body.prompt_notes.strip()
    v.status, v.progress = "focusing", "焦點標記中"
    await db.commit()
    return variant_out(v, user)


# ---- 4. process

@router.post("/variants/{variant_id}/process", response_model=VariantOut)
async def process(variant_id: str, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    if not v.original_key:
        raise HTTPException(409, "請先上傳原圖")
    limit = get_settings().focus_box_area_limit
    area = focus_area(v.focus_boxes or [])
    if area > limit:
        raise HTTPException(422, f"Focus Box 總面積 {area:.0%} 超過上限 {limit:.0%}")
    await start_job(db, v, "processing", "排隊中", "process_variant", v.id)
    return variant_out(v, user)


# ---- 5. review

@router.get("/review/queue")
async def review_queue(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Variant.id, Variant.theme, Variant.updated_at, Variant.attempts, Variant.check_report, Step.id, Step.title, Flow.id, Flow.name, Platform.display_name)
        .join(Step, Step.id == Variant.step_id).join(Flow, Flow.id == Step.flow_id).join(Platform, Platform.id == Flow.platform_id)
        .where(Flow.tenant_id == user.tenant_id, Variant.status == "pending_review").order_by(Variant.updated_at)
    )).all()
    return [{"variant_id": vid, "theme": theme, "step_id": sid, "step_title": stitle, "flow_id": fid, "flow_name": fname,
             "platform_name": pname, "updated_at": updated, "attempts": attempts, "checks_ok": (report or {}).get("ok", True)}
            for vid, theme, updated, attempts, report, sid, stitle, fid, fname, pname in rows]


@router.post("/variants/{variant_id}/review", response_model=VariantOut)
async def review(variant_id: str, body: ReviewIn, user: CurrentUser = Depends(require_any("reviewer")), db: AsyncSession = Depends(get_db)):
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    if v.status != "pending_review":
        raise HTTPException(409, "此變體不在待審核狀態")
    if body.decision == "regenerate" and not body.feedback.strip():
        raise HTTPException(422, "回饋重生需要附上文字回饋")
    await start_job(db, v, "processing", "送回管線中", "resume_variant", v.id, body.decision, body.feedback, user.id)
    return variant_out(v, user)


@router.post("/variants/{variant_id}/fake-data", response_model=VariantOut)
async def sync_fake_data(variant_id: str, body: FakeDataSyncIn, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    """假資料同步 (SPEC §6.5): the clerk's answer to what this replica reported
    inventing. Picked values join the platform's 示範資料, so every screen after
    this one uses them; `regenerate` draws this screen again first, since a
    value they corrected is still wrong on the image in front of them."""
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    if body.regenerate and v.status != "pending_review":
        raise HTTPException(409, "此變體不在待審核狀態，無法請 AI 重做")
    picks = [p.model_dump() for p in body.adopt]
    if picks:
        step = await db.get(Step, v.step_id)
        flow = await db.get(Flow, step.flow_id)
        platform = await db.get(Platform, flow.platform_id)
        platform.demo_data = _merged_demo_data(platform.demo_data or [], picks)
    v.fake_data_reviewed = True
    if not body.regenerate:
        await db.commit()
        return variant_out(v, user)
    feedback = demo_data_service.regenerate_feedback(picks)
    if not feedback:
        raise HTTPException(422, "請先選好要沿用的假資料，AI 才知道這頁要改成什麼")
    # Corrected values are swapped into the replica's text and re-rendered; only
    # a value that is not on the page as written needs the model to draw again.
    changes = demo_data_service.value_changes(v.fake_data or [], picks)
    decision = "revalue" if changes else "regenerate"
    progress = "更新畫面上的假資料" if changes else "依新的假資料重做中"
    await start_job(db, v, "processing", progress, "resume_variant", v.id, decision, feedback, user.id, changes)
    return variant_out(v, user)


def _merged_demo_data(current: list[dict], picks: list[dict]) -> list[dict]:
    """The platform's 示範資料 with the picks folded in, refused with a message
    the clerk can act on when it would break the limits the panel enforces."""
    merged = demo_data_service.merge(current, picks)
    if len(merged) > DEMO_DATA_MAX_FIELDS:
        raise HTTPException(422, f"共用假資料最多 {DEMO_DATA_MAX_FIELDS} 個欄位，這樣會變成 {len(merged)} 個。"
                                 "請少選幾筆，或先到平台設定整理示範資料。")
    try:
        for f in merged:
            DemoDataField(**f)
    except ValueError:
        raise HTTPException(422, "假資料的欄位名稱或值不符合格式，請調整後再存")
    return merged


@router.get("/variants/{variant_id}/replica.png")
async def replica_png(variant_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    v = await _variant(db, user, variant_id)
    if not v.replica_png_key:
        raise HTTPException(404, "尚無復刻圖")
    data = await _private_bytes(storage.get_private, v.replica_png_key)
    return Response(data, media_type="image/png", headers={"Cache-Control": "private, max-age=60"})


@router.get("/variants/{variant_id}/replica.html")
async def replica_html(variant_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    v = await _variant(db, user, variant_id)
    if not v.replica_html_key:
        raise HTTPException(404, "尚無復刻 HTML")
    data = await _private_bytes(storage.get_private, v.replica_html_key)
    return Response(data, media_type="text/html; charset=utf-8", headers={"Cache-Control": "private, no-store"})


@router.put("/variants/{variant_id}/replica-html", response_model=VariantOut)
async def advanced_edit(variant_id: str, body: AdvancedEditIn, user: CurrentUser = Depends(require("admin")), db: AsyncSession = Depends(get_db)):
    """Admin-only advanced mode (SPEC §6.2 step 5): direct HTML edit, re-rendered
    outside the graph. The same programmatic checks as the pipeline apply."""
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    if v.status not in EDITABLE_AFTER_REVIEW:
        raise HTTPException(409, "只有已通過審核的變體可用進階編輯")
    width = v.replica_width or 390
    step = await db.get(Step, v.step_id)
    flow = await db.get(Flow, step.flow_id)
    demo_data, components = await platform_context(db, await db.get(Platform, flow.platform_id))
    report = check_replica(body.html, structure=v.structure or {}, focus_boxes=v.focus_boxes or [],
                           kept_texts=v.kept_texts or [], rendered_width=None, expected_width=width,
                           demo_data=demo_data, components=components)
    if not report["ok"]:
        raise HTTPException(422, {"message": "HTML 未通過檢查", "problems": report["problems"]})
    await release_connection(db)  # don't hold a pooled connection while the renderer works
    try:
        png, w, h = await render_html(body.html, width, scale=2)
    except RendererRejected as e:
        raise HTTPException(422, {"message": "HTML 無法渲染（尺寸或大小超出限制）", "problems": [str(e)]})
    except Exception:
        log.exception("advanced edit render failed for variant %s", v.id)
        raise HTTPException(503, "渲染服務暫時無法使用，請稍後再試")
    prefix = f"replicas/{user.tenant_id}/{v.id}/{uuid.uuid4().hex}"
    try:
        html_key = await asyncio.to_thread(storage.put_private, f"{prefix}.html", body.html.encode(), "text/html")
        png_key = await asyncio.to_thread(storage.put_private, f"{prefix}.png", png, "image/png")
    except Exception:
        log.exception("advanced edit upload failed for variant %s", v.id)
        raise HTTPException(503, STORAGE_UNAVAILABLE)
    old_keys = [k for k in (v.replica_html_key, v.replica_png_key) if k]
    v.replica_html_key, v.replica_png_key = html_key, png_key
    v.replica_width, v.replica_height = w, h
    v.annotations = []
    v.stepcard_key = v.stepcard_preview_key = None
    v.status, v.progress = "annotating", "待標註（進階編輯後）"
    v.review_history = [*(v.review_history or []), {"decision": "advanced_edit", "by": user.id, "at": datetime.now(UTC).isoformat()}]
    await db.commit()
    await _delete_replaced(old_keys)
    return variant_out(v, user)


async def _delete_replaced(keys: list[str]) -> None:
    """Old replicas are desensitised; a failed cleanup only leaves an orphan, so log it."""
    for key in keys:
        try:
            await asyncio.to_thread(storage.delete_private, key)
        except Exception:
            log.warning("could not delete replaced replica %s", key, exc_info=True)


# ---- 7. annotations & 8. step card

@router.put("/variants/{variant_id}/annotations", response_model=VariantOut)
async def set_annotations(variant_id: str, body: AnnotationsIn, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    if v.status not in EDITABLE_AFTER_REVIEW:
        raise HTTPException(409, "尚未通過審核，不能標註")
    v.annotations = [a.model_dump() for a in sorted(body.annotations, key=lambda a: a.number)]
    v.progress = "標註已修改，需重新產生 Step Card" if v.status == "completed" else "標註中"
    v.status = "annotating"
    await db.commit()
    return variant_out(v, user)


# ---- step card layout (SPEC §9.1)

@router.post("/variants/{variant_id}/card-preview", response_model=CardPreviewOut)
async def card_preview(variant_id: str, body: CardPreviewIn, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """The card as HTML for the layout editor: the worker's exact page, drawn
    with the given (or stored) template and step patch and the unsaved
    annotations. The editor then moves things live through CSS variables."""
    v = await _variant(db, user, variant_id)
    if not v.replica_html_key or v.status not in (*EDITABLE_AFTER_REVIEW, "rendering"):
        raise HTTPException(409, "審核通過後才能預覽 Step Card")
    cx = await load_card_context(db, v)
    template = body.template.model_dump() if body.template else cx.template
    patch = body.patch.sparse() if body.patch is not None else cx.patch
    layout = merge_layout(template, patch)
    annotations = [a.model_dump() for a in body.annotations] if body.annotations is not None else list(v.annotations or [])
    replica_html = (await _private_bytes(storage.get_private, v.replica_html_key)).decode()
    html, _ = build_card_html(replica_html=replica_html, replica_w=v.replica_width, replica_h=v.replica_height, annotations=annotations,
                              title=cx.title, instruction=cx.instruction, theme=v.theme, layout=layout, step_number=cx.number)
    return CardPreviewOut(html=html, channel=cx.channel, replica_w=v.replica_width, replica_h=v.replica_height,
                          layout=layout, template=template, patch=patch, built_in=cx.built_in)


@router.put("/variants/{variant_id}/stepcard-layout", response_model=VariantOut)
async def set_layout(variant_id: str, body: StepCardLayoutIn, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    """Store this step's changes to the template — only the keys it touched —
    or clear them so it follows the template again. The card is rendered
    again by hand."""
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    if v.status not in EDITABLE_AFTER_REVIEW:
        raise HTTPException(409, "審核通過後才能調整版型")
    v.stepcard_layout = (body.patch.sparse() if body.patch else {}) or None
    await db.commit()
    return variant_out(v, user)


@router.post("/variants/{variant_id}/render-card", response_model=VariantOut)
async def render_card(variant_id: str, user: CurrentUser = Depends(require("editor")), db: AsyncSession = Depends(get_db)):
    v = await _variant(db, user, variant_id)
    ensure_not_job_owned(v)
    if v.status not in EDITABLE_AFTER_REVIEW or not v.replica_html_key:
        raise HTTPException(409, "尚未通過審核")
    await start_job(db, v, "rendering", "排隊產生 Step Card", "render_stepcard", v.id)
    return variant_out(v, user)
