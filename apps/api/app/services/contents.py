"""罐頭訊息服務（SPEC §8.6）。

市民看到的每一個字都從這裡來。三條規則決定了整個模組的形狀：

1. **永不拋錯**。缺列、空字串、連資料庫都讀不到，一律退回 registry 的預設值。
   LINE 那一側寧可回「舊的、對的」文案，也不要回一顆空泡泡或一個 500。
2. **快取，寫入即失效**。一個 tenant 的已發布文案整批進行程內字典；任何寫入
   （發布、重設、sync）都把該 tenant 的快取丟掉，下一次讀取重建。
3. **草稿與已發布分開**。`content` 是 LINE 正在唸的那一份，`draft` 是承辦人還在
   改的那一份；發布才會蓋過去，並清掉草稿。

模組名刻意是 `contents`（複數）：`services/content.py` 已經是 SOP 流程快照的服務，
兩者無關（決策 D19）。

函式一律帶 `tenant_id`，因為 `contents` 的自然鍵是 (tenant_id, key)；youth-line-bot
是單機關系統才能省掉這個參數。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..content_registry import (
    CONTENT_CATEGORIES,
    CONTENT_REGISTRY,
    ContentDefinition,
    get_definition,
)
from ..content_registry import get_default as registry_default
from ..models import Content
from . import audit
from .actors import Actor
from .versioning import bump, check_version

log = logging.getLogger("maydru.contents")

__all__ = [
    "CONTENT_NOT_FOUND",
    "SAMPLE_VARIABLES",
    "ContentView",
    "categories",
    "get_or_create",
    "invalidate",
    "list_contents",
    "prefixed",
    "preview",
    "publish",
    "publish_draft",
    "render",
    "reset",
    "save_draft",
    "stats",
    "substitute",
    "sync_defaults",
    "t",
    "tf",
]

CONTENT_NOT_FOUND = "找不到這個文案 key"

# `{{ name }}` 與 `{{name}}` 都算。認不得的 placeholder 原樣留著——刪掉它只會讓
# 民眾看到一句缺了資訊的話，留著至少承辦人一眼就看得出哪個變數沒代進去。
_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

# 後台預覽用的範例值（youth-line-bot previewService.SAMPLE_VARIABLES 的移植）。
SAMPLE_VARIABLES: dict[str, str] = {
    "status": "審核中",
    "count": "2",
    "category": "文件準備",
    "keyword": "補件",
    "current": "1",
    "total": "6",
    "index": "1",
    "list": "1. 審查需要多久？\n2. 補助什麼時候撥款？",
    "case_no": "HC-2026-000123",
    "headline": "你的案件有最新進度",
    "deadline": "2026-10-01",
    # 預覽用的假案件；`services/line/flex.py` 不放任何中文字串，範例值一律從這裡拿。
    "applicant": "王小明",
    "scheme_name": "示範補助方案",
}

# 哪些 key 的預覽要附上主選單快速回覆（前綴比對，同 youth-line-bot previewService）。
_QUICK_REPLY_PREFIXES = ("home.", "error.", "contact.")
_QUICK_REPLY_KEYS = frozenset({"case.verify_failed", "case.link_success", "mycase.empty"})


# --------------------------------------------------------------------- 快取

# tenant_id -> {key: 已發布文字}。程序內共用，worker 與 api 各有一份（各自的程序）。
_CACHE: dict[str, dict[str, str]] = {}


def invalidate(tenant_id: str | None = None) -> None:
    """丟掉快取。不帶參數＝全部丟（測試與 sync_defaults 用）。"""
    if tenant_id is None:
        _CACHE.clear()
    else:
        _CACHE.pop(tenant_id, None)


async def _published(db: AsyncSession, tenant_id: str) -> dict[str, str]:
    """一個 tenant 的已發布文案。整批讀一次，之後都走快取。

    讀不到（資料表還沒建、連線斷了）就回空字典，呼叫端自然退回 registry 預設值。
    """
    cached = _CACHE.get(tenant_id)
    if cached is not None:
        return cached
    try:
        rows = (
            await db.execute(select(Content.key, Content.content).where(Content.tenant_id == tenant_id))
        ).all()
    except Exception:
        log.warning("讀取 contents 失敗，本次改用 registry 預設值", exc_info=True)
        return {}
    table = {key: text for key, text in rows if (text or "").strip()}
    _CACHE[tenant_id] = table
    return table


# ----------------------------------------------------------------- 讀取 API

async def t(db: AsyncSession, tenant_id: str, key: str) -> str:
    """一段文案。缺列或空白一律退回 registry 預設值，永不拋錯。"""
    table = await _published(db, tenant_id)
    text = table.get(key, "")
    return text if text.strip() else registry_default(key)


async def tf(db: AsyncSession, tenant_id: str, key: str, **variables: Any) -> str:
    """帶變數的文案。`{{name}}` 會被代換，未知的 placeholder 原樣留著。"""
    return substitute(await t(db, tenant_id, key), variables)


async def prefixed(db: AsyncSession, tenant_id: str, prefix: str) -> dict[str, str]:
    """某個前綴底下的所有文案，key 已去掉前綴。

    registry 有、資料表沒有的 key 也會出現（帶著出廠預設值）——呼叫端拿到的是
    「這個機關現在會說的每一句」，不是「承辦人剛好改過的那幾句」。
    `services/policy.py` 用它把 `sop.template.*` 灌進 SOP 對話的語句表（SPEC §8.5）。
    """
    table = await _published(db, tenant_id)
    out: dict[str, str] = {}
    for definition in CONTENT_REGISTRY:
        if definition.key.startswith(prefix) and definition.default.strip():
            out[definition.key[len(prefix):]] = definition.default
    for key, text in table.items():
        if key.startswith(prefix) and text.strip():
            out[key[len(prefix):]] = text
    return out


def substitute(text: str, variables: dict[str, Any] | None) -> str:
    values = variables or {}

    def swap(m: re.Match[str]) -> str:
        name = m.group(1)
        return str(values[name]) if name in values else m.group(0)

    return _VAR_RE.sub(swap, text)


def declared_variables(text: str) -> list[str]:
    """文字裡實際出現的 `{{var}}`，依出現順序、去重。"""
    seen: list[str] = []
    for name in _VAR_RE.findall(text):
        if name not in seen:
            seen.append(name)
    return seen


async def render(db: AsyncSession, tenant_id: str, key: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    """`/v1/contents/render` 與 LINE 共用的渲染：`{type, text}` 或 `{type, flex}`。

    `content_type=flex` 的列存的是 Flex JSON 字串；解析失敗就退回純文字，
    因為一段壞掉的 JSON 不該讓對話停掉。
    """
    text = substitute(await t(db, tenant_id, key), variables)
    definition = get_definition(key)
    kind = definition.content_type if definition else "text"
    row_type = await _stored_type(db, tenant_id, key)
    kind = row_type or kind
    if kind == "flex":
        try:
            return {"type": "flex", "flex": json.loads(text)}
        except (TypeError, ValueError):
            log.warning("contents %s 宣告為 flex 但內容不是合法 JSON，改以純文字回覆", key)
            return {"type": "text", "text": text}
    return {"type": kind, "text": text}


async def _stored_type(db: AsyncSession, tenant_id: str, key: str) -> str:
    row = await _row(db, tenant_id, key)
    return row.content_type if row is not None else ""


# ----------------------------------------------------------------- 寫入 API

@dataclass
class ContentView:
    """後台列表與編輯器要的一切，外加三個算出來的旗標。"""

    key: str
    category: str
    title: str
    description: str
    content: str
    draft: str | None
    default: str
    content_type: str
    variables: list[str]
    sort_order: int
    version: int
    published_at: str | None = None
    published_by: str | None = None
    customised: bool = False
    has_draft: bool = False
    scheme_id: str | None = None
    missing_variables: list[str] = field(default_factory=list)

    def dict(self) -> dict[str, Any]:
        return asdict(self)


def _view(row: Content) -> ContentView:
    definition = get_definition(row.key)
    default = definition.default if definition else ""
    declared = list(row.variables or [])
    live = row.draft if (row.draft is not None and row.draft != row.content) else row.content
    return ContentView(
        key=row.key,
        category=row.category,
        title=row.title,
        description=row.description,
        content=row.content,
        draft=row.draft,
        default=default,
        content_type=row.content_type,
        variables=declared,
        sort_order=row.sort_order,
        version=row.version,
        published_at=row.published_at.isoformat() if row.published_at else None,
        published_by=row.published_by,
        customised=bool(definition) and row.content != default,
        has_draft=row.draft is not None and row.draft != row.content,
        scheme_id=row.scheme_id,
        missing_variables=[v for v in declared if f"{{{{{v}}}}}" not in (live or "")],
    )


async def _row(db: AsyncSession, tenant_id: str, key: str) -> Content | None:
    return (
        await db.execute(select(Content).where(Content.tenant_id == tenant_id, Content.key == key))
    ).scalar_one_or_none()


async def get_or_create(db: AsyncSession, tenant_id: str, key: str) -> Content:
    """讀一筆文案；沒有列就先用預設值補一列。

    後台一開啟編輯器就需要一個 `version` 可以鎖（youth-line-bot 也是讀取時寫列），
    否則兩個人同時第一次編輯同一個 key 會雙雙成功。
    """
    row = await _row(db, tenant_id, key)
    if row is not None:
        return row
    definition = get_definition(key)
    if definition is None:
        from fastapi import HTTPException

        raise HTTPException(404, CONTENT_NOT_FOUND)
    row = Content(
        tenant_id=tenant_id,
        key=definition.key,
        category=definition.category,
        title=definition.title,
        description=definition.description,
        content=definition.default,
        content_type=definition.content_type,
        variables=list(definition.variables),
        sort_order=definition.sort_order,
    )
    db.add(row)
    await db.flush()
    invalidate(tenant_id)
    return row


async def sync_defaults(db: AsyncSession, tenant_id: str) -> dict[str, int]:
    """把 registry 灌進資料庫：缺的列補上，既有列只更新中繼資料。

    **永遠不動 `content` 與 `draft`**——承辦人改過的字不會被一次部署蓋回預設值
    （搬遷進來的舊文案也一樣，見 `scripts/migrate_legacy/youth.py`）。
    啟動時與 seed 都會呼叫。
    """
    existing = {
        row.key: row
        for row in (await db.execute(select(Content).where(Content.tenant_id == tenant_id))).scalars()
    }
    inserted = updated = 0
    for definition in CONTENT_REGISTRY:
        row = existing.get(definition.key)
        if row is None:
            db.add(
                Content(
                    tenant_id=tenant_id,
                    key=definition.key,
                    category=definition.category,
                    title=definition.title,
                    description=definition.description,
                    content=definition.default,
                    content_type=definition.content_type,
                    variables=list(definition.variables),
                    sort_order=definition.sort_order,
                )
            )
            inserted += 1
            continue
        if _refresh_metadata(row, definition):
            updated += 1
    await db.flush()
    invalidate(tenant_id)
    return {"inserted": inserted, "updated": updated, "total": len(CONTENT_REGISTRY)}


def _refresh_metadata(row: Content, definition: ContentDefinition) -> bool:
    """只同步「這段字是什麼」，不同步「這段字寫什麼」。"""
    changed = False
    for attr, value in (
        ("category", definition.category),
        ("title", definition.title),
        ("description", definition.description),
        ("content_type", definition.content_type),
        ("variables", list(definition.variables)),
        ("sort_order", definition.sort_order),
    ):
        if getattr(row, attr) != value:
            setattr(row, attr, value)
            changed = True
    return changed


async def save_draft(
    db: AsyncSession,
    tenant_id: str,
    key: str,
    draft: str,
    *,
    actor: Actor | None = None,
    expected_version: int | None = None,
) -> ContentView:
    """存草稿。LINE 還是唸 `content`，民眾看不到半成品。"""
    row = await get_or_create(db, tenant_id, key)
    check_version(row, expected_version)
    row.draft = draft
    bump(row)
    await audit.log(db, actor, "save_draft", "content", key, {"length": len(draft)}, tenant_id=tenant_id)
    await db.flush()
    return _view(row)


async def publish(
    db: AsyncSession,
    tenant_id: str,
    key: str,
    text: str | None = None,
    *,
    actor: Actor | None = None,
    expected_version: int | None = None,
    now: datetime | None = None,
    record_audit: bool = True,
) -> ContentView:
    """發布。草稿清空、版本遞增、快取失效；文字真的變了才寫稽核。

    `record_audit=False` 給 `reset()` 用——那一步自己會寫一列 `reset`，
    再寫一列 `publish` 只會讓稽核出現兩筆講同一件事的紀錄。
    """
    row = await get_or_create(db, tenant_id, key)
    check_version(row, expected_version)
    before = row.content
    after = before if text is None else text
    row.content = after
    row.draft = None
    row.published_at = now or datetime.now(UTC)
    row.published_by = actor.id if actor else None
    bump(row)
    if record_audit and before != after:
        await audit.log(
            db, actor, "publish", "content", key,
            {"content": {"from": before, "to": after}}, tenant_id=tenant_id,
        )
    await db.flush()
    invalidate(tenant_id)
    return _view(row)


async def publish_draft(
    db: AsyncSession,
    tenant_id: str,
    key: str,
    *,
    actor: Actor | None = None,
    expected_version: int | None = None,
) -> ContentView:
    """發布目前的草稿；沒有草稿就等於重新發布現行文字。"""
    row = await get_or_create(db, tenant_id, key)
    return await publish(
        db, tenant_id, key, row.draft if row.draft is not None else row.content,
        actor=actor, expected_version=expected_version,
    )


async def reset(
    db: AsyncSession,
    tenant_id: str,
    key: str,
    *,
    actor: Actor | None = None,
    expected_version: int | None = None,
) -> ContentView:
    """還原成出廠文案。一定寫稽核——「誰把這段字改回去了」跟改成什麼一樣重要。"""
    definition = get_definition(key)
    if definition is None:
        from fastapi import HTTPException

        raise HTTPException(404, CONTENT_NOT_FOUND)
    row = await get_or_create(db, tenant_id, key)
    check_version(row, expected_version)
    before = row.content
    view = await publish(db, tenant_id, key, definition.default, actor=actor, expected_version=None,
                         record_audit=False)
    await audit.log(
        db, actor, "reset", "content", key,
        {"content": {"from": before, "to": definition.default}}, tenant_id=tenant_id,
    )
    await db.flush()
    return view


# ----------------------------------------------------------------- 後台查詢

async def list_contents(
    db: AsyncSession,
    tenant_id: str,
    *,
    category: str | None = None,
    q: str | None = None,
) -> list[ContentView]:
    """後台列表。先確保 registry 的 key 都有列，再依分類／關鍵字過濾。"""
    await sync_defaults(db, tenant_id)
    where = [Content.tenant_id == tenant_id]
    if category:
        where.append(Content.category == category)
    rows = (
        await db.execute(select(Content).where(*where).order_by(Content.sort_order, Content.key))
    ).scalars().all()
    views = [_view(row) for row in rows]
    if q:
        needle = q.strip().lower()
        views = [
            v for v in views
            if needle in v.key.lower()
            or needle in v.title.lower()
            or needle in (v.content or "").lower()
            or needle in (v.draft or "").lower()
        ]
    return views


def categories() -> list[dict[str, Any]]:
    return [asdict(c) for c in CONTENT_CATEGORIES]


async def stats(db: AsyncSession, tenant_id: str) -> dict[str, int]:
    """後台首頁的三個數字：總數、被改過的、還有草稿的。"""
    rows = (
        await db.execute(select(Content).where(Content.tenant_id == tenant_id))
    ).scalars().all()
    customised = sum(1 for r in rows if r.content != registry_default(r.key) and get_definition(r.key))
    drafts = sum(1 for r in rows if r.draft is not None and r.draft != r.content)
    total = (
        await db.execute(select(func.count(Content.id)).where(Content.tenant_id == tenant_id))
    ).scalar_one()
    return {"total": int(total), "registry": len(CONTENT_REGISTRY), "customised": customised, "drafts": drafts}


# ------------------------------------------------------------------- 預覽

async def preview(db: AsyncSession, tenant_id: str, key: str, text: str | None = None) -> dict[str, Any]:
    """後台編輯器的即時預覽。

    回三件事：這段字代入範例變數長什麼樣、少了哪些變數、以及它出現在哪些
    真實畫面上（用同一組 Flex builder 產生，不是另外畫一份近似的）。
    """
    definition = get_definition(key)
    row = await _row(db, tenant_id, key)
    draft = text if text is not None else ((row.draft if row and row.draft is not None else row.content) if row else "")
    if not draft and definition:
        draft = definition.default
    kind = (row.content_type if row else None) or (definition.content_type if definition else "text")
    declared = list(definition.variables) if definition else declared_variables(draft)

    from .line import flex  # 延後匯入：flex 會回頭讀 contents

    surfaces = await flex.preview_surfaces(db, tenant_id)
    return {
        "key": key,
        "kind": kind,
        "rendered": substitute(draft, SAMPLE_VARIABLES),
        "sample_variables": {name: SAMPLE_VARIABLES.get(name, "") for name in declared},
        "missing_variables": [name for name in declared if f"{{{{{name}}}}}" not in draft],
        "unknown_variables": [name for name in declared_variables(draft) if name not in declared],
        "quick_replies": await _preview_quick_replies(db, tenant_id, key),
        "where": definition.description if definition else "",
        "surfaces": surfaces,
    }


async def _preview_quick_replies(db: AsyncSession, tenant_id: str, key: str) -> list[str]:
    if not (key.startswith(_QUICK_REPLY_PREFIXES) or key in _QUICK_REPLY_KEYS):
        return []
    from .line import flex

    return await flex.main_menu_labels(db, tenant_id)
