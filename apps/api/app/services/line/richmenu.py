"""圖文選單（SPEC §8.4）。

版面是 3 欄 × 2 列、2500×1686 的畫布，六個格子剛好鋪滿（測試會驗六塊面積加起來
等於整張畫布）。每一格都是 postback，沒有一格送純文字——handler 因此永遠不必猜
民眾按了哪裡。

圖檔只檢查、不修改：尺寸或大小不合就把問題**回報**出去，不會自己縮圖再上傳，
因為一張被程式偷偷改過的圖跟設計稿對不起來，除錯會更久。問題用代碼回報
（`bad_size`、`too_large`…），中文說明在後台，這個檔案裡不放任何中文字串。

同步流程刻意是「先建新的，成功了才刪舊的」：中途失敗時使用者手機上的選單
還是原來那個，不會變成沒有選單。每一次同步都留一列 `line_sync_logs`。
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import storage
from ...config import get_settings
from ...models import LineRichMenu, LineSyncLog
from .. import contents
from ..actors import Actor
from .flex import MAIN_MENU, postback

log = logging.getLogger("maydru.line.richmenu")

__all__ = [
    "ALLOWED_SIZES",
    "DEFAULT_IMAGE_PATH",
    "MAX_IMAGE_BYTES",
    "MEDIA_PREFIX",
    "RESOURCE",
    "RICH_MENU_SIZE",
    "TILES",
    "ImageCheck",
    "Tile",
    "bounds",
    "build_request",
    "default_image_bytes",
    "get_client",
    "inspect_image",
    "logs",
    "publish",
    "remove",
    "set_client_for_testing",
    "status",
    "tile_layout",
]

RESOURCE = "richmenu"
RICH_MENU_SIZE = {"width": 2500, "height": 1686}
COLS = 3
ROWS = 2
ALLOWED_SIZES = ((2500, 1686), (2500, 843), (1200, 810))
MAX_IMAGE_BYTES = 1024 * 1024
MEDIA_PREFIX = "media/"
DEFAULT_IMAGE_PATH = Path(__file__).resolve().parents[2] / "content_registry" / "assets" / "richmenu.jpg"

_PNG_MAGIC = bytes.fromhex("89504e470d0a1a0a")


@dataclass(frozen=True)
class Tile:
    column: int
    row: int
    action: str
    label_key: str


# 順序＝美術稿的順序，也是主選單快速回覆的順序（`flex.MAIN_MENU`）。
TILES: tuple[Tile, ...] = tuple(
    Tile(column=index % COLS, row=index // COLS, action=action, label_key=key)
    for index, (action, key) in enumerate(MAIN_MENU)
)


def bounds(column: int, row: int) -> dict[str, int]:
    """一格的位置。最後一欄與最後一列貼齊畫布邊緣，六格之間不留死角。"""
    tile_w = RICH_MENU_SIZE["width"] / COLS
    tile_h = RICH_MENU_SIZE["height"] / ROWS
    x = round(column * tile_w)
    y = round(row * tile_h)
    next_x = RICH_MENU_SIZE["width"] if column == COLS - 1 else round((column + 1) * tile_w)
    next_y = RICH_MENU_SIZE["height"] if row == ROWS - 1 else round((row + 1) * tile_h)
    return {"x": x, "y": y, "width": next_x - x, "height": next_y - y}


async def tile_layout(db: AsyncSession, tenant_id: str) -> list[dict[str, Any]]:
    """後台畫面要的版面：每一格的位置、動作與（從 contents 來的）標籤。"""
    return [
        {
            "action": tile.action,
            "label_key": tile.label_key,
            "label": await contents.t(db, tenant_id, tile.label_key),
            "bounds": bounds(tile.column, tile.row),
            "data": postback(tile.action),
        }
        for tile in TILES
    ]


async def build_request(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    """送給 LINE 的 rich menu 定義（camelCase，SDK 可直接 `from_dict`）。"""
    areas = []
    for tile in TILES:
        label = await contents.t(db, tenant_id, tile.label_key)
        areas.append(
            {
                "bounds": bounds(tile.column, tile.row),
                "action": {
                    "type": "postback",
                    "label": label[:20],
                    "data": postback(tile.action),
                    "displayText": label[:20],
                },
            }
        )
    return {
        "size": dict(RICH_MENU_SIZE),
        "selected": True,
        "name": (await contents.t(db, tenant_id, "line.richmenu.name"))[:300],
        "chatBarText": (await contents.t(db, tenant_id, "line.richmenu.chat_bar_text"))[:14],
        "areas": areas,
    }


# ------------------------------------------------------------------ 圖檔檢查

@dataclass(frozen=True)
class ImageCheck:
    width: int
    height: int
    bytes: int
    content_type: str
    valid: bool
    problems: tuple[str, ...]

    def dict(self) -> dict[str, Any]:
        return {
            "width": self.width,
            "height": self.height,
            "bytes": self.bytes,
            "content_type": self.content_type,
            "valid": self.valid,
            "problems": list(self.problems),
        }


def inspect_image(data: bytes) -> ImageCheck:
    """只讀檔頭判斷格式與尺寸，不解碼像素（也就不怕解壓縮炸彈）。"""
    problems: list[str] = []
    is_png = data[:8] == _PNG_MAGIC
    is_jpeg = len(data) > 2 and data[0] == 0xFF and data[1] == 0xD8
    width = height = 0

    if is_png and len(data) >= 24:
        width = int.from_bytes(data[16:20], "big")
        height = int.from_bytes(data[20:24], "big")
    elif is_jpeg:
        width, height = _jpeg_size(data)
    else:
        problems.append("not_png_or_jpeg")

    if (width, height) not in ALLOWED_SIZES:
        problems.append("bad_size")
    if len(data) > MAX_IMAGE_BYTES:
        problems.append("too_large")

    return ImageCheck(
        width=width,
        height=height,
        bytes=len(data),
        content_type="image/jpeg" if is_jpeg else "image/png" if is_png else "application/octet-stream",
        valid=not problems,
        problems=tuple(problems),
    )


def _jpeg_size(data: bytes) -> tuple[int, int]:
    """走訪 JPEG 段落直到第一個 SOF，那裡才有真正的尺寸。"""
    offset = 2
    while offset < len(data) - 9:
        if data[offset] != 0xFF:
            break
        marker = data[offset + 1]
        length = int.from_bytes(data[offset + 2 : offset + 4], "big")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return (
                int.from_bytes(data[offset + 7 : offset + 9], "big"),
                int.from_bytes(data[offset + 5 : offset + 7], "big"),
            )
        if length <= 0:
            break
        offset += 2 + length
    return 0, 0


def default_image_bytes() -> bytes:
    """內建的美術稿。承辦人沒有上傳自己的圖時就用它。"""
    return DEFAULT_IMAGE_PATH.read_bytes()


# ------------------------------------------------------------ LINE API 介面

class RichMenuClient(Protocol):
    """rich menu 需要的六個遠端動作。抽出來是為了讓測試不必碰網路。"""

    async def list_menus(self) -> list[dict[str, Any]]: ...

    async def default_menu_id(self) -> str: ...

    async def create(self, request: dict[str, Any]) -> str: ...

    async def upload_image(self, menu_id: str, data: bytes, content_type: str) -> None: ...

    async def set_default(self, menu_id: str) -> None: ...

    async def delete(self, menu_id: str) -> None: ...


@dataclass
class NoopRichMenuClient:
    """記在記憶體裡的假 LINE。`calls` 讓測試看得到順序。"""

    menus: dict[str, dict[str, Any]] | None = None
    default_id: str = ""
    calls: list[tuple[str, str]] | None = None
    fail_on: str = ""

    def __post_init__(self) -> None:
        self.menus = self.menus if self.menus is not None else {}
        self.calls = self.calls if self.calls is not None else []

    def _record(self, op: str, target: str = "") -> None:
        assert self.calls is not None
        self.calls.append((op, target))
        if self.fail_on == op:
            raise RuntimeError(f"line api failed: {op}")

    async def list_menus(self) -> list[dict[str, Any]]:
        self._record("list")
        assert self.menus is not None
        return [{"richMenuId": mid, **body} for mid, body in self.menus.items()]

    async def default_menu_id(self) -> str:
        self._record("default")
        return self.default_id

    async def create(self, request: dict[str, Any]) -> str:
        self._record("create")
        assert self.menus is not None
        menu_id = f"richmenu-{len(self.menus) + 1:04d}"
        self.menus[menu_id] = dict(request)
        return menu_id

    async def upload_image(self, menu_id: str, data: bytes, content_type: str) -> None:
        self._record("upload", menu_id)

    async def set_default(self, menu_id: str) -> None:
        self._record("set_default", menu_id)
        self.default_id = menu_id

    async def delete(self, menu_id: str) -> None:
        self._record("delete", menu_id)
        assert self.menus is not None
        self.menus.pop(menu_id, None)
        if self.default_id == menu_id:
            self.default_id = ""


class RealRichMenuClient:
    """真的 Messaging API（line-bot-sdk v3）。"""

    def __init__(self, access_token: str) -> None:
        self._token = access_token

    async def _api(self) -> tuple[Any, Any]:
        from linebot.v3.messaging import AsyncApiClient, AsyncMessagingApi, Configuration

        client = AsyncApiClient(Configuration(access_token=self._token))
        return client, AsyncMessagingApi(client)

    async def list_menus(self) -> list[dict[str, Any]]:
        client, api = await self._api()
        try:
            response = await api.get_rich_menu_list()
            return [m.to_dict() for m in response.richmenus]
        finally:
            await client.close()

    async def default_menu_id(self) -> str:
        client, api = await self._api()
        try:
            return str((await api.get_default_rich_menu_id()).rich_menu_id)
        except Exception:
            return ""
        finally:
            await client.close()

    async def create(self, request: dict[str, Any]) -> str:
        from linebot.v3.messaging import RichMenuRequest

        client, api = await self._api()
        try:
            created = await api.create_rich_menu(RichMenuRequest.from_dict(request))
            return str(created.rich_menu_id)
        finally:
            await client.close()

    async def upload_image(self, menu_id: str, data: bytes, content_type: str) -> None:
        from linebot.v3.messaging import AsyncApiClient, AsyncMessagingApiBlob, Configuration

        client = AsyncApiClient(Configuration(access_token=self._token))
        try:
            await AsyncMessagingApiBlob(client).set_rich_menu_image(
                rich_menu_id=menu_id, body=bytearray(data), _headers={"Content-Type": content_type}
            )
        finally:
            await client.close()

    async def set_default(self, menu_id: str) -> None:
        client, api = await self._api()
        try:
            await api.set_default_rich_menu(menu_id)
        finally:
            await client.close()

    async def delete(self, menu_id: str) -> None:
        client, api = await self._api()
        try:
            await api.delete_rich_menu(menu_id)
        finally:
            await client.close()


_client: RichMenuClient | None = None


def get_client() -> RichMenuClient:
    global _client
    if _client is None:
        s = get_settings()
        if s.line_sender == "line" and s.line_channel_access_token:
            _client = RealRichMenuClient(s.line_channel_access_token)
        else:
            _client = NoopRichMenuClient()
    return _client


def set_client_for_testing(client: RichMenuClient | None) -> None:
    global _client
    _client = client


# ----------------------------------------------------------------- 狀態比對

async def status(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    """唯讀：本機版面與 LINE 上那一份差在哪。

    出錯回 `unknown` 而不是 `different`——「問不到」跟「不一樣」是兩件事，
    後者會讓承辦人以為自己需要重新同步。
    """
    s = get_settings()
    row = await _row(db, tenant_id)
    local = await build_request(db, tenant_id)
    result: dict[str, Any] = {
        "state": "unknown",
        "differences": [],
        "remote": [],
        "default_rich_menu_id": "",
        "local": local,
        "tiles": await tile_layout(db, tenant_id),
        "image_key": row.image_key if row else "",
        "last_sync": row.synced_at.isoformat() if row and row.synced_at else None,
        "checked_at": datetime.now(UTC).isoformat(),
    }
    if s.line_sender != "line" or not s.line_channel_access_token:
        result["state"] = "not_configured"
        return result
    try:
        remote = await get_client().list_menus()
        default_id = await get_client().default_menu_id()
    except Exception as e:
        log.warning("讀取 LINE rich menu 失敗：%s", e)
        result["error"] = _describe(e)
        return result

    result["remote"] = remote
    result["default_rich_menu_id"] = default_id
    current = next((m for m in remote if m.get("richMenuId") == default_id), None)
    if current is None:
        result["state"] = "missing"
        return result
    differences = _diff(local, current)
    result["differences"] = differences
    result["state"] = "synced" if not differences else "different"
    return result


def _diff(local: dict[str, Any], remote: dict[str, Any]) -> list[str]:
    """差異用代碼回報，後台翻成中文。"""
    out: list[str] = []
    if remote.get("size") != local["size"]:
        out.append("size")
    if remote.get("chatBarText") != local["chatBarText"]:
        out.append("chat_bar_text")
    remote_areas = remote.get("areas") or []
    if len(remote_areas) != len(local["areas"]):
        out.append("area_count")
        return out
    for index, (mine, theirs) in enumerate(zip(local["areas"], remote_areas)):
        if (theirs.get("action") or {}).get("data") != mine["action"]["data"]:
            out.append(f"area_{index}_action")
        if theirs.get("bounds") != mine["bounds"]:
            out.append(f"area_{index}_bounds")
    return out


def _describe(e: BaseException) -> str:
    body = getattr(e, "body", "")
    return (f"{e!r} {body}" if body else repr(e))[:400]


# ------------------------------------------------------------------- 發布

async def publish(
    db: AsyncSession,
    tenant_id: str,
    *,
    actor: Actor | None = None,
    image: bytes | None = None,
    set_as_default: bool = True,
    delete_others: bool = True,
) -> dict[str, Any]:
    """把本機版面推上 LINE。順序：建立 → 上傳圖 → 設為預設 → 才刪舊的。

    圖檔在呼叫 LINE **之前**先驗；驗不過就不會留下一個沒有圖的半成品選單。
    """
    data = image if image is not None else await _current_image(db, tenant_id)
    check = inspect_image(data)
    sync_log = LineSyncLog(
        tenant_id=tenant_id,
        resource_type=RESOURCE,
        resource_id="",
        operation="create+upload+set_default+delete_old",
        status="pending",
        actor_id=actor.id if actor else None,
    )
    db.add(sync_log)
    await db.flush()

    if not check.valid:
        return await _fail(db, sync_log, "invalid_image:" + ",".join(check.problems), check)

    client = get_client()
    previous: list[str] = []
    menu_id = ""
    try:
        previous = [m["richMenuId"] for m in await client.list_menus() if m.get("richMenuId")]
        menu_id = await client.create(await build_request(db, tenant_id))
        await client.upload_image(menu_id, data, check.content_type)
        if set_as_default:
            await client.set_default(menu_id)
    except Exception as e:
        if menu_id:
            try:
                await client.delete(menu_id)
            except Exception:
                log.warning("清掉半成品 rich menu 失敗：%s", menu_id)
        return await _fail(db, sync_log, _describe(e), check)

    if delete_others:
        for old in previous:
            try:
                await client.delete(old)
            except Exception:
                log.warning("刪除舊 rich menu 失敗（不影響這次同步）：%s", old)

    row = await _row(db, tenant_id)
    # 選單此刻已經在 LINE 上了；留存圖檔只是為了後台能顯示，存不起來不該把
    # 一次成功的同步標成失敗。
    image_key = await _store_image(data, check.content_type) or (row.image_key if row else "")
    if row is None:
        row = LineRichMenu(tenant_id=tenant_id, name=RESOURCE)
        db.add(row)
    row.layout = {"tiles": [{"action": t.action, "bounds": bounds(t.column, t.row)} for t in TILES]}
    row.image_key = image_key
    row.line_rich_menu_id = menu_id
    row.is_default = set_as_default
    row.synced_at = datetime.now(UTC)

    sync_log.status = "synced"
    sync_log.resource_id = menu_id
    sync_log.remote_id = menu_id
    sync_log.completed_at = datetime.now(UTC)
    await db.flush()
    return {"state": "synced", "rich_menu_id": menu_id, "image": check.dict(), "image_key": image_key,
            "deleted": previous if delete_others else []}


async def _fail(db: AsyncSession, sync_log: LineSyncLog, error: str, check: ImageCheck) -> dict[str, Any]:
    sync_log.status = "failed"
    sync_log.error = error[:2000]
    sync_log.completed_at = datetime.now(UTC)
    await db.flush()
    return {"state": "failed", "error": error, "image": check.dict()}


async def remove(db: AsyncSession, tenant_id: str, *, actor: Actor | None = None) -> dict[str, Any]:
    """把 LINE 上的選單撤下來。本機那一列留著，才看得出「曾經同步過」。"""
    row = await _row(db, tenant_id)
    menu_id = row.line_rich_menu_id if row else ""
    sync_log = LineSyncLog(
        tenant_id=tenant_id, resource_type=RESOURCE, resource_id=menu_id or "", operation="delete",
        status="pending", actor_id=actor.id if actor else None,
    )
    db.add(sync_log)
    await db.flush()
    if not menu_id:
        sync_log.status = "failed"
        sync_log.error = "no_rich_menu"
        sync_log.completed_at = datetime.now(UTC)
        await db.flush()
        return {"state": "missing"}
    try:
        await get_client().delete(menu_id)
    except Exception as e:
        return await _fail(db, sync_log, _describe(e), inspect_image(b""))
    if row is not None:
        row.line_rich_menu_id = None
        row.is_default = False
    sync_log.status = "synced"
    sync_log.completed_at = datetime.now(UTC)
    await db.flush()
    return {"state": "removed", "rich_menu_id": menu_id}


async def logs(db: AsyncSession, tenant_id: str, limit: int = 20) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(LineSyncLog)
            .where(LineSyncLog.tenant_id == tenant_id, LineSyncLog.resource_type == RESOURCE)
            .order_by(LineSyncLog.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [
        {
            "id": r.id,
            "operation": r.operation,
            "status": r.status,
            "remote_id": r.remote_id,
            "error": r.error,
            "actor_id": r.actor_id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        }
        for r in rows
    ]


async def _row(db: AsyncSession, tenant_id: str) -> LineRichMenu | None:
    return (
        await db.execute(
            select(LineRichMenu).where(LineRichMenu.tenant_id == tenant_id, LineRichMenu.name == RESOURCE)
        )
    ).scalar_one_or_none()


async def _current_image(db: AsyncSession, tenant_id: str) -> bytes:
    """承辦人上傳過的圖優先；沒有（或讀不到）就用內建美術稿。"""
    row = await _row(db, tenant_id)
    if row and row.image_key:
        try:
            import asyncio

            return await asyncio.to_thread(storage.get_public, row.image_key)
        except Exception:
            log.warning("讀不到已上傳的 rich menu 圖，改用內建美術稿：%s", row.image_key)
    return default_image_bytes()


async def _store_image(data: bytes, content_type: str) -> str:
    """公開 bucket、內容雜湊檔名（`media/` 前綴由 routers/media.py 放行）。

    存不進去回空字串：這一步失敗只代表後台看不到縮圖，選單本身已經上線了。
    """
    import asyncio

    ext = "jpg" if content_type == "image/jpeg" else "png"
    digest = hashlib.sha256(data).hexdigest()[:32]
    key = f"{MEDIA_PREFIX}{RESOURCE}/{digest}.{ext}"
    try:
        await asyncio.to_thread(storage.put, get_settings().s3_bucket_public, key, data, content_type)
    except Exception:
        log.warning("保存 rich menu 圖檔失敗（選單已上線）：%s", key, exc_info=True)
        return ""
    return key
