"""`/api/admin/applications`：審核佇列、案件頁、findings、狀態轉移（SPEC §8.2「案件審核」）。

狀態機完全在 `services/application.py`，判定完全在 `services/review.py`；這支 router
只把 JWT 裡的角色包成 `Actor` 交出去，再把結果攤平成 JSON。可執行的轉移也由 service
算，前端不自己推——按鈕少一顆是小事，多一顆就會變成一次 403。

證明文件永遠不直接吐 bytes：只給 5 分鐘的 presigned URL（SPEC §11）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ...db import get_db
from ...deps import CurrentUser, require_cap
from ...models import (
    Application,
    ApplicationDocument,
    ApplicationStatusEvent,
    ReviewFinding,
    Scheme,
    User,
)
from ...pii import decrypt_phone, mask_name, mask_phone
from ...services import application as case_service
from ...services import audit, review
from ...services import documents as documents_service
from ...services import scheme as scheme_service
from ...services.actors import Actor
from .schemas import (
    ApplicationDetailOut,
    ApplicationOut,
    AssignIn,
    AssignOut,
    DocumentUrlOut,
    EvaluateOut,
    EventOut,
    FindingOverrideIn,
    FindingsOut,
    OcrIn,
    QueueOut,
    TransitionIn,
    TransitionResultOut,
)

router = APIRouter(prefix="/api/admin/applications", tags=["admin-applications"])

NOT_FOUND = "找不到此案件"
DOCUMENT_NOT_FOUND = "找不到此文件"
RULE_NOT_FOUND = "找不到此規則"
DOCUMENT_PURGED = "文件已超過保存期限並刪除"
TRANSITION_NOT_ALLOWED = "TRANSITION_NOT_ALLOWED"


# ------------------------------------------------------------------ 載入

async def _load(db: AsyncSession, tenant_id: str, case_no: str, *, with_documents: bool = False) -> Application:
    """非同步 session 不能延遲載入關聯，要哪些子資料就在這裡一次講清楚。"""
    q = select(Application).where(Application.tenant_id == tenant_id, Application.case_no == case_no)
    if with_documents:
        q = q.options(selectinload(Application.documents))
    app = (await db.execute(q)).scalar_one_or_none()
    if app is None:
        raise HTTPException(404, NOT_FOUND)
    return app


async def _reviewers(db: AsyncSession, ids: set[str]) -> dict[str, User]:
    clean = {i for i in ids if i}
    if not clean:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(clean)))).scalars().all()
    return {u.id: u for u in rows}


def _reviewer_out(user: User | None) -> dict[str, str] | None:
    if user is None:
        return None
    return {"id": user.id, "name": user.name or user.email}


async def _schemes(db: AsyncSession, ids: set[str]) -> dict[str, Scheme]:
    clean = {i for i in ids if i}
    if not clean:
        return {}
    rows = (await db.execute(select(Scheme).where(Scheme.id.in_(clean)))).scalars().all()
    return {s.id: s for s in rows}


def _row(
    app: Application,
    *,
    scheme: Scheme | None = None,
    reviewer: User | None = None,
    verdict: str | None = None,
) -> dict[str, Any]:
    return {
        "case_no": app.case_no,
        "scheme_id": app.scheme_id,
        "scheme_code": scheme.code if scheme else "",
        "scheme_name": scheme.name if scheme else "",
        "status": app.status,
        "tier_code": app.tier_code,
        "payment_channel_code": app.payment_channel_code,
        "intake_channel": app.intake_channel,
        "applicant_name_masked": mask_name(app.applicant_name),
        "tool_name": app.tool_name,
        "purchase_amount": app.purchase_amount,
        "revision_count": app.revision_count,
        "first_submitted_at": app.first_submitted_at,
        "last_submitted_at": app.last_submitted_at,
        "supplement_deadline": app.supplement_deadline,
        "assigned_reviewer_id": app.assigned_reviewer_id,
        "assigned_reviewer": _reviewer_out(reviewer),
        "verdict": verdict,
        "version": app.version,
    }


async def _verdicts(db: AsyncSession, apps: list[Application], schemes: dict[str, Scheme]) -> dict[str, str | None]:
    """佇列上每一件案子的目前結論。沒有任何 finding 就是 None（還沒判定過）。"""
    out: dict[str, str | None] = {}
    for app in apps:
        scheme = schemes.get(app.scheme_id)
        rows = await review.latest_findings(db, app)
        if not rows or scheme is None:
            out[app.id] = None
            continue
        rules = [review.rule_spec(r) for r in scheme.review_rules]
        out[app.id] = review.verdict_of([review.finding_of(r) for r in rows], rules)
    return out


# ------------------------------------------------------------------ 佇列

@router.get("", response_model=QueueOut)
async def list_queue(
    status: list[str] | None = Query(default=None),
    scheme: str | None = Query(default=None, description="方案代碼"),
    assigned: str | None = Query(default=None, description="承辦人 id"),
    q: str = Query(default="", max_length=120, description="案號、姓名或工具名稱"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> QueueOut:
    """佇列固定依 `first_submitted_at` 排序——補件不重排是對民眾的承諾（SPEC §7）。"""
    scheme_id: str | None = None
    if scheme:
        row = (
            await db.execute(select(Scheme.id).where(Scheme.tenant_id == user.tenant_id, Scheme.code == scheme))
        ).scalar_one_or_none()
        scheme_id = str(row) if row else "__none__"

    rows, total = await case_service.queue(
        db, user.tenant_id, statuses=status, scheme_id=scheme_id,
        assigned_reviewer_id=assigned, limit=page_size, offset=(page - 1) * page_size,
        search=q,
    )
    schemes = await _schemes(db, {a.scheme_id for a in rows})
    reviewers = await _reviewers(db, {a.assigned_reviewer_id or "" for a in rows})
    verdicts = await _verdicts(db, rows, schemes)
    return QueueOut(
        total=total,
        items=[
            ApplicationOut(**_row(a, scheme=schemes.get(a.scheme_id),
                                  reviewer=reviewers.get(a.assigned_reviewer_id or ""),
                                  verdict=verdicts.get(a.id)))
            for a in rows
        ],
    )


# ---------------------------------------------------------------- 案件頁

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
            "needs_supplement_items": t.needs_supplement,
        })
    return out


def _finding_out(
    row: ReviewFinding,
    *,
    reviewer: User | None,
    superseded: bool,
    document_types: dict[str, str],
) -> dict[str, Any]:
    """`review_findings` 的一列 → 契約 §Finding + 案件頁的落地欄位。

    `document_type_code` 沒有自己的欄位，由 `document_id` 反查——finding 指向的是
    某一個版本的文件，而不是某個類型。
    """
    return {
        "id": row.id,
        "rule_id": row.rule_id,
        "rule_code": row.rule_code,
        "document_id": row.document_id,
        "status": row.status,
        "extracted_value": row.extracted_value or None,
        "expected_value": row.expected_value or None,
        "confidence": row.confidence,
        "bbox": dict(row.bbox) if row.bbox else None,
        "document_type_code": document_types.get(row.document_id or ""),
        "note": row.note or None,
        "suggested_supplement": None,
        "source": row.source,
        "reviewer": _reviewer_out(reviewer),
        "decided_at": row.decided_at,
        "superseded": superseded,
    }


async def _findings_payload(db: AsyncSession, app: Application) -> list[dict[str, Any]]:
    """最新的在前，歷史接在後面並標 `superseded`（契約 §CaseDetail）。"""
    history = await review.all_findings(db, app)
    latest = {row.id for row in await review.latest_findings(db, app)}
    reviewers = await _reviewers(db, {row.reviewer_id or "" for row in history})
    document_types = {
        d.id: d.document_type_code
        for d in (
            await db.execute(
                select(ApplicationDocument).where(ApplicationDocument.application_id == app.id)
            )
        ).scalars()
    }
    current = [r for r in history if r.id in latest]
    older = [r for r in history if r.id not in latest]

    def out(row: ReviewFinding, *, superseded: bool) -> dict[str, Any]:
        return _finding_out(row, reviewer=reviewers.get(row.reviewer_id or ""),
                            superseded=superseded, document_types=document_types)

    return (
        [out(r, superseded=False) for r in sorted(current, key=lambda r: r.rule_code)]
        + [out(r, superseded=True) for r in older]
    )


async def _events_payload(db: AsyncSession, app: Application) -> list[dict[str, Any]]:
    """時間軸。STAFF 的 `actor_id` 一次查完換成名字，一件案子只多一次查詢。"""
    events = (
        await db.execute(
            select(ApplicationStatusEvent)
            .where(ApplicationStatusEvent.application_id == app.id)
            .order_by(ApplicationStatusEvent.created_at)
        )
    ).scalars().all()
    staff = await _reviewers(db, {e.actor_id or "" for e in events if e.actor_type == "STAFF"})
    out = []
    for event in events:
        row = EventOut.model_validate(event, from_attributes=True).model_dump()
        user = staff.get(event.actor_id or "") if event.actor_type == "STAFF" else None
        row["actor_name"] = (user.name or user.email) if user else None
        out.append(row)
    return out


async def _documents_payload(db: AsyncSession, app: Application, scheme: Scheme | None) -> list[dict[str, Any]]:
    docs = sorted(app.documents, key=lambda d: (d.document_type_code, d.revision))
    ocr = await review.latest_ocr_for(db, [d.id for d in docs])
    labels = {d.code: d.label for d in (scheme.document_types if scheme else [])}
    out = []
    for doc in docs:
        row = ocr.get(doc.id)
        out.append({
            "id": doc.id,
            "document_type_code": doc.document_type_code,
            "document_type_label": labels.get(doc.document_type_code, ""),
            "revision": doc.revision,
            "is_current": doc.is_current,
            "supersedes_id": doc.supersedes_id,
            "mime": doc.mime,
            "size": doc.size,
            "page_count": doc.page_count,
            "masked": doc.masked,
            "preview_key": doc.preview_key,
            "uploaded_at": doc.uploaded_at,
            "purged_at": doc.purged_at,
            "ocr": None if row is None else {
                "source": row.source,
                "engine": row.engine,
                "confidence": row.confidence,
                "lines": list(row.lines or []),
            },
        })
    return out


@router.get("/{case_no}", response_model=ApplicationDetailOut)
async def get_application(
    case_no: str,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> ApplicationDetailOut:
    app = await _load(db, user.tenant_id, case_no, with_documents=True)
    scheme = await scheme_service.get_scheme_by_id(db, user.tenant_id, app.scheme_id)
    reviewers = await _reviewers(db, {app.assigned_reviewer_id or ""})

    findings = await _findings_payload(db, app)
    rules = [review.rule_spec(r) for r in sorted(scheme.review_rules, key=lambda r: (r.sort_order, r.code))]
    latest = await review.latest_findings(db, app)
    verdict = review.verdict_of([review.finding_of(r) for r in latest], rules) if latest else None

    return ApplicationDetailOut(
        **_row(app, scheme=scheme, reviewer=reviewers.get(app.assigned_reviewer_id or ""), verdict=verdict),
        applicant_name=app.applicant_name,
        email=app.email,
        phone_masked=mask_phone(decrypt_phone(app.phone_encrypted)),
        id_last4_masked="****" if app.id_last4_hash else "",
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
        scheme_settings=scheme_service.scheme_settings_view(scheme),  # type: ignore[arg-type]
        allowed_transitions=_transitions_for(user, app),  # type: ignore[arg-type]
        approval_blockers=await review.blockers_for(db, app),  # type: ignore[arg-type]
        rules=[r.to_public() for r in rules],
        documents=await _documents_payload(db, app, scheme),  # type: ignore[arg-type]
        events=await _events_payload(db, app),  # type: ignore[arg-type]
        findings=findings,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------- 文件

async def _document(db: AsyncSession, app: Application, doc_id: str) -> ApplicationDocument:
    doc = (
        await db.execute(
            select(ApplicationDocument).where(
                ApplicationDocument.id == doc_id, ApplicationDocument.application_id == app.id
            )
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(404, DOCUMENT_NOT_FOUND)
    return doc


@router.get("/{case_no}/documents/{doc_id}/url", response_model=DocumentUrlOut)
async def document_url(
    case_no: str,
    doc_id: str,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> DocumentUrlOut:
    """5 分鐘的 presigned URL。檔案本身永遠不經過這支 API（SPEC §11）。"""
    app = await _load(db, user.tenant_id, case_no)
    doc = await _document(db, app, doc_id)
    if not doc.object_key:
        raise HTTPException(410, DOCUMENT_PURGED)
    url, expires_at = await documents_service.presigned_url(doc.object_key)
    await audit.log(db, Actor.staff(user), "document_url", "application_document", doc.id,
                    {"case_no": app.case_no}, tenant_id=user.tenant_id)
    await db.commit()
    return DocumentUrlOut(url=url, expires_at=expires_at)


@router.post("/{case_no}/documents/{doc_id}/ocr", response_model=FindingsOut)
async def put_reviewer_ocr(
    case_no: str,
    doc_id: str,
    body: OcrIn,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> FindingsOut:
    """承辦人在自己的瀏覽器重新辨識（`source=reviewer`），存完立刻重跑規則。

    重跑的結果會蓋過申請人版本的判定——`source=applicant` 的 OCR 依 SPEC §11 一律
    視為不可信。
    """
    app = await _load(db, user.tenant_id, case_no)
    doc = await _document(db, app, doc_id)
    await documents_service.write_ocr(db, doc, body.ocr, source="reviewer", engine="tesseract.js")
    findings = await review.evaluate_application(db, app)
    await review.persist_findings(db, app, findings, source="auto")
    await audit.log(db, Actor.staff(user), "reviewer_ocr", "application_document", doc.id,
                    {"case_no": app.case_no}, tenant_id=user.tenant_id)
    await db.commit()
    return FindingsOut(findings=await _findings_payload(db, app))  # type: ignore[arg-type]


# -------------------------------------------------------------- findings

@router.post("/{case_no}/evaluate", response_model=EvaluateOut)
async def evaluate_case(
    case_no: str,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> EvaluateOut:
    """重跑規則引擎：目前版本的每份文件、每份文件最新的 OCR。"""
    app = await _load(db, user.tenant_id, case_no)
    scheme = await scheme_service.get_scheme_by_id(db, user.tenant_id, app.scheme_id)
    findings = await review.evaluate_application(db, app)
    await review.persist_findings(db, app, findings, source="auto")
    await db.commit()
    rules = [review.rule_spec(r) for r in scheme.review_rules]
    return EvaluateOut(
        findings=await _findings_payload(db, app),  # type: ignore[arg-type]
        verdict=review.verdict_of(findings, rules),
    )


@router.put("/{case_no}/findings/{rule_code}", response_model=FindingsOut)
async def override_finding(
    case_no: str,
    rule_code: str,
    body: FindingOverrideIn,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> FindingsOut:
    """人工覆寫一條規則的判定：**另寫一列** `source=reviewer`，舊的留著（SPEC §8.3）。"""
    app = await _load(db, user.tenant_id, case_no)
    scheme = await scheme_service.get_scheme_by_id(db, user.tenant_id, app.scheme_id)
    if not any(r.code == rule_code for r in scheme.review_rules):
        raise HTTPException(404, RULE_NOT_FOUND)

    previous = {row.rule_code: row for row in await review.latest_findings(db, app)}.get(rule_code)
    finding = review.Finding(
        rule_code=rule_code,
        status=body.status,
        extracted_value=body.extracted_value
        if body.extracted_value is not None
        else (previous.extracted_value if previous else None),
        expected_value=previous.expected_value if previous else None,
        confidence=previous.confidence if previous else None,
        bbox=dict(previous.bbox) if previous and previous.bbox else None,
        note=body.note,
        document_id=previous.document_id if previous else None,
    )
    await review.persist_findings(db, app, [finding], source="reviewer", reviewer_id=user.id)
    await audit.log(db, Actor.staff(user), "finding_override", "application", app.case_no,
                    {"rule_code": rule_code, "status": body.status}, tenant_id=user.tenant_id)
    await db.commit()
    return FindingsOut(findings=await _findings_payload(db, app))  # type: ignore[arg-type]


# -------------------------------------------------------------- 狀態轉移

@router.post("/{case_no}/transitions", response_model=None, status_code=201,
             responses={201: {"model": TransitionResultOut}})
async def post_transition(
    case_no: str,
    body: TransitionIn,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """唯一的狀態變更入口。每一條規則的檢查都在 service 裡（CLAUDE.md 規則 5）。

    被核准前置條件擋下來時回 `409 {code, blockers}`——承辦人要知道「還差哪幾條規則」，
    而不是只看到一句「不行」。
    """
    app = await _load(db, user.tenant_id, case_no)
    try:
        await case_service.transition(
            db, app, body.code,
            actor=Actor.staff(user),
            reason=body.reason,
            rejection_codes=body.rejection_codes,
            supplement_items=[i.model_dump() for i in body.supplement_items],
            supplement_deadline=body.supplement_deadline,
            payload=body.payload,
        )
    except case_service.TransitionError as err:
        if err.status_code != 409:
            raise
        blockers = await review.blockers_for(db, app) if body.code == "T3" else []
        return JSONResponse(status_code=409, content={"code": TRANSITION_NOT_ALLOWED, "blockers": blockers,
                                                      "message": str(err.detail)})

    events = await _events_payload(db, app)
    latest = events[-1]
    await audit.log(
        db, Actor.staff(user), "transition", "application", app.case_no,
        {"code": body.code, "from": latest["from_status"], "to": latest["to_status"]},
        tenant_id=user.tenant_id,
    )
    await db.commit()
    return TransitionResultOut(status=app.status, events=events)  # type: ignore[arg-type]


@router.post("/{case_no}/assign", response_model=AssignOut)
async def assign(
    case_no: str,
    body: AssignIn,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> AssignOut:
    """指派（或取消指派）承辦人。只能指派同一個機關裡的人。"""
    app = await _load(db, user.tenant_id, case_no)
    reviewer: User | None = None
    if body.reviewer_id:
        reviewer = (
            await db.execute(
                select(User).where(User.id == body.reviewer_id, User.tenant_id == user.tenant_id)
            )
        ).scalar_one_or_none()
        if reviewer is None:
            raise HTTPException(404, "找不到此承辦人")
    before = app.assigned_reviewer_id
    app.assigned_reviewer_id = reviewer.id if reviewer else None
    await audit.log(db, Actor.staff(user), "assign", "application", app.case_no,
                    {"from": before, "to": app.assigned_reviewer_id}, tenant_id=user.tenant_id)
    await db.commit()
    return AssignOut(assigned_reviewer=_reviewer_out(reviewer))  # type: ignore[arg-type]


__all__ = ["router"]
