"""`/api/admin/schemes`：方案與其子設定表的 CRUD（SPEC §8.2「方案管理」）。

所有邏輯在 `services/scheme.py`；這裡只做四件事：取出自己 tenant 的方案、把 payload
交給 service、寫稽核、回序列化結果。樂觀鎖由 service 的 `check_version` 丟 409。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ...db import get_db
from ...deps import CurrentUser, require_cap
from ...services import audit, review
from ...services import scheme as scheme_service
from ...services.actors import Actor
from .schemas import (
    ChildIn,
    ReorderIn,
    RuleEvaluateIn,
    RuleEvaluateOut,
    SchemeIn,
    SchemeOut,
    SchemePatch,
    SchemeSettingsOut,
    ToolResolveIn,
)

router = APIRouter(prefix="/api/admin/schemes", tags=["admin-schemes"])


def _out(s: Any) -> SchemeOut:
    return SchemeOut(
        id=s.id, code=s.code, name=s.name, category=s.category, active=s.active,
        version=s.version, retention_days=s.retention_days, supplement_days=s.supplement_days,
        max_revisions=s.max_revisions, updated_at=s.updated_at,
    )


def _child_out(obj: Any) -> dict[str, Any]:
    """子表欄位每張都不同，就照實回傳它自己的欄位（去掉 SQLAlchemy 的內部狀態）。"""
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


@router.get("", response_model=list[SchemeOut])
async def list_schemes(
    active: bool | None = None,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
):
    return [_out(s) for s in await scheme_service.list_schemes(db, user.tenant_id, active=active)]


@router.post("", response_model=SchemeOut, status_code=201)
async def create_scheme(
    body: SchemeIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
):
    scheme = await scheme_service.create_scheme(db, user.tenant_id, body.model_dump())
    await audit.log(db, Actor.staff(user), "create", "scheme", scheme.code, {"code": scheme.code},
                    tenant_id=user.tenant_id)
    await db.commit()
    return _out(scheme)


@router.get("/{code}")
async def get_scheme(
    code: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
):
    """後台要看的是完整設定（含 review_rules 與 staff_label），不是公開檢視。"""
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    view = scheme_service.scheme_public_view(scheme)
    view["id"] = scheme.id
    view["version"] = scheme.version
    view["review_rules"] = [_child_out(r) for r in sorted(scheme.review_rules, key=lambda r: (r.sort_order, r.code))]
    view["rejection_codes"] = [_child_out(r) for r in sorted(scheme.rejection_codes, key=lambda r: (r.sort_order, r.code))]
    return view


@router.get("/{code}/settings", response_model=SchemeSettingsOut)
async def get_scheme_settings(
    code: str,
    user: CurrentUser = Depends(require_cap("case_review")),
    db: AsyncSession = Depends(get_db),
) -> SchemeSettingsOut:
    """案件頁要的方案設定：退件碼（含 `staff_label`）、文件類型、管道、級距、天數。

    要 `case_review` 而不是 `admin`——承辦人不能改方案，但看不到退件碼的內部說法就
    沒辦法退件。必須排在 `/{code}/{kind}` 之前，否則 `settings` 會被當成子設定表。
    """
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    return SchemeSettingsOut.model_validate(scheme_service.scheme_settings_view(scheme))


@router.patch("/{code}", response_model=SchemeOut)
async def patch_scheme(
    code: str,
    body: SchemePatch,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
):
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    data = body.model_dump(exclude_unset=True)
    expected = data.pop("expected_version", None)
    before = await scheme_service.update_scheme(db, scheme, data, expected_version=expected)
    await audit.log(db, Actor.staff(user), "update", "scheme", scheme.code,
                    audit.diff_of(before, data), tenant_id=user.tenant_id)
    await db.commit()
    return _out(scheme)


@router.delete("/{code}", status_code=204)
async def delete_scheme(
    code: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
):
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    await scheme_service.delete_scheme(db, scheme)
    await audit.log(db, Actor.staff(user), "delete", "scheme", code, {}, tenant_id=user.tenant_id)
    await db.commit()
    return Response(status_code=204)


# --------------------------------------------- 規則試算與待審工具（P5）
# 這三支都排在 `/{code}/{kind}` 之前：FastAPI 依宣告順序比對，寫在後面的話
# `review-rules` 會先被 `/{code}/{kind}` 吃掉，`evaluate` 會被當成 child_id。


@router.post("/{code}/review-rules/evaluate", response_model=RuleEvaluateOut)
async def evaluate_review_rules(
    code: str,
    body: RuleEvaluateIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> RuleEvaluateOut:
    """規則編輯器的「試算」：貼一段 OCR 文字，看規則會判成什麼。不落地。

    後台的試算面板在瀏覽器裡跑 `@maydru/review-rules` 給即時回饋，這一支跑的是
    伺服器上的 Python 版。兩邊對同一段文字必須判得一樣——承辦人員按這顆按鈕，
    就是在確認他剛寫的規則在真正做判定的那一側也成立（SPEC §14「規則一致性」）。
    """
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    return RuleEvaluateOut.model_validate(await review.dry_run(db, scheme, body.model_dump()))


@router.get("/{code}/eligible-tools/pending")
async def list_pending_tools(
    code: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """待審工具佇列：民眾打了、但清單上還沒有的工具名稱。"""
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    return [_child_out(t) for t in await scheme_service.pending_tools(db, scheme)]


@router.post("/{code}/eligible-tools/{tool_id}/resolve")
async def resolve_eligible_tool(
    code: str,
    tool_id: str,
    body: ToolResolveIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """核可／退回一筆待審工具，或把它併進既有的那一筆。"""
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    tool = await scheme_service.get_child(db, scheme, "eligible-tools", tool_id)
    result = await scheme_service.resolve_tool(
        db, scheme, tool,
        status=body.status, verdict_note=body.verdict_note, merge_into_id=body.merge_into_id,
    )
    await audit.log(db, Actor.staff(user), "resolve", "eligible-tools", tool_id,
                    {"status": body.status, "merge_into_id": body.merge_into_id, "scheme": code},
                    tenant_id=user.tenant_id)
    await db.commit()
    return _child_out(result)


@router.post("/{code}/{kind}/reorder")
async def reorder_children(
    code: str,
    kind: str,
    body: ReorderIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """把整個分頁的 `sort_order` 按送上來的順序重寫一次。"""
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    rows = await scheme_service.reorder_children(db, scheme, kind, body.ids)
    await audit.log(db, Actor.staff(user), "reorder", kind, scheme.code,
                    {"ids": list(body.ids)}, tenant_id=user.tenant_id)
    await db.commit()
    return [_child_out(row) for row in rows]


# ------------------------------------------------------------- 子設定表

@router.get("/{code}/{kind}")
async def list_children(
    code: str,
    kind: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
):
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    return [_child_out(o) for o in await scheme_service.list_children(db, scheme, kind)]


@router.post("/{code}/{kind}", status_code=201)
async def create_child(
    code: str,
    kind: str,
    body: ChildIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
):
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    data = body.model_dump(exclude_unset=True)
    data.pop("expected_version", None)
    obj = await scheme_service.create_child(db, scheme, kind, data)
    await audit.log(db, Actor.staff(user), "create", kind, obj.id, {"scheme": code}, tenant_id=user.tenant_id)
    await db.commit()
    return _child_out(obj)


@router.patch("/{code}/{kind}/{child_id}")
async def patch_child(
    code: str,
    kind: str,
    child_id: str,
    body: ChildIn,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
):
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    obj = await scheme_service.get_child(db, scheme, kind, child_id)
    data = body.model_dump(exclude_unset=True)
    expected = data.pop("expected_version", None)
    before = await scheme_service.update_child(db, obj, data, expected_version=expected)
    await audit.log(db, Actor.staff(user), "update", kind, child_id,
                    audit.diff_of(before, data), tenant_id=user.tenant_id)
    await db.commit()
    return _child_out(obj)


@router.delete("/{code}/{kind}/{child_id}", status_code=204)
async def delete_child(
    code: str,
    kind: str,
    child_id: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
):
    scheme = await scheme_service.get_scheme(db, user.tenant_id, code)
    obj = await scheme_service.get_child(db, scheme, kind, child_id)
    await scheme_service.delete_child(db, obj)
    await audit.log(db, Actor.staff(user), "delete", kind, child_id, {}, tenant_id=user.tenant_id)
    await db.commit()
    return Response(status_code=204)
