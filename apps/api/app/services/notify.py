"""通知（SPEC §8.7）。

P1 只把「該通知了」這件事排進 `notifications`，狀態 `queued`；真正的 LINE 推播、
文案渲染與重試在 P2。狀態機呼叫 `enqueue_status_notification()`，之後換成真的
sender 時，狀態機那一行完全不用動。

文案只用 content key，不在這裡組任何中文句子（CLAUDE.md 規則 4）。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Application, ApplicationStatusEvent, CaseVerification, Notification

__all__ = ["NOTIFY_TRANSITIONS", "content_key_for", "enqueue_status_notification"]

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
    }
    rows = [
        Notification(
            tenant_id=application.tenant_id,
            application_id=application.id,
            line_user_id=line_user_id,
            kind="status_changed",
            content_key=content_key_for(event.to_status),
            payload=payload,
            status="queued",
        )
        for line_user_id in (bound or [""])
    ]
    db.add_all(rows)
    return rows
