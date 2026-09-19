"""規則引擎的 Python / TypeScript 一致性（SPEC §14「規則一致性」）。

`packages/review-rules/fixtures/*.json` 是兩版唯一的共同真相。TS 端由
`src/fixtures.test.ts` 掃同一批檔案；這裡用同樣的比對語意：
- `findings` 的長度與順序必須完全相同；
- 每個 finding 只比對 fixture 裡有寫的欄位；
- `null` 與「欄位不存在」視為相同。

`note` 是例外：fixtures 只斷言 `note: null`，兩版對非 null 的 note 各自輸出
（TS 直接組中文給瀏覽器看，Python 回文案 key 交給 contents 渲染）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from app.services import review

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "packages" / "review-rules" / "fixtures"
FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def run(fixture: dict[str, Any]) -> tuple[list[review.Finding], list[review.RuleSpec], str]:
    rules = [review.RuleSpec.from_dict(r) for r in fixture["rules"]]
    documents = [
        review.OcrDocument(
            document_type_code=d["document_type_code"],
            ocr=review.OcrResult.from_dict(d.get("ocr")),
        )
        for d in fixture["documents"]
    ]
    facts = review.ApplicationFacts.from_dict(fixture["facts"])
    findings = review.evaluate(rules, documents, facts)
    return findings, rules, review.precheck(findings, rules).verdict


def test_the_fixture_folder_is_where_we_think_it_is():
    assert FIXTURE_DIR.is_dir(), f"找不到 fixtures：{FIXTURE_DIR}"
    assert len(FIXTURES) >= 21


def test_the_fixtures_cover_all_four_rule_types():
    types = {rule["rule_type"] for path in FIXTURES for rule in load(path)["rules"]}
    assert sorted(types) == ["amount_tolerance", "keyword_extract", "regex_extract", "required_doc"]


def test_the_fixtures_cover_all_three_verdicts():
    verdicts = {load(path)["expected"]["verdict"] for path in FIXTURES}
    assert sorted(verdicts) == ["FAIL", "INDETERMINATE", "PASS"]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_fixture_matches_the_typescript_engine(path: Path):
    fixture = load(path)
    findings, _rules, verdict = run(fixture)
    expected = fixture["expected"]

    assert [f.rule_code for f in findings] == [e["rule_code"] for e in expected["findings"]], path.name
    for index, want in enumerate(expected["findings"]):
        got = findings[index].to_dict()
        for key, value in want.items():
            if key == "note":
                # 兩版的 note 文案不同（TS 給句子、Python 給 key），只有「該不該有」一致。
                assert (got["note"] is None) == (value is None), f"{path.name}#{index}.note"
                continue
            if value is None:
                assert got.get(key) is None, f"{path.name}#{index}.{key}"
                continue
            assert got.get(key) == value, f"{path.name}#{index}.{key}"
    assert verdict == expected["verdict"], path.name


# ------------------------------------------------------------- normalizers

@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("NT$1,200", "1200"),
        ("1200", "1200"),
        ("1,200.50", "1200.5"),
        ("１２００", "1200"),               # 全形數字
        ("新臺幣 6,000 元整", "6000"),
        ("1.200,50", None),                 # 歐式寫法無從判斷
        ("1.2.3", None),                    # 多於一個小數點
        ("沒有數字", None),
        ("", None),
        ("-1200", "-1200"),
        ("12-34", "1234"),                  # 內部的減號當雜訊去掉
    ],
)
def test_normalize_amount(raw, want):
    assert review.normalize_amount(raw) == want


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("民國 115 年 9 月 1 日", "2026-09-01"),
        ("115年9月1日", "2026-09-01"),
        ("2026-09-01", "2026-09-01"),
        ("115/09/01", "2026-09-01"),
        ("2026/9/1", "2026-09-01"),
        ("2026.09.01", "2026-09-01"),
        ("20260901", "2026-09-01"),
        ("2026-13-01", None),               # 月份不合理，其餘樣式也對不上
        ("2026-09-32", None),
        ("沒有日期", None),
    ],
)
def test_normalize_date(raw, want):
    assert review.normalize_date(raw) == want


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("**** **** **** 4826", "4826"),
        ("xxxx-xxxx-xxxx-4826", "4826"),
        ("••••4826", "4826"),
        ("＊＊＊＊4826", "4826"),
        ("末四碼 4826", "4826"),
        ("4826", "4826"),
        ("482", None),
        ("卡號 4826 交易", None),           # 結尾不是四碼，也沒有遮罩字元
        ("", None),
    ],
)
def test_normalize_last4(raw, want):
    assert review.normalize_last4(raw) == want


def test_apply_normalizer_without_a_name_only_trims():
    assert review.apply_normalizer("  值  ") == "值"


def test_an_unknown_normalizer_falls_back_to_the_raw_string():
    assert review.apply_normalizer(" 1,200 ", "nonsense") == "1,200"


def test_parse_amount_round_trips_through_the_normalizer():
    assert review.parse_amount("NT$1,234.50") == 1234.5
    assert review.parse_amount("看不懂") is None


# ------------------------------------------------------------- 引擎細節

def test_keyword_preference_puts_latin_first():
    assert review.pick_keyword("金額 amount NT$1,200", ["金額", "amount"]) == "amount"


def test_keyword_preference_falls_back_to_substring_then_compact():
    assert review.pick_keyword("金額 NT$1,200", ["金額"]) == "金額"
    assert review.pick_keyword("卡 號 末 四 碼 4826", ["卡號末四碼"]) == "卡號末四碼"


def test_value_after_keyword_strips_separators():
    assert review.value_after_keyword("品項：Pro Plan", "品項") == "Pro Plan"
    assert review.value_after_keyword("金額 — 1200", "金額") == "1200"


def test_value_after_keyword_returns_the_whole_line_when_the_keyword_is_not_there():
    assert review.value_after_keyword("  卡 號 4826 ", "卡號") == "卡 號 4826"


@pytest.mark.parametrize(
    ("value", "expected", "pct", "abs_", "ok"),
    [
        (1200, 1200, 5, 150, True),
        (1260, 1200, 5, 150, True),        # 剛好 5.0%，<= 算過
        (1350, 1200, 20, 150, True),       # 剛好差 150，<= 算過
        (1351, 1200, 20, 150, False),      # 差 151，絕對值不過
        (1300, 1200, 5, 150, False),       # 百分比不過
        (1200, 0, 5, 150, False),          # 申報金額 0 一律不成立
    ],
)
def test_within_tolerance(value, expected, pct, abs_, ok):
    assert review.within_tolerance(value, expected, pct, abs_) is ok


def test_suggested_supplements_dedupes_and_keeps_order():
    findings = [
        review.Finding("A", "MISMATCH", suggested_supplement=("B", "A")),
        review.Finding("B", "MISMATCH", suggested_supplement=("A", "C")),
    ]
    assert review.suggested_supplements(findings) == ["B", "A", "C"]


def test_an_unknown_rule_type_is_pending_rather_than_an_exception():
    rule = review.RuleSpec(code="X", rule_type="telepathy")
    findings = review.evaluate([rule], [], review.ApplicationFacts())
    assert findings[0].status == "PENDING"
    assert findings[0].note == review.NOTE_UNKNOWN_RULE_TYPE


def test_an_uncompilable_regex_is_unreadable_rather_than_an_exception():
    rule = review.RuleSpec(code="X", rule_type="regex_extract", config={"pattern": "([unclosed"})
    findings = review.evaluate([rule], [], review.ApplicationFacts())
    assert findings[0].status == "UNREADABLE"
    assert findings[0].note == review.NOTE_BAD_REGEX


def test_inactive_rules_never_appear():
    rules = [
        review.RuleSpec(code="ON", rule_type="required_doc", config={"document_type_codes": []}),
        review.RuleSpec(code="OFF", rule_type="required_doc", config={}, active=False),
    ]
    assert [f.rule_code for f in review.evaluate(rules, [], review.ApplicationFacts())] == ["ON"]


def test_amount_tolerance_reads_a_source_rule_declared_after_it():
    rules = [
        review.RuleSpec(code="CHECK", rule_type="amount_tolerance", sort_order=1,
                        config={"source_rule_code": "AMOUNT", "tolerance_pct": 5, "tolerance_abs": 150}),
        review.RuleSpec(code="AMOUNT", rule_type="keyword_extract", sort_order=2,
                        document_type_code="BILL",
                        config={"keywords": ["金額"], "value_after_keyword": True, "normalize": "amount"}),
    ]
    documents = [
        review.OcrDocument("BILL", review.OcrResult(
            text="金額 NT$1,200",
            confidence=90,
            lines=(review.OcrLine("金額 NT$1,200", 90, {"x0": 0, "y0": 0, "x1": 1, "y1": 1}),),
        ))
    ]
    findings = review.evaluate(rules, documents, review.ApplicationFacts(purchase_amount=1200))
    assert [f.rule_code for f in findings] == ["CHECK", "AMOUNT"]
    assert findings[0].status == "MATCH" and findings[0].expected_value == "1200"


def test_the_first_line_wins_a_tie():
    """同分時先出現的贏：兩行信心值一樣，取上面那一行的 bbox。"""
    rule = review.RuleSpec(code="R", rule_type="keyword_extract", document_type_code="BILL",
                           config={"keywords": ["金額"], "value_after_keyword": True})
    documents = [
        review.OcrDocument("BILL", review.OcrResult(lines=(
            review.OcrLine("金額 100", 90, {"x0": 0, "y0": 0, "x1": 1, "y1": 1}),
            review.OcrLine("金額 200", 90, {"x0": 0, "y0": 9, "x1": 1, "y1": 9}),
        )))
    ]
    assert review.evaluate([rule], documents, review.ApplicationFacts())[0].extracted_value == "100"
