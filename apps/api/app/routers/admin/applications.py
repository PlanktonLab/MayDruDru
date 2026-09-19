"""`/api/admin/applications`：審核佇列、案件頁、狀態轉移（SPEC §8.2「案件審核」）。

狀態機完全在 `services/application.py`；這支 router 只把 JWT 裡的角色包成 `Actor`
交出去。可執行的轉移也由 service 算，前端不自己推——按鈕少一顆是小事，
多一顆就會變成一次 403。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ...db import get_db
from ...deps import CurrentUser, require_cap
from ...models import Application, ApplicationStatusEvent, ReviewFinding
from ...pii import decrypt_phone, mask_name, mask_phone
from ...services import application as case_service
from ...services import audit
from ...services import scheme as scheme_service
from ...services.actors import Actor
from .schemas import (
    ApplicationDetailOut,
    ApplicationOut,
    DocumentOut,
    EventOut,
    FindingOut,
    QueueOut,
    TransitionIn,
)

router = APIRouter(prefix="/api/admin/applications", tags=["admin-applications"])

NOT_FOUND = "找不到此案件"


def _row(app: Application) -> ApplicationOut:
    return ApplicationOut(
        case_no=app.case_no,
        scheme_id=app.scheme_id,
        status=app.status,
        tier_code=app.tier_code,
        payment_channel_code=app.payment_channel_code,
        intake_channel=app.intake_channel,
        applicant_name_masked=mask_name(app.applicant_name),
        tool_name=app.tool_name,
        purchase_amount=app.purchase_amount,
        revision_count=app.revision_count,
        first_submitted_at=app.first_submitted_at,
        last_submitted_at=app.last_submitted_at,
        supplement_deadline=app.supplement_deadline,
        assigned_reviewer_id=app.assigned_reviewer_id,
        version=app.version,
    )


async def _load(db: AsyncSession, tenant_id: str, case_no: str, *, with_documents: bool = False) -> Application:
    """非同步 session 不能延遲載入關聯，要哪些子資料就在這裡一次講清楚。"""
    q = select(Application).where(Application.tenant_id == tenant_id, Application.case_no == case_no)
    if with_documents:
        q = q.options(selectinload(Application.documents))
    app = (await db.execute(q)).scalar_one_or_none()
    if app is None:
        raise HTTPException(404, NOT_FOUND)
    return app


@router.get("", response_model=QueueOut)
async def list_queue(
    status: list[str] | None = Query(default=None),
    scheme_id: str | None = None,
    assigned_reviewer_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
):
    """佇列固定依 `first_submitted_at` 排序——補件不重排是對民眾的承諾（SPEC §7）。"""
    rows, total = await case_service.queue(
        db, user.tenant_id, statuses=status, scheme_id=scheme_id,
        assigned_reviewer_id=assigned_reviewer_id, limit=limit, offset=offset,
    )
    return QueueOut(total=total, items=[_row(a) for a in rows])


@router.get("/{case_no}", response_model=ApplicationDetailOut)
async def get_application(
    case_no: str,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
):
    app = await _load(db, user.tenant_id, case_no, with_documents=True)
    scheme = await scheme_service.get_scheme_by_id(db, user.tenant_id, app.scheme_id)

    events = (
        await db.execute(
            select(ApplicationStatusEvent)
            .where(ApplicationStatusEvent.application_id == app.id)
            .order_by(ApplicationStatusEvent.created_at)
        )
    ).scalars().all()
    findings = (
        await db.execute(select(ReviewFinding).where(ReviewFinding.application_id == app.id))
    ).scalars().all()

    base = _row(app).model_dump()
    return ApplicationDetailOut(
        **base,
        applicant_name=app.applicant_name,
        email=app.email,
        phone_masked=mask_phone(decrypt_phone(app.phone_encrypted)),
        purchase_date=app.purchase_date,
        paid_by_proxy=app.paid_by_proxy,
        note=app.note,
        approved_amount=app.approved_amount,
        payment_date=app.payment_date,
        payment_amount=app.payment_amount,
        documents_purge_at=app.documents_purge_at,
        supplement_items=list(app.supplement_items or []),
        required_document_types=scheme_service.required_document_types(
            scheme, app.tier_code, app.payment_channel_code, app.paid_by_proxy
        ),
        available_transitions=_transitions_for(user, app),
        documents=[DocumentOut.model_validate(d, from_attributes=True) for d in app.documents],
        events=[EventOut.model_validate(e, from_attributes=True) for e in events],
        findings=[FindingOut.model_validate(f, from_attributes=True) for f in findings],
    )


def _transitions_for(user: CurrentUser, app: Application) -> list[dict[str, Any]]:
    """這位承辦人現在按得到哪些按鈕。沒有 capability 的就不列出來。"""
    out = []
    for t in case_service.allowed_transitions(app.status):
        if t.actor_type != "STAFF" or (t.capability and not user.can(t.capability)):
            continue
        out.append({
            "code": t.code,
            "label": t.label,
            "to_status": t.to_status,
            "needs_reason": t.needs_reason,
            "needs_rejection_codes": t.needs_rejection_codes,
            "needs_supplement": t.needs_supplement,
        })
    return out


@router.post("/{case_no}/transitions", response_model=EventOut, status_code=201)
async def post_transition(
    case_no: str,
    body: TransitionIn,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
):
    """唯一的狀態變更入口。每一條規則的檢查都在 service 裡（CLAUDE.md 規則 5）。"""
    app = await _load(db, user.tenant_id, case_no)
    event = await case_service.transition(
        db, app, body.code,
        actor=Actor.staff(user),
        reason=body.reason,
        rejection_codes=body.rejection_codes,
        supplement_items=[i.model_dump() for i in body.supplement_items],
        supplement_deadline=body.supplement_deadline,
        payload=body.payload,
    )
    await audit.log(
        db, Actor.staff(user), "transition", "application", app.case_no,
        {"code": body.code, "from": event.from_status, "to": event.to_status},
        tenant_id=user.tenant_id,
    )
    await db.commit()
    return EventOut.model_validate(event, from_attributes=True)
