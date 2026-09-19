"""意圖分類（SPEC §9.1）。

這一版**只有規則**：關鍵字比對加上案號／手機的抽取，完全不呼叫模型。P4 會在前面
加一層 LLM 分類器，但 `classify_rules()` 會留著當 fallback——SPEC §9「紅線 6」要求
模型逾時或低信心時系統仍然要回得出東西，永遠不因為 LLM 掛掉而沉默。

規則表移植自 youth-line-bot `src/services/intentService.ts`，關鍵字原樣保留，
只把兩個意圖改名對上新的 action：`SUBSIDY_INFO` → `SCHEME_INFO`（補助改叫方案）、
`ELIGIBILITY_CHECK` → `SOP_START`（六題資格問卷改成 SOP 文件選擇器，決策 D20）。

輸出的 `intent` 就是 postback action 的名字，handler 那一側因此不需要第二張對照表。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

__all__ = ["INTENTS", "RULES", "IntentResult", "classify_rules", "extract_entities"]

INTENTS = (
    "case_status",
    "my_cases",
    "faq",
    "scheme_info",
    "sop_start",
    "checklist",
    "contact",
    "security_check",
    "greeting",
    "help",
    "cancel",
    "unknown",
)


@dataclass(frozen=True)
class IntentResult:
    intent: str
    confidence: float = 0.0
    entities: dict[str, str] = field(default_factory=dict)
    matched_by: str = "fallback"   # rule | fallback

    def dict(self) -> dict[str, object]:
        return {
            "intent": self.intent,
            "confidence": self.confidence,
            "entities": dict(self.entities),
            "matched_by": self.matched_by,
        }


# (intent, weight, keywords)。命中任一關鍵字就算，分數最高的那一次命中獲勝。
RULES: tuple[tuple[str, int, tuple[str, ...]], ...] = (
    (
        "case_status", 3,
        ("案件進度", "查進度", "進度", "案件查詢", "查案件", "我的案件到哪", "審查到哪", "案件狀態",
         "到哪了", "審核進度", "申請進度", "查詢案件", "案件編號"),
    ),
    ("my_cases", 3, ("我的案件", "我的申請", "我有哪些案件", "已驗證", "我的紀錄", "我的補助案件")),
    (
        "checklist", 3,
        ("需要什麼文件", "準備文件", "文件清單", "要帶什麼", "應備文件", "checklist", "檢查清單", "要準備"),
    ),
    (
        "sop_start", 3,
        ("資格檢查", "我符合", "符合資格", "我可以申請", "找補助", "推薦補助", "適合我", "哪些補助", "我能申請",
         "申請小幫手", "我想申請", "我要申請", "怎麼申請", "如何申請", "申請流程", "怎麼準備", "教我"),
    ),
    (
        "scheme_info", 2,
        ("補助資訊", "有什麼補助", "補助有哪些", "查補助", "我要查補助", "看補助", "瀏覽補助",
         "創業補助", "就業補助", "租金補貼", "青年補助", "補助說明", "補助介紹", "補助項目", "方案資訊"),
    ),
    ("contact", 3, ("聯絡", "客服", "電話", "承辦", "怎麼找你們", "聯繫", "窗口", "地址")),
    ("security_check", 3, ("詐騙", "可疑", "假訊息", "這是真的嗎", "簡訊詐騙", "釣魚", "可疑網址")),
    ("greeting", 1, ("你好", "哈囉", "hi", "hello", "嗨", "在嗎")),
    ("help", 2, ("help", "幫助", "怎麼用", "功能", "選單", "說明")),
    ("cancel", 5, ("取消", "重來", "結束", "離開", "返回", "cancel", "回主選單")),
)

# 新制案號 `HC-2026-000123`；舊系統的 8 位數字沿用（決策 D13）。
CASE_NO_PATTERN = re.compile(r"\b([A-Z]{2}-\d{4}-\d{6}|\d{8})\b", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"\b(09\d{8}|8869\d{8}|\+886-?9\d{8})\b")
# 送件完成頁的 LINE deep link：`?case=HC-2026-000123` 或直接貼 `case=HC-…`。
DEEP_LINK_PATTERN = re.compile(r"case=([A-Za-z]{2}-\d{4}-\d{6}|\d{8})", re.IGNORECASE)
LAST4_PATTERN = re.compile(r"^\s*(\d{4})\s*$")

_MAX_SCORE = 6.0


def extract_entities(text: str) -> dict[str, str]:
    """先抓手機再抓案號：手機本身也有 8 位數字，不先拿掉會被誤讀成案號。"""
    entities: dict[str, str] = {}
    deep = DEEP_LINK_PATTERN.search(text)
    if deep:
        entities["case_no"] = deep.group(1).upper()
        entities["deep_link"] = "1"
        return entities
    phone = PHONE_PATTERN.search(text)
    remainder = text
    if phone:
        entities["phone"] = phone.group(1)
        remainder = text.replace(phone.group(1), " ")
    case_no = CASE_NO_PATTERN.search(remainder)
    if case_no:
        entities["case_no"] = case_no.group(1).upper()
    return entities


def classify_rules(text: str) -> IntentResult:
    """關鍵字分類。空字串與完全沒命中都回 `unknown`，由 handler 決定怎麼接。"""
    raw = (text or "").strip()
    entities = extract_entities(raw)
    if not raw:
        return IntentResult("unknown", 0.0, entities, "fallback")

    lowered = raw.lower()
    best_intent = ""
    best_score = 0.0
    for intent, weight, keywords in RULES:
        for keyword in keywords:
            if keyword.lower() not in lowered:
                continue
            score = weight + len(keyword) / 10
            if score > best_score:
                best_intent, best_score = intent, score

    if best_intent:
        return IntentResult(best_intent, min(best_score / _MAX_SCORE, 1.0), entities, "rule")

    # 只打了一個案號，幾乎都是在問進度。
    if entities.get("case_no") and raw.replace("-", "").isalnum() and " " not in raw:
        return IntentResult("case_status", 0.8, entities, "rule")

    return IntentResult("unknown", 0.0, entities, "fallback")
