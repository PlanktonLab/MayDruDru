import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import CurrentUser, current_user
from ..models import Tenant, User
from ..redis_client import redis
from ..schemas import BootstrapIn, LoginIn, TokenOut, UserOut
from ..security import create_token, hash_password_async, verify_password_async
from ..services import tenancy

log = logging.getLogger("sop.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])

LOGIN_WINDOW_SECONDS = 60
BOOTSTRAP_LOCK_ID = 0x50505401  # pg advisory lock serialising first-tenant creation


def login_rate_key(client_ip: str, email: str) -> str:
    return f"login:{client_ip}:{email.strip().lower()}"


async def _login_allowed(request: Request, email: str) -> bool:
    """Fixed window per client IP + email. Redis being down never locks people out."""
    key = login_rate_key(request.client.host if request.client else "unknown", email)
    try:
        r = redis()
        n = await r.incr(key)
        if n == 1:
            await r.expire(key, LOGIN_WINDOW_SECONDS)
    except Exception:
        log.warning("login rate limit unavailable", exc_info=True)
        return True
    return n <= get_settings().login_attempts_per_minute


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    if not await _login_allowed(request, body.email):
        raise HTTPException(429, "嘗試次數過多，請稍後再試")
    q = select(User).where(User.email == body.email.lower().strip(), User.is_active.is_(True))
    if body.tenant_slug:
        q = q.join(Tenant, Tenant.id == User.tenant_id).where(Tenant.slug == body.tenant_slug)
    users = (await db.execute(q)).scalars().all()
    if not users:
        await verify_password_async(body.password, None)  # same bcrypt cost as a real account
    for u in users:
        if await verify_password_async(body.password, u.password_hash):
            return TokenOut(access_token=create_token(u.id, u.tenant_id, u.role))
    raise HTTPException(401, "帳號或密碼錯誤")


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser = Depends(current_user)):
    return UserOut(id=user.id, tenant_id=user.tenant_id, email=user.email, name=user.name, role=user.role)


@router.get("/bootstrap-status")
async def bootstrap_status(db: AsyncSession = Depends(get_db)):
    """還沒有任何人能登入時，前端才顯示「建立第一個管理者」（決策 D26）。"""
    return {"needs_bootstrap": await tenancy.needs_bootstrap(db)}


@router.post("/bootstrap", response_model=TokenOut)
async def bootstrap(body: BootstrapIn, db: AsyncSession = Depends(get_db)):
    """建立第一個 owner。閘門是「沒有任何還在用的 owner」，不是「沒有 tenant」。

    `scripts/seed.py` 會先建好機關，所以灌過種子、但一個使用者都沒有的機器，用
    tenant 數量判斷會永遠進不去（決策 D26）。tenant 已經在了就把 owner 掛上去，
    不再開第二個機關——一台機器一個機關是這套系統的部署形態。
    """
    password_hash = await hash_password_async(body.owner_password)
    # 兩個人同時送出時只能有一個贏；SQLite（測試）沒有這個函式，也不需要它。
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": BOOTSTRAP_LOCK_ID})
    if not await tenancy.needs_bootstrap(db):
        raise HTTPException(403, "系統已完成初始化")
    t = await tenancy.default_tenant(db)
    if t is None:
        t = Tenant(name=body.tenant_name, slug=body.tenant_slug)
        db.add(t)
        await db.flush()
    u = User(tenant_id=t.id, email=body.owner_email.lower().strip(), name=body.owner_name, role="owner",
             password_hash=password_hash, password_changed_at=datetime.now(UTC))
    db.add(u)
    await db.commit()
    return TokenOut(access_token=create_token(u.id, t.id, u.role))
