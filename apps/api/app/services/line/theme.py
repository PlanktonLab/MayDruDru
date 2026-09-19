"""LINE 訊息的顏色（youth-line-bot `src/line/theme.ts` 的移植）。

規則照搬：整個服務只有一個品牌色系，功能用圖示與標題分辨而不是用顏色；
沒有漸層；狀態色只能染一個小指示點或一行狀態字，不能染整張卡或整個標題列。
要換品牌只需要改這裡。
"""

from __future__ import annotations

from typing import Final

PRIMARY: Final = "#5B8AC4"            # 標題列、主要按鈕、目前所在的時間軸節點
PRIMARY_LIGHT: Final = "#E8EFF7"      # 區塊底色、安靜的標籤
PRIMARY_SOFT: Final = "#8FAFD4"       # 已完成的節點：還是藍的，但是「做完了」的藍
BACKGROUND: Final = "#F4F7FA"
CARD: Final = "#FFFFFF"
TEXT: Final = "#333B45"
TEXT_SECONDARY: Final = "#6B7A8C"
TEXT_MUTED: Final = "#9AA7B5"         # 提示、時間、還沒走到的節點
BORDER: Final = "#DCE4EC"
ON_PRIMARY: Final = "#FFFFFF"
ON_PRIMARY_MUTED: Final = "#FFFFFFCC"

# 狀態色。只染小指示器。
SUCCESS: Final = "#4E9E7E"
INFO: Final = "#5B8AC4"               # 「審核中」刻意就是品牌藍，看起來才冷靜
WARNING: Final = "#D9954A"            # 需要民眾動手（待補件、期限將至）
ERROR: Final = "#C0665E"

COLORS: Final[dict[str, str]] = {
    "primary": PRIMARY,
    "primary_light": PRIMARY_LIGHT,
    "primary_soft": PRIMARY_SOFT,
    "background": BACKGROUND,
    "card": CARD,
    "text": TEXT,
    "text_secondary": TEXT_SECONDARY,
    "text_muted": TEXT_MUTED,
    "border": BORDER,
    "on_primary": ON_PRIMARY,
    "on_primary_muted": ON_PRIMARY_MUTED,
    "success": SUCCESS,
    "info": INFO,
    "warning": WARNING,
    "error": ERROR,
}
