"""Non-SOP `/v1` resources, thin wrappers around existing services (SPEC §10.1)."""

from datetime import date
from types import SimpleNamespace
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import intent as intent_service
from ..db import get_db
from ..deps import ApiCaller, api_caller, require_api_scope
from ..models import (
    Application,
    ApplicationDocument,
    ApplicationStatusEvent,
    Content,
    DocumentOcrResult,
    Notification,
)
from ..security import decode_case_token
from ..services import application as applications
from ..services import contents, faq, review, scheme
from ..services.actors import Actor

router = APIRouter(prefix="/v1", tags=["public-v1"])


async def _application(db: AsyncSession, tenant_id: str, case_no: str) -> Application:
    row = (await db.execute(select(Application).where(
        Application.tenant_id == tenant_id, Application.case_no == case_no,
    ))).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "找不到案件")
    return row


def _application_view(row: Application) -> dict[str, Any]:
    return {"id": row.id, "case_no": row.case_no, "scheme_id": row.scheme_id, "status": row.status,
            "tier_code": row.tier_code, "payment_channel_code": row.payment_channel_code,
            "intake_channel": row.intake_channel, "purchase_amount": row.purchase_amount,
            "purchase_date": row.purchase_date, "paid_by_proxy": row.paid_by_proxy,
            "revision_count": row.revision_count, "supplement_items": row.supplement_items,
            "supplement_deadline": row.supplement_deadline, "approved_amount": row.approved_amount,
            "created_at": row.created_at, "updated_at": row.updated_at}


@router.get("/schemes")
async def list_schemes(caller: ApiCaller = Depends(require_api_scope("read")), db: AsyncSession = Depends(get_db)):
    return [scheme.scheme_public_view(row) for row in await scheme.list_schemes(db, caller.tenant_id, active=True)]


@router.get("/schemes/{code}")
async def get_scheme(code: str, caller: ApiCaller = Depends(require_api_scope("read")),
                     db: AsyncSession = Depends(get_db)):
    return scheme.scheme_public_view(await scheme.get_scheme(db, caller.tenant_id, code))


class ApplicationIn(BaseModel):
    scheme: str
    applicant_name: str
    phone: str = ""
    id_number: str = ""
    email: str = ""
    tier_code: str = ""
    payment_channel_code: str = ""
    purchase_amount: int | None = None
    purchase_date: date | None = None
    paid_by_proxy: bool = False
    note: str = ""
    documents: list[dict[str, Any]] = []


async def _store_ocr(db: AsyncSession, rows: list[ApplicationDocument], specs: list[dict[str, Any]]) -> None:
    for row, spec in zip(rows, specs, strict=True):
        data = spec.get("ocr")
        if not isinstance(data, dict):
            continue
        db.add(DocumentOcrResult(tenant_id=row.tenant_id, document_id=row.id, source="applicant",
                                 engine=str(data.get("engine", "")), lang=str(data.get("lang", "")),
                                 text=str(data.get("text", "")), confidence=float(data.get("confidence", 0) or 0),
                                 lines=list(data.get("lines") or [])))


@router.post("/applications", status_code=201)
async def create_application(body: ApplicationIn, caller: ApiCaller = Depends(require_api_scope("apply")),
                             db: AsyncSession = Depends(get_db)):
    configured = await scheme.get_scheme(db, caller.tenant_id, body.scheme)
    specs = [{k: v for k, v in item.items() if k != "ocr"} for item in body.documents]
    row = await applications.create_application(
        db, tenant_id=caller.tenant_id, scheme=configured, applicant_name=body.applicant_name,
        phone=body.phone, id_number=body.id_number, email=body.email, tier_code=body.tier_code,
        payment_channel_code=body.payment_channel_code, purchase_amount=body.purchase_amount,
        purchase_date=body.purchase_date, paid_by_proxy=body.paid_by_proxy, note=body.note,
        documents=specs, intake_channel="WEB",
    )
    docs = (await db.execute(select(ApplicationDocument).where(
        ApplicationDocument.application_id == row.id,
    ).order_by(ApplicationDocument.uploaded_at, ApplicationDocument.id))).scalars().all()
    await _store_ocr(db, list(docs), body.documents)
    await db.commit()
    return _application_view(row)


@router.get("/applications/{case_no}")
async def get_application(case_no: str, caller: ApiCaller = Depends(require_api_scope("read")),
                          db: AsyncSession = Depends(get_db)):
    return _application_view(await _application(db, caller.tenant_id, case_no))


class DocumentsIn(BaseModel):
    documents: list[dict[str, Any]] = Field(min_length=1)


@router.post("/applications/{case_no}/documents", status_code=201)
async def add_documents(case_no: str, body: DocumentsIn,
                        caller: ApiCaller = Depends(require_api_scope("apply")), db: AsyncSession = Depends(get_db)):
    app = await _application(db, caller.tenant_id, case_no)
    specs = [{k: v for k, v in item.items() if k != "ocr"} for item in body.documents]
    rows = await applications.add_documents(db, app, specs)
    await _store_ocr(db, rows, body.documents)
    await db.commit()
    return {"documents": [{"id": row.id, "document_type_code": row.document_type_code,
                             "revision": row.revision} for row in rows]}


class TransitionIn(BaseModel):
    transition_code: str
    applicant_token: str = ""
    reason: str = ""
    rejection_codes: list[str] = []
    supplement_items: list[dict[str, Any]] = []
    payload: dict[str, Any] = {}


@router.post("/applications/{case_no}/transitions")
async def transition_application(case_no: str, body: TransitionIn, caller: ApiCaller = Depends(api_caller),
                                 db: AsyncSession = Depends(get_db)):
    app = await _application(db, caller.tenant_id, case_no)
    if body.transition_code in {"T4", "T10"}:
        try:
            token = decode_case_token(body.applicant_token)
        except Exception:
            raise HTTPException(401, "案件驗證已失效")
        if token.get("case_no") != case_no or token.get("tid") != caller.tenant_id:
            raise HTTPException(403, "案件 token 不屬於此案件")
        actor = Actor.applicant(case_no)
    else:
        if not caller.can("review"):
            raise HTTPException(403, "API key 缺少 review scope")
        actor = Actor.staff(SimpleNamespace(id=caller.api_key_id, role="case_supervisor", name=caller.name))
    event = await applications.transition(db, app, body.transition_code, actor=actor, reason=body.reason,
                                          rejection_codes=body.rejection_codes,
                                          supplement_items=body.supplement_items, payload=body.payload)
    await db.commit()
    return {"event_id": event.id, "from_status": event.from_status, "to_status": event.to_status,
            "transition_code": event.transition_code}


@router.get("/applications/{case_no}/events")
async def application_events(case_no: str, caller: ApiCaller = Depends(require_api_scope("read")),
                             db: AsyncSession = Depends(get_db)):
    app = await _application(db, caller.tenant_id, case_no)
    rows = (await db.execute(select(ApplicationStatusEvent).where(
        ApplicationStatusEvent.application_id == app.id,
    ).order_by(ApplicationStatusEvent.created_at))).scalars().all()
    return [{"id": row.id, "from_status": row.from_status, "to_status": row.to_status,
             "transition_code": row.transition_code, "actor_type": row.actor_type, "reason": row.reason,
             "rejection_codes": row.rejection_codes, "payload": row.payload, "created_at": row.created_at}
            for row in rows]


class EvaluateIn(BaseModel):
    scheme: str
    documents: list[dict[str, Any]] = []
    facts: dict[str, Any] = {}


@router.post("/review/evaluate")
async def evaluate(body: EvaluateIn, caller: ApiCaller = Depends(require_api_scope("review")),
                   db: AsyncSession = Depends(get_db)):
    configured = await scheme.get_scheme(db, caller.tenant_id, body.scheme)
    return await review.dry_run(db, configured, {"documents": body.documents, "facts": body.facts})


@router.get("/review/rules")
async def review_rules(scheme_code: str = Query(alias="scheme"),
                       caller: ApiCaller = Depends(require_api_scope("review")),
                       db: AsyncSession = Depends(get_db)):
    configured = await scheme.get_scheme(db, caller.tenant_id, scheme_code)
    return [row.to_public() for row in await review.rules_for(db, configured.id)]


@router.get("/applications/{case_no}/findings")
async def findings(case_no: str, caller: ApiCaller = Depends(require_api_scope("review")),
                   db: AsyncSession = Depends(get_db)):
    app = await _application(db, caller.tenant_id, case_no)
    rows = await review.latest_findings(db, app)
    return [{"id": row.id, "rule_code": row.rule_code, "status": row.status,
             "extracted_value": row.extracted_value, "expected_value": row.expected_value,
             "confidence": row.confidence, "note": row.note, "source": row.source} for row in rows]


class FindingIn(BaseModel):
    status: str
    extracted_value: str = ""
    expected_value: str = ""
    confidence: float = 0
    note: str = ""


@router.put("/applications/{case_no}/findings/{rule_code}")
async def update_finding(case_no: str, rule_code: str, body: FindingIn,
                         caller: ApiCaller = Depends(require_api_scope("review")), db: AsyncSession = Depends(get_db)):
    app = await _application(db, caller.tenant_id, case_no)
    rows = await review.persist_findings(db, app, [review.Finding(
        rule_code=rule_code, status=body.status, extracted_value=body.extracted_value,
        expected_value=body.expected_value, confidence=body.confidence, note=body.note,
    )], source="reviewer", reviewer_id=caller.api_key_id)
    await db.commit()
    return {"id": rows[0].id, "rule_code": rule_code, "status": rows[0].status}


@router.get("/contents")
async def list_contents(category: str | None = None, caller: ApiCaller = Depends(require_api_scope("contents")),
                        db: AsyncSession = Depends(get_db)):
    query = select(Content).where(Content.tenant_id == caller.tenant_id)
    if category:
        query = query.where(Content.category == category)
    rows = (await db.execute(query.order_by(Content.sort_order, Content.key))).scalars().all()
    return [{"key": row.key, "category": row.category, "title": row.title,
             "content": row.content, "content_type": row.content_type, "variables": row.variables} for row in rows]


@router.get("/contents/{key}")
async def get_content(key: str, caller: ApiCaller = Depends(require_api_scope("contents")),
                      db: AsyncSession = Depends(get_db)):
    rows = await list_contents(None, caller, db)
    match = next((row for row in rows if row["key"] == key), None)
    if match is None:
        raise HTTPException(404, "找不到文案")
    return match


class RenderIn(BaseModel):
    key: str
    vars: dict[str, Any] = {}


@router.post("/contents/render")
async def render_content(body: RenderIn, caller: ApiCaller = Depends(require_api_scope("contents")),
                         db: AsyncSession = Depends(get_db)):
    return await contents.render(db, caller.tenant_id, body.key, body.vars)


class TextIn(BaseModel):
    text: str
    limit: int = Field(default=3, ge=1, le=20)


@router.post("/faqs/search")
async def search_faqs(body: TextIn, caller: ApiCaller = Depends(require_api_scope("read")),
                      db: AsyncSession = Depends(get_db)):
    hits = await faq.search(db, caller.tenant_id, body.text, limit=body.limit)
    return [{"id": hit.faq.id, "question": hit.faq.question, "answer": hit.faq.answer,
             "category": hit.faq.category, "score": hit.score, "source": hit.source} for hit in hits]


@router.post("/intent/classify")
async def classify_intent(body: TextIn, caller: ApiCaller = Depends(require_api_scope("sop")),
                          db: AsyncSession = Depends(get_db)):
    return (await intent_service.classify(db, caller.tenant_id, body.text,
                                          ref_id=f"api:{caller.api_key_id}")).dict()


@router.get("/notifications")
async def notifications(case_no: str | None = None, caller: ApiCaller = Depends(require_api_scope("read")),
                        db: AsyncSession = Depends(get_db)):
    query = select(Notification).where(Notification.tenant_id == caller.tenant_id)
    if case_no:
        app = await _application(db, caller.tenant_id, case_no)
        query = query.where(Notification.application_id == app.id)
    rows = (await db.execute(query.order_by(Notification.created_at.desc()).limit(200))).scalars().all()
    return [{"id": row.id, "case_no": row.payload.get("case_no"), "kind": row.kind,
             "content_key": row.content_key, "payload": row.payload, "status": row.status,
             "error": row.error, "created_at": row.created_at, "sent_at": row.sent_at} for row in rows]
