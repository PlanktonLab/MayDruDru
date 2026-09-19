from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import CurrentUser, current_user, get_owned, require_cap
from ..models import ApiKey, Tenant, User
from ..schemas import (
    ApiKeyIn,
    ApiKeyOut,
    ApiKeyPatch,
    MemberIn,
    MemberPatch,
    PolicyIn,
    TenantLayoutIn,
    TenantOut,
    UserOut,
)
from ..security import generate_api_key, hash_password_async
from ..services.card_context import TENANT_LAYOUT_KEY
from ..services.policy import DEFAULTS as POLICY_DEFAULTS
from ..services.policy import LEGACY_KEY, POLICY_KEY, TEMPLATES, Policy

router = APIRouter(prefix="/api", tags=["tenant"])

MEMBER_NOT_FOUND = "找不到此成員"
API_KEY_NOT_FOUND = "找不到此 API key"
DUPLICATE_EMAIL = "此 email 已是成員"
LAST_OWNER = "至少要保留一位啟用中的 owner"


def _user_out(u: User) -> UserOut:
    return UserOut(id=u.id, tenant_id=u.tenant_id, email=u.email, name=u.name, role=u.role, is_active=u.is_active, created_at=u.created_at)


def removes_last_owner(target: User, active_owner_count: int, *, new_role: str | None = None,
                       new_active: bool | None = None, deleting: bool = False) -> bool:
    """True if the change would leave the tenant without an active owner."""
    if target.role != "owner" or not target.is_active:
        return False
    stays_owner = not deleting and (new_role in (None, "owner")) and new_active is not False
    return not stays_owner and active_owner_count <= 1


async def _active_owner_count(db: AsyncSession, tenant_id: str) -> int:
    """Locks the tenant's active owners so two concurrent demotions can't both pass."""
    ids = (await db.execute(
        select(User.id).where(User.tenant_id == tenant_id, User.role == "owner", User.is_active.is_(True)).with_for_update()
    )).scalars().all()
    return len(ids)


async def _email_taken(db: AsyncSession, tenant_id: str, email: str) -> bool:
    q = select(User.id).where(User.tenant_id == tenant_id, func.lower(User.email) == email.lower()).limit(1)
    return (await db.execute(q)).first() is not None


@router.get("/tenant", response_model=TenantOut)
async def get_tenant(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    t = await db.get(Tenant, user.tenant_id)
    return TenantOut(id=t.id, name=t.name, slug=t.slug, settings=t.settings or {})


@router.put("/tenant/stepcard-layout", response_model=TenantOut)
async def set_tenant_layout(body: TenantLayoutIn, user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)):
    """The Step Card layout every step of this channel renders with unless it
    has its own (SPEC §9.1). Already-rendered cards keep their picture."""
    t = await db.get(Tenant, user.tenant_id)
    layouts = dict((t.settings or {}).get(TENANT_LAYOUT_KEY) or {})
    if body.layout:
        layouts[body.channel] = body.layout.model_dump()
    else:
        layouts.pop(body.channel, None)
    t.settings = {**(t.settings or {}), TENANT_LAYOUT_KEY: layouts}
    await db.commit()
    return TenantOut(id=t.id, name=t.name, slug=t.slug, settings=t.settings or {})


@router.get("/tenant/policy")
async def get_policy(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """The tenant's 客服策略, resolved (blanks filled with the language's
    built-ins), plus the built-in templates so the UI can show what a blank
    means and which keys can be overridden."""
    t = await db.get(Tenant, user.tenant_id)
    p = Policy.from_settings(t.settings if t else None)
    return {**p.to_dict(), "overrides": p.templates, "builtin_templates": TEMPLATES.get(p.language) or TEMPLATES["zh-TW"],
            "languages_with_templates": sorted(TEMPLATES)}


@router.put("/tenant/policy")
async def set_policy(body: PolicyIn, user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)):
    """Voice (language, name, tone, goal noun, extra rules, hand-off line),
    behaviour (delivery, what each screenshot outcome turns into, confidence
    bars) and template overrides. Fields equal to the built-in are stored as
    blanks so a later change of language picks up the new built-ins."""
    t = await db.get(Tenant, user.tenant_id)
    raw = body.model_dump()
    builtin = TEMPLATES.get(raw["language"]) or TEMPLATES["zh-TW"]
    for k in ("name", "tone", "goal_noun"):
        if raw[k].strip() == builtin.get(k, ""):
            raw[k] = ""
    if raw["handoff_message"].strip() == builtin.get("handoff", ""):
        raw["handoff_message"] = ""
    raw["templates"] = {k: v for k, v in raw["templates"].items() if v.strip() and v.strip() != builtin.get(k)}
    stored = {k: v for k, v in raw.items() if v != POLICY_DEFAULTS.get(k)}
    settings = {k: v for k, v in (t.settings or {}).items() if k != LEGACY_KEY}
    t.settings = {**settings, POLICY_KEY: stored}
    await db.commit()
    p = Policy.from_settings(t.settings)
    return {**p.to_dict(), "overrides": p.templates, "builtin_templates": builtin, "languages_with_templates": sorted(TEMPLATES)}


# the first version's endpoint, kept for one release
@router.get("/tenant/assistant")
async def get_assistant_settings(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await get_policy(user, db)


@router.get("/members", response_model=list[UserOut])
async def list_members(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(User).where(User.tenant_id == user.tenant_id).order_by(User.created_at))).scalars().all()
    return [_user_out(u) for u in rows]


@router.post("/members", response_model=UserOut)
async def create_member(body: MemberIn, user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)):
    if body.role == "owner" and user.role != "owner":
        raise HTTPException(403, "只有 owner 能建立 owner")
    email = body.email.lower().strip()
    if await _email_taken(db, user.tenant_id, email):
        raise HTTPException(409, DUPLICATE_EMAIL)
    u = User(tenant_id=user.tenant_id, email=email, name=body.name, role=body.role,
             password_hash=await hash_password_async(body.password), password_changed_at=datetime.now(UTC))
    db.add(u)
    try:
        await db.commit()
    except IntegrityError:  # concurrent insert of the same email
        await db.rollback()
        raise HTTPException(409, DUPLICATE_EMAIL)
    return _user_out(u)


@router.patch("/members/{member_id}", response_model=UserOut)
async def patch_member(member_id: str, body: MemberPatch, user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)):
    u = await get_owned(db, User, member_id, user, MEMBER_NOT_FOUND)
    if (u.role == "owner" or body.role == "owner") and user.role != "owner":
        raise HTTPException(403, "只有 owner 能變更 owner")
    if u.role == "owner" and (body.role not in (None, "owner") or body.is_active is False):
        if removes_last_owner(u, await _active_owner_count(db, user.tenant_id), new_role=body.role, new_active=body.is_active):
            raise HTTPException(409, LAST_OWNER)
    if body.name is not None:
        u.name = body.name
    if body.role is not None:
        u.role = body.role
    if body.is_active is not None:
        u.is_active = body.is_active
    if body.password:
        u.password_hash = await hash_password_async(body.password)
        u.password_changed_at = datetime.now(UTC)
    await db.commit()
    return _user_out(u)


@router.delete("/members/{member_id}")
async def delete_member(member_id: str, user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)):
    u = await get_owned(db, User, member_id, user, MEMBER_NOT_FOUND)
    if u.role == "owner":
        if user.role != "owner":
            raise HTTPException(403, "只有 owner 能移除 owner")
        if removes_last_owner(u, await _active_owner_count(db, user.tenant_id), deleting=True):
            raise HTTPException(409, LAST_OWNER)
    await db.delete(u)
    await db.commit()
    return {"ok": True}


def _key_out(k: ApiKey, plaintext: str | None = None) -> ApiKeyOut:
    return ApiKeyOut(id=k.id, name=k.name, prefix=k.prefix, status=k.status, rate_limit_per_minute=k.rate_limit_per_minute,
                     last_used_at=k.last_used_at, created_at=k.created_at, plaintext=plaintext)


@router.get("/api-keys", response_model=list[ApiKeyOut])
async def list_keys(user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ApiKey).where(ApiKey.tenant_id == user.tenant_id).order_by(ApiKey.created_at))).scalars().all()
    return [_key_out(k) for k in rows]


@router.post("/api-keys", response_model=ApiKeyOut)
async def create_key(body: ApiKeyIn, user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)):
    raw, prefix, digest = generate_api_key()
    k = ApiKey(tenant_id=user.tenant_id, name=body.name, prefix=prefix, key_hash=digest, rate_limit_per_minute=body.rate_limit_per_minute)
    db.add(k)
    await db.commit()
    return _key_out(k, raw)


@router.patch("/api-keys/{key_id}", response_model=ApiKeyOut)
async def patch_key(key_id: str, body: ApiKeyPatch, user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)):
    k = await get_owned(db, ApiKey, key_id, user, API_KEY_NOT_FOUND)
    for f in ("name", "status", "rate_limit_per_minute"):
        if getattr(body, f) is not None:
            setattr(k, f, getattr(body, f))
    await db.commit()
    return _key_out(k)


@router.delete("/api-keys/{key_id}")
async def delete_key(key_id: str, user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)):
    k = await get_owned(db, ApiKey, key_id, user, API_KEY_NOT_FOUND)
    await db.delete(k)
    await db.commit()
    return {"ok": True}
