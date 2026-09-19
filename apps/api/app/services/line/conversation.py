"""LINE 對話狀態（SPEC §6.4 / §8.4）。

一個使用者一列，開一個新流程就蓋掉舊的——這點沿用 youth-line-bot。
不一樣的是**會過期**：youth 的狀態永遠留著，隔三週回來還停在「請輸入手機末四碼」；
這裡每次寫入都推 30 分鐘的 `expires_at`，讀到過期的列等於沒有狀態，
另外有一個每 5 分鐘的排程把過期列清掉（SPEC §8.4「30 分鐘無互動」）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import LineConversation

__all__ = [
    "DEFAULT_TTL_MINUTES",
    "FLOWS",
    "State",
    "clear",
    "get",
    "set_state",
    "sweep_expired",
]

DEFAULT_TTL_MINUTES = 30

# `idle` 不會寫進資料庫——沒有列就是 idle。
FLOWS = ("idle", "case_verify", "sop_session", "sop_pending")


@dataclass(frozen=True)
class State:
    flow: str = "idle"
    step: str = ""
    data: dict[str, Any] | None = None
    sop_session_id: str | None = None

    @property
    def is_idle(self) -> bool:
        return self.flow == "idle"

    def value(self, key: str, default: Any = None) -> Any:
        return (self.data or {}).get(key, default)


IDLE = State()


async def _row(db: AsyncSession, tenant_id: str, line_user_id: str) -> LineConversation | None:
    return (
        await db.execute(
            select(LineConversation).where(
                LineConversation.tenant_id == tenant_id,
                LineConversation.line_user_id == line_user_id,
            )
        )
    ).scalar_one_or_none()


async def get(db: AsyncSession, tenant_id: str, line_user_id: str, *, now: datetime | None = None) -> State:
    """目前的狀態。過期的列直接當成 idle（列本身留給排程收）。"""
    row = await _row(db, tenant_id, line_user_id)
    if row is None:
        return IDLE
    stamp = now or datetime.now(UTC)
    if row.expires_at is not None and _aware(row.expires_at) <= stamp:
        return IDLE
    return State(flow=row.flow, step=row.step, data=dict(row.data or {}), sop_session_id=row.sop_session_id)


async def set_state(
    db: AsyncSession,
    tenant_id: str,
    line_user_id: str,
    flow: str,
    step: str = "",
    data: dict[str, Any] | None = None,
    *,
    sop_session_id: str | None = None,
    ttl_minutes: int = DEFAULT_TTL_MINUTES,
    now: datetime | None = None,
) -> State:
    """寫入狀態並把逾時往後推。一個人只會有一列。"""
    stamp = now or datetime.now(UTC)
    expires = stamp + timedelta(minutes=ttl_minutes)
    row = await _row(db, tenant_id, line_user_id)
    if row is None:
        row = LineConversation(tenant_id=tenant_id, line_user_id=line_user_id)
        db.add(row)
    row.flow = flow
    row.step = step
    row.data = dict(data or {})
    row.sop_session_id = sop_session_id
    row.expires_at = expires
    await db.flush()
    return State(flow=flow, step=step, data=dict(data or {}), sop_session_id=sop_session_id)


async def clear(db: AsyncSession, tenant_id: str, line_user_id: str) -> None:
    """回到 idle。刪列而不是寫 `flow='idle'`，資料表就只裝「正在進行中的事」。"""
    await db.execute(
        delete(LineConversation).where(
            LineConversation.tenant_id == tenant_id,
            LineConversation.line_user_id == line_user_id,
        )
    )
    await db.flush()


async def sweep_expired(db: AsyncSession, *, now: datetime | None = None) -> int:
    """排程每 5 分鐘一次：刪掉所有過期的對話狀態，回傳刪了幾列。"""
    stamp = now or datetime.now(UTC)
    result = await db.execute(
        delete(LineConversation).where(
            LineConversation.expires_at.is_not(None), LineConversation.expires_at <= stamp
        )
    )
    await db.commit()
    return int(getattr(result, "rowcount", 0) or 0)


def _aware(value: datetime) -> datetime:
    """SQLite 取回來的時間沒有時區；補上 UTC 才能跟 `now()` 比大小。"""
    return value if value.tzinfo else value.replace(tzinfo=UTC)
