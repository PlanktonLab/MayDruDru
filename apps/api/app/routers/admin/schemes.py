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
from ...services import audit
from ...services import scheme as scheme_service
from ...services.actors import Actor
from .schemas import ChildIn, SchemeIn, SchemeOut, SchemePatch

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
