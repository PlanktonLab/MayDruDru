"""誰在動這筆案件。

狀態機、稽核與通知都需要同一組「行為人」描述，而且不能各自依賴 FastAPI 的
`CurrentUser`（service 不該認識 router 的東西）。`Actor` 是那個共同語彙：
- `SYSTEM`：排程與自動轉移（T1、T5、T8）
- `APPLICANT`：帶案件 token 的市民（T4、T10）
- `STAFF`：後台登入者，`role` 決定他有哪些 capability（D14）
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

__all__ = ["Actor"]


@dataclass(frozen=True)
class Actor:
    type: str                 # APPLICANT | STAFF | SYSTEM
    id: str | None = None
    role: str = ""
    name: str = ""

    @classmethod
    def system(cls, name: str = "system") -> Actor:
        return cls(type="SYSTEM", name=name)

    @classmethod
    def applicant(cls, case_no: str = "") -> Actor:
        return cls(type="APPLICANT", name=case_no)

    @classmethod
    def staff(cls, user: Any) -> Actor:
        """接受任何有 `id` / `role` / `name` 的物件（`deps.CurrentUser`、`models.User`）。"""
        return cls(
            type="STAFF",
            id=getattr(user, "id", None),
            role=getattr(user, "role", "") or "",
            name=getattr(user, "name", "") or getattr(user, "email", "") or "",
        )
