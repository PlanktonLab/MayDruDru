"""審核服務（規則引擎、判定、人工覆寫）。

P0 佔位：實作在 P3（SPEC §16）。

此模組是 CLAUDE.md 規則 3 的受管對象——**永遠不得 import `app.ai`**。
審核結果必須是決定性的、可重現、可稽核；證明文件也永遠不送 LLM（SPEC §11）。
import-linter 契約 `review 與 apply 不得 import app.ai` 會在 CI 強制這件事。
"""

from __future__ import annotations

__all__: list[str] = []
