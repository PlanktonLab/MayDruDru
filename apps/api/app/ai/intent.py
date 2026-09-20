"""意圖分類（SPEC §9.1、§9.7）。

兩層，永遠是兩層：

1. **LLM**（`classify()`）——把候選集合交給模型，讓它挑一個。候選是 postback action
   的標籤、FAQ 標題（向量檢索的 top-k）、以及 SOP 對話裡的四個動作。模型只能**挑**，
   不產生任何給市民的字（紅線 1）。
2. **規則**（`classify_rules()` / `classify_session_rules()`）——關鍵字比對加上案號／
   手機的抽取，完全不碰網路。

第 2 層不是舊版的遺跡，是 SPEC §9「紅線 6」的硬要求：模型逾時、出錯或信心不足時，
系統仍然要回得出東西。兩層都認不出來時 handler 會改回快速回覆選單（`home.unknown`），
**永不因為 LLM 掛掉而沉默**。

LINE 的逾時上限另外設（`LINE_INTENT_TIMEOUT_SECONDS`，預設 8 秒）：LINE 平台只等
幾秒就判定逾時並重送整批事件，用跑圖片分析那種三分鐘的上限等於保證重送。

規則表移植自 youth-line-bot `src/services/intentService.ts`，關鍵字原樣保留，
只把兩個意圖改名對上新的 action：`SUBSIDY_INFO` → `SCHEME_INFO`（補助改叫方案）、
`ELIGIBILITY_CHECK` → `SOP_START`（六題資格問卷改成 SOP 文件選擇器，決策 D20）。

輸出的 `intent` 就是 postback action 的名字，handler 那一側因此不需要第二張對照表。
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..services import faq as faq_service
from .llm import dumps, embed, structured_call
from .prompts import INTENT_CLASSIFY_SYSTEM
from .schemas import IntentClassification

log = logging.getLogger("maydru.ai.intent")

__all__ = [
    "FAQ_INTENT",
    "INTENTS",
    "RULES",
    "SESSION_INTENTS",
    "SESSION_RULES",
    "IntentCandidate",
    "IntentDecision",
    "IntentResult",
    "classify",
    "classify_rules",
    "classify_session_rules",
    "extract_entities",
    "faq_candidates",
]

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
_PHONE_SEPARATORS = re.compile(r"[\s()\-]")


def normalize_case_phone(value: str) -> str | None:
    """案件驗證接受罐頭訊息要求的完整手機，也保留只輸入末四碼的快速路徑。

    LINE 使用者常直接貼 `0912-345-678` 或 `+886 912 345 678`；驗證服務本來就只
    比對末四碼的加鹽 hash，因此這裡只負責先確認輸入確實是臺灣手機格式，再取末四碼。
    """
    compact = _PHONE_SEPARATORS.sub("", (value or "").strip())
    if re.fullmatch(r"\d{4}", compact):
        return compact
    if re.fullmatch(r"09\d{8}", compact) or re.fullmatch(r"\+?8869\d{8}", compact):
        return compact[-4:]
    return None

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


# ------------------------------------------------------------ SOP 對話的意圖

# `sop_session` 裡使用者只有四件事可做，名字與 postback action 一致（同一張表）。
SESSION_INTENTS: tuple[str, ...] = ("sop_next", "sop_stuck", "sop_switch", "sop_exit")

SESSION_RULES: tuple[tuple[str, int, tuple[str, ...]], ...] = (
    ("sop_exit", 5, ("結束", "離開", "不用了", "先這樣", "取消", "停", "exit", "quit", "回主選單")),
    ("sop_stuck", 4, ("卡住", "不會", "找不到", "看不到", "沒有這個", "怎麼辦", "不懂", "看不懂",
                      "不一樣", "沒看到", "help", "求助", "幫我看")),
    ("sop_switch", 4, ("換流程", "換一個", "換平台", "換別的", "其他文件", "另一份", "改成", "換 app", "換成")),
    # 刻意不收單字「好」：「天氣真好」也會中，一句閒聊就把人往下一步推。
    ("sop_next", 3, ("下一步", "下一張", "下一", "繼續", "然後呢", "接下來", "好了", "完成了", "做好了",
                     "ok", "next", "了解")),
)


def classify_session_rules(text: str) -> IntentResult:
    """SOP 對話裡的關鍵字分類。四個意圖以外一律 unknown，由 handler 決定怎麼接。"""
    raw = (text or "").strip()
    if not raw:
        return IntentResult("unknown", 0.0, {}, "fallback")
    lowered = raw.lower()
    best_intent, best_score = "", 0.0
    for intent, weight, keywords in SESSION_RULES:
        for keyword in keywords:
            if keyword.lower() not in lowered:
                continue
            s = weight + len(keyword) / 10
            if s > best_score:
                best_intent, best_score = intent, s
    if best_intent:
        return IntentResult(best_intent, min(best_score / _MAX_SCORE, 1.0), {}, "rule")
    return IntentResult("unknown", 0.0, {}, "fallback")


# ------------------------------------------------------------------ 候選與決定

#: FAQ 命中用的意圖名。handler 看到它就去把 `target_id` 那一則的答案唸出來。
FAQ_INTENT = "faq_answer"
FAQ_TOP_K = 5


@dataclass(frozen=True)
class IntentCandidate:
    """模型能挑的一個選項。`label` 是民眾看得到的字（按鈕文字、FAQ 標題）。"""

    intent: str
    label: str
    target_id: str = ""
    hint: str = ""

    def public(self) -> dict[str, str]:
        out = {"intent": self.intent, "label": self.label}
        if self.target_id:
            out["target_id"] = self.target_id
        if self.hint:
            out["hint"] = self.hint
        return out


@dataclass(frozen=True)
class IntentDecision:
    """一次分類的結果。`source` 說得出這個答案是誰給的，稽核與除錯都靠它。"""

    intent: str
    target_id: str = ""
    confidence: float = 0.0
    source: str = "rules"  # llm | rules | faq
    entities: dict[str, str] = field(default_factory=dict)

    @property
    def is_unknown(self) -> bool:
        return self.intent in ("", "unknown")

    def dict(self) -> dict[str, object]:
        return {"intent": self.intent, "target_id": self.target_id, "confidence": self.confidence,
                "source": self.source, "entities": dict(self.entities)}


async def faq_candidates(db: AsyncSession, tenant_id: str, text: str, *, limit: int = FAQ_TOP_K) -> list[IntentCandidate]:
    """語意最接近的幾則 FAQ（SPEC §9.7）。

    向量算不出來（沒有金鑰、模型掛了）也不會讓整條路斷掉：`faq.search()` 收到
    空向量就走關鍵字，回傳形狀一樣。
    """
    vector: list[float] | None = None
    try:
        vector = await embed(text)
    except Exception:
        log.warning("FAQ 向量計算失敗，改用關鍵字比對", exc_info=True)
    hits = await faq_service.search(db, tenant_id, text, limit=limit, vector=vector)
    return [IntentCandidate(FAQ_INTENT, hit.faq.question, target_id=hit.faq.id, hint=hit.source) for hit in hits]


async def classify(
    db: AsyncSession,
    tenant_id: str,
    text: str,
    *,
    mode: str = "idle",
    candidates: list[IntentCandidate] | None = None,
    timeout: float | None = None,
    ref_id: str = "",
) -> IntentDecision:
    """一句話 → 一個意圖（SPEC §9.1）。

    `mode` 決定候選集合怎麼補齊與哪一張規則表當 fallback：`idle` 會自己去找
    語意最接近的幾則 FAQ 加進候選；`sop_session` 不找（教學進行中提 FAQ 只會打斷節奏）。

    落回的順序是 LLM → 規則 → FAQ 最佳命中 → unknown，任何一步失敗都只是往下一步走，
    **不會拋例外**（SPEC §9 紅線 6）。
    """
    raw = (text or "").strip()
    entities = extract_entities(raw)
    if not raw:
        return IntentDecision("unknown", source="rules", entities=entities)

    pool = list(candidates or [])
    faqs: list[IntentCandidate] = []
    if mode == "idle":
        try:
            faqs = await faq_candidates(db, tenant_id, raw)
        except Exception:
            log.warning("FAQ 候選查詢失敗", exc_info=True)
        pool.extend(faqs)

    decided = await _llm_decision(raw, pool, tenant_id=tenant_id, mode=mode, timeout=timeout, ref_id=ref_id)
    if decided is not None:
        return IntentDecision(decided[0], decided[1], decided[2], "llm", entities)

    rules = classify_session_rules(raw) if mode == "sop_session" else classify_rules(raw)
    if rules.intent != "unknown":
        return IntentDecision(rules.intent, "", rules.confidence, "rules", entities)

    if faqs:
        return IntentDecision(FAQ_INTENT, faqs[0].target_id, 0.5, "faq", entities)
    return IntentDecision("unknown", source="rules", entities=entities)


async def _llm_decision(
    text: str,
    pool: list[IntentCandidate],
    *,
    tenant_id: str,
    mode: str,
    timeout: float | None,
    ref_id: str,
) -> tuple[str, str, float] | None:
    """模型那一層。逾時、出錯、選了清單外的東西、信心不足——一律回 None。

    回 None 的意思永遠是「這一層沒有答案」，不是「沒有答案」：呼叫端接著走規則。
    """
    if not pool:
        return None
    s = get_settings()
    limit = s.line_intent_timeout_seconds if timeout is None else timeout
    prompt = (
        f"模式：{mode}\n候選清單：{dumps([c.public() for c in pool])}\n民眾文字：{text}"
    )
    try:
        out, _usage = await asyncio.wait_for(
            structured_call("intent", IntentClassification, INTENT_CLASSIFY_SYSTEM, prompt, None,
                            tenant_id=tenant_id, ref_type="line_intent", ref_id=ref_id,
                            fake_context={"candidates": [c.public() for c in pool], "text": text, "mode": mode}),
            timeout=max(0.1, limit),
        )
    except TimeoutError:
        log.warning("意圖分類逾時（%.1fs），改用規則式分類", limit)
        return None
    except Exception:
        log.warning("意圖分類失敗，改用規則式分類", exc_info=True)
        return None

    match = next(
        (c for c in pool if c.intent == out.intent and (not c.target_id or c.target_id == out.target_id)),
        None,
    )
    if match is None or out.confidence < s.intent_confidence_threshold:
        return None
    return match.intent, match.target_id, float(out.confidence)
