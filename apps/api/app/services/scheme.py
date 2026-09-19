"""方案服務：設定的 CRUD、必要文件推導、公開檢視（SPEC §6.2 / §8.1 / §10.1）。

方案是純資料（決策 D6），所以這裡沒有任何「新竹市 AI 補助」專屬的判斷。
`required_document_types()` 是 submit-flow `requiredDocs()` 的移植，差別在於三個
來源都改讀資料：文件自己的 `required` / `required_when`、繳費管道的必附文件、
級距的佐證文件。
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
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
    "get_scheme",
    "list_children",
    "list_schemes",
    "required_document_types",
    "scheme_public_view",
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
