"""方案服務：設定的 CRUD、必要文件推導、公開檢視（SPEC §6.2 / §8.1 / §10.1）。

方案是純資料（決策 D6），所以這裡沒有任何「新竹市 AI 補助」專屬的判斷。
`required_document_types()` 是 submit-flow `requiredDocs()` 的移植，差別在於三個
來源都改讀資料：文件自己的 `required` / `required_when`、繳費管道的必附文件、
級距的佐證文件。
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    TOOL_STATUSES,
    Application,
    DocumentType,
    DocumentTypeSopFlow,
    EligibleTool,
    PaymentChannel,
    RejectionCode,
    ReviewRule,
    Scheme,
    SchemeTier,
)
from .versioning import bump, check_version

__all__ = [
    "CHILD_MODELS",
    "child_model",
    "create_child",
    "create_scheme",
    "delete_child",
    "delete_scheme",
    "document_type_of",
    "get_scheme",
    "is_open",
    "list_children",
    "list_schemes",
    "pending_tools",
    "reorder_children",
    "required_document_types",
    "resolve_tool",
    "scheme_apply_view",
    "scheme_public_view",
    "scheme_settings_view",
    "scheme_summary_view",
    "update_child",
    "update_scheme",
]

# admin API 的巢狀資源名稱 → model。名稱就是 URL 片段，兩邊不會走樣。
CHILD_MODELS: dict[str, type[Any]] = {
    "tiers": SchemeTier,
    "document-types": DocumentType,
    "payment-channels": PaymentChannel,
    "review-rules": ReviewRule,
    "rejection-codes": RejectionCode,
    "eligible-tools": EligibleTool,
    "sop-flows": DocumentTypeSopFlow,
}

SCHEME_NOT_FOUND = "找不到此方案"
CHILD_NOT_FOUND = "找不到此設定項目"


def child_model(kind: str) -> type[Any]:
    model = CHILD_MODELS.get(kind)
    if model is None:
        raise HTTPException(404, f"未知的設定項目 {kind}")
    return model


# ------------------------------------------------------------------ 讀取

async def list_schemes(db: AsyncSession, tenant_id: str, *, active: bool | None = None) -> list[Scheme]:
    q = select(Scheme).where(Scheme.tenant_id == tenant_id)
    if active is not None:
        q = q.where(Scheme.active.is_(active))
    return list((await db.execute(q.order_by(Scheme.code))).scalars())


async def get_scheme(db: AsyncSession, tenant_id: str, code: str) -> Scheme:
    q = select(Scheme).where(Scheme.tenant_id == tenant_id, Scheme.code == code)
    scheme = (await db.execute(q)).scalar_one_or_none()
    if scheme is None:
        raise HTTPException(404, SCHEME_NOT_FOUND)
    return scheme


async def get_scheme_by_id(db: AsyncSession, tenant_id: str, scheme_id: str) -> Scheme:
    q = select(Scheme).where(Scheme.tenant_id == tenant_id, Scheme.id == scheme_id)
    scheme = (await db.execute(q)).scalar_one_or_none()
    if scheme is None:
        raise HTTPException(404, SCHEME_NOT_FOUND)
    return scheme


async def list_children(db: AsyncSession, scheme: Scheme, kind: str) -> list[Any]:
    model = child_model(kind)
    if model is DocumentTypeSopFlow:
        codes = select(DocumentType.id).where(DocumentType.scheme_id == scheme.id)
        q = select(model).where(model.document_type_id.in_(codes))
    else:
        q = select(model).where(model.scheme_id == scheme.id)
    order = getattr(model, "sort_order", None)
    if order is not None:
        q = q.order_by(order, model.id)
    return list((await db.execute(q)).scalars())


async def get_child(db: AsyncSession, scheme: Scheme, kind: str, child_id: str) -> Any:
    model = child_model(kind)
    obj = await db.get(model, child_id)
    owner_ok = obj is not None and (
        getattr(obj, "scheme_id", None) == scheme.id or model is DocumentTypeSopFlow
    )
    if not owner_ok:
        raise HTTPException(404, CHILD_NOT_FOUND)
    return obj


# ------------------------------------------------------------------ 寫入

_SCHEME_WRITABLE = frozenset({
    "code", "name", "category", "description", "eligibility", "age_min", "age_max",
    "application_start", "application_end", "official_url", "contact", "amount_note",
    "tags", "identity_tags", "details", "active", "retention_days", "supplement_days",
    "max_revisions", "application_method", "required_documents", "student_requirement",
    "employment_requirement", "residency_requirement", "image_url",
})


def _apply(obj: Any, data: dict[str, Any], allowed: Iterable[str] | None = None) -> dict[str, Any]:
    """只套用有出現在 payload 裡的欄位，回傳套用前的值（給稽核 diff 用）。"""
    before: dict[str, Any] = {}
    for key, value in data.items():
        if allowed is not None and key not in allowed:
            continue
        if not hasattr(obj, key):
            continue
        before[key] = getattr(obj, key)
        setattr(obj, key, value)
    return before


async def create_scheme(db: AsyncSession, tenant_id: str, data: dict[str, Any]) -> Scheme:
    scheme = Scheme(tenant_id=tenant_id, code=data["code"], name=data.get("name", ""))
    _apply(scheme, data, _SCHEME_WRITABLE)
    db.add(scheme)
    await db.flush()
    return scheme


async def update_scheme(
    db: AsyncSession, scheme: Scheme, data: dict[str, Any], *, expected_version: int | None = None
) -> dict[str, Any]:
    check_version(scheme, expected_version)
    before = _apply(scheme, data, _SCHEME_WRITABLE)
    bump(scheme)
    await db.flush()
    return before


async def delete_scheme(db: AsyncSession, scheme: Scheme) -> None:
    await db.delete(scheme)
    await db.flush()


async def create_child(db: AsyncSession, scheme: Scheme, kind: str, data: dict[str, Any]) -> Any:
    model = child_model(kind)
    obj = model(tenant_id=scheme.tenant_id)
    if hasattr(obj, "scheme_id"):
        obj.scheme_id = scheme.id
    _apply(obj, data)
    db.add(obj)
    await db.flush()
    return obj


async def update_child(
    db: AsyncSession, obj: Any, data: dict[str, Any], *, expected_version: int | None = None
) -> dict[str, Any]:
    check_version(obj, expected_version)
    before = _apply(obj, data)
    if hasattr(obj, "version"):
        bump(obj)
    await db.flush()
    return before


async def delete_child(db: AsyncSession, obj: Any) -> None:
    await db.delete(obj)
    await db.flush()


# ------------------------------------------------------------------ 排序

async def reorder_children(db: AsyncSession, scheme: Scheme, kind: str, ids: Sequence[str]) -> list[Any]:
    """照送上來的順序重寫 `sort_order`（0、1、2…），回傳排好的清單。

    沒出現在 `ids` 裡的列排在後面，維持它們原本的相對順序——後台一次只拖一個分頁，
    漏掉一筆不該讓它跳到最前面去。不認得的 id 直接忽略，不是 404：使用者按下儲存
    的那一刻，別人剛刪掉其中一列是完全可能的，而那不該讓整次排序失敗。

    這裡刻意不檢查 `expected_version`：排序改的是「這幾列之間的關係」，不是任何一列
    的內容，用單列的版本號去鎖一個跨列的操作只會鎖錯東西。
    """
    model = child_model(kind)
    if not hasattr(model, "sort_order"):
        raise HTTPException(400, f"{kind} 沒有排序")
    rows = await list_children(db, scheme, kind)
    by_id = {row.id: row for row in rows}
    ordered = [by_id[i] for i in ids if i in by_id]
    ordered += [row for row in rows if row.id not in set(ids)]
    for index, row in enumerate(ordered):
        row.sort_order = index
    await db.flush()
    return ordered


# ------------------------------------------------------------- 待審工具

async def record_application_tool(db: AsyncSession, scheme: Scheme, name: str, tool_id: str | None, *, inquiry: bool = False) -> str | None:
    """Resolve catalog selections and count only free-text submissions, scoped to a scheme."""
    import unicodedata

    def normalized(value: str) -> str:
        return " ".join(unicodedata.normalize("NFKC", value).casefold().split())

    # Serialize additions and increments for the same scheme, including new names.
    await db.execute(select(Scheme.id).where(Scheme.id == scheme.id).with_for_update())
    rows = list((await db.execute(select(EligibleTool).where(EligibleTool.scheme_id == scheme.id)
                                 .execution_options(populate_existing=True))).scalars())
    if tool_id:
        selected = next((row for row in rows if row.id == tool_id), None)
        if selected is None or (name.strip() and normalized(name) not in
                                [normalized(selected.name), *(normalized(str(alias)) for alias in selected.aliases or [])]):
            raise HTTPException(422, {"code": "UNKNOWN_TOOL"})
    else:
        needle = normalized(name)
        if not needle:
            return None
        selected = next((row for row in rows if needle in
                         [normalized(row.name), *(normalized(str(alias)) for alias in row.aliases or [])]), None)
    if not inquiry and selected is not None and selected.status == "REJECTED":
        raise HTTPException(422, {"code": "TOOL_REJECTED"})
    if not tool_id:
        if selected is None:
            selected = EligibleTool(tenant_id=scheme.tenant_id, scheme_id=scheme.id, name=name.strip(), status="PENDING", request_count=0)
            db.add(selected)
        if inquiry:
            selected.inquiry_count = int(selected.inquiry_count or 0) + 1
        else:
            selected.request_count = int(selected.request_count or 0) + 1
        await db.flush()
        await db.refresh(scheme, ["eligible_tools"])
    return selected.id if selected else None


async def pending_tools(db: AsyncSession, scheme: Scheme) -> list[EligibleTool]:
    """民眾送件時打了、但清單上還沒有的工具（submit-flow 的 pendingTools）。"""
    q = (
        select(EligibleTool)
        .where(EligibleTool.scheme_id == scheme.id, EligibleTool.status == "PENDING")
        .order_by(EligibleTool.request_count.desc(), EligibleTool.name)
    )
    return list((await db.execute(q)).scalars())


async def resolve_tool(
    db: AsyncSession,
    scheme: Scheme,
    tool: EligibleTool,
    *,
    status: str,
    verdict_note: str = "",
    merge_into_id: str | None = None,
) -> EligibleTool:
    """處理一筆待審工具：核可、退回，或併進既有的那一筆。

    併入是第三種答案，而且是最常見的一種：民眾打的「chatgpt plus」「ChatGPT 訂閱」
    其實就是清單上的「ChatGPT Plus」。併入時把名字與別名都加到既有那一筆的 `aliases`，
    下一個人打同樣的字就會直接對上，待審佇列也不會再冒出同一個東西的第七種寫法。
    被併掉的那一列直接刪除——留著只會讓同一個工具在清單上出現兩次。
    """
    await db.execute(select(Scheme.id).where(Scheme.id == scheme.id).with_for_update())
    await db.refresh(tool)
    if status not in TOOL_STATUSES:
        raise HTTPException(400, f"未知的工具狀態 {status}")
    if merge_into_id:
        target = await db.get(EligibleTool, merge_into_id)
        if target is None or target.scheme_id != scheme.id or target.id == tool.id:
            raise HTTPException(404, "找不到要併入的工具")
        aliases = list(target.aliases or [])
        for name in [tool.name, *(tool.aliases or [])]:
            text = str(name).strip()
            if text and text != target.name and text not in aliases:
                aliases.append(text)
        target.aliases = aliases
        target.request_count = int(target.request_count or 0) + int(tool.request_count or 0)
        target.inquiry_count = int(target.inquiry_count or 0) + int(tool.inquiry_count or 0)
        if verdict_note:
            target.verdict_note = verdict_note
        bump(target)
        await db.execute(update(Application).where(Application.scheme_id == scheme.id, Application.tool_id == tool.id).values(tool_id=target.id))
        await db.delete(tool)
        await db.flush()
        return target
    tool.status = status
    tool.verdict_note = verdict_note
    bump(tool)
    await db.flush()
    return tool


# ------------------------------------------------------- 必要文件（submit-flow 移植）

def required_document_types(
    scheme: Scheme,
    tier_code: str = "",
    payment_channel_code: str = "",
    paid_by_proxy: bool = False,
) -> list[str]:
    """這一件案子必須附哪些文件類型，依 `sort_order` 排好。

    三個來源疊加（submit-flow `requiredDocs`）：
    1. 方案本身標 `required` 的文件；`required_when="proxy"` 的只在代付時加入。
    2. 繳費管道的 `required_document_type_codes`（CHANNEL_DOCS）。
    3. 級距的 `required_proof_doc_types`（例如低收入戶要附特定對象證明）。

    找不到的管道或級距就當作沒有額外要求——設定不完整不該讓送件流程整個停住。
    """
    wanted: set[str] = set()
    for dt in scheme.document_types:
        if dt.required or (dt.required_when == "proxy" and paid_by_proxy):
            wanted.add(dt.code)

    channel = next((c for c in scheme.payment_channels if c.code == payment_channel_code), None)
    if channel:
        wanted.update(channel.required_document_type_codes or [])

    tier = next((t for t in scheme.tiers if t.code == tier_code), None)
    if tier:
        wanted.update(tier.required_proof_doc_types or [])

    order = {dt.code: (dt.sort_order, dt.code) for dt in scheme.document_types}
    known = sorted((c for c in wanted if c in order), key=lambda c: order[c])
    unknown = sorted(c for c in wanted if c not in order)
    return known + unknown


def missing_document_types(
    scheme: Scheme, present_codes: Sequence[str], *, tier_code: str = "",
    payment_channel_code: str = "", paid_by_proxy: bool = False,
) -> list[str]:
    have = set(present_codes)
    return [c for c in required_document_types(scheme, tier_code, payment_channel_code, paid_by_proxy) if c not in have]


# ------------------------------------------------------------------ 公開檢視

def scheme_public_view(scheme: Scheme) -> dict[str, Any]:
    """`GET /v1/schemes/{code}` 與 apply-web 用的形狀。

    只有公開欄位：退件碼給的是給民眾看的兩句話，承辦人用的 `staff_label` 不出去；
    審核規則完全不出現（那是伺服器端判定的依據，`GET /v1/review/rules` 另外管）。
    """
    return {
        "code": scheme.code,
        "name": scheme.name,
        "category": scheme.category,
        "description": scheme.description,
        "eligibility": scheme.eligibility,
        "age_min": scheme.age_min,
        "age_max": scheme.age_max,
        "application_start": scheme.application_start,
        "application_end": scheme.application_end,
        "official_url": scheme.official_url,
        "contact": scheme.contact,
        "amount_note": scheme.amount_note,
        "tags": list(scheme.tags or []),
        "identity_tags": list(scheme.identity_tags or []),
        "details": list(scheme.details or []),
        "active": scheme.active,
        "supplement_days": scheme.supplement_days,
        "retention_days": scheme.retention_days,
        "tiers": [
            {
                "code": t.code,
                "label": t.label,
                "subsidy_rate": t.subsidy_rate,
                "cap_amount": t.cap_amount,
                "required_proof_doc_types": list(t.required_proof_doc_types or []),
            }
            for t in sorted(scheme.tiers, key=lambda t: (t.sort_order, t.code))
        ],
        "document_types": [
            {
                "code": d.code,
                "label": d.label,
                "hint": d.hint,
                "required": d.required,
                "required_when": d.required_when,
                "must_mask": d.must_mask,
                "keep_visible": d.keep_visible,
                "accepted_mime": list(d.accepted_mime or []),
                "max_pages": d.max_pages,
            }
            for d in sorted(scheme.document_types, key=lambda d: (d.sort_order, d.code))
        ],
        "payment_channels": [
            {
                "code": c.code,
                "label": c.label,
                "hint": c.hint,
                "required_document_type_codes": list(c.required_document_type_codes or []),
                "guide_content_key": c.guide_content_key,
            }
            for c in sorted(scheme.payment_channels, key=lambda c: (c.sort_order, c.code))
        ],
        "rejection_codes": [
            {
                "code": r.code,
                "public_what_wrong": r.public_what_wrong,
                "public_how_to_fix": r.public_how_to_fix,
                "related_document_type_codes": list(r.related_document_type_codes or []),
            }
            for r in sorted(scheme.rejection_codes, key=lambda r: (r.sort_order, r.code))
            if r.active
        ],
        "eligible_tools": [
            {"name": t.name, "vendor": t.vendor, "aliases": list(t.aliases or []),
             "status": t.status, "verdict_note": t.verdict_note}
            for t in sorted(scheme.eligible_tools, key=lambda t: (t.sort_order, t.name))
        ],
    }


# ------------------------------------------------- apply-web 用的公開檢視（P3）

def is_open(scheme: Scheme, today: date | None = None) -> bool:
    """這個方案現在收不收件：`active` 且在申請期間內（兩端皆含）。

    沒填起訖日就是「沒有期限」——設定不完整不該把民眾擋在門外。
    """
    if not scheme.active:
        return False
    day = today or datetime.now(UTC).date()
    if scheme.application_start and day < scheme.application_start:
        return False
    if scheme.application_end and day > scheme.application_end:
        return False
    return True


def scheme_summary_view(scheme: Scheme) -> dict[str, Any]:
    """`GET /api/apply/schemes` 的一列：方案列表卡片需要的最少欄位。"""
    return {
        "code": scheme.code,
        "name": scheme.name,
        "category": scheme.category,
        "description": scheme.description,
        "application_start": scheme.application_start,
        "application_end": scheme.application_end,
        "amount_note": scheme.amount_note,
        "tags": list(scheme.tags or []),
        "active": scheme.active,
    }


def scheme_apply_view(scheme: Scheme) -> dict[str, Any]:
    """`GET /api/apply/schemes/{code}`：送件流程需要的完整設定（P3 契約 §SchemePublic）。

    比 `scheme_public_view()` 多了 `review_rules`——apply-web 用它在瀏覽器裡跑
    `packages/review-rules` 做即時回饋。規則本身不是祕密（它就是「要看到哪個欄位」），
    真正不外流的是承辦人的 `staff_label` 與判定結果。
    """
    return {
        "code": scheme.code,
        "name": scheme.name,
        "category": scheme.category,
        "description": scheme.description,
        "eligibility": scheme.eligibility,
        "age_min": scheme.age_min,
        "age_max": scheme.age_max,
        "application_start": scheme.application_start,
        "application_end": scheme.application_end,
        "official_url": scheme.official_url,
        "contact": scheme.contact,
        "amount_note": scheme.amount_note,
        "tags": list(scheme.tags or []),
        "identity_tags": list(scheme.identity_tags or []),
        "details": list(scheme.details or []),
        "active": scheme.active,
        "supplement_days": scheme.supplement_days,
        "max_revisions": scheme.max_revisions,
        "tiers": [
            {
                "code": t.code,
                "label": t.label,
                "subsidy_rate": t.subsidy_rate,
                "cap_amount": t.cap_amount,
                "required_proof_doc_types": list(t.required_proof_doc_types or []),
            }
            for t in sorted(scheme.tiers, key=lambda t: (t.sort_order, t.code))
        ],
        "document_types": [
            {
                "code": d.code,
                "label": d.label,
                "hint": d.hint,
                "required": d.required,
                "required_when": d.required_when,
                "must_mask": d.must_mask,
                "keep_visible": d.keep_visible,
                "accepted_mime": list(d.accepted_mime or []),
                "max_pages": d.max_pages,
                "sort_order": d.sort_order,
            }
            for d in sorted(scheme.document_types, key=lambda d: (d.sort_order, d.code))
        ],
        "payment_channels": [
            {
                "code": c.code,
                "label": c.label,
                "hint": c.hint,
                "required_document_type_codes": list(c.required_document_type_codes or []),
                "guide_content_key": c.guide_content_key,
            }
            for c in sorted(scheme.payment_channels, key=lambda c: (c.sort_order, c.code))
        ],
        "rejection_codes": [
            {
                "code": r.code,
                "public_what_wrong": r.public_what_wrong,
                "public_how_to_fix": r.public_how_to_fix,
                "related_document_type_codes": list(r.related_document_type_codes or []),
                "related_sop_flow_ids": list(r.related_sop_flow_ids or []),
            }
            for r in sorted(scheme.rejection_codes, key=lambda r: (r.sort_order, r.code))
            if r.active
        ],
        "review_rules": [
            {
                "code": r.code,
                "label": r.label,
                "document_type_code": r.document_type_code or None,
                "rule_type": r.rule_type,
                "config": dict(r.config or {}),
                "required": r.required,
                "severity": r.severity,
                "sort_order": r.sort_order,
                "active": r.active,
            }
            for r in sorted(scheme.review_rules, key=lambda r: (r.sort_order, r.code))
            if r.active
        ],
        "eligible_tools": [
            {"id": t.id, "name": t.name, "vendor": t.vendor, "aliases": list(t.aliases or []),
             "status": t.status, "verdict_note": t.verdict_note}
            for t in sorted(scheme.eligible_tools, key=lambda t: (t.sort_order, t.name))
        ],
    }


# ------------------------------------------------- 後台用的方案設定（P3）

def scheme_settings_view(scheme: Scheme) -> dict[str, Any]:
    """`GET /api/admin/schemes/{code}/settings`：案件頁要拿來組表單的設定。

    和 `scheme_apply_view()` 的差別只有一個，但那個差別就是它存在的理由：退件碼帶
    `staff_label`。承辦人選退件原因時看的是機關內部的說法，市民收到的才是
    `public_what_wrong` / `public_how_to_fix`——兩邊用同一份清單但不是同一段字。

    這裡不含 `review_rules`：案件頁的判定結果已經由 `ApplicationDetailOut.rules` 給了。
    """
    return {
        "code": scheme.code,
        "name": scheme.name,
        "supplement_days": scheme.supplement_days,
        "max_revisions": scheme.max_revisions,
        "retention_days": scheme.retention_days,
        "tiers": [
            {
                "code": t.code,
                "label": t.label,
                "subsidy_rate": t.subsidy_rate,
                "cap_amount": t.cap_amount,
                "required_proof_doc_types": list(t.required_proof_doc_types or []),
                "sort_order": t.sort_order,
            }
            for t in sorted(scheme.tiers, key=lambda t: (t.sort_order, t.code))
        ],
        "document_types": [
            {
                "code": d.code,
                "label": d.label,
                "hint": d.hint,
                "required": d.required,
                "required_when": d.required_when,
                "must_mask": d.must_mask,
                "keep_visible": d.keep_visible,
                "keep_after_disbursed": d.keep_after_disbursed,
                "accepted_mime": list(d.accepted_mime or []),
                "max_pages": d.max_pages,
                "sort_order": d.sort_order,
            }
            for d in sorted(scheme.document_types, key=lambda d: (d.sort_order, d.code))
        ],
        "payment_channels": [
            {
                "code": c.code,
                "label": c.label,
                "hint": c.hint,
                "required_document_type_codes": list(c.required_document_type_codes or []),
                "guide_content_key": c.guide_content_key,
                "sort_order": c.sort_order,
            }
            for c in sorted(scheme.payment_channels, key=lambda c: (c.sort_order, c.code))
        ],
        "rejection_codes": [
            {
                "code": r.code,
                "staff_label": r.staff_label,
                "public_what_wrong": r.public_what_wrong,
                "public_how_to_fix": r.public_how_to_fix,
                "related_document_type_codes": list(r.related_document_type_codes or []),
                "related_sop_flow_ids": list(r.related_sop_flow_ids or []),
            }
            for r in sorted(scheme.rejection_codes, key=lambda r: (r.sort_order, r.code))
            if r.active
        ],
    }


def document_type_of(scheme: Scheme, code: str) -> DocumentType | None:
    return next((d for d in scheme.document_types if d.code == code), None)
