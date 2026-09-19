"""Outward-facing API (SPEC §8). Authenticated with X-API-Key. Citizen
screenshots are read into memory, handed to the engine, and dropped.

Three layers, pick what fits the channel:

* **Chat API** (`/v1/chat`): the tool-calling 虛擬客服. One endpoint in, a
  list of plain messages out (`text`, `image`, `choices`) — a LINE bot or a
  web widget only has to draw those three.
* **Session API** (`/v1/sessions`): the deterministic engine with typed
  responses (step / clarification / escalation / completed) for channels
  that want to drive the flow themselves.
* **Building blocks** (`/v1/locate`, `/v1/intent`, `/v1/flows/{id}/steps`,
  `/v1/catalog/*`): stateless functions for anyone composing their own
  behaviour — the same functions the two engines use.

SPEC §8.5 groups all of it under one prefix: every endpoint below is also
mounted at `/v1/sop/…` (see `_SOP_ALIASES` at the bottom). The flat paths stay
as aliases for one version so existing integrations keep working; new callers
should use `/v1/sop/*`. The SOP read paths share `services/sop_public.py` with
the anonymous `/api/sop/*` router — one door per audience, one implementation.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..ai.assistant import ChatEngine
from ..ai.image_utils import ImageTooLarge, InvalidImage, read_image_upload
from ..ai.session_graph import SessionEngine
from ..db import get_db
from ..deps import ApiCaller, api_caller
from ..models import Tenant
from ..security import hash_external_user
from ..services import sop_public
from ..services.content import card_preview_url, card_url, load_snapshot, tenant_catalog
from ..services.guide import resolve_intent

router = APIRouter(prefix="/v1", tags=["public"])


class SessionCreate(BaseModel):
    external_user_id: str
    hint: str | None = None
    known_context: dict[str, Any] | None = None
    theme: Literal["light", "dark"] = "light"


class MessageIn(BaseModel):
    text: str


class SessionAction(BaseModel):
    action: Literal["next", "prev", "choose_branch", "choose_option", "restart"]
    edge_id: str | None = None
    option_id: str | None = None


async def _read_png(file: UploadFile) -> bytes:
    try:
        return await read_image_upload(file)
    except ImageTooLarge:
        raise errors.ApiError(413, errors.IMAGE_TOO_LARGE, "圖片過大")
    except InvalidImage:
        raise errors.ApiError(400, errors.IMAGE_INVALID, "無法讀取圖片")


# ---- chat (stateful, the 虛擬客服)

class ChatCreate(BaseModel):
    external_user_id: str
    theme: Literal["light", "dark"] = "light"
    # per-conversation overrides of the tenant policy: language, delivery,
    # on_off_flow, …, templates — see services.policy.DEFAULTS for the keys
    policy: dict[str, Any] | None = None


async def _chat_engine(db: AsyncSession, tenant_id: str) -> ChatEngine:
    tenant = await db.get(Tenant, tenant_id)
    return ChatEngine(db, tenant.name if tenant else "", tenant.settings if tenant else None)


@router.post("/chat")
async def create_chat(body: ChatCreate, caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    """Opens a chat and returns the greeting. Messages come back as
    `{kind: text|image|choices, …}`; `choices` carries `text` (the question)
    and `options[].label` — send the chosen label back as a text message."""
    engine = await _chat_engine(db, caller.tenant_id)
    state, hello = await engine.start(caller.tenant_id, source="api", theme=body.theme, policy=body.policy,
                                      external_user_hash=hash_external_user(caller.tenant_id, body.external_user_id))
    return {"chat_id": state.chat_id, "messages": [{"kind": "text", "text": hello}]}


@router.post("/chat/{chat_id}/messages")
async def chat_message(chat_id: str, text: str | None = Form(None), file: UploadFile | None = File(None),
                       caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    """One turn: text, a screenshot, or both (multipart). Every picture gets
    an answer — a located step and the cards from there, a question with
    options, or a request for a better picture."""
    png = await _read_png(file) if file is not None and file.filename else None
    if not (text or "").strip() and png is None:
        raise errors.ApiError(400, errors.INVALID_ACTION, "請提供 text 或 file")
    engine = await _chat_engine(db, caller.tenant_id)
    out = await engine.handle(caller.tenant_id, chat_id, text, png)
    out.pop("_debug", None)
    return out


@router.get("/chat/{chat_id}")
async def chat_status(chat_id: str, caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    return await ChatEngine(db).status(caller.tenant_id, chat_id)


# ---- building blocks (stateless)

@router.post("/locate")
async def locate_screenshot(file: UploadFile, platform_id: str | None = Form(None), flow_id: str | None = Form(None),
                            step_id: str | None = Form(None), goal_id: str | None = Form(None),
                            caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    """Where is this screenshot? Returns the outcome (located / ambiguous /
    off_flow / unknown_platform / not_app_screen / not_a_screenshot /
    unreadable), the best step with confidence, the candidates, and a
    `guidance` block saying what to do next (steps to send, question to ask).
    `platform_id` is a hard filter; `flow_id`/`step_id`/`goal_id` describe
    where the citizen was, which the ranking favours."""
    png = await _read_png(file)
    return await sop_public.locate(db, caller.tenant_id, png, platform_id=platform_id, flow_id=flow_id,
                                   step_id=step_id, goal_id=goal_id, session_id=f"api:{caller.api_key_id}")


class IntentIn(BaseModel):
    text: str
    known_context: dict[str, Any] | None = None


@router.post("/intent")
async def parse_intent(body: IntentIn, caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    """The citizen's words → platform, goal and the published flow that
    delivers it; `needs` lists what is still missing (platform / channel /
    goal / flow) so the caller can ask."""
    out = await resolve_intent(db, caller.tenant_id, body.text, body.known_context, ref_id=f"api:{caller.api_key_id}")
    return out.public()


@router.get("/flows/{flow_id}/steps")
async def flow_steps(flow_id: str, goal_id: str | None = None, from_step_id: str | None = None,
                     theme: Literal["light", "dark"] = "light", number_from: int = 1,
                     caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    """The steps of a published flow toward one goal, and the messages a
    channel sends for them (one numbered card per step). `from_step_id`
    starts partway (after a screenshot located the citizen)."""
    return await sop_public.flow_steps(db, caller.tenant_id, flow_id, goal_id=goal_id,
                                       from_step_id=from_step_id, theme=theme, number_from=number_from)


@router.post("/sessions")
async def create_session(body: SessionCreate, caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    engine = SessionEngine(db)
    return await engine.start(caller.tenant_id, hash_external_user(caller.tenant_id, body.external_user_id), hint=body.hint,
                              known_context=body.known_context, theme=body.theme, source="api")


@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: str, body: MessageIn, caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    return await SessionEngine(db).handle(caller.tenant_id, session_id, {"kind": "text", "text": body.text})


@router.post("/sessions/{session_id}/screenshots")
async def send_screenshot(session_id: str, file: UploadFile, caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    png = await _read_png(file)
    return await SessionEngine(db).handle(caller.tenant_id, session_id, {"kind": "screenshot"}, screenshot=png)


@router.post("/sessions/{session_id}/actions")
async def send_action(session_id: str, body: SessionAction, caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    return await SessionEngine(db).handle(caller.tenant_id, session_id, {"kind": "action", **body.model_dump()})


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    return await SessionEngine(db).status(caller.tenant_id, session_id)


# ---- catalog (stateless)

@router.get("/catalog/platforms")
async def catalog_platforms(caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    p, _, _ = await tenant_catalog(db, caller.tenant_id)
    return [x for x in p if x["has_flows"]]


@router.get("/catalog/goals")
async def catalog_goals(caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    _, g, _ = await tenant_catalog(db, caller.tenant_id)
    return [x for x in g if x["has_flows"]]


@router.get("/catalog/flows")
async def catalog_flows(caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    _, _, f = await tenant_catalog(db, caller.tenant_id)
    return f


@router.get("/catalog/flows/{flow_id}/cards")
async def catalog_cards(flow_id: str, caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    loaded = await load_snapshot(db, caller.tenant_id, flow_id, "published")
    if not loaded:
        raise errors.ApiError(404, errors.FLOW_NOT_PUBLISHED, "flow 不存在或未發布")
    snap, _ = loaded
    return {"flow": snap["flow"], "version": snap.get("version"), "edges": snap["edges"],
            "steps": [{"id": s["id"], "title": s["title"], "instruction": s["instruction"], "is_start": s["is_start"], "is_end": s["is_end"],
                       "cards": {t: {"image_url": card_url(v), "preview_url": card_preview_url(v), "width": v["width"], "height": v["height"]}
                                 for t, v in s["variants"].items()}} for s in snap["steps"]]}


@router.get("/document-types/{code}/flows")
async def document_type_flows(code: str, platform_id: str | None = None, scheme: str = "", rejection_code: str = "",
                              caller: ApiCaller = Depends(api_caller), db: AsyncSession = Depends(get_db)):
    """The published flows that teach how to obtain one document type
    (SPEC §8.5). With `scheme` + `rejection_code` the clerk's picks on that
    rejection code win; the document type's own mapping is the fallback."""
    return await sop_public.document_type_flows(db, caller.tenant_id, code, platform_id=platform_id,
                                                scheme_code=scheme, rejection_code=rejection_code)


# ---- /v1/sop/* (SPEC §8.5 / §10.1)
#
# One prefix for everything SOP. The flat paths above stay mounted for one
# version as aliases (決策 D28) so a channel that already integrated keeps
# working; both spellings reach the same function, so they can never drift.

_SOP_ALIASES: tuple[tuple[str, str, Any], ...] = (
    ("POST", "/sop/chat", create_chat),
    ("POST", "/sop/chat/{chat_id}/messages", chat_message),
    ("GET", "/sop/chat/{chat_id}", chat_status),
    ("POST", "/sop/locate", locate_screenshot),
    ("POST", "/sop/intent", parse_intent),
    ("GET", "/sop/flows/{flow_id}/steps", flow_steps),
    ("POST", "/sop/sessions", create_session),
    ("POST", "/sop/sessions/{session_id}/messages", send_message),
    ("POST", "/sop/sessions/{session_id}/screenshots", send_screenshot),
    ("POST", "/sop/sessions/{session_id}/actions", send_action),
    ("GET", "/sop/sessions/{session_id}", get_session),
    ("GET", "/sop/catalog/platforms", catalog_platforms),
    ("GET", "/sop/catalog/goals", catalog_goals),
    ("GET", "/sop/catalog/flows", catalog_flows),
    ("GET", "/sop/catalog/flows/{flow_id}/cards", catalog_cards),
    ("GET", "/sop/document-types/{code}/flows", document_type_flows),
)

for _method, _path, _fn in _SOP_ALIASES:
    router.add_api_route(_path, _fn, methods=[_method], name=f"sop_{_fn.__name__}")
