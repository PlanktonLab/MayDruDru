"""FastAPI dependencies: admin auth (JWT), public auth (API key), role gates,
tenant-scoped loading."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TypeVar

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .errors import RATE_LIMITED, ApiError
from .models import ROLES, ApiKey, Edge, Flow, Step, User, Variant
from .redis_client import redis
from .security import decode_token, hash_api_key, token_predates_password_change

ROLE_RANK = {role: rank for rank, role in enumerate(ROLES)}
LAST_USED_RESOLUTION = timedelta(minutes=1)

T = TypeVar("T")


@dataclass
class CurrentUser:
    id: str
    tenant_id: str
    role: str
    email: str
    name: str

    def at_least(self, role: str) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[role]


async def current_user(request: Request, db: AsyncSession = Depends(get_db)) -> CurrentUser:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "未登入")
    try:
        payload = decode_token(auth[7:])
    except Exception:
        raise HTTPException(401, "登入已失效")
    user = await db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(401, "帳號不存在或已停用")
    if token_predates_password_change(payload, user.password_changed_at):
        raise HTTPException(401, "密碼已變更，請重新登入")
    return CurrentUser(id=user.id, tenant_id=user.tenant_id, role=user.role, email=user.email, name=user.name)


def require(role: str):
    """Minimum role gate. Roles are ordered viewer < reviewer < editor < admin < owner."""

    async def dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if not user.at_least(role):
            raise HTTPException(403, f"需要 {role} 以上的權限")
        return user

    return dep


def require_any(*roles: str):
    """Exact-role gate that admins and owners always pass (e.g. reviewer actions)."""

    async def dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.role not in roles and not user.at_least("admin"):
            raise HTTPException(403, f"需要 {', '.join(roles)} 角色")
        return user

    return dep


def _tenant_scoped(model, tenant_id: str):
    """SELECT for `model` limited to one tenant, joining up to Flow where the
    model has no tenant_id of its own."""
    q = select(model)
    if model is Variant:
        q = q.join(Step, Step.id == Variant.step_id).join(Flow, Flow.id == Step.flow_id)
    elif model in (Step, Edge):
        q = q.join(Flow, Flow.id == model.flow_id)
    elif not hasattr(model, "tenant_id"):
        raise TypeError(f"{model.__name__} is not tenant scoped")
    owner = Flow if model in (Variant, Step, Edge) else model
    return q.where(owner.tenant_id == tenant_id)


async def get_owned(db: AsyncSession, model: type[T], obj_id: str, user: CurrentUser, not_found_message: str, *, options=()) -> T:
    """Load a row that belongs to the caller's tenant, or 404 with a zh-TW message."""
    q = _tenant_scoped(model, user.tenant_id).where(model.id == obj_id)
    if options:
        q = q.options(*options)
    obj = (await db.execute(q)).scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, not_found_message)
    return obj


@dataclass
class ApiCaller:
    tenant_id: str
    api_key_id: str
    name: str


async def _check_rate_limit(key: ApiKey) -> None:
    """Fixed one-minute window per API key; Redis being down never blocks traffic."""
    try:
        r = redis()
        bucket = f"rl:{key.id}:{int(datetime.now(UTC).timestamp() // 60)}"
        n = await r.incr(bucket)
        if n == 1:
            await r.expire(bucket, 70)
    except Exception:
        return
    if n > key.rate_limit_per_minute:
        raise ApiError(429, RATE_LIMITED, "超過速率限制")


def last_used_is_stale(last_used_at: datetime | None, now: datetime) -> bool:
    return last_used_at is None or now - last_used_at >= LAST_USED_RESOLUTION


async def api_caller(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> ApiCaller:
    if not x_api_key:
        raise HTTPException(401, {"code": "unauthorized", "message": "缺少 X-API-Key"})
    key = (await db.execute(select(ApiKey).where(ApiKey.key_hash == hash_api_key(x_api_key)))).scalar_one_or_none()
    if not key or key.status != "active":
        raise HTTPException(401, {"code": "unauthorized", "message": "API key 無效或已停用"})
    await _check_rate_limit(key)
    now = datetime.now(UTC)
    if last_used_is_stale(key.last_used_at, now):
        key.last_used_at = now
        await db.commit()
    return ApiCaller(tenant_id=key.tenant_id, api_key_id=key.id, name=key.name)
