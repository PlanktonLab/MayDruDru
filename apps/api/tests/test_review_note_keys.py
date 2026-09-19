"""規則引擎的 `note` 與罐頭訊息 registry 之間的契約（SPEC §8.3 / §8.6）。

`services/review.py` 不組句子，只回 `review.note.*` 這種文案 key（CLAUDE.md 規則 4）。
key 沒有對應的 registry 定義時不會炸——`contents.t()` 會安靜地回空字串——所以案件頁
會突然少一行「為什麼判不出來」。那種缺漏只有測試看得見，於是這裡逐一對。

來源刻意是 AST 而不是 `dir(review)`：漏掉的正是那些「寫在呼叫點、沒有拉成常數」的
字串，`dir()` 看不到它們。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from app.content_registry import BY_KEY, get_default
from app.services import review

REVIEW_PY = Path(review.__file__)


def _note_keys_in_source() -> set[str]:
    """`services/review.py` 裡每一個以 `review.note.` 開頭的字串常數。"""
    tree = ast.parse(REVIEW_PY.read_text(encoding="utf-8"))
    return {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value.startswith(review.NOTE_PREFIX)
    } - {review.NOTE_PREFIX}  # 前綴常數本身不是一個 key


def test_the_source_really_does_carry_note_keys():
    """守著這支測試本身：抓不到任何 key 時，下面那條會空轉通過。"""
    assert len(_note_keys_in_source()) >= 11


@pytest.mark.parametrize("key", sorted(_note_keys_in_source()))
def test_every_note_key_has_a_registry_default(key):
    assert key in BY_KEY, f"{key} 沒有定義在 app/content_registry/，案件頁會少一行說明"
    assert get_default(key).strip(), f"{key} 的預設值是空的"


def test_note_definitions_live_in_the_review_category():
    """後台側邊欄要找得到它們，才改得到。"""
    for key, definition in BY_KEY.items():
        if key.startswith(review.NOTE_PREFIX):
            assert definition.category == "review", key


async def test_the_rendered_note_comes_from_contents(db, tenant):
    """承辦人改過的字會蓋過 registry 預設值。"""
    from app.services import contents as contents_service

    assert await contents_service.t(db, tenant.id, review.NOTE_NO_DOCUMENT) == get_default(
        review.NOTE_NO_DOCUMENT
    )
    row = await contents_service.get_or_create(db, tenant.id, review.NOTE_NO_DOCUMENT)
    await contents_service.publish(db, tenant.id, row.key, "這份文件還沒收到。")
    await db.commit()
    contents_service.invalidate()
    assert await contents_service.t(db, tenant.id, review.NOTE_NO_DOCUMENT) == "這份文件還沒收到。"
