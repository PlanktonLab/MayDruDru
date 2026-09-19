"""審核服務：規則引擎、判定、人工覆寫（SPEC §8.3）。

這是**判定的唯一權威**。`packages/review-rules` 的 TypeScript 版只做送件時的即時回饋，
兩版共用 `packages/review-rules/fixtures/*.json`，CI 比對同一輸入的輸出（SPEC §14）。
任何行為調整都要兩邊一起改，並先補一個 fixture。

此模組是 CLAUDE.md 規則 3 的受管對象——**永遠不得 import `app.ai`**。
審核結果必須是決定性的、可重現、可稽核；證明文件也永遠不送 LLM（SPEC §11）。
import-linter 契約 `review 與 apply 不得 import app.ai` 會在 CI 強制這件事。

`note` 是**文案 key**（`review.note.*`）而不是句子：市民看到的字由 contents 層渲染
（CLAUDE.md 規則 4）。TS 版在瀏覽器端直接組中文，兩邊在 fixtures 上仍然一致——
fixtures 只斷言 `note` 為 null 的情形。
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from inspect import isawaitable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_object_session

from ..models import (
    Application,
    ApplicationDocument,
    DocumentOcrResult,
    ReviewFinding,
    ReviewRule,
    Scheme,
)

__all__ = [
    "FINDING_STATUSES",
    "NOTE_AMOUNT_MISMATCH",
    "NOTE_AMOUNT_PENDING",
    "NOTE_AMOUNT_SOURCE_MISSING",
    "NOTE_AMOUNT_UNREADABLE",
    "NOTE_BAD_REGEX",
    "NOTE_FIELD_NOT_FOUND",
    "NOTE_MISSING_DOCUMENTS",
    "NOTE_NO_DOCUMENT",
    "NOTE_NO_TEXT",
    "NOTE_NORMALIZE_FAILED",
    "NOTE_PREFIX",
    "NOTE_UNKNOWN_RULE_TYPE",
    "RULE_TYPES",
    "ApplicationFacts",
    "Finding",
    "OcrDocument",
    "OcrLine",
    "OcrResult",
    "PrecheckResult",
    "RuleSpec",
    "approval_blockers",
    "blockers_for",
    "db_approval_blockers",
    "dry_run",
    "evaluate",
    "evaluate_application",
    "facts_for",
    "install_approval_blockers",
    "latest_findings",
    "latest_ocr_for",
    "no_blockers",
    "normalize_amount",
    "normalize_date",
    "normalize_last4",
    "parse_amount",
    "persist_findings",
    "pick_keyword",
    "precheck",
    "reset_approval_blockers",
    "rule_spec",
    "set_approval_blockers",
    "suggested_supplements",
    "value_after_keyword",
    "verdict_of",
    "within_tolerance",
]

# `review_findings.status` 的值域，與 models.application.FINDING_STATUSES 同一組。
FINDING_STATUSES = ("PENDING", "MATCH", "MISMATCH", "UNREADABLE")
RULE_TYPES = ("keyword_extract", "regex_extract", "amount_tolerance", "required_doc")

# note 的文案 key（SPEC §8.1「錯誤訊息說怎麼修」的字由 contents 提供）。
# 每一個 key 在 `app/content_registry/` 都要有預設值，tests/test_review_note_keys.py 把關。
NOTE_PREFIX = "review.note."
NOTE_NO_DOCUMENT = "review.note.no_document"
NOTE_NO_TEXT = "review.note.no_text"
NOTE_FIELD_NOT_FOUND = "review.note.field_not_found"
NOTE_NORMALIZE_FAILED = "review.note.normalize_failed"
NOTE_BAD_REGEX = "review.note.bad_regex"
NOTE_AMOUNT_SOURCE_MISSING = "review.note.amount_source_missing"
NOTE_AMOUNT_UNREADABLE = "review.note.amount_unreadable"
NOTE_AMOUNT_PENDING = "review.note.amount_pending"
NOTE_AMOUNT_MISMATCH = "review.note.amount_mismatch"
NOTE_MISSING_DOCUMENTS = "review.note.missing_documents"
NOTE_UNKNOWN_RULE_TYPE = "review.note.unknown_rule_type"


# ============================================================ 值的正規化
# 逐條對齊 packages/review-rules/src/normalize.ts。改這裡就要改那裡。

_FULLWIDTH_DIGITS = {0xFF10 + i: str(i) for i in range(10)}
_AMOUNT_KEEP = re.compile(r"[^0-9.\-]")
_INNER_MINUS = re.compile(r"(?!^)-")
_HAS_DIGIT = re.compile(r"\d")

# 依序嘗試的日期樣式；年份 < 1911 一律視為民國年。
_DATE_PATTERNS = (
    re.compile(r"(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日"),  # 民國 115 年 9 月 1 日
    re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})"),                        # ISO
    re.compile(r"(\d{2,4})/(\d{1,2})/(\d{1,2})"),                      # 115/09/01 或 2026/09/01
    re.compile(r"(\d{2,4})\.(\d{1,2})\.(\d{1,2})"),                    # 2026.09.01
    re.compile(r"(\d{4})(\d{2})(\d{2})(?!\d)"),                        # 20260901
)

_MASK_CHARS = r"[•*xX·✱●＊ｘＸ#]"
_MASKED_LAST4 = re.compile(rf"(?:{_MASK_CHARS}){{2,}}\s*(\d{{4}})")
_TRAILING_LAST4 = re.compile(r"(\d{4})$")
_LAST4_STRIP = re.compile(r"[\s–—_-]")


def _number_string(value: float) -> str:
    """JS `String(number)` 的等價寫法：整數不帶 `.0`。"""
    if value == int(value):
        return str(int(value))
    return repr(value)


def normalize_amount(raw: str) -> str | None:
    """金額：去掉幣別符號、千分位、全形字與中文單位後 parse。

    歐式寫法（`1.200,50`，最後一個逗號在最後一個點之後）與多個小數點都視為看不懂，
    回 None 交給人工——寧可 UNREADABLE，也不要把 1,200 讀成 1.2。
    """
    compact = raw.translate(_FULLWIDTH_DIGITS)
    if compact.rfind(",") > compact.rfind(".") and "." in compact:
        return None
    digits = _AMOUNT_KEEP.sub("", compact)
    if not _HAS_DIGIT.search(digits):
        return None
    if digits.count(".") > 1:
        return None
    try:
        value = float(_INNER_MINUS.sub("", digits))
    except ValueError:
        return None
    if value != value or value in (float("inf"), float("-inf")):  # NaN / Infinity
        return None
    return _number_string(value)


def normalize_date(raw: str) -> str | None:
    """日期：民國 / ISO / 斜線 / 點 / 八碼 → `YYYY-MM-DD`。

    一律「年 → 月 → 日」，不支援美式 `MM/DD/YYYY`（台灣的憑證不會這樣印，而且
    無法和民國年區分）。月份或日期不合理就換下一個樣式再試。
    """
    for pattern in _DATE_PATTERNS:
        match = pattern.search(raw)
        if match is None:
            continue
        year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if year < 1911:
            year += 1911
        if month < 1 or month > 12 or day < 1 or day > 31:
            continue
        return f"{year:04d}-{month:02d}-{day:02d}"
    return None


def normalize_last4(raw: str) -> str | None:
    """卡號末四碼：先看遮罩字元後面的四碼，再看字串結尾的四碼，都沒有就 None。"""
    compact = _LAST4_STRIP.sub("", raw)
    masked = _MASKED_LAST4.search(compact)
    if masked is not None:
        return masked.group(1)
    trailing = _TRAILING_LAST4.search(compact)
    if trailing is not None:
        return trailing.group(1)
    return None


NORMALIZERS: dict[str, Callable[[str], str | None]] = {
    "amount": normalize_amount,
    "date": normalize_date,
    "last4": normalize_last4,
}


def apply_normalizer(raw: str, normalizer: str | None = None) -> str | None:
    """沒有指定 normalizer 時，值就是 trim 過的原字串。認不得的名字同樣原樣放行。"""
    value = raw.strip()
    if not normalizer:
        return value
    fn = NORMALIZERS.get(normalizer)
    if fn is None:
        return value
    return fn(value)


def parse_amount(value: str) -> float | None:
    """把 normalize 過的金額字串轉回數字（`amount_tolerance` 用）。"""
    normalized = normalize_amount(value)
    if normalized is None:
        return None
    try:
        return float(normalized)
    except ValueError:
        return None


# ================================================================ 型別

BBox = dict[str, float]


@dataclass(frozen=True)
class OcrLine:
    text: str = ""
    confidence: float | None = None
    bbox: BBox | None = None

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> OcrLine:
        bbox = raw.get("bbox")
        return cls(
            text=str(raw.get("text", "") or ""),
            confidence=_as_number(raw.get("confidence")),
            bbox=dict(bbox) if isinstance(bbox, Mapping) else None,
        )


@dataclass(frozen=True)
class OcrResult:
    text: str = ""
    confidence: float | None = None
    lines: tuple[OcrLine, ...] = ()

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any] | None) -> OcrResult | None:
        if raw is None:
            return None
        lines = raw.get("lines") or []
        return cls(
            text=str(raw.get("text", "") or ""),
            confidence=_as_number(raw.get("confidence")),
            lines=tuple(OcrLine.from_dict(line) for line in lines if isinstance(line, Mapping)),
        )


@dataclass(frozen=True)
class OcrDocument:
    """一份已上傳的文件與它的 OCR 結果。`ocr` 為 None 代表還沒辨識。

    `document_id` 是伺服器端的額外欄位（TS 版沒有），讓 finding 連得回文件列。
    """

    document_type_code: str
    ocr: OcrResult | None = None
    document_id: str | None = None


@dataclass(frozen=True)
class RuleSpec:
    """規則引擎吃的規則。`document_type_code` 為 None＝不限文件類型。"""

    code: str
    label: str = ""
    document_type_code: str | None = None
    rule_type: str = ""
    config: Mapping[str, Any] = field(default_factory=dict)
    required: bool = True
    severity: str = "error"
    sort_order: int = 0
    active: bool = True
    rule_id: str | None = None

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> RuleSpec:
        code = str(raw.get("code", ""))
        doc_type = raw.get("document_type_code")
        return cls(
            code=code,
            label=str(raw.get("label", "") or ""),
            document_type_code=str(doc_type) if doc_type else None,
            rule_type=str(raw.get("rule_type", "") or ""),
            config=dict(raw.get("config") or {}),
            required=bool(raw.get("required", True)),
            severity=str(raw.get("severity", "error") or "error"),
            sort_order=int(raw.get("sort_order", 0) or 0),
            active=bool(raw.get("active", True)),
            rule_id=raw.get("id"),
        )

    def to_public(self) -> dict[str, Any]:
        """`GET /api/apply/schemes/{code}` 與 admin 案件頁用的形狀（同 @maydru/review-rules）。"""
        return {
            "code": self.code,
            "label": self.label,
            "document_type_code": self.document_type_code,
            "rule_type": self.rule_type,
            "config": dict(self.config),
            "required": self.required,
            "severity": self.severity,
            "sort_order": self.sort_order,
            "active": self.active,
        }


@dataclass(frozen=True)
class ApplicationFacts:
    """申請書上的事實。規則引擎只看這些，不碰資料庫。"""

    purchase_amount: float | None = None
    purchase_date: str | None = None
    tier_code: str = ""
    payment_channel_code: str = ""
    paid_by_proxy: bool = False
    required_document_type_codes: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> ApplicationFacts:
        return cls(
            purchase_amount=_as_number(raw.get("purchase_amount")),
            purchase_date=raw.get("purchase_date"),
            tier_code=str(raw.get("tier_code", "") or ""),
            payment_channel_code=str(raw.get("payment_channel_code", "") or ""),
            paid_by_proxy=bool(raw.get("paid_by_proxy", False)),
            required_document_type_codes=tuple(raw.get("required_document_type_codes") or ()),
        )


@dataclass(frozen=True)
class Finding:
    """一條規則對一份文件的判定結果（形狀與 `@maydru/review-rules` 的 Finding 相同）。

    `bbox` 是文件上的像素座標，purge 時會被清空（SPEC §7）。
    `document_id` 是伺服器端的額外欄位，不出現在對外的 JSON 裡。
    """

    rule_code: str
    status: str = "PENDING"
    extracted_value: str | None = None
    expected_value: str | None = None
    confidence: float | None = None
    bbox: BBox | None = None
    document_type_code: str | None = None
    note: str | None = None
    suggested_supplement: tuple[str, ...] | None = None
    document_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_code": self.rule_code,
            "status": self.status,
            "extracted_value": self.extracted_value,
            "expected_value": self.expected_value,
            "confidence": self.confidence,
            "bbox": dict(self.bbox) if self.bbox else None,
            "document_type_code": self.document_type_code,
            "note": self.note,
            "suggested_supplement": list(self.suggested_supplement) if self.suggested_supplement else None,
        }


@dataclass(frozen=True)
class PrecheckResult:
    verdict: str
    blocking: tuple[Finding, ...] = ()
    warnings: tuple[Finding, ...] = ()


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


# ============================================================== 規則引擎
# 逐條對齊 packages/review-rules/src/engine.ts。

@dataclass(frozen=True)
class _Candidate:
    document_type_code: str
    document_id: str | None
    line: OcrLine
    value: str
    score: float


def _documents_for(rule: RuleSpec, documents: Sequence[OcrDocument]) -> list[OcrDocument]:
    """這條規則要看哪些文件：`document_type_code` 為 None 時看全部。"""
    if rule.document_type_code is None:
        return list(documents)
    return [d for d in documents if d.document_type_code == rule.document_type_code]


def _compile(pattern: Any) -> re.Pattern[str] | None:
    if not pattern or not isinstance(pattern, str):
        return None
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error:
        return None


def _group_text(match: re.Match[str], group: Any) -> str:
    """`match[group ?? 0] ?? ''`：抓不到的 group 在 JS 是 undefined，這裡是空字串。"""
    index = 0 if group is None else int(group)
    try:
        value = match.group(index)
    except IndexError:  # pragma: no cover - 設定錯的 group 不該讓整支引擎爆掉
        return ""
    return value or ""


_LATIN = re.compile(r"[a-z]", re.IGNORECASE)
_WHITESPACE = re.compile(r"\s+")
_VALUE_PREFIX = re.compile(r"^[\s:：#—–/-]+")


def pick_keyword(line_text: str, keywords: Sequence[str]) -> str | None:
    """關鍵字偏好順序（port 自 proreview `detected()`，**順序不可調換**）：

    1. 含拉丁字母、且出現在小寫化後的整行裡的關鍵字；
    2. 任何出現在小寫化後整行裡的關鍵字；
    3. 去掉所有空白後才對上的關鍵字。

    第 3 種命中時 `index()` 會找不到，於是取值退回「整行」——這是 proreview 的既有
    行為，刻意保留（見 fixture `03-keyword-compact-fallback`）。
    """
    lower = line_text.lower()
    compact = _WHITESPACE.sub("", lower)
    for keyword in keywords:
        if _LATIN.search(keyword) and keyword in lower:
            return keyword
    for keyword in keywords:
        if keyword in lower:
            return keyword
    for keyword in keywords:
        if _WHITESPACE.sub("", keyword) in compact:
            return keyword
    return None


def value_after_keyword(line_text: str, keyword: str) -> str:
    """關鍵字後面的值：去掉開頭的 `[\\s:：#—–/-]+`。找不到關鍵字就回整行。"""
    index = line_text.lower().find(keyword)
    if index < 0:
        return line_text.strip()
    return _VALUE_PREFIX.sub("", line_text[index + len(keyword):]).strip()


def _unreadable_note(rule: RuleSpec, scoped: Sequence[OcrDocument]) -> str:
    if not scoped:
        return NOTE_NO_DOCUMENT
    if all(d.ocr is None or not d.ocr.lines for d in scoped):
        return NOTE_NO_TEXT
    return NOTE_FIELD_NOT_FOUND


def _keyword_extract(rule: RuleSpec, documents: Sequence[OcrDocument]) -> Finding:
    config = rule.config
    keywords = [k.strip().lower() for k in (config.get("keywords") or []) if k and k.strip()]
    pattern = _compile(config.get("regex"))
    scoped = _documents_for(rule, documents)

    best: _Candidate | None = None
    for document in scoped:
        for line in (document.ocr.lines if document.ocr else ()):
            keyword = pick_keyword(line.text, keywords)
            if keywords and keyword is None:
                continue
            match = pattern.search(line.text) if pattern is not None else None
            if pattern is not None and match is None:
                continue

            value = ""
            if match is not None:
                value = _group_text(match, config.get("group")).strip()
            if not value and config.get("value_after_keyword") and keyword is not None:
                value = value_after_keyword(line.text, keyword)
            if not value:
                value = line.text.strip()

            # 分數：命中 regex 加 3，OCR 信心值當小數位的 tie-breaker。
            # 嚴格大於才換人 → 同分時「先出現的贏」（文件順序 → 行順序）。
            score = 10.0 + (3.0 if match is not None else 0.0) + (line.confidence or 0.0) / 100.0
            candidate = _Candidate(document.document_type_code, document.document_id, line, value, score)
            if best is None or candidate.score > best.score:
                best = candidate

    if best is None:
        return Finding(rule.code, "UNREADABLE", document_type_code=rule.document_type_code,
                       note=_unreadable_note(rule, scoped))

    normalized = apply_normalizer(best.value, config.get("normalize"))
    if normalized is None:
        return Finding(rule.code, "UNREADABLE", extracted_value=best.value,
                       confidence=best.line.confidence, bbox=best.line.bbox,
                       document_type_code=best.document_type_code, document_id=best.document_id,
                       note=NOTE_NORMALIZE_FAILED)
    return Finding(rule.code, "MATCH", extracted_value=normalized,
                   confidence=best.line.confidence, bbox=best.line.bbox,
                   document_type_code=best.document_type_code, document_id=best.document_id)


def _line_containing(documents: Sequence[OcrDocument], raw: str) -> OcrLine | None:
    """找出第一行包含這段文字的 OCR 行，用它的 bbox 當高亮位置。"""
    needle = raw.strip()
    if not needle:
        return None
    for document in documents:
        for line in (document.ocr.lines if document.ocr else ()):
            if needle in line.text:
                return line
    return None


def _regex_extract(rule: RuleSpec, documents: Sequence[OcrDocument]) -> Finding:
    config = rule.config
    pattern = _compile(config.get("pattern"))
    scoped = _documents_for(rule, documents)

    if pattern is None:
        return Finding(rule.code, "UNREADABLE", document_type_code=rule.document_type_code,
                       note=NOTE_BAD_REGEX)

    for document in scoped:
        text = document.ocr.text if document.ocr else ""
        if not text:
            continue
        match = pattern.search(text)
        if match is None:
            continue
        raw = _group_text(match, config.get("group")).strip()
        located = _line_containing([document], raw) or _line_containing([document], (match.group(0) or "").strip())
        confidence = located.confidence if located is not None else None
        if confidence is None and document.ocr is not None:
            confidence = document.ocr.confidence
        bbox = located.bbox if located is not None else None

        normalized = apply_normalizer(raw, config.get("normalize"))
        if normalized is None:
            return Finding(rule.code, "UNREADABLE", extracted_value=raw, confidence=confidence, bbox=bbox,
                           document_type_code=document.document_type_code, document_id=document.document_id,
                           note=NOTE_NORMALIZE_FAILED)
        return Finding(rule.code, "MATCH", extracted_value=normalized, confidence=confidence, bbox=bbox,
                       document_type_code=document.document_type_code, document_id=document.document_id)

    return Finding(rule.code, "UNREADABLE", document_type_code=rule.document_type_code,
                   note=_unreadable_note(rule, scoped))


def within_tolerance(value: float, expected: float, tolerance_pct: float, tolerance_abs: float) -> bool:
    """容差比對：**百分比與絕對金額兩個條件都要成立**（port 自 submit-flow）。

    `tolerance_pct` 是百分比（5 代表 5%）；`expected` 為 0 時一律不成立。
    """
    if not expected:
        return False
    diff = abs(value - expected)
    return diff / expected <= tolerance_pct / 100 and diff <= tolerance_abs


def _amount_tolerance(rule: RuleSpec, facts: ApplicationFacts, by_code: Mapping[str, Finding]) -> Finding:
    config = rule.config
    source = by_code.get(str(config.get("source_rule_code", "")))

    if source is None or source.extracted_value is None:
        return Finding(rule.code, "UNREADABLE", document_type_code=rule.document_type_code,
                       note=NOTE_AMOUNT_SOURCE_MISSING)

    value = parse_amount(source.extracted_value)
    if value is None:
        return Finding(rule.code, "UNREADABLE", extracted_value=source.extracted_value,
                       confidence=source.confidence, bbox=source.bbox,
                       document_type_code=source.document_type_code, document_id=source.document_id,
                       note=NOTE_AMOUNT_UNREADABLE)

    expected = facts.purchase_amount
    if expected is None:
        return Finding(rule.code, "PENDING", extracted_value=source.extracted_value,
                       confidence=source.confidence, bbox=source.bbox,
                       document_type_code=source.document_type_code, document_id=source.document_id,
                       note=NOTE_AMOUNT_PENDING)

    ok = within_tolerance(value, expected,
                          float(config.get("tolerance_pct", 0) or 0),
                          float(config.get("tolerance_abs", 0) or 0))
    return Finding(rule.code, "MATCH" if ok else "MISMATCH", extracted_value=source.extracted_value,
                   expected_value=_number_string(expected), confidence=source.confidence, bbox=source.bbox,
                   document_type_code=source.document_type_code, document_id=source.document_id,
                   note=None if ok else NOTE_AMOUNT_MISMATCH)


def _required_doc(rule: RuleSpec, documents: Sequence[OcrDocument], facts: ApplicationFacts) -> Finding:
    configured = list(rule.config.get("document_type_codes") or [])
    wanted = configured if configured else list(facts.required_document_type_codes)
    present = {d.document_type_code for d in documents}

    missing: list[str] = []
    for code in wanted:
        if code not in present and code not in missing:
            missing.append(code)

    if not missing:
        return Finding(rule.code, "MATCH", expected_value=",".join(wanted),
                       document_type_code=rule.document_type_code)
    return Finding(rule.code, "MISMATCH", expected_value=",".join(wanted),
                   document_type_code=rule.document_type_code, note=NOTE_MISSING_DOCUMENTS,
                   suggested_supplement=tuple(missing))


def _evaluate_one(
    rule: RuleSpec,
    documents: Sequence[OcrDocument],
    facts: ApplicationFacts,
    by_code: Mapping[str, Finding],
) -> Finding:
    if rule.rule_type == "keyword_extract":
        return _keyword_extract(rule, documents)
    if rule.rule_type == "regex_extract":
        return _regex_extract(rule, documents)
    if rule.rule_type == "amount_tolerance":
        return _amount_tolerance(rule, facts, by_code)
    if rule.rule_type == "required_doc":
        return _required_doc(rule, documents, facts)
    return Finding(rule.code, "PENDING", document_type_code=rule.document_type_code,
                   note=NOTE_UNKNOWN_RULE_TYPE)


def evaluate(
    rules: Sequence[RuleSpec],
    documents: Sequence[OcrDocument],
    facts: ApplicationFacts,
) -> list[Finding]:
    """跑完一組規則。

    只跑 `active` 的規則，輸出順序等於 `sort_order`（同 order 再比 `code`）。
    `amount_tolerance` 會去拿別條規則的結果，所以分兩輪：第一輪跑其餘三種，第二輪
    才跑 `amount_tolerance`——這樣 `source_rule_code` 排在後面也讀得到。
    """
    active = sorted((r for r in rules if r.active), key=lambda r: (r.sort_order, r.code))
    by_code: dict[str, Finding] = {}

    for rule in active:
        if rule.rule_type == "amount_tolerance":
            continue
        by_code[rule.code] = _evaluate_one(rule, documents, facts, by_code)
    for rule in active:
        if rule.rule_type != "amount_tolerance":
            continue
        by_code[rule.code] = _evaluate_one(rule, documents, facts, by_code)

    return [by_code[rule.code] for rule in active]


def precheck(findings: Sequence[Finding], rules: Sequence[RuleSpec]) -> PrecheckResult:
    """把 findings 收斂成一個結論（SPEC §8.1 第 4 步）。

    - `blocking`：`required` 且 `severity == "error"` 的 MISMATCH → **FAIL**。
    - `warnings`：其餘 MISMATCH，加上所有 UNREADABLE / PENDING → **INDETERMINATE**。
    - 兩者都空 → **PASS**。
    """
    by_code = {rule.code: rule for rule in rules}
    blocking: list[Finding] = []
    warnings: list[Finding] = []

    for item in findings:
        rule = by_code.get(item.rule_code)
        is_blocking = (
            item.status == "MISMATCH" and rule is not None and rule.required and rule.severity == "error"
        )
        if is_blocking:
            blocking.append(item)
        elif item.status in ("MISMATCH", "UNREADABLE", "PENDING"):
            warnings.append(item)

    verdict = "FAIL" if blocking else ("INDETERMINATE" if warnings else "PASS")
    return PrecheckResult(verdict=verdict, blocking=tuple(blocking), warnings=tuple(warnings))


def verdict_of(findings: Sequence[Finding], rules: Sequence[RuleSpec]) -> str:
    return precheck(findings, rules).verdict


def suggested_supplements(findings: Iterable[Finding]) -> list[str]:
    """把所有 `required_doc` findings 建議的補件項目合起來（去重、保持順序）。"""
    out: list[str] = []
    for item in findings:
        for code in item.suggested_supplement or ():
            if code not in out:
                out.append(code)
    return out


# =================================================== 資料庫這一側（落地與讀取）

def rule_spec(rule: ReviewRule) -> RuleSpec:
    """`review_rules` 的一列 → 引擎吃的規則。空字串的 document_type_code 等於「不限」。"""
    return RuleSpec(
        code=rule.code,
        label=rule.label,
        document_type_code=rule.document_type_code or None,
        rule_type=rule.rule_type,
        config=dict(rule.config or {}),
        required=bool(rule.required),
        severity=rule.severity or "error",
        sort_order=int(rule.sort_order or 0),
        active=bool(rule.active),
        rule_id=rule.id,
    )


async def rules_for(db: AsyncSession, scheme_id: str) -> list[RuleSpec]:
    rows = (
        await db.execute(
            select(ReviewRule).where(ReviewRule.scheme_id == scheme_id)
            .order_by(ReviewRule.sort_order, ReviewRule.code)
        )
    ).scalars().all()
    return [rule_spec(r) for r in rows]


# 承辦人重新辨識的結果勝過申請人送上來的（SPEC §11：applicant 的 OCR 不可信）。
_SOURCE_RANK = {"reviewer": 2, "applicant": 1}


def _ocr_rank(row: DocumentOcrResult) -> tuple[int, datetime]:
    created = row.created_at or datetime.fromtimestamp(0, UTC)
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return (_SOURCE_RANK.get(row.source, 0), created)


async def latest_ocr_for(db: AsyncSession, document_ids: Sequence[str]) -> dict[str, DocumentOcrResult]:
    """每份文件挑一筆 OCR：承辦人的勝過申請人的，同來源取最新。"""
    if not document_ids:
        return {}
    rows = (
        await db.execute(
            select(DocumentOcrResult).where(DocumentOcrResult.document_id.in_(list(document_ids)))
        )
    ).scalars().all()
    best: dict[str, DocumentOcrResult] = {}
    for row in rows:
        current = best.get(row.document_id)
        if current is None or _ocr_rank(row) >= _ocr_rank(current):
            best[row.document_id] = row
    return best


async def current_documents(db: AsyncSession, application: Application) -> list[ApplicationDocument]:
    return list(
        (
            await db.execute(
                select(ApplicationDocument)
                .where(
                    ApplicationDocument.application_id == application.id,
                    ApplicationDocument.is_current.is_(True),
                )
                .order_by(ApplicationDocument.uploaded_at, ApplicationDocument.id)
            )
        ).scalars()
    )


def facts_for(application: Application, required_document_type_codes: Sequence[str]) -> ApplicationFacts:
    return ApplicationFacts(
        purchase_amount=None if application.purchase_amount is None else float(application.purchase_amount),
        purchase_date=application.purchase_date.isoformat() if application.purchase_date else None,
        tier_code=application.tier_code,
        payment_channel_code=application.payment_channel_code,
        paid_by_proxy=bool(application.paid_by_proxy),
        required_document_type_codes=tuple(required_document_type_codes),
    )


async def ocr_documents_for(db: AsyncSession, application: Application) -> list[OcrDocument]:
    """目前這一版的每份文件 + 它最新的 OCR 結果。"""
    docs = await current_documents(db, application)
    ocr = await latest_ocr_for(db, [d.id for d in docs])
    out: list[OcrDocument] = []
    for doc in docs:
        row = ocr.get(doc.id)
        result = None
        if row is not None:
            result = OcrResult(
                text=row.text or "",
                confidence=_as_number(row.confidence),
                lines=tuple(OcrLine.from_dict(line) for line in (row.lines or []) if isinstance(line, Mapping)),
            )
        out.append(OcrDocument(document_type_code=doc.document_type_code, ocr=result, document_id=doc.id))
    return out


async def evaluate_application(db: AsyncSession, application: Application) -> list[Finding]:
    """對一件案子重跑規則引擎：目前版本的每份文件、每份文件最新的 OCR。

    承辦人「重新辨識」的結果（`source=reviewer`）勝過申請人送上來的，因為後者依
    SPEC §11 一律視為不可信。
    """
    scheme = await db.get(Scheme, application.scheme_id)
    if scheme is None:
        return []
    from .scheme import required_document_types

    # 規則走明確的查詢而不是 `scheme.review_rules`：方案物件可能是剛建出來、還沒被
    # 查詢載入過的那一顆，在非同步 session 裡碰它的關聯會直接炸。
    rules = await rules_for(db, application.scheme_id)
    documents = await ocr_documents_for(db, application)
    facts = facts_for(
        application,
        required_document_types(scheme, application.tier_code, application.payment_channel_code,
                                application.paid_by_proxy),
    )
    return evaluate(rules, documents, facts)


async def dry_run(db: AsyncSession, scheme: Scheme, payload: Mapping[str, Any]) -> dict[str, Any]:
    """規則試算（SPEC §8.2「規則編輯器」）：貼一段 OCR 文字，看規則會判成什麼。

    **不落地、不碰案件**，純運算——所以它可以在規則還沒存檔時就被呼叫，承辦人員
    改一個關鍵字就按一次，不會在 `review_findings` 上留下一堆假資料。

    `rules` 沒給就用方案存著的那一份；給了就用給的那一份（規則編輯器在存檔前試算，
    送上來的是編輯中的版本）。這支存在的理由是**校準**：後台的試算面板在瀏覽器裡
    跑 `@maydru/review-rules`，這裡跑 Python 版，兩邊對同一段文字必須判得一樣，
    不一樣就是規則引擎的兩個實作走鐘了（SPEC §14「規則一致性」）。
    """
    raw_rules = payload.get("rules")
    rules = (
        [RuleSpec.from_dict(r) for r in raw_rules]
        if isinstance(raw_rules, Sequence) and not isinstance(raw_rules, (str, bytes))
        else await rules_for(db, scheme.id)
    )
    documents = [
        OcrDocument(
            document_type_code=str(d.get("document_type_code", "") or ""),
            ocr=OcrResult.from_dict(d.get("ocr") if isinstance(d.get("ocr"), Mapping) else None),
        )
        for d in (payload.get("documents") or [])
        if isinstance(d, Mapping)
    ]
    raw_facts = payload.get("facts")
    facts = ApplicationFacts.from_dict(raw_facts if isinstance(raw_facts, Mapping) else {})
    if not facts.required_document_type_codes:
        from .scheme import required_document_types

        facts = ApplicationFacts(
            purchase_amount=facts.purchase_amount,
            purchase_date=facts.purchase_date,
            tier_code=facts.tier_code,
            payment_channel_code=facts.payment_channel_code,
            paid_by_proxy=facts.paid_by_proxy,
            required_document_type_codes=tuple(
                required_document_types(scheme, facts.tier_code, facts.payment_channel_code, facts.paid_by_proxy)
            ),
        )
    findings = evaluate(rules, documents, facts)
    result = precheck(findings, rules)
    return {
        "verdict": result.verdict,
        "findings": [f.to_dict() for f in findings],
        "blocking": [f.rule_code for f in result.blocking],
        "warnings": [f.rule_code for f in result.warnings],
        "suggested_supplement": suggested_supplements(findings),
    }


async def persist_findings(
    db: AsyncSession,
    application: Application,
    findings: Sequence[Finding],
    *,
    source: str = "auto",
    reviewer_id: str | None = None,
    now: datetime | None = None,
) -> list[ReviewFinding]:
    """把判定寫成 `review_findings` 的新列。**永遠 append**，不覆寫舊列。

    承辦人的覆寫也走這裡（`source="reviewer"`），案件頁靠 `latest_findings()` 取最新，
    歷史留在表上供稽核（SPEC §8.3）。
    """
    stamp = now or datetime.now(UTC)
    rule_ids = {
        r.code: r.rule_id
        for r in await rules_for(db, application.scheme_id)
    }
    rows: list[ReviewFinding] = []
    for item in findings:
        row = ReviewFinding(
            tenant_id=application.tenant_id,
            application_id=application.id,
            rule_id=rule_ids.get(item.rule_code),
            rule_code=item.rule_code,
            document_id=item.document_id,
            status=item.status,
            extracted_value=item.extracted_value or "",
            expected_value=item.expected_value or "",
            confidence=float(item.confidence or 0.0),
            bbox=dict(item.bbox) if item.bbox else None,
            source=source,
            note=item.note or "",
            reviewer_id=reviewer_id,
            decided_at=stamp,
        )
        db.add(row)
        rows.append(row)
    await db.flush()
    from . import webhooks

    await webhooks.create_deliveries(db, application.tenant_id, "review.findings_updated", {
        "application_id": application.id, "case_no": application.case_no,
        "rule_codes": [row.rule_code for row in rows], "source": source,
    })
    return rows


async def all_findings(db: AsyncSession, application: Application) -> list[ReviewFinding]:
    """整段歷史，新的在前（同時間再以 source 排，reviewer 勝過 auto）。"""
    rows = (
        await db.execute(select(ReviewFinding).where(ReviewFinding.application_id == application.id))
    ).scalars().all()
    return sorted(rows, key=_finding_rank, reverse=True)


def _finding_rank(row: ReviewFinding) -> tuple[datetime, int]:
    stamp = row.decided_at or row.created_at or datetime.fromtimestamp(0, UTC)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return (stamp, _SOURCE_RANK.get(row.source, 0))


async def latest_findings(db: AsyncSession, application: Application) -> list[ReviewFinding]:
    """每條規則只留最新的一列，依 rule_code 排序。"""
    latest: dict[str, ReviewFinding] = {}
    for row in await all_findings(db, application):   # 新的在前
        latest.setdefault(row.rule_code, row)
    return sorted(latest.values(), key=lambda r: r.rule_code)


def finding_of(row: ReviewFinding) -> Finding:
    """`review_findings` 的一列 → 引擎的 Finding（給 verdict 計算用）。"""
    return Finding(
        rule_code=row.rule_code,
        status=row.status,
        extracted_value=row.extracted_value or None,
        expected_value=row.expected_value or None,
        confidence=row.confidence,
        bbox=dict(row.bbox) if row.bbox else None,
        document_type_code=None,
        note=row.note or None,
        document_id=row.document_id,
    )


async def blockers_for(db: AsyncSession, application: Application) -> list[dict[str, str]]:
    """核准（T3）前置條件：所有 `required` 規則的最新 finding 都必須是 MATCH（SPEC §8.3）。

    沒有判定過的 required 規則同樣算阻擋——「還沒看」不等於「看過沒問題」。
    """
    latest = {row.rule_code: row for row in await latest_findings(db, application)}
    out: list[dict[str, str]] = []
    for rule in await rules_for(db, application.scheme_id):
        if not rule.active or not rule.required:
            continue
        row = latest.get(rule.code)
        if row is None or row.status != "MATCH":
            out.append({"rule_code": rule.code, "label": rule.label, "status": row.status if row else "PENDING"})
    return out


# ------------------------------------------------- 核准前置條件的掛鉤（P1 介面）

BlockersHook = Callable[[Any], "list[str] | Awaitable[list[str]]"]


async def no_blockers(application: Any) -> list[str]:
    """什麼都不擋。測試與離線工具用；正式啟動時由 `install_approval_blockers()` 換掉。"""
    return []


async def db_approval_blockers(application: Any) -> list[str]:
    """真正的前置條件：從案件所在的 session 讀最新 findings（SPEC §8.3）。

    `transition()` 只把 application 交給掛鉤，所以 session 由 ORM 反查——這樣
    狀態機不必認識審核服務的參數，掛鉤也不必被到處傳。
    """
    if not isinstance(application, Application):
        return []
    db = async_object_session(application)
    if db is None:
        return []
    return [b["rule_code"] for b in await blockers_for(db, application)]


_hook: BlockersHook = db_approval_blockers


def set_approval_blockers(hook: BlockersHook) -> None:
    """換掉核准前置條件的判斷。測試用它模擬有缺失的案件。"""
    global _hook
    _hook = hook


def install_approval_blockers() -> None:
    """裝上真的規則引擎（`app.main` 與 worker 啟動時呼叫；本模組匯入時已是預設）。"""
    set_approval_blockers(db_approval_blockers)


def reset_approval_blockers() -> None:
    global _hook
    _hook = db_approval_blockers


async def approval_blockers(application: Any) -> list[str]:
    """核准（T3）前置條件：回傳一串「還不能核准的理由」，空的才准過。

    伺服器端強制（SPEC §8.3）——前端顯示什麼都不算數。
    """
    result = _hook(application)
    if isawaitable(result):
        return list(await result)
    return list(result)  # type: ignore[arg-type]
