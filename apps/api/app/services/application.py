"""案件服務：建案、狀態機、補件、查詢驗證、到期與清除（SPEC §7）。

這裡的 `transition()` 是**唯一**能改 `applications.status` 的地方（CLAUDE.md 規則 5）。
apply-web、admin、`/v1` 與排程工作都從同一扇門進來，所以角色檢查、前置條件、事件、
通知與 purge 排程只寫了一次，也只能被繞過一次——也就是不能。

規則都在 `TRANSITIONS` 這張表裡，程式碼只負責執行它。要加一條轉移就加一列。
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    TERMINAL_STATUSES,
    Application,
    ApplicationDocument,
    ApplicationStatusEvent,
    CaseNoCounter,
    ReviewFinding,
    Scheme,
)
from ..pii import LAST4_LENGTH, encrypt_phone, encrypt_pii, hash_last4
from ..redis_client import redis as _redis
from ..security import create_case_token
from . import documents as documents_service
from . import notify, review, webhooks
from .actors import Actor

log = logging.getLogger("maydru.application")

__all__ = [
    "CASE_NO_PREFIX",
    "TRANSITIONS",
    "Transition",
    "TransitionError",
    "VERIFY_LOCK_SECONDS",
    "VERIFY_MAX_FAILURES",
    "add_documents",
    "allowed_transitions",
    "create_application",
    "expire_overdue",
    "next_case_no",
    "purge_due",
    "queue",
    "transition",
    "verify_case",
]

CASE_NO_PREFIX = "HC"
VERIFY_MAX_FAILURES = 5
VERIFY_LOCK_SECONDS = 15 * 60


class TransitionError(HTTPException):
    """狀態機拒絕了一次轉移。訊息是給承辦人看的（市民端的文案走 `contents`）。"""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(status_code, message)


# --------------------------------------------------------------- 狀態機定義

@dataclass(frozen=True)
class Transition:
    code: str
    from_statuses: tuple[str, ...]        # 空 tuple = 任一非終態
    to_status: str
    actor_type: str                       # APPLICANT | STAFF | SYSTEM
    capability: str = ""                  # STAFF 轉移需要的 capability（D14）
    label: str = ""
    needs_reason: bool = False
    needs_rejection_codes: bool = False
    needs_supplement: bool = False


TRANSITIONS: dict[str, Transition] = {
    t.code: t
    for t in (
        Transition("T1", ("SUBMITTED",), "UNDER_REVIEW", "SYSTEM", label="收件進入審查"),
        Transition("T2", ("UNDER_REVIEW",), "NEEDS_REVISION", "STAFF", capability="case_review",
                   label="要求補件", needs_supplement=True),
        Transition("T3", ("UNDER_REVIEW",), "APPROVED", "STAFF", capability="case_supervise", label="核定"),
        Transition("T4", ("NEEDS_REVISION",), "REVISION_SUBMITTED", "APPLICANT", label="送出補件"),
        Transition("T5", ("REVISION_SUBMITTED",), "UNDER_REVIEW", "SYSTEM", label="補件收件，重新審查"),
        Transition("T6", ("APPROVED",), "DISBURSING", "STAFF", capability="case_supervise", label="開始撥款作業"),
        Transition("T7", ("DISBURSING",), "DISBURSED", "STAFF", capability="case_supervise", label="確認撥款完成"),
        Transition("T8", ("NEEDS_REVISION",), "EXPIRED", "SYSTEM", label="補件逾期"),
        Transition("T9", ("UNDER_REVIEW",), "REJECTED", "STAFF", capability="case_supervise",
                   label="不通過", needs_reason=True, needs_rejection_codes=True),
        Transition("T10", ("SUBMITTED", "UNDER_REVIEW", "NEEDS_REVISION"), "WITHDRAWN", "APPLICANT", label="自行撤回"),
        Transition("T11", (), "CANCELLED_BY_STAFF", "STAFF", capability="case_supervise",
                   label="註銷案件", needs_reason=True),
    )
}


def allowed_transitions(status: str) -> list[Transition]:
    """這個狀態現在可以走哪幾條。終態什麼都不能走。"""
    if status in TERMINAL_STATUSES:
        return []
    return [t for t in TRANSITIONS.values() if not t.from_statuses or status in t.from_statuses]


# ------------------------------------------------------------------ 案件編號

def _case_no(year: int, seq: int) -> str:
    return f"{CASE_NO_PREFIX}-{year}-{seq:06d}"


async def next_case_no(db: AsyncSession, tenant_id: str, *, year: int | None = None) -> str:
    """`HC-YYYY-NNNNNN`，流水號依 tenant 與年度各自累加（決策 D16）。

    Postgres 上用 `SELECT … FOR UPDATE` 鎖住計數列，兩個同時送件的人不會拿到同一號；
    SQLite 沒有列鎖，但測試裡本來就是單一 session，結果一樣。
    """
    year = year or datetime.now(UTC).year
    q = select(CaseNoCounter).where(CaseNoCounter.tenant_id == tenant_id, CaseNoCounter.year == year)
    if db.get_bind().dialect.name == "postgresql":
        q = q.with_for_update()
    counter = (await db.execute(q)).scalar_one_or_none()
    if counter is None:
        counter = CaseNoCounter(tenant_id=tenant_id, year=year, next_seq=1)
        db.add(counter)
        await db.flush()
    seq = counter.next_seq
    counter.next_seq = seq + 1
    return _case_no(year, seq)


# ------------------------------------------------------------------ 建立案件

async def create_application(
    db: AsyncSession,
    *,
    tenant_id: str,
    scheme: Scheme,
    applicant_name: str,
    phone: str = "",
    id_number: str = "",
    email: str = "",
    tier_code: str = "",
    payment_channel_code: str = "",
    intake_channel: str = "WEB",
    tool_name: str = "",
    tool_id: str | None = None,
    purchase_amount: int | None = None,
    purchase_date: Any = None,
    paid_by_proxy: bool = False,
    note: str = "",
    documents: Sequence[dict[str, Any]] = (),
    case_no: str | None = None,
    now: datetime | None = None,
    actor: Actor | None = None,
    auto_start_review: bool = True,
) -> Application:
    """建一件新案：配號、雜湊個資、寫文件列，然後 SUBMITTED → T1 → UNDER_REVIEW。

    T1 由系統立刻執行（SPEC §7 的圖），所以送件完成的案子一律已經在審查佇列裡，
    排序用的 `first_submitted_at` 就是這一刻。

    `auto_start_review=False` 讓案件停在 SUBMITTED——只給 seed 與搬遷用，真正的
    送件路徑永遠收件即進審查。
    """
    stamp = now or datetime.now(UTC)
    app = Application(
        tenant_id=tenant_id,
        case_no=case_no or await next_case_no(db, tenant_id, year=stamp.year),
        scheme_id=scheme.id,
        tier_code=tier_code,
        payment_channel_code=payment_channel_code,
        intake_channel=intake_channel,
        applicant_name=applicant_name,
        phone_encrypted=encrypt_phone(phone),
        phone_last4_hash=hash_last4(phone),
        id_last4_hash=hash_last4(id_number),
        # 只有拿到完整字號才加密保存（D40）；舊客戶端只送末四碼時這裡留空，
        # 否則資料庫裡會出現一批「密文解開只有四碼」的假完整號碼。
        id_number_encrypted=encrypt_pii(id_number) if len(id_number.strip()) > LAST4_LENGTH else "",
        email=email,
        tool_name=tool_name,
        tool_id=tool_id,
        purchase_amount=purchase_amount,
        purchase_date=purchase_date,
        paid_by_proxy=paid_by_proxy,
        note=note,
        status="SUBMITTED",
        first_submitted_at=stamp,
        last_submitted_at=stamp,
    )
    db.add(app)
    await db.flush()

    for spec in documents:
        db.add(_document_row(app, spec, revision=0, uploaded_at=stamp))
    await db.flush()

    # T0 不在 SPEC §7 的轉移表裡——它是「案件誕生」那一筆，讓時間軸從 SUBMITTED 開始
    # 就有東西可看，而不是憑空出現在 UNDER_REVIEW。
    system = Actor.system()
    await _write_event(db, app, None, "SUBMITTED", "T0", actor or system,
                       payload={"intake_channel": intake_channel}, now=stamp)
    if auto_start_review:
        await transition(db, app, "T1", actor=system, now=stamp)
    await webhooks.create_deliveries(db, tenant_id, "application.created", {
        "application_id": app.id, "case_no": app.case_no, "status": app.status,
    })
    if documents:
        await webhooks.create_deliveries(db, tenant_id, "application.document_uploaded", {
            "application_id": app.id, "case_no": app.case_no,
            "document_types": [str(item["document_type_code"]) for item in documents],
        })
    return app


def _document_row(app: Application, spec: dict[str, Any], *, revision: int, uploaded_at: datetime) -> ApplicationDocument:
    return ApplicationDocument(
        tenant_id=app.tenant_id,
        application_id=app.id,
        document_type_code=spec["document_type_code"],
        revision=spec.get("revision", revision),
        supersedes_id=spec.get("supersedes_id"),
        is_current=spec.get("is_current", True),
        object_key=spec.get("object_key", ""),
        mime=spec.get("mime", ""),
        size=spec.get("size", 0),
        page_count=spec.get("page_count", 1),
        preview_key=spec.get("preview_key"),
        masked=spec.get("masked", False),
        uploaded_at=spec.get("uploaded_at", uploaded_at),
    )


async def add_documents(
    db: AsyncSession,
    app: Application,
    documents: Sequence[dict[str, Any]],
    *,
    now: datetime | None = None,
) -> list[ApplicationDocument]:
    """補件上傳：同一個 document_type 的舊版本退位，新列帶 `revision+1` 與 `supersedes_id`。

    舊版留到 purge 為止（SPEC §7「文件版本」），承辦人才比對得出這次補了什麼。
    """
    stamp = now or datetime.now(UTC)
    current = {
        d.document_type_code: d
        for d in (
            await db.execute(
                select(ApplicationDocument).where(
                    ApplicationDocument.application_id == app.id,
                    ApplicationDocument.is_current.is_(True),
                )
            )
        ).scalars()
    }
    rows: list[ApplicationDocument] = []
    for spec in documents:
        previous = current.get(spec["document_type_code"])
        if previous is not None:
            previous.is_current = False
        row = _document_row(
            app,
            {**spec, "supersedes_id": spec.get("supersedes_id") or (previous.id if previous else None)},
            revision=(previous.revision + 1) if previous else 0,
            uploaded_at=stamp,
        )
        db.add(row)
        rows.append(row)
    await db.flush()
    if rows:
        await webhooks.create_deliveries(db, app.tenant_id, "application.document_uploaded", {
            "application_id": app.id, "case_no": app.case_no,
            "document_ids": [row.id for row in rows],
            "document_types": [row.document_type_code for row in rows],
        })
    return rows


# -------------------------------------------------------------------- 狀態機

def _check_actor(t: Transition, actor: Actor) -> None:
    if actor.type != t.actor_type:
        raise TransitionError(403, f"{t.code} 只能由 {t.actor_type} 執行")
    if t.actor_type != "STAFF" or not t.capability:
        return
    # 延後匯入：deps 會 import models / redis，service 在模組層匯入它會繞一圈。
    from ..deps import has_cap

    if not has_cap(actor.role, t.capability):
        raise TransitionError(403, f"{t.label or t.code} 需要 {t.capability} 權限")


async def _write_event(
    db: AsyncSession,
    app: Application,
    from_status: str | None,
    to_status: str,
    code: str,
    actor: Actor,
    *,
    reason: str = "",
    rejection_codes: Sequence[str] = (),
    payload: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> ApplicationStatusEvent:
    event = ApplicationStatusEvent(
        tenant_id=app.tenant_id,
        application_id=app.id,
        from_status=from_status,
        to_status=to_status,
        transition_code=code,
        actor_type=actor.type,
        actor_id=actor.id,
        reason=reason,
        rejection_codes=list(rejection_codes),
        payload=payload or {},
        created_at=now or datetime.now(UTC),
    )
    db.add(event)
    await db.flush()
    return event


async def _scheme_of(db: AsyncSession, app: Application) -> Scheme | None:
    return await db.get(Scheme, app.scheme_id)


async def transition(
    db: AsyncSession,
    application: Application,
    code: str,
    *,
    actor: Actor,
    reason: str | None = None,
    rejection_codes: Sequence[str] | None = None,
    supplement_items: Sequence[dict[str, Any]] | None = None,
    supplement_deadline: datetime | None = None,
    payload: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> ApplicationStatusEvent:
    """執行一次狀態轉移，回傳寫下的事件。

    順序固定：規則檢查 → 前置條件 → 改欄位 → 寫事件 → 排通知 → 排 purge。
    任何一步失敗都丟 `TransitionError`，呼叫端的交易沒有 commit，案件原封不動。
    """
    t = TRANSITIONS.get(code)
    if t is None:
        raise TransitionError(400, f"未知的轉移 {code}")

    stamp = now or datetime.now(UTC)
    from_status = application.status
    scheme = await _scheme_of(db, application)

    # --- 規則檢查（順序刻意由「誰」到「什麼狀態」到「帶了什麼」）------------
    _check_actor(t, actor)

    if from_status in TERMINAL_STATUSES:
        raise TransitionError(409, f"案件已在終態 {from_status}，不能再轉移")
    if t.from_statuses and from_status not in t.from_statuses:
        raise TransitionError(409, f"{t.code} 不能由 {from_status} 執行")

    reason = (reason or "").strip()
    codes = list(rejection_codes or [])
    if t.needs_reason and not reason:
        raise TransitionError(400, f"{t.label or t.code} 必須填寫理由")
    if t.needs_rejection_codes and not codes:
        raise TransitionError(400, f"{t.label or t.code} 必須至少選一個退件原因")
    if t.needs_supplement:
        if not supplement_items:
            raise TransitionError(400, "要求補件必須列出需要補的項目")
        max_revisions = scheme.max_revisions if scheme else 3
        if application.revision_count >= max_revisions:
            raise TransitionError(409, f"補件次數已達上限（{max_revisions} 次），請改以不通過結案")

    if t.code == "T3":
        blockers = await review.approval_blockers(application)
        if blockers:
            raise TransitionError(409, "尚未通過核准前置條件：" + "；".join(blockers))

    # --- 套用欄位變化 ------------------------------------------------------
    extra: dict[str, Any] = dict(payload or {})
    application.status = t.to_status

    if actor.type == "STAFF" and actor.id and not application.assigned_reviewer_id:
        application.assigned_reviewer_id = actor.id

    if t.code == "T2":
        application.supplement_items = [dict(i) for i in supplement_items or []]
        application.supplement_deadline = supplement_deadline or _default_deadline(scheme, stamp)
        application.revision_count += 1
        extra.setdefault("revision", application.revision_count)
    elif t.code == "T4":
        application.last_submitted_at = stamp
    elif t.code == "T5":
        application.supplement_items = []
        application.supplement_deadline = None
    elif t.code == "T3":
        amount = extra.get("approved_amount")
        if amount is not None:
            application.approved_amount = int(amount)
    elif t.code == "T7":
        application.payment_date = _as_datetime(extra.get("payment_date")) or stamp
        amount = extra.get("payment_amount", application.approved_amount)
        if amount is not None:
            application.payment_amount = int(amount)

    if t.to_status in TERMINAL_STATUSES:
        retention = scheme.retention_days if scheme else 90
        application.documents_purge_at = stamp + timedelta(days=retention)

    event = await _write_event(
        db, application, from_status, t.to_status, t.code, actor,
        reason=reason, rejection_codes=codes, payload=extra, now=stamp,
    )
    await notify.enqueue_status_notification(db, application, event)
    await webhooks.create_deliveries(db, application.tenant_id, "application.status_changed", {
        "application_id": application.id, "case_no": application.case_no,
        "event_id": event.id, "transition_code": code,
        "from_status": from_status, "to_status": t.to_status,
    })
    await db.flush()
    return event


def _default_deadline(scheme: Scheme | None, stamp: datetime) -> datetime:
    return stamp + timedelta(days=scheme.supplement_days if scheme else 14)


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


# ------------------------------------------------------- 排程：逾期與清除

async def expire_overdue(db: AsyncSession, now: datetime | None = None) -> list[str]:
    """T8：補件期限過了還沒補的案子自動逾期。回傳被處理的案號。"""
    stamp = now or datetime.now(UTC)
    rows = (
        await db.execute(
            select(Application).where(
                Application.status == "NEEDS_REVISION",
                Application.supplement_deadline.is_not(None),
                Application.supplement_deadline <= stamp,
            )
        )
    ).scalars().all()
    done: list[str] = []
    system = Actor.system("expire_overdue")
    for app in rows:
        try:
            await transition(db, app, "T8", actor=system, now=stamp)
        except TransitionError:
            log.exception("T8 失敗：%s", app.case_no)
            continue
        done.append(app.case_no)
    await db.commit()
    return done


async def purge_due(db: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    """終態滿保存期限的案件硬刪證明文件（SPEC §7「清除」）。

    刪的是：MinIO 上的原件與預覽、OCR 結果、findings 的 bbox。
    留的是：申請主檔與事件時間軸——案件紀錄本身不會消失，只是不再附著任何影像。
    `keep_after_disbursed` 的文件類型跳過不刪。
    """
    stamp = now or datetime.now(UTC)
    apps = (
        await db.execute(
            select(Application).where(
                Application.documents_purge_at.is_not(None),
                Application.documents_purge_at <= stamp,
                Application.documents_purged_at.is_(None),
            )
        )
    ).scalars().all()
    if not apps:
        return {"applications": 0, "documents": 0, "objects": 0, "ocr": 0, "findings": 0}

    keep_codes = await _keep_after_disbursed_codes(db, {a.scheme_id for a in apps})
    counts = {"applications": len(apps), "documents": 0, "objects": 0, "ocr": 0, "findings": 0}

    for app in apps:
        docs = (
            await db.execute(
                select(ApplicationDocument).where(
                    ApplicationDocument.application_id == app.id,
                    ApplicationDocument.purged_at.is_(None),
                )
            )
        ).scalars().all()
        for doc in docs:
            if doc.document_type_code in keep_codes.get(app.scheme_id, frozenset()):
                continue
            counts["objects"] += await documents_service.delete_objects(doc)
            counts["ocr"] += await documents_service.delete_ocr(db, doc.id)
            doc.object_key = ""
            doc.preview_key = None
            doc.purged_at = stamp
            counts["documents"] += 1

        findings = (
            await db.execute(
                select(ReviewFinding).where(
                    ReviewFinding.application_id == app.id, ReviewFinding.bbox.is_not(None)
                )
            )
        ).scalars().all()
        for finding in findings:
            finding.bbox = None
            counts["findings"] += 1

        app.documents_purged_at = stamp
    await db.commit()
    return counts


async def _keep_after_disbursed_codes(db: AsyncSession, scheme_ids: set[str]) -> dict[str, frozenset[str]]:
    from ..models import DocumentType

    rows = (
        await db.execute(
            select(DocumentType.scheme_id, DocumentType.code).where(
                DocumentType.scheme_id.in_(scheme_ids), DocumentType.keep_after_disbursed.is_(True)
            )
        )
    ).all()
    out: dict[str, set[str]] = {}
    for scheme_id, code in rows:
        out.setdefault(scheme_id, set()).add(code)
    return {k: frozenset(v) for k, v in out.items()}


# --------------------------------------------------------------- 查詢驗證

def _fail_keys(case_no: str, ip: str) -> tuple[str, str]:
    return f"case:verify:fail:{case_no}", f"case:verify:fail:ip:{ip}"


async def _failures(r: Any, key: str) -> int:
    try:
        raw = await r.get(key)
    except Exception:
        return 0
    if raw is None:
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


async def _record_failure(r: Any, key: str) -> None:
    try:
        n = await r.incr(key)
        if n == 1:
            await r.expire(key, VERIFY_LOCK_SECONDS)
    except Exception:
        log.warning("案件查詢失敗計數寫入失敗：%s", key)


async def verify_case(
    db: AsyncSession,
    case_no: str,
    last4: str,
    *,
    ip: str,
    tenant_id: str | None = None,
    redis: Any = None,
    now: datetime | None = None,
) -> tuple[Application, str]:
    """案號 + 末四碼 → (案件, 短效 token)。決策 D17。

    比對的是手機或身分證末四碼的 hash，兩者都算通過。連續 5 次失敗就鎖 15 分鐘，
    案號與來源 IP 各自計數：前者擋針對單一案件的猜測，後者擋掃整個號段的腳本。

    失敗與查無此案的回應刻意完全一樣（youth-line-bot 的教訓），否則錯誤訊息本身
    就變成一個「這個案號存在嗎」的查詢介面。
    """
    r = redis if redis is not None else _redis()
    case_key, ip_key = _fail_keys(case_no, ip)
    if await _failures(r, case_key) >= VERIFY_MAX_FAILURES or await _failures(r, ip_key) >= VERIFY_MAX_FAILURES:
        raise TransitionError(429, "嘗試次數過多，請 15 分鐘後再試")

    q = select(Application).where(Application.case_no == case_no)
    if tenant_id:
        q = q.where(Application.tenant_id == tenant_id)
    app = (await db.execute(q)).scalar_one_or_none()

    supplied = hash_last4(last4)
    ok = app is not None and bool(supplied) and supplied in {app.phone_last4_hash, app.id_last4_hash}
    if app is None or not ok:
        await _record_failure(r, case_key)
        await _record_failure(r, ip_key)
        raise TransitionError(401, "案件編號或末四碼不正確")

    try:
        await r.delete(case_key)
    except Exception:
        pass
    return app, create_case_token(app.case_no, app.tenant_id)


async def queue(
    db: AsyncSession,
    tenant_id: str,
    *,
    statuses: Sequence[str] | None = None,
    scheme_id: str | None = None,
    assigned_reviewer_id: str | None = None,
    search: str = "",
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[Application], int]:
    """審核佇列：一律依 `first_submitted_at` 排序，補件不重排（SPEC §7）。

    `search` 比對案號、申請人姓名與工具名稱。姓名在佇列上是遮蔽的，但承辦人手上
    通常就是一個名字，所以比對用的是原始欄位。
    """
    where = [Application.tenant_id == tenant_id]
    if statuses:
        where.append(Application.status.in_(list(statuses)))
    if scheme_id:
        where.append(Application.scheme_id == scheme_id)
    if assigned_reviewer_id:
        where.append(Application.assigned_reviewer_id == assigned_reviewer_id)
    if search:
        needle = f"%{search.strip()}%"
        where.append(or_(
            Application.case_no.ilike(needle),
            Application.applicant_name.ilike(needle),
            Application.tool_name.ilike(needle),
        ))

    total = (await db.execute(select(func.count(Application.id)).where(*where))).scalar_one()
    rows = (
        await db.execute(
            select(Application)
            .where(*where)
            .order_by(Application.first_submitted_at.asc(), Application.case_no.asc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return list(rows), int(total)
