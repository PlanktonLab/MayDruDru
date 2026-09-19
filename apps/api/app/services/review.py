"""審核服務（規則引擎、判定、人工覆寫）。

P1 只定下與狀態機之間的介面；四種 rule_type 的實作在 P3（SPEC §8.3 / §16）。

此模組是 CLAUDE.md 規則 3 的受管對象——**永遠不得 import `app.ai`**。
審核結果必須是決定性的、可重現、可稽核；證明文件也永遠不送 LLM（SPEC §11）。
import-linter 契約 `review 與 apply 不得 import app.ai` 會在 CI 強制這件事。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from inspect import isawaitable
from typing import Any

__all__ = [
    "FINDING_STATUSES",
    "Finding",
    "approval_blockers",
    "no_blockers",
    "reset_approval_blockers",
    "set_approval_blockers",
]

# `review_findings.status` 的值域，與 models.application.FINDING_STATUSES 同一組。
FINDING_STATUSES = ("PENDING", "MATCH", "MISMATCH", "UNREADABLE")


@dataclass(frozen=True)
class Finding:
    """一條規則對一份文件的判定結果。

    P3 的規則引擎產出這個；承辦人覆寫時另外產一個 `source="reviewer"` 的，取最新。
    `bbox` 是文件上的相對座標（0–1），purge 時會被清空（SPEC §7）。
    """

    rule_code: str
    status: str = "PENDING"
    document_type_code: str = ""
    document_id: str | None = None
    extracted_value: str = ""
    expected_value: str = ""
    confidence: float = 0.0
    bbox: dict[str, float] | None = None
    source: str = "auto"
    note: str = ""
    required: bool = True


BlockersHook = Callable[[Any], "list[str] | Awaitable[list[str]]"]


async def no_blockers(application: Any) -> list[str]:
    """P1 的預設：沒有任何阻擋。P3 會換成「所有 required 規則的最新判定都是 MATCH」。"""
    return []


_hook: BlockersHook = no_blockers


def set_approval_blockers(hook: BlockersHook) -> None:
    """換掉核准前置條件的判斷。P3 在啟動時裝上真的規則引擎；測試用它模擬有缺失的案件。"""
    global _hook
    _hook = hook


def reset_approval_blockers() -> None:
    global _hook
    _hook = no_blockers


async def approval_blockers(application: Any) -> list[str]:
    """核准（T3）前置條件：回傳一串「還不能核准的理由」，空的才准過。

    伺服器端強制（SPEC §8.3）——前端顯示什麼都不算數。回傳的字串是給承辦人看的。
    """
    result = _hook(application)
    if isawaitable(result):
        return list(await result)
    return list(result)  # type: ignore[arg-type]
