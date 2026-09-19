"""LINE channel（SPEC §8.4）。

這個套件是 youth-line-bot 的 TypeScript bot 移植到 Python 的結果，分工如下：

- `signature` 驗簽（憑證缺失即拒絕）
- `sender` 送訊息（真的 Messaging API / 測試用 Noop）
- `theme` 顏色
- `flex` 訊息組裝（文字一律從 `services/contents` 來）
- `richmenu` 圖文選單的版面、圖檔檢查與同步
- `conversation` 對話狀態（含 30 分鐘逾時）
- `sop` SOP 教學對話（`sop_session`，接 `ai/session_graph.py` 的引擎）
- `handlers` 事件路由（follow / postback / text / image）

**這個套件裡不得出現任何給市民看的中文字串**（CLAUDE.md 規則 4）；
所有文案都以 content key 取得，測試會逐一檢查字串常數。
"""

from __future__ import annotations

__all__ = ["conversation", "flex", "handlers", "richmenu", "sender", "signature", "sop", "theme"]
