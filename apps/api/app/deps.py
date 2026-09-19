"""FastAPI dependencies: admin auth (JWT), public auth (API key), case tokens,
capability gates, tenant-scoped loading."""

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
from .security import decode_case_token, decode_token, hash_api_key, token_predates_password_change

ROLE_RANK = {role: rank for rank, role in enumerate(ROLES)}
LAST_USED_RESOLUTION = timedelta(minutes=1)

# 授權以 capability 為準，不以角色排名為準（決策 D14）。角色只是 capability 的組合，
# 所以「案件覆核者」不會因為排名比較高就順便拿到 SOP 編輯權。
CAPABILITIES = ("sop_edit", "sop_review", "case_review", "case_supervise", "admin", "owner")

_ADMIN_CAPS = frozenset({"sop_edit", "sop_review", "case_review", "case_supervise", "admin"})
ROLE_CAPS: dict[str, frozenset[str]] = {
    "viewer": frozenset(),                              # 舊資料的唯讀層級，UI 不再提供
    "sop_editor": frozenset({"sop_edit"}),
    "sop_reviewer": frozenset({"sop_review"}),
    "case_reviewer": frozenset({"case_review"}),
    "case_supervisor": frozenset({"case_review", "case_supervise"}),
    "admin": _ADMIN_CAPS,
    "owner": _ADMIN_CAPS | {"owner"},
}

T = TypeVar("T")


def has_cap(role: str, cap: str) -> bool:
    return cap in ROLE_CAPS.get(role, frozenset())


def roles_with_any_cap(*caps: str) -> list[str]:
    """帶得到這幾個 capability 之一的角色。

    授權以 capability 為準（D14），所以「誰可以被指派案件」也從 capability 反推，
    而不是把角色名單硬寫進查詢裡——新增一個角色時不必記得回來改這一行。
    """
    wanted = set(caps)
    return sorted(role for role, granted in ROLE_CAPS.items() if granted & wanted)


@dataclass
class CurrentUser:
    id: str
    tenant_id: str
    role: str
    email: str
    name: str

    def at_least(self, role: str) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[role]

    def can(self, cap: str) -> bool:
        return has_cap(self.role, cap)


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


def require_cap(cap: str):
    """Capability gate (SPEC §6.5 / 決策 D14). An endpoint declares what it *does*
    (`sop_edit`, `case_supervise`), never which rank happens to be allowed today."""

    async def dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if not has_cap(user.role, cap):
            raise HTTPException(403, f"需要 {cap} 權限")
        return user

    return dep


@dataclass
class CaseCaller:
    """一張案件 token 代表的身分：只有一個案號，沒有帳號（SPEC §8.1）。"""

    case_no: str
    tenant_id: str


async def require_case_token(request: Request) -> CaseCaller:
    """補件與撤回用的短效憑證。查詢驗證成功後發，30 分鐘內只對那一件案子有效。"""
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else request.headers.get("x-case-token", "")
    if not token:
        raise HTTPException(401, "缺少案件驗證")
    try:
        payload = decode_case_token(token)
    except Exception:
        raise HTTPException(401, "案件驗證已失效，請重新查詢")
    return CaseCaller(case_no=payload["case_no"], tenant_id=payload.get("tid", ""))


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
