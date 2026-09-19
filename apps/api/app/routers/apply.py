"""`/api/apply/*`：市民匿名送件端點（薄殼，邏輯在 `app/services/application.py`）。

P0 佔位：實作在 P3（SPEC §16）。

此模組是 CLAUDE.md 規則 3 的受管對象——**永遠不得 import `app.ai`**。
import-linter 契約 `review 與 apply 不得 import app.ai` 會在 CI 強制這件事。
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/apply", tags=["apply"])
