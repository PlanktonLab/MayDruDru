"""`/api/apply/*`：市民匿名送件、查詢、補件與撤回（SPEC §8.1 / §10.2）。

薄殼：解析 multipart、叫 service、序列化。所有判斷都在 `app/services/` ——
狀態轉移一律經過 `services/application.py::transition()`（CLAUDE.md 規則 5），
判定一律經過 `services/review.py`（前端送上來的 precheck 完全不採信，SPEC §8.1 第 5 步）。

此模組是 CLAUDE.md 規則 3 的受管對象——**永遠不得 import `app.ai`**。
import-linter 契約 `review 與 apply 不得 import app.ai` 會在 CI 強制這件事。

錯誤一律回 `{"code": …}` 的扁平 body（契約 §/api/apply），文案由前端的 contents 層
渲染；這裡不組任何中文句子（CLAUDE.md 規則 4）。
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile as FormFile

from ..db import get_db
from ..deps import CaseCaller, require_case_token
from ..models import Application, ApplicationDocument, ApplicationStatusEvent, Scheme
from ..redis_client import get_redis
from ..security import CASE_TOKEN_MINUTES
from ..services import application as case_service
from ..services import documents as documents_service
from ..services import faq as faq_service
from ..services import review, tenancy
from ..services import scheme as scheme_service
from ..services.actors import Actor
from .apply_schemas import (
    ApplicationIn,
    CasePublicOut,
    DocumentIn,
    FaqOut,
    RequiredDocumentsIn,
    RequiredDocumentsOut,
    SchemeSummaryOut,
    SubmitResultOut,
    VerifyIn,
    VerifyOut,
    WithdrawOut,
)

log = logging.getLogger("maydru.apply")

router = APIRouter(prefix="/api/apply", tags=["apply"])

# 錯誤代碼（契約）。文案在前端。
SCHEME_CLOSED = "SCHEME_CLOSED"
SCHEME_NOT_FOUND = "SCHEME_NOT_FOUND"
VERIFICATION_FAILED = "VERIFICATION_FAILED"
LOCKED = "LOCKED"
NOT_IN_SUPPLEMENT = "NOT_IN_SUPPLEMENT"
UNEXPECTED_DOCUMENT_TYPE = "UNEXPECTED_DOCUMENT_TYPE"
RATE_LIMITED = "RATE_LIMITED"
CASE_NOT_FOUND = "CASE_NOT_FOUND"

# per-IP rate limit（SPEC §10.2「匿名 + rate limit」）。讀多寫少，所以讀寬寫嚴。
READ_LIMIT_PER_MINUTE = 120
SUBMIT_LIMIT_PER_MINUTE = 10
VERIFY_LIMIT_PER_MINUTE = 20


def coded(status: int, code: str, **extra: Any) -> JSONResponse:
    """契約要求的扁平錯誤 body：`{"code": …}`，不包在 `detail` 裡。"""
    return JSONResponse(status_code=status, content={"code": code, **extra})


def client_ip(request: Request) -> str:
    """反向代理後面的真實來源；`deploy/nginx` 會設 `X-Forwarded-For`。"""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, limit: int, window: int = 60) -> Any:
    """固定視窗的 per-IP 計數。Redis 掛掉時**不擋流量**——限流是防濫用，不是防火牆。"""

    async def dep(request: Request, r: Any = Depends(get_redis)) -> None:
        key = f"apply:rl:{bucket}:{client_ip(request)}:{int(datetime.now(UTC).timestamp() // window)}"
        try:
            hits = await r.incr(key)
            if hits == 1:
                await r.expire(key, window + 10)
        except Exception:
            return
        if hits > limit:
            raise HTTPException(429, {"code": RATE_LIMITED, "retry_after_seconds": window})

    return dep


async def _tenant(db: AsyncSession) -> str:
    return await tenancy.default_tenant_id(db)


async def _scheme(db: AsyncSession, code: str) -> Scheme:
    scheme = (
        await db.execute(
            select(Scheme).where(Scheme.tenant_id == await _tenant(db), Scheme.code == code)
        )
    ).scalar_one_or_none()
    if scheme is None or not scheme.active:
        raise HTTPException(404, {"code": SCHEME_NOT_FOUND})
    return scheme


# ------------------------------------------------------------------ 方案

@router.get("/schemes", response_model=list[SchemeSummaryOut],
            dependencies=[Depends(rate_limit("read", READ_LIMIT_PER_MINUTE))])
async def list_schemes(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    """開放中的方案。停用的方案完全不出現在列表裡。"""
    schemes = await scheme_service.list_schemes(db, await _tenant(db), active=True)
    return [scheme_service.scheme_summary_view(s) for s in schemes]


@router.get("/schemes/{code}", dependencies=[Depends(rate_limit("read", READ_LIMIT_PER_MINUTE))])
async def get_scheme(code: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """送件流程需要的完整方案設定，含 `review_rules`（前端即時回饋用）。"""
    return scheme_service.scheme_apply_view(await _scheme(db, code))


@router.post("/schemes/{code}/required-documents", response_model=RequiredDocumentsOut,
             dependencies=[Depends(rate_limit("read", READ_LIMIT_PER_MINUTE))])
async def required_documents(
    code: str,
    body: RequiredDocumentsIn,
    db: AsyncSession = Depends(get_db),
) -> RequiredDocumentsOut:
    """必要文件由伺服器算（`scheme.required_document_types`），前端不自己推。"""
    scheme = await _scheme(db, code)
    return RequiredDocumentsOut(
        document_type_codes=scheme_service.required_document_types(
            scheme, body.tier_code, body.payment_channel_code, body.paid_by_proxy
        )
    )


# ------------------------------------------------------------------ 送件

def _parse(raw: str, model: type[Any], field: str) -> Any:
    try:
        return model.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(422, [{"loc": ["body", field], "msg": str(exc)}])


def _parse_documents(raw: str) -> list[DocumentIn]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(422, [{"loc": ["body", "documents"], "msg": str(exc)}])
    if not isinstance(payload, list):
        raise HTTPException(422, [{"loc": ["body", "documents"], "msg": "documents must be a list"}])
    try:
        return [DocumentIn.model_validate(item) for item in payload]
    except ValidationError as exc:
        raise HTTPException(422, [{"loc": ["body", "documents"], "msg": str(exc)}])


async def _files(request: Request, count: int) -> list[FormFile]:
    """依序取 `file_0`…`file_{count-1}`。少一個檔就是 422，不默默少存一份文件。

    FastAPI 只宣告得了 `file_0`（檔案數量隨文件清單而變），其餘直接從已經解析好的
    form 取——Starlette 會把 `request.form()` 的結果快取起來，所以不會重讀 body。
    """
    form = await request.form()
    out: list[FormFile] = []
    for index in range(count):
        item = form.get(f"file_{index}")
        if not isinstance(item, FormFile):
            raise HTTPException(422, [{"loc": ["body", f"file_{index}"], "msg": "missing file"}])
        out.append(item)
    return out


async def _store_all(
    db: AsyncSession,
    app: Application,
    scheme: Scheme,
    specs: list[DocumentIn],
    files: list[FormFile],
) -> list[dict[str, Any]]:
    """驗證並把每個檔案放進 private bucket，回傳文件列的 spec。"""
    stored: list[dict[str, Any]] = []
    for spec, upload in zip(specs, files):
        data = await upload.read()
        document_type = scheme_service.document_type_of(scheme, spec.document_type_code)
        result = await documents_service.store_upload(
            db, app,
            document_type=document_type,
            data=data,
            mime=spec.mime or (upload.content_type or ""),
            page_count=spec.page_count,
            masked=spec.masked,
            document_type_code=spec.document_type_code,
        )
        stored.append(result.as_spec())
    return stored


async def _attach_ocr(
    db: AsyncSession,
    app: Application,
    specs: list[DocumentIn],
    *,
    source: str = "applicant",
) -> None:
    rows = {
        d.document_type_code: d
        for d in await review.current_documents(db, app)
    }
    for spec in specs:
        row = rows.get(spec.document_type_code)
        if row is not None:
            await documents_service.write_ocr(db, row, spec.ocr, source=source)


async def _re_evaluate(db: AsyncSession, app: Application) -> tuple[str, list[dict[str, Any]]]:
    """伺服器重跑規則引擎並落地（`source=auto`）。回傳 (verdict, findings)。"""
    rules = await review.rules_for(db, app.scheme_id)
    findings = await review.evaluate_application(db, app)
    await review.persist_findings(db, app, findings, source="auto")
    return review.verdict_of(findings, rules), [f.to_dict() for f in findings]


@router.post("/applications", status_code=201, response_model=None,
             dependencies=[Depends(rate_limit("submit", SUBMIT_LIMIT_PER_MINUTE))],
             responses={201: {"model": SubmitResultOut}})
async def create_application(
    request: Request,
    application: str = Form(..., description="ApplicationIn 的 JSON 字串"),
    documents: str = Form("[]", description="DocumentIn[] 的 JSON 字串，順序對應 file_0、file_1…"),
    file_0: UploadFile | None = File(default=None, description="第一份文件；其餘為 file_1、file_2…"),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """匿名送件。檔案進 private bucket，OCR 存 `source=applicant`，判定由伺服器重跑。"""
    payload: ApplicationIn = _parse(application, ApplicationIn, "application")
    specs = _parse_documents(documents)
    files = await _files(request, len(specs))

    tenant_id = await _tenant(db)
    scheme = (
        await db.execute(
            select(Scheme).where(Scheme.tenant_id == tenant_id, Scheme.code == payload.scheme_code)
        )
    ).scalar_one_or_none()
    if scheme is None:
        return coded(404, SCHEME_NOT_FOUND)
    if not scheme_service.is_open(scheme):
        return coded(400, SCHEME_CLOSED)

    app = await case_service.create_application(
        db,
        tenant_id=tenant_id,
        scheme=scheme,
        applicant_name=payload.applicant_name,
        phone=payload.phone,
        id_number=payload.id_last4,
        email=payload.email,
        tier_code=payload.tier_code,
        payment_channel_code=payload.payment_channel_code,
        intake_channel="WEB",
        tool_name=payload.tool_name,
        tool_id=payload.tool_id,
        purchase_amount=payload.purchase_amount,
        purchase_date=payload.purchase_date,
        paid_by_proxy=payload.paid_by_proxy,
        note=payload.note,
        documents=[],
        actor=Actor.applicant(),
    )

    try:
        stored = await _store_all(db, app, scheme, specs, files)
    except documents_service.DocumentRejected as rejected:
        await db.rollback()
        return coded(rejected.status, rejected.code, document_type_code=rejected.document_type_code)

    await case_service.add_documents(db, app, stored)
    await _attach_ocr(db, app, specs)
    verdict, findings = await _re_evaluate(db, app)
    await db.commit()
    return {"case_no": app.case_no, "status": app.status, "verdict": verdict, "findings": findings}


# ------------------------------------------------------------------ 查詢驗證

@router.post("/verify", response_model=None,
             dependencies=[Depends(rate_limit("verify", VERIFY_LIMIT_PER_MINUTE))],
             responses={200: {"model": VerifyOut}})
async def verify(
    body: VerifyIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    r: Any = Depends(get_redis),
) -> Any:
    """案號 + 末四碼 → 30 分鐘、只對這一件案子有效的 token（決策 D17）。

    查無此案與末四碼錯誤的回應完全一致，否則錯誤訊息本身就成了查詢介面。
    """
    try:
        app, token = await case_service.verify_case(
            db, body.case_no, body.last4, ip=client_ip(request),
            tenant_id=await _tenant(db), redis=r,
        )
    except case_service.TransitionError as err:
        if err.status_code == 429:
            return coded(423, LOCKED, retry_after_seconds=case_service.VERIFY_LOCK_SECONDS)
        return coded(401, VERIFICATION_FAILED)
    return VerifyOut(
        token=token,
        expires_at=datetime.now(UTC) + timedelta(minutes=CASE_TOKEN_MINUTES),
        case_no=app.case_no,
    )


# ------------------------------------------------------- 帶 token 的案件端點

async def _case(db: AsyncSession, caller: CaseCaller, case_no: str) -> Application:
    """token 只對發它的那一件案子有效——拿 A 案的 token 查 B 案一律 401。"""
    if caller.case_no != case_no:
        raise HTTPException(401, {"code": VERIFICATION_FAILED})
    app = (
        await db.execute(
            select(Application).where(
                Application.case_no == case_no,
                Application.tenant_id == (caller.tenant_id or await _tenant(db)),
            )
        )
    ).scalar_one_or_none()
    if app is None:
        raise HTTPException(404, {"code": CASE_NOT_FOUND})
    return app


@router.get("/applications/{case_no}", response_model=CasePublicOut,
            dependencies=[Depends(rate_limit("read", READ_LIMIT_PER_MINUTE))])
async def get_case(
    case_no: str,
    caller: CaseCaller = Depends(require_case_token),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """市民看得到的案件：時間軸、補件項目、目前版本的文件清單。沒有承辦人資訊。"""
    app = await _case(db, caller, case_no)
    scheme = await db.get(Scheme, app.scheme_id)
    docs = (
        await db.execute(
            select(ApplicationDocument)
            .where(ApplicationDocument.application_id == app.id)
            .order_by(ApplicationDocument.uploaded_at, ApplicationDocument.id)
        )
    ).scalars().all()
    events = (
        await db.execute(
            select(ApplicationStatusEvent)
            .where(ApplicationStatusEvent.application_id == app.id)
            .order_by(ApplicationStatusEvent.created_at)
        )
    ).scalars().all()
    codes = {t.code for t in case_service.allowed_transitions(app.status)}
    return {
        "case_no": app.case_no,
        "scheme": {"code": scheme.code if scheme else "", "name": scheme.name if scheme else ""},
        "status": app.status,
        "first_submitted_at": app.first_submitted_at,
        "last_submitted_at": app.last_submitted_at,
        "revision_count": app.revision_count,
        "supplement_items": list(app.supplement_items or []),
        "supplement_deadline": app.supplement_deadline,
        "payment_date": app.payment_date,
        "tool_name": app.tool_name,
        "purchase_amount": app.purchase_amount,
        "documents": [
            {
                "document_type_code": d.document_type_code,
                "revision": d.revision,
                "is_current": d.is_current,
                "uploaded_at": d.uploaded_at,
                "page_count": d.page_count,
            }
            for d in docs
        ],
        "events": [
            {
                "transition_code": e.transition_code,
                "from_status": e.from_status,
                "to_status": e.to_status,
                "actor_type": e.actor_type,
                "created_at": e.created_at,
                "rejection_codes": list(e.rejection_codes or []),
            }
            for e in events
        ],
        "can_supplement": "T4" in codes,
        "can_withdraw": "T10" in codes,
    }


@router.post("/applications/{case_no}/documents", response_model=None,
             dependencies=[Depends(rate_limit("submit", SUBMIT_LIMIT_PER_MINUTE))],
             responses={200: {"model": SubmitResultOut}})
async def add_supplement(
    case_no: str,
    request: Request,
    documents: str = Form("[]", description="DocumentIn[] 的 JSON 字串，順序對應 file_0、file_1…"),
    file_0: UploadFile | None = File(default=None, description="第一份文件；其餘為 file_1、file_2…"),
    caller: CaseCaller = Depends(require_case_token),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """補件（T4）。只收 `supplement_items` 列出的文件類型，其他一律退回。

    送出後系統立刻走 T5 把案件放回審查佇列——`REVISION_SUBMITTED` 是過場狀態，
    和建案後立刻走 T1 是同一個道理。
    """
    app = await _case(db, caller, case_no)
    if app.status != "NEEDS_REVISION":
        return coded(400, NOT_IN_SUPPLEMENT)

    specs = _parse_documents(documents)
    files = await _files(request, len(specs))

    wanted = {
        item.get("document_type_code")
        for item in (app.supplement_items or [])
        if isinstance(item, dict)
    }
    for spec in specs:
        if spec.document_type_code not in wanted:
            return coded(400, UNEXPECTED_DOCUMENT_TYPE, document_type_code=spec.document_type_code)

    scheme = await db.get(Scheme, app.scheme_id)
    if scheme is None:
        return coded(404, SCHEME_NOT_FOUND)

    try:
        stored = await _store_all(db, app, scheme, specs, files)
    except documents_service.DocumentRejected as rejected:
        await db.rollback()
        return coded(rejected.status, rejected.code, document_type_code=rejected.document_type_code)

    await case_service.add_documents(db, app, stored)
    await _attach_ocr(db, app, specs)
    actor = Actor.applicant(app.case_no)
    await case_service.transition(db, app, "T4", actor=actor)
    await case_service.transition(db, app, "T5", actor=Actor.system())
    verdict, findings = await _re_evaluate(db, app)
    await db.commit()
    return {"case_no": app.case_no, "status": app.status, "verdict": verdict, "findings": findings}


@router.post("/applications/{case_no}/withdraw", response_model=WithdrawOut,
             dependencies=[Depends(rate_limit("submit", SUBMIT_LIMIT_PER_MINUTE))])
async def withdraw(
    case_no: str,
    caller: CaseCaller = Depends(require_case_token),
    db: AsyncSession = Depends(get_db),
) -> WithdrawOut:
    """自行撤回（T10）。終態或不允許的狀態由狀態機擋下來，回 409。"""
    app = await _case(db, caller, case_no)
    await case_service.transition(db, app, "T10", actor=Actor.applicant(app.case_no))
    await db.commit()
    return WithdrawOut(status=app.status)


# ------------------------------------------------------------------- FAQ

@router.get("/faqs", response_model=list[FaqOut],
            dependencies=[Depends(rate_limit("read", READ_LIMIT_PER_MINUTE))])
async def list_faqs(
    q: str = Query(default="", max_length=200),
    scheme: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """關鍵字搜尋（問題、答案與 keywords）。語意搜尋在 P4 接上 embedding。"""
    rows = await faq_service.search(db, await _tenant(db), q=q, scheme_code=scheme)
    return [
        {"id": f.id, "category": f.category, "question": f.question, "answer": f.answer, "priority": f.priority}
        for f in rows
    ]
