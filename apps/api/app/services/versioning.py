"""可編輯設定表的樂觀鎖（SPEC §6）。

呼叫端載入資料時拿到 `version`，寫回時把它一起送上來：對不上就是有人在這中間改過，
回 409 要求重新載入。送 `None` 等於明確放棄檢查（搬遷腳本、seed、系統工作）。

youth-line-bot 的版本是「檢查」與「遞增」兩句沒有交易包著的 SQL，兩個人同時存檔會
雙雙通過。這裡的 `check_version` 與 `bump` 都在呼叫端的交易內，寫入跟遞增一起 commit。
"""

from __future__ import annotations

from typing import Any, Protocol

from fastapi import HTTPException

__all__ = ["VERSION_CONFLICT_MESSAGE", "VersionConflict", "Versioned", "bump", "check_version"]

VERSION_CONFLICT_MESSAGE = "這筆資料已被其他人更新，請重新載入最新版本後再編輯"


class Versioned(Protocol):
    version: int


class VersionConflict(HTTPException):
    def __init__(self, current: int, expected: int) -> None:
        super().__init__(409, VERSION_CONFLICT_MESSAGE)
        self.current = current
        self.expected = expected


def check_version(obj: Any, expected: int | None) -> None:
    """`expected is None` 代表呼叫端放棄樂觀鎖；否則版本不符就 409。"""
    if expected is None:
        return
    current = int(getattr(obj, "version", 1) or 1)
    if current != expected:
        raise VersionConflict(current, expected)


def bump(obj: Any) -> int:
    """寫入後把版本推進一格，回傳新版本。"""
    nxt = int(getattr(obj, "version", 1) or 1) + 1
    obj.version = nxt
    return nxt
