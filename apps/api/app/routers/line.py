"""LINE webhook（SPEC §8.4 / §10.4）。

薄殼一如其他 router：驗簽、立刻回 200、把事件丟到背景。LINE 只等幾秒，
任何在請求裡做的事（讀方案、組 Flex、推播）都可能讓它判定逾時並重送同一批事件。

每個事件一個資料庫 session：一個事件處理失敗不該把同一批的其他事件一起 rollback。
失敗時盡力回一句「系統忙碌」，再失敗就算了——回覆 token 只能用一次。

另外提供 `POST /__test__/line/inbound`：同步跑完 handler 並把 Noop sender 收到的
訊息交出來，給 SPEC §14 的 E2E 劇本用。只在非 production 且 `LINE_SENDER=noop`
時才掛上去，正式站上這個路徑根本不存在。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db, sessionmaker
from ..models import Tenant
from ..services import contents
from ..services.line import handlers, sender, signature

log = logging.getLogger("maydru.line.webhook")

router = APIRouter(tags=["line"])


async def _default_tenant_id(db: AsyncSession) -> str:
    """LINE channel 目前一個部署對一個機關；取第一個 tenant。

    多機關共用一個 channel 要靠 destination 對照，屆時改這一個函式就好。
    """
    return (await db.execute(select(Tenant.id).order_by(Tenant.created_at))).scalars().first() or ""


@router.post("/line/webhook")
async def webhook(
    request: Request,
    background: BackgroundTasks,
    x_line_signature: str | None = Header(default=None, alias="X-Line-Signature"),
) -> dict[str, Any]:
    """驗簽後立刻回 200，事件在背景處理。"""
    body = await request.body()
    s = get_settings()
    if not signature.verify(body, x_line_signature, s.line_channel_secret):
        raise HTTPException(401, "簽章驗證失敗")

    events = _parse(body).get("events") or []
    for event in events:
        background.add_task(dispatch, event)
    return {"ok": True, "received": len(events)}


def _parse(body: bytes) -> dict[str, Any]:
    """驗簽過的 body 才會走到這裡，所以壞掉的 JSON 是 LINE 端的問題，回 400。"""
    try:
        return dict(json.loads(body or b"{}"))
    except (TypeError, ValueError):
        raise HTTPException(400, "內容不是合法的 JSON")


async def dispatch(event: dict[str, Any]) -> None:
    """處理單一事件並送出回覆。自己開 session、自己 commit。"""
    reply_token = event.get("replyToken", "")
    try:
        async with sessionmaker()() as db:
            tenant_id = await _default_tenant_id(db)
            messages = await handlers.build_event_reply(db, tenant_id, event)
            await db.commit()
        if messages and reply_token:
            await sender.get_sender().reply(reply_token, messages)
    except Exception:
        log.exception("LINE 事件處理失敗：%s", event.get("type"))
        await _best_effort_error(reply_token)


async def _best_effort_error(reply_token: str) -> None:
    if not reply_token:
        return
    try:
        async with sessionmaker()() as db:
            tenant_id = await _default_tenant_id(db)
            text = await contents.t(db, tenant_id, "error.system_busy")
        await sender.get_sender().reply(reply_token, [{"type": "text", "text": text}])
    except Exception:
        log.warning("連錯誤回覆都送不出去", exc_info=True)


# ------------------------------------------------------- 測試用同步端點

def test_endpoint_enabled() -> bool:
    s = get_settings()
    return not s.is_production and s.line_sender != "line"


@router.post("/__test__/line/inbound")
async def test_inbound(request: Request, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """同步跑一個 LINE 事件並回傳 bot 會送出的訊息（SPEC §14 的 E2E 用）。

    只在非 production 且 sender 為 noop 時可用；其餘情況一律 404，
    連「這個端點存在但你不能用」都不透露。
    """
    if not test_endpoint_enabled():
        raise HTTPException(404, "Not Found")
    payload = await request.json()
    event = payload.get("event") or payload
    tenant_id = payload.get("tenant_id") or await _default_tenant_id(db)
    messages = await handlers.build_event_reply(db, tenant_id, event)
    await db.commit()
    active = sender.get_sender()
    if isinstance(active, sender.NoopLineSender) and messages and event.get("replyToken"):
        await active.reply(event["replyToken"], messages)
    return {"messages": messages}
