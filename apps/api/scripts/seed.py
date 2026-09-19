"""把新竹市 AI 工具補助方案與示範案件灌進資料庫（SPEC §12）。

    uv run --package maydru-api python scripts/seed.py

冪等：跑第二次只會更新變動的欄位，不會複製出第二份方案，也不會多出五筆示範案件。
判斷「已經有了」一律用自然鍵（方案用 code、子表用 scheme_id + code、案件用 case_no），
因為 id 是隨機的，重跑一次就不一樣。

資料在 `seed_data.py`；這裡只有搬運與比對。
"""

from __future__ import annotations

import asyncio
import sys
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import seed_data as data  # noqa: E402
from app.db import sessionmaker  # noqa: E402
from app.models import (  # noqa: E402
    Application,
    DocumentType,
    EligibleTool,
    Faq,
    PaymentChannel,
    RejectionCode,
    ReviewRule,
    Scheme,
    SchemeTier,
    Tenant,
)
from app.services import application as case_service  # noqa: E402
from app.services import review  # noqa: E402
from app.services.actors import Actor  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

DEFAULT_TENANT_SLUG = "default"
DEFAULT_TENANT_NAME = "新竹市政府"

SEED_REVIEWER = Actor(type="STAFF", id="seedreviewer" .ljust(32, "0")[:32], role="case_reviewer", name="示範承辦")
SEED_SUPERVISOR = Actor(type="STAFF", id="seedsupervisor".ljust(32, "0")[:32], role="case_supervisor", name="示範科長")


class Report(Counter):
    """inserted / updated / skipped 的計數器，印出來就是搬遷報表。"""

    def line(self) -> str:
        return "  ".join(f"{k}={self[k]}" for k in ("inserted", "updated", "skipped") if k in self or True)


def _as_date(value: Any) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _apply(obj: Any, fields: dict[str, Any]) -> bool:
    """套用欄位，回傳「有沒有真的改到東西」——冪等報表靠它分辨 updated 與 skipped。"""
    changed = False
    for key, value in fields.items():
        if not hasattr(obj, key):
            continue
        if getattr(obj, key) != value:
            setattr(obj, key, value)
            changed = True
    return changed


async def _upsert(
    db: AsyncSession, model: Any, where: list[Any], fields: dict[str, Any], report: Report, label: str
) -> Any:
    obj = (await db.execute(select(model).where(*where))).scalar_one_or_none()
    if obj is None:
        obj = model(**fields)
        db.add(obj)
        await db.flush()
        report[f"{label}:inserted"] += 1
        report["inserted"] += 1
        return obj
    if _apply(obj, fields):
        report[f"{label}:updated"] += 1
        report["updated"] += 1
    else:
        report[f"{label}:skipped"] += 1
        report["skipped"] += 1
    return obj


# ------------------------------------------------------------------ tenant

async def ensure_tenant(db: AsyncSession, report: Report) -> Tenant:
    """沿用 main.py 的 bootstrap 慣例：slug `default` 就是這台機器的機關。"""
    tenant = (await db.execute(select(Tenant).where(Tenant.slug == DEFAULT_TENANT_SLUG))).scalar_one_or_none()
    if tenant is None:
        tenant = (await db.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
    if tenant is None:
        tenant = Tenant(name=DEFAULT_TENANT_NAME, slug=DEFAULT_TENANT_SLUG)
        db.add(tenant)
        await db.flush()
        report["tenant:inserted"] += 1
        report["inserted"] += 1
    else:
        report["tenant:skipped"] += 1
        report["skipped"] += 1
    return tenant


# ------------------------------------------------------------------ scheme

async def seed_scheme(db: AsyncSession, tenant: Tenant, spec: dict[str, Any], report: Report) -> Scheme:
    fields = {k: v for k, v in spec.items()}
    fields["application_start"] = _as_date(fields.get("application_start"))
    fields["application_end"] = _as_date(fields.get("application_end"))
    fields["tenant_id"] = tenant.id
    return await _upsert(
        db, Scheme, [Scheme.tenant_id == tenant.id, Scheme.code == spec["code"]], fields, report, "scheme"
    )


async def seed_children(db: AsyncSession, scheme: Scheme, report: Report) -> None:
    for i, spec in enumerate(data.TIERS):
        await _upsert(db, SchemeTier, [SchemeTier.scheme_id == scheme.id, SchemeTier.code == spec["code"]],
                      {**spec, "tenant_id": scheme.tenant_id, "scheme_id": scheme.id}, report, "tier")

    for i, spec in enumerate(data.DOCUMENT_TYPES):
        fields = {
            "tenant_id": scheme.tenant_id, "scheme_id": scheme.id, "sort_order": i + 1,
            "required": False, "required_when": "", "must_mask": False, "keep_visible": "",
            "accepted_mime": list(data.IMAGE_MIME), "max_pages": 5, **spec,
        }
        await _upsert(db, DocumentType,
                      [DocumentType.scheme_id == scheme.id, DocumentType.code == spec["code"]],
                      fields, report, "document_type")

    for spec in data.PAYMENT_CHANNELS:
        await _upsert(db, PaymentChannel,
                      [PaymentChannel.scheme_id == scheme.id, PaymentChannel.code == spec["code"]],
                      {**spec, "tenant_id": scheme.tenant_id, "scheme_id": scheme.id}, report, "payment_channel")

    for i, spec in enumerate(data.REJECTION_CODES):
        fields = {
            "tenant_id": scheme.tenant_id, "scheme_id": scheme.id, "sort_order": i + 1,
            "related_document_type_codes": [], "related_sop_flow_ids": [], "active": True, **spec,
        }
        await _upsert(db, RejectionCode,
                      [RejectionCode.scheme_id == scheme.id, RejectionCode.code == spec["code"]],
                      fields, report, "rejection_code")

    for spec in data.REVIEW_RULES:
        await _upsert(db, ReviewRule,
                      [ReviewRule.scheme_id == scheme.id, ReviewRule.code == spec["code"]],
                      {**spec, "tenant_id": scheme.tenant_id, "scheme_id": scheme.id, "active": True},
                      report, "review_rule")

    for i, spec in enumerate(data.ELIGIBLE_TOOLS):
        await _upsert(db, EligibleTool,
                      [EligibleTool.scheme_id == scheme.id, EligibleTool.name == spec["name"]],
                      {**spec, "tenant_id": scheme.tenant_id, "scheme_id": scheme.id,
                       "sort_order": i + 1, "request_count": 0},
                      report, "eligible_tool")

    for i, spec in enumerate(data.PENDING_TOOLS):
        await _upsert(db, EligibleTool,
                      [EligibleTool.scheme_id == scheme.id, EligibleTool.name == spec["name"]],
                      {"tenant_id": scheme.tenant_id, "scheme_id": scheme.id, "status": "PENDING",
                       "vendor": "", "aliases": [], "verdict_note": "",
                       "sort_order": 100 + i, **spec},
                      report, "pending_tool")


async def seed_faqs(db: AsyncSession, tenant: Tenant, scheme: Scheme, report: Report) -> None:
    for spec in data.FAQS:
        await _upsert(db, Faq, [Faq.tenant_id == tenant.id, Faq.code == spec["code"]],
                      {**spec, "tenant_id": tenant.id, "scheme_id": scheme.id,
                       "active": True, "source": "manual"},
                      report, "faq")


# ------------------------------------------------------------- 示範案件

async def seed_demo_cases(db: AsyncSession, tenant: Tenant, scheme: Scheme, report: Report) -> None:
    """每個狀態一筆，全部走真的 `transition()`——示範資料也必須是合法的歷史。"""
    for spec in data.DEMO_CASES:
        existing = (await db.execute(select(Application).where(
            Application.tenant_id == tenant.id, Application.case_no == spec["case_no"]))).scalar_one_or_none()
        if existing is not None:
            report["application:skipped"] += 1
            report["skipped"] += 1
            continue

        submitted_at = datetime.now(UTC) - timedelta(days=spec["days_ago"])
        app = await case_service.create_application(
            db,
            tenant_id=tenant.id,
            scheme=scheme,
            case_no=spec["case_no"],
            applicant_name=spec["applicant_name"],
            phone=spec["phone"],
            id_number=spec["id_number"],
            tier_code=spec["tier_code"],
            payment_channel_code=spec["payment_channel_code"],
            tool_name=spec["tool_name"],
            purchase_amount=spec["purchase_amount"],
            purchase_date=_as_date(spec["purchase_date"]),
            paid_by_proxy=spec.get("paid_by_proxy", False),
            note="示範資料",
            documents=[
                # 刻意指向不存在的物件；預覽一律 null，所以後台看得到結構但沒有影像。
                {"document_type_code": code, "object_key": f"demo/{spec['case_no']}/{code}.jpg",
                 "preview_key": None, "mime": "image/jpeg", "size": 0, "masked": True}
                for code in spec["documents"]
            ],
            now=submitted_at,
            auto_start_review=spec["status"] != "SUBMITTED",
        )
        report["application:inserted"] += 1
        report["inserted"] += 1

        # 示範案件的文件指向不存在的影像，所以規則引擎判不出東西；讓示範的承辦人
        # 先把每條必要規則標成 MATCH，核准（T3）的前置條件才成立（SPEC §8.3）。
        await _demo_findings(db, app, scheme, submitted_at)

        for step, code in enumerate(data.DEMO_PATHS[spec["status"]], start=1):
            t = case_service.TRANSITIONS[code]
            kwargs: dict[str, Any] = {}
            actor = SEED_SUPERVISOR
            if t.needs_supplement:
                actor = SEED_REVIEWER
                kwargs["supplement_items"] = spec["supplement_items"]
            if code == "T3":
                kwargs["payload"] = {"approved_amount": spec.get("approved_amount")}
            if code == "T7":
                kwargs["payload"] = {"payment_amount": spec.get("approved_amount")}
            await case_service.transition(
                db, app, code, actor=actor, now=submitted_at + timedelta(days=step), **kwargs)


async def _demo_findings(db: Any, app: Any, scheme: Any, when: datetime) -> None:
    """示範案件的人工判定：每條啟用中的規則一列 `source=reviewer` 的 MATCH。

    真實案件的 finding 由 `services/review.py` 自動產生；示範資料沒有真的影像，
    所以直接寫承辦人覆寫那一種——後台看到的結構與真案件完全一樣。
    """
    findings = [
        review.Finding(rule_code=rule.code, status="MATCH", document_type_code=rule.document_type_code)
        for rule in await review.rules_for(db, scheme.id)
        if rule.active
    ]
    if findings:
        await review.persist_findings(db, app, findings, source="reviewer", now=when)


# --------------------------------------------------------------------- main

async def run() -> Report:
    report = Report()
    async with sessionmaker()() as db:
        tenant = await ensure_tenant(db, report)
        scheme = await seed_scheme(db, tenant, data.SCHEME, report)
        await seed_children(db, scheme, report)
        await seed_faqs(db, tenant, scheme, report)
        for other in data.OTHER_SCHEMES:
            await seed_scheme(db, tenant, other, report)
        await seed_demo_cases(db, tenant, scheme, report)
        await db.commit()
    return report


def print_report(report: Report) -> None:
    print("=" * 56)
    print("seed 報表")
    print("=" * 56)
    for key in sorted(k for k in report if ":" in k):
        print(f"  {key:<28} {report[key]}")
    print("-" * 56)
    for key in ("inserted", "updated", "skipped"):
        print(f"  {key:<28} {report[key]}")


if __name__ == "__main__":
    print_report(asyncio.run(run()))
