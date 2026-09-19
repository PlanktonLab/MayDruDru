"""通知（SPEC §8.7）。

分成兩半，中間隔著一張資料表：

1. 狀態機呼叫 `enqueue_status_notification()`，只寫 `notifications` 列（`queued`）
   並排一個背景工作。**不在請求裡送 LINE**——推播失敗不該讓一次核定回 500，
   案件的狀態轉移更不該因此 rollback。
2. worker 執行 `send_notification()`：組訊息、推播、更新那一列的 status。
   失敗重試三次（arq 的退避），三次都失敗就留在 `failed` 並保留錯誤訊息，
   承辦人在後台看得到「這個人沒收到」。

沒有綁定 LINE 的案件也會留一列（`line_user_id` 空著、狀態 `skipped`），
否則後台會誤以為通知都送到了。

對外 webhook（SPEC §10.3）是 P6，這裡只留一個什麼都不做的掛鉤。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Application, ApplicationStatusEvent, CaseVerification, Notification, Scheme

log = logging.getLogger("maydru.notify")

__all__ = [
    "NOTIFY_TRANSITIONS",
    "build_messages",
    "content_key_for",
    "deliver",
    "enqueue_demo_missing_notification",
    "enqueue_status_notification",
    "outbound_webhook_hook",
]

# SPEC §7「通知」那一列：T2 補件、T3 核定、T7 撥款完成、T8 逾期、T9 不通過、T11 註銷。
NOTIFY_TRANSITIONS = frozenset({"T2", "T3", "T7", "T8", "T9", "T11"})


def content_key_for(status: str) -> str:
    """每個狀態在 `contents` 都有一組 `status.{STATUS}.*` 文案（SPEC §7）。"""
    return f"status.{status}.notify_headline"


async def enqueue_status_notification(
    db: AsyncSession,
    application: Application,
    event: ApplicationStatusEvent,
) -> list[Notification]:
    """替這次狀態轉移排一筆推播。不該通知的轉移回空清單。

    已綁定 LINE 的案件，每個綁定各排一筆；還沒綁定的也留一筆（`line_user_id` 空著），
    承辦人才看得到「這個人沒有收到通知」。
    """
    if event.transition_code not in NOTIFY_TRANSITIONS:
        return []

    bound = (
        await db.execute(
            select(CaseVerification.line_user_id).where(CaseVerification.application_id == application.id)
        )
    ).scalars().all()

    payload = {
        "case_no": application.case_no,
        "from_status": event.from_status,
        "to_status": event.to_status,
        "transition_code": event.transition_code,
        "event_id": event.id,
        # 退件推播的「教我準備」要知道是哪一份文件卡住（SPEC §8.4）。
        "document_code": _first_document_code(application),
    }
    rows = [
        Notification(
            tenant_id=application.tenant_id,
            application_id=application.id,
            line_user_id=line_user_id,
            kind="status_changed",
            content_key=content_key_for(event.to_status),
            payload=payload,
            status="queued" if line_user_id else "skipped",
            error="" if line_user_id else "no_linked_line_user",
        )
        for line_user_id in (bound or [""])
    ]
    db.add_all(rows)
    await db.flush()
    for row in rows:
        if row.status == "queued":
            await _enqueue_job(row.id)
    return rows


async def enqueue_demo_missing_notification(
    db: AsyncSession,
    application: Application,
    *,
    document_code: str = "BILLING_STATEMENT",
) -> list[Notification]:
    """排入 Demo 缺件提醒，不改案件狀態。

    收件人沿用已驗證／關注這件案件的 LINE 綁定；因此 Demo 按鈕不會廣播給
    同機關的其他民眾，也不會偽造一筆狀態轉移。
    """
    bound = (
        await db.execute(
            select(CaseVerification.line_user_id).where(CaseVerification.application_id == application.id)
        )
    ).scalars().all()
    payload = {
        "case_no": application.case_no,
        "transition_code": "DEMO_MISSING",
        "document_code": document_code,
    }
    rows = [
        Notification(
            tenant_id=application.tenant_id,
            application_id=application.id,
            line_user_id=line_user_id,
            kind="demo_missing_document",
            content_key="notify.demo_missing",
            payload=payload,
            status="queued" if line_user_id else "skipped",
            error="" if line_user_id else "no_linked_line_user",
        )
        for line_user_id in (bound or [""])
    ]
    db.add_all(rows)
    await db.flush()
    for row in rows:
        if row.status == "queued":
            await _enqueue_job(row.id)
    return rows


def _first_document_code(application: Application) -> str:
    for item in application.supplement_items or []:
        if isinstance(item, dict) and item.get("document_type_code"):
            return str(item["document_type_code"])
    return ""


async def _enqueue_job(notification_id: str) -> None:
    """丟進 arq 佇列。Redis 掛了不該拖垮狀態轉移——記一筆警告就算了，
    那一列還留在 `queued`，補送得回來。"""
    try:
        from ..jobs import enqueue

        await enqueue("send_notification", notification_id)
    except Exception:
        log.warning("排入推播工作失敗，通知 %s 仍在 queued", notification_id, exc_info=True)


# --------------------------------------------------------------- 實際送出

async def build_messages(db: AsyncSession, notification: Notification) -> list[dict[str, Any]]:
    """把一筆通知組成 LINE 訊息。文案與版面都在 `services/line/flex.py`。"""
    from .line import flex

    application = await db.get(Application, notification.application_id or "")
    if application is None:
        return []
    scheme = await db.get(Scheme, application.scheme_id)
    payload = notification.payload or {}
    if notification.kind == "demo_missing_document":
        return await flex.demo_missing_messages(
            db,
            notification.tenant_id,
            application,
            scheme_name=scheme.name if scheme else "",
            document_code=str(payload.get("document_code", "BILLING_STATEMENT")),
        )
    return await flex.notification_messages(
        db,
        notification.tenant_id,
        application,
        transition_code=str(payload.get("transition_code", "")),
        scheme_name=scheme.name if scheme else "",
        document_code=str(payload.get("document_code", "")),
    )


async def deliver(db: AsyncSession, notification_id: str, *, now: datetime | None = None) -> str:
    """送一筆通知，回傳最終狀態。**例外會往外丟**，讓 arq 決定要不要重試。

    已經送過的列直接跳過：重試同一個工作不該讓使用者收到第二次推播。
    """
    from .line.sender import get_sender

    notification = await db.get(Notification, notification_id)
    if notification is None:
        return "missing"
    if notification.status == "sent":
        return "sent"
    if not notification.line_user_id:
        notification.status = "skipped"
        notification.error = "no_linked_line_user"
        await db.commit()
        return "skipped"

    messages = await build_messages(db, notification)
    if not messages:
        notification.status = "failed"
        notification.error = "no_message"
        await db.commit()
        return "failed"

    try:
        await get_sender().push(notification.line_user_id, messages)
    except Exception as e:
        notification.status = "failed"
        notification.error = repr(e)[:2000]
        await db.commit()
        raise

    notification.status = "sent"
    notification.error = ""
    notification.sent_at = now or datetime.now(UTC)
    await db.commit()
    await outbound_webhook_hook(notification)
    return "sent"


async def outbound_webhook_hook(notification: Notification) -> None:
    """SPEC §10.3 的對外 webhook 在 P6。留這個掛鉤，屆時只要填這一個函式。"""
    return None
