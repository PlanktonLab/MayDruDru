"""Playground (SPEC §10), authenticated with the admin login.

`/chats` is the 虛擬客服 chat the page uses: a blank room, one canned greeting,
then the tool-calling assistant answers text and screenshots with plain
messages. `/sessions` keeps exposing the Session API engine (the same one the
public API and LINE channels use) with a debug payload per turn."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.assistant import ChatEngine
from ..ai.image_utils import ImageTooLarge, InvalidImage, read_image_upload
from ..ai.session_graph import SessionEngine
from ..db import get_db
from ..deps import CurrentUser, current_user
from ..models import Tenant
from ..schemas import ActionIn, ChatStart, PlaygroundStart, TextIn
from ..security import hash_external_user

router = APIRouter(prefix="/api/playground", tags=["playground"])


@router.post("/sessions")
async def start(body: PlaygroundStart, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await SessionEngine(db).start(user.tenant_id, hash_external_user(user.tenant_id, f"pg:{user.id}:{body.external_user_id}"),
                                         hint=body.hint, known_context=body.known_context, content_mode=body.content_mode,
                                         theme=body.theme, source="playground")


@router.post("/sessions/{session_id}/messages")
async def text(session_id: str, body: TextIn, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await SessionEngine(db).handle(user.tenant_id, session_id, {"kind": "text", "text": body.text})


@router.post("/sessions/{session_id}/screenshots")
async def screenshot(session_id: str, file: UploadFile, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    try:
        png = await read_image_upload(file)
    except ImageTooLarge:
        raise HTTPException(413, "檔案過大")
    except InvalidImage:
        raise HTTPException(400, "無法讀取圖片")
    return await SessionEngine(db).handle(user.tenant_id, session_id, {"kind": "screenshot"}, screenshot=png)


@router.post("/sessions/{session_id}/actions")
async def action(session_id: str, body: ActionIn, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await SessionEngine(db).handle(user.tenant_id, session_id, {"kind": "action", **body.model_dump()})


@router.get("/sessions/{session_id}")
async def status(session_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await SessionEngine(db).status(user.tenant_id, session_id)


# ---- 虛擬客服 chat: a blank room, one canned greeting, then the tool-calling
# assistant answers text and pasted screenshots with plain messages.

@router.post("/chats")
async def chat_start(body: ChatStart, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    tenant = await db.get(Tenant, user.tenant_id)
    state, hello = await ChatEngine(db, tenant.name if tenant else "", tenant.settings if tenant else None).start(user.tenant_id, content_mode=body.content_mode)
    return {"chat_id": state.chat_id, "content_mode": state.content_mode, "messages": [{"kind": "text", "text": hello}]}


@router.get("/chats/{chat_id}")
async def chat_status(chat_id: str, user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await ChatEngine(db).status(user.tenant_id, chat_id)


@router.post("/chats/{chat_id}/messages")
async def chat_message(chat_id: str, text: str | None = Form(None), file: UploadFile | None = File(None),
                       user: CurrentUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    png = None
    if file is not None and file.filename:
        try:
            png = await read_image_upload(file)
        except ImageTooLarge:
            raise HTTPException(413, "檔案過大")
        except InvalidImage:
            raise HTTPException(400, "無法讀取圖片")
    if not (text or "").strip() and png is None:
        raise HTTPException(400, "請輸入文字或附上截圖")
    tenant = await db.get(Tenant, user.tenant_id)
    return await ChatEngine(db, tenant.name if tenant else "", tenant.settings if tenant else None).handle(user.tenant_id, chat_id, text, png)
