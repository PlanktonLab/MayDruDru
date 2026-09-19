"""CLAUDE.md 規則 4：`services/line/` 裡不得硬編任何給市民看的中文。

檢查的是**字串常數**，不是註解與 docstring——那兩者是寫給維護的人看的，本來就該
是中文。做法是走 AST 取出每一個字串字面值，把 docstring 挑掉再驗，
比 grep 精準（grep 會把中文註解一起誤判）。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

LINE_PACKAGE = Path(__file__).resolve().parents[1] / "app" / "services" / "line"
MODULES = sorted(LINE_PACKAGE.glob("*.py"))

# 中日韓表意文字與全形標點：任何一個出現在字串常數裡，就是把文案寫死在程式裡了。
CJK_RANGES = (
    (0x3000, 0x303F),   # CJK 標點
    (0x3400, 0x4DBF),   # 擴充 A
    (0x4E00, 0x9FFF),   # 基本區
    (0xF900, 0xFAFF),   # 相容表意文字
    (0xFF00, 0xFF65),   # 全形字母與標點
)


def has_cjk(text: str) -> bool:
    return any(any(low <= ord(ch) <= high for low, high in CJK_RANGES) for ch in text)


def docstrings(tree: ast.AST) -> set[int]:
    """每個模組／類別／函式的第一個字串——那是說明，不是文案。"""
    found: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        body = getattr(node, "body", [])
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                and isinstance(body[0].value.value, str):
            found.add(id(body[0].value))
    return found


def log_messages(tree: ast.AST) -> set[int]:
    """`log.warning(...)` 之類的訊息是寫給維運看的，不是給市民的文案。

    這是規則的精確版本：禁的是「民眾會看到的中文」，不是「檔案裡的中文」。
    日誌用團隊看得懂的語言寫，值班的人才不必先翻譯再除錯。
    """
    found: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        owner = node.func.value
        if not (isinstance(owner, ast.Name) and owner.id in ("log", "logger")):
            continue
        for inner in ast.walk(node):
            if isinstance(inner, ast.Constant) and isinstance(inner.value, str):
                found.add(id(inner))
    return found


def test_the_package_has_modules_to_check():
    assert len(MODULES) >= 7


@pytest.mark.parametrize("path", MODULES, ids=lambda p: p.name)
def test_no_chinese_string_literals(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    skip = docstrings(tree) | log_messages(tree)
    offenders = [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
        and id(node) not in skip and has_cjk(node.value)
    ]
    assert offenders == [], f"{path.name} 有硬編中文：{offenders}"


def test_the_check_would_actually_catch_something():
    """守門的測試自己也要有守門的測試。"""
    tree = ast.parse('x = "請輸入案件編號"\n')
    strings = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    assert any(has_cjk(s) for s in strings)


def test_handlers_reach_the_copy_through_content_keys():
    """反面證據：handler 裡真的有一堆 content key 在用。"""
    source = (LINE_PACKAGE / "handlers.py").read_text(encoding="utf-8")
    for key in ("home.welcome", "case.ask_case_id", "case.verify_failed", "security.screenshot_notice",
                "error.cancelled", "home.unknown"):
        assert f'"{key}"' in source
