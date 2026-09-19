from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import CurrentUser, current_user, require_cap
from ..redis_client import get_redis
from ..services import help_chat
from ..services.actors import Actor
from ..services.tenancy import default_tenant_id

router = APIRouter(tags=["help-chat"])


class ChatReply(BaseModel):
    role: Literal["assistant"]
    text: str
    source_ids: list[str]


@router.post("/api/apply/help-chat", response_model=ChatReply)
async def ask(body: help_chat.Question, request: Request, db: AsyncSession = Depends(get_db), redis: Any = Depends(get_redis)) -> dict[str, Any]:
    return await help_chat.answer(db, redis, await default_tenant_id(db), request.client.host if request.client else "unknown", body)


@router.get("/api/admin/help-chat", response_model=help_chat.ChatSettings)
async def read_settings(user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> help_chat.ChatSettings:
    return await help_chat.settings(db, user.tenant_id)


@router.put("/api/admin/help-chat", response_model=help_chat.ChatSettings)
async def write_settings(body: help_chat.ChatSettings, user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db)) -> help_chat.ChatSettings:
    return await help_chat.save(db, user.tenant_id, body, Actor.staff(user))
