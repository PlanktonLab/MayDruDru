"""Bounded public FAQ assistant: no model, prompts, documents, or external actions."""
import hashlib
import hmac
import time
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import Faq, Scheme, Tenant
from . import audit, contents, faq
from .actors import Actor


class ChatSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    per_minute: int = Field(default=6, ge=1, le=60)
    per_day: int = Field(default=60, ge=1, le=1000)
    tenant_per_day: int = Field(default=5000, ge=1, le=100000)
    max_question_chars: int = Field(default=500, ge=20, le=1000)
    max_results: int = Field(default=2, ge=1, le=3)
    version: int = Field(default=1, ge=1)


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=1000)
    scheme_code: str = Field(default="", max_length=80)


async def settings(db: AsyncSession, tenant_id: str) -> ChatSettings:
    tenant = await db.get(Tenant, tenant_id)
    return ChatSettings.model_validate((tenant.settings or {}).get("help_chat", {})) if tenant else ChatSettings(enabled=False)


async def save(db: AsyncSession, tenant_id: str, body: ChatSettings, actor: Actor) -> ChatSettings:
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id).with_for_update().execution_options(populate_existing=True))).scalar_one()
    old = ChatSettings.model_validate((tenant.settings or {}).get("help_chat", {}))
    if old.version != body.version:
        raise HTTPException(409, "設定已更新，請重新整理後再試")
    updated = body.model_copy(update={"version": old.version + 1})
    tenant.settings = {**(tenant.settings or {}), "help_chat": updated.model_dump()}
    await audit.log(db, actor, "help_chat.update", "tenant", tenant_id,
                    audit.diff_of(old.model_dump(), updated.model_dump()), tenant_id=tenant_id)
    await db.commit()
    return updated


async def fail(db: AsyncSession, tenant_id: str, status: int, key: str, retry: int = 0) -> None:
    raise HTTPException(status, {"code": key, "message": await contents.t(db, tenant_id, key)},
                        headers={"Retry-After": str(retry)} if retry else None)


async def reserve(redis: Any, db: AsyncSession, tenant_id: str, ip: str, cfg: ChatSettings) -> None:
    fingerprint = hmac.new(get_settings().secret_key.encode(), ip.encode(), hashlib.sha256).hexdigest()
    now = int(time.time())
    for scope, seconds, limit in ((fingerprint, 60, cfg.per_minute), (fingerprint, 86400, cfg.per_day), ("all", 86400, cfg.tenant_per_day)):
        key = f"help-chat:{tenant_id}:{scope}:{seconds}:{now // seconds}"
        try:
            count = await redis.incr(key)
            # Also repairs expiry if another process died between INCR and EXPIRE.
            await redis.expire(key, seconds + 60)
        except Exception:
            await fail(db, tenant_id, 503, "help_chat.unavailable")
            return
        if count > limit:
            await fail(db, tenant_id, 429, "help_chat.limited", seconds - now % seconds)


async def answer(db: AsyncSession, redis: Any, tenant_id: str, ip: str, body: Question) -> dict[str, Any]:
    cfg = await settings(db, tenant_id)
    if not cfg.enabled:
        await fail(db, tenant_id, 503, "help_chat.disabled")
    await reserve(redis, db, tenant_id, ip, cfg)
    if len(body.text) > cfg.max_question_chars:
        await fail(db, tenant_id, 422, "help_chat.too_long")
    scheme_id = None
    if body.scheme_code:
        scheme_id = (await db.execute(select(Scheme.id).where(Scheme.tenant_id == tenant_id, Scheme.code == body.scheme_code))).scalar_one_or_none()
        if scheme_id is None:
            await fail(db, tenant_id, 404, "help_chat.unavailable")
    rows = (await db.execute(select(Faq).where(Faq.tenant_id == tenant_id, Faq.active.is_(True),
        or_(Faq.scheme_id.is_(None), Faq.scheme_id == scheme_id)).order_by(Faq.id).limit(500))).scalars().all()
    ranked = sorted(((faq.score(row, body.text), row) for row in rows if row.answer.strip()), key=lambda item: (-item[0], item[1].id))
    matched = [row for score, row in ranked if score >= faq.MIN_SCORE][:cfg.max_results]
    text = "\n\n".join(f"{row.question}\n{row.answer}" for row in matched)
    return {"role": "assistant", "text": text or await contents.t(db, tenant_id, "help_chat.fallback"),
            "source_ids": [row.id for row in matched]}
