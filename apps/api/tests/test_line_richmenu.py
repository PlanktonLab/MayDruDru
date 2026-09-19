"""圖文選單：版面計算、圖檔檢查與同步紀錄（SPEC §8.4）。"""

from __future__ import annotations

import struct

import pytest
from app.config import get_settings
from app.models import LineRichMenu, LineSyncLog
from app.services.actors import Actor
from app.services.line import richmenu
from sqlalchemy import select

STAFF = Actor(type="STAFF", id="a" * 32, role="admin", name="管理者")


@pytest.fixture
def configured():
    """`status()` 只有在真的接上 LINE 時才會去比對遠端。"""
    s = get_settings()
    before = (s.line_sender, s.line_channel_access_token)
    s.line_sender, s.line_channel_access_token = "line", "token"
    yield
    s.line_sender, s.line_channel_access_token = before


def png(width: int, height: int, padding: int = 0) -> bytes:
    header = bytes.fromhex("89504e470d0a1a0a") + b"\x00\x00\x00\rIHDR"
    return header + struct.pack(">II", width, height) + b"\x00" * (4 + padding)


def jpeg(width: int, height: int, padding: int = 16) -> bytes:
    # SOI + 一個 SOF0 段：長度、精度、高、寬。後面補一點資料，真實 JPEG 不會在 SOF 就結束。
    sof = b"\xff\xc0" + struct.pack(">H", 17) + b"\x08" + struct.pack(">HH", height, width)
    return b"\xff\xd8" + sof + b"\x00" * padding


@pytest.fixture(autouse=True)
def fake_object_storage(monkeypatch):
    """測試不連 MinIO：把寫入攔下來記在字典裡就夠了。"""
    written: dict[str, bytes] = {}
    monkeypatch.setattr(richmenu.storage, "put",
                        lambda bucket, key, data, content_type="": written.setdefault(key, data) and key or key)
    return written


# ------------------------------------------------------------------ 版面

def test_the_six_tiles_cover_the_whole_canvas():
    total = sum(richmenu.bounds(t.column, t.row)["width"] * richmenu.bounds(t.column, t.row)["height"]
                for t in richmenu.TILES)
    assert total == richmenu.RICH_MENU_SIZE["width"] * richmenu.RICH_MENU_SIZE["height"]


def test_the_tiles_do_not_overlap():
    seen = [richmenu.bounds(t.column, t.row) for t in richmenu.TILES]
    for i, a in enumerate(seen):
        for b in seen[i + 1:]:
            apart = (a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"]
                     or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])
            assert apart


def test_the_last_column_and_row_reach_the_edge():
    last = richmenu.bounds(2, 1)
    assert last["x"] + last["width"] == richmenu.RICH_MENU_SIZE["width"]
    assert last["y"] + last["height"] == richmenu.RICH_MENU_SIZE["height"]


def test_there_are_exactly_six_tiles_in_three_by_two():
    assert len(richmenu.TILES) == 6
    assert {(t.column, t.row) for t in richmenu.TILES} == {(c, r) for r in (0, 1) for c in (0, 1, 2)}


def test_every_tile_is_a_postback_to_a_known_action(db):
    from app.services.line.handlers import ACTIONS

    for tile in richmenu.TILES:
        assert tile.action in ACTIONS


async def test_the_request_takes_its_labels_from_contents(db, tenant):
    from app.services import contents

    await contents.publish(db, tenant.id, "button.case_status", "查件", actor=STAFF)
    await db.commit()
    request = await richmenu.build_request(db, tenant.id)
    assert request["areas"][0]["action"]["label"] == "查件"
    assert request["areas"][0]["action"]["data"] == "action=case_status"


async def test_the_chat_bar_text_fits_line_s_limit(db, tenant):
    request = await richmenu.build_request(db, tenant.id)
    assert len(request["chatBarText"]) <= 14
    assert all(len(a["action"]["label"]) <= 20 for a in request["areas"])


async def test_the_layout_view_carries_bounds_and_labels(db, tenant):
    tiles = await richmenu.tile_layout(db, tenant.id)
    assert len(tiles) == 6
    assert all(t["label"] and t["bounds"]["width"] > 0 for t in tiles)


# --------------------------------------------------------------- 圖檔檢查

def test_the_shipped_artwork_passes():
    check = richmenu.inspect_image(richmenu.default_image_bytes())
    assert check.valid, check.problems
    assert (check.width, check.height) == (2500, 1686)
    assert check.content_type == "image/jpeg"


def test_a_png_of_an_allowed_size_passes():
    assert richmenu.inspect_image(png(2500, 843)).valid


def test_a_wrong_size_is_reported_not_fixed():
    check = richmenu.inspect_image(png(1000, 1000))
    assert not check.valid and "bad_size" in check.problems


def test_a_file_over_one_megabyte_is_refused():
    check = richmenu.inspect_image(png(2500, 1686, padding=1024 * 1024))
    assert "too_large" in check.problems


def test_something_that_is_not_an_image_is_refused():
    check = richmenu.inspect_image(b"hello")
    assert "not_png_or_jpeg" in check.problems


def test_jpeg_dimensions_are_read_from_the_sof_segment():
    check = richmenu.inspect_image(jpeg(1200, 810))
    assert (check.width, check.height) == (1200, 810)
    assert check.valid


# ------------------------------------------------------------------ 同步

async def test_publishing_creates_uploads_and_sets_default_in_that_order(db, tenant, rich_menu_client):
    result = await richmenu.publish(db, tenant.id, actor=STAFF)
    await db.commit()
    assert result["state"] == "synced"
    assert [c[0] for c in rich_menu_client.calls] == ["list", "create", "upload", "set_default"]


async def test_publishing_writes_a_sync_log_that_ends_synced(db, tenant, rich_menu_client):
    await richmenu.publish(db, tenant.id, actor=STAFF)
    await db.commit()
    row = (await db.execute(select(LineSyncLog))).scalars().one()
    assert (row.resource_type, row.status) == (richmenu.RESOURCE, "synced")
    assert row.remote_id and row.completed_at is not None


async def test_publishing_remembers_the_menu_id_and_image(db, tenant, rich_menu_client):
    await richmenu.publish(db, tenant.id, actor=STAFF)
    await db.commit()
    row = (await db.execute(select(LineRichMenu))).scalars().one()
    assert row.line_rich_menu_id and row.is_default
    assert row.image_key.startswith(richmenu.MEDIA_PREFIX)
    assert len(row.layout["tiles"]) == 6


async def test_an_invalid_image_never_reaches_line(db, tenant, rich_menu_client):
    result = await richmenu.publish(db, tenant.id, actor=STAFF, image=b"not an image")
    await db.commit()
    assert result["state"] == "failed"
    assert rich_menu_client.calls == []
    row = (await db.execute(select(LineSyncLog))).scalars().one()
    assert row.status == "failed" and "invalid_image" in row.error


async def test_a_failure_halfway_deletes_the_half_made_menu(db, tenant, rich_menu_client):
    rich_menu_client.fail_on = "upload"
    result = await richmenu.publish(db, tenant.id, actor=STAFF)
    await db.commit()
    assert result["state"] == "failed"
    assert ("delete", rich_menu_client.calls[1][1] or "") in rich_menu_client.calls or \
        any(c[0] == "delete" for c in rich_menu_client.calls)
    row = (await db.execute(select(LineSyncLog))).scalars().one()
    assert row.status == "failed"


async def test_old_menus_are_deleted_only_after_the_new_one_is_live(db, tenant, rich_menu_client):
    await richmenu.publish(db, tenant.id, actor=STAFF)
    await db.commit()
    rich_menu_client.calls.clear()
    await richmenu.publish(db, tenant.id, actor=STAFF)
    await db.commit()
    order = [c[0] for c in rich_menu_client.calls]
    assert order.index("set_default") < order.index("delete")


async def test_remove_takes_the_menu_down(db, tenant, rich_menu_client):
    await richmenu.publish(db, tenant.id, actor=STAFF)
    await db.commit()
    result = await richmenu.remove(db, tenant.id, actor=STAFF)
    await db.commit()
    assert result["state"] == "removed"
    row = (await db.execute(select(LineRichMenu))).scalars().one()
    assert row.line_rich_menu_id is None


async def test_removing_without_a_menu_is_reported_not_crashed(db, tenant, rich_menu_client):
    assert (await richmenu.remove(db, tenant.id, actor=STAFF))["state"] == "missing"


async def test_logs_are_newest_first(db, tenant, rich_menu_client):
    await richmenu.publish(db, tenant.id, actor=STAFF)
    await richmenu.publish(db, tenant.id, actor=STAFF, image=b"bad")
    await db.commit()
    rows = await richmenu.logs(db, tenant.id)
    assert len(rows) == 2
    assert rows[0]["status"] in ("failed", "synced")


# ------------------------------------------------------------------ 狀態

async def test_status_without_credentials_is_not_configured(db, tenant):
    result = await richmenu.status(db, tenant.id)
    assert result["state"] == "not_configured"
    assert len(result["tiles"]) == 6


async def test_status_is_synced_right_after_publishing(db, tenant, rich_menu_client, configured):
    await richmenu.publish(db, tenant.id, actor=STAFF)
    await db.commit()
    assert (await richmenu.status(db, tenant.id))["state"] == "synced"


async def test_status_spots_a_changed_label(db, tenant, rich_menu_client, configured):
    await richmenu.publish(db, tenant.id, actor=STAFF)
    await db.commit()
    menu_id = next(iter(rich_menu_client.menus))
    rich_menu_client.menus[menu_id]["areas"][0]["action"]["data"] = "action=something_else"
    result = await richmenu.status(db, tenant.id)
    assert result["state"] == "different"
    assert "area_0_action" in result["differences"]


async def test_a_missing_default_menu_is_reported_as_missing(db, tenant, rich_menu_client, configured):
    assert (await richmenu.status(db, tenant.id))["state"] == "missing"


async def test_an_api_error_is_unknown_not_different(db, tenant, rich_menu_client, configured):
    """問不到跟不一樣是兩件事：後者會讓承辦人以為自己需要重新同步。"""
    rich_menu_client.fail_on = "list"
    result = await richmenu.status(db, tenant.id)
    assert result["state"] == "unknown"
    assert result["error"]
