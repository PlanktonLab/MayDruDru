"""`/api/admin/line/*`：圖文選單、推播紀錄與未命中訊息（SPEC §8.2「LINE 內容」）。

同步是對外動作（會改變每個民眾手機上的選單），所以要 `admin`；查看狀態與紀錄
任何登入的承辦人都可以。同步失敗回 502 並附上原因，而不是回 200 說「好了」。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...db import get_db
from ...deps import CurrentUser, current_user, require_cap
from ...models import Application, Notification, UnmatchedMessage
from ...services.actors import Actor
from ...services.line import richmenu

router = APIRouter(prefix="/api/admin/line", tags=["admin-line"])


@router.get("/richmenu")
async def richmenu_status(
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await richmenu.status(db, user.tenant_id)


@router.get(
    "/richmenu/image",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}}},
)
async def richmenu_image(
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """目前選單圖；沒有客製圖時回傳系統內建美術稿。"""
    data = await richmenu.current_image(db, user.tenant_id)
    check = richmenu.inspect_image(data)
    return Response(
        data,
        media_type=check.content_type,
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.post("/richmenu/sync")
async def richmenu_sync(
    image: UploadFile | None = File(default=None),
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """建立並發布圖文選單。沒有上傳圖就沿用目前那一張（或內建美術稿）。"""
    data = await image.read() if image is not None else None
    result = await richmenu.publish(db, user.tenant_id, actor=Actor.staff(user), image=data)
    await db.commit()
    if result.get("state") == "failed":
        raise HTTPException(502, {"message": "圖文選單同步失敗", **result})
    # 同步完重讀一次真實狀態，後台看到的就不是我們自己宣稱的結果。
    return {**result, "status": await richmenu.status(db, user.tenant_id)}


@router.delete("/richmenu")
async def richmenu_remove(
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await richmenu.remove(db, user.tenant_id, actor=Actor.staff(user))
    await db.commit()
    return result


@router.get("/sync-logs")
async def sync_logs(
    limit: int = Query(default=20, le=100),
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return {"items": await richmenu.logs(db, user.tenant_id, limit)}


@router.get("/notifications")
async def notifications(
    status: str | None = None,
    case_no: str | None = None,
    limit: int = Query(default=50, le=200),
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    where = [Notification.tenant_id == user.tenant_id]
    if status:
        where.append(Notification.status == status)
    if case_no:
        where.append(
            Notification.application_id.in_(
                select(Application.id).where(
                    Application.tenant_id == user.tenant_id, Application.case_no == case_no
                )
            )
        )
    rows = (
        await db.execute(
            select(Notification).where(*where).order_by(Notification.created_at.desc()).limit(limit)
        )
    ).scalars().all()
    return {
        "items": [
            {
                "id": r.id,
                "case_no": (r.payload or {}).get("case_no", ""),
                "kind": r.kind,
                "content_key": r.content_key,
                "status": r.status,
                "error": r.error,
                "transition_code": (r.payload or {}).get("transition_code", ""),
                "created_at": r.created_at,
                "sent_at": r.sent_at,
            }
            for r in rows
        ]
    }


@router.get("/unmatched")
async def unmatched(
    limit: int = Query(default=100, le=500),
    user: CurrentUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """意圖沒命中的自由文字，餵給內容助理 (b)（SPEC §8.6）。只有 userId 的 hash。"""
    rows = (
        await db.execute(
            select(UnmatchedMessage)
            .where(UnmatchedMessage.tenant_id == user.tenant_id)
            .order_by(UnmatchedMessage.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return {
        "items": [
            {
                "id": r.id,
                "text": r.text,
                "intent_result": r.intent_result,
                "user_hash": (r.line_user_id_hash or "")[:8],
                "created_at": r.created_at,
            }
            for r in rows
        ]
    }


@router.delete("/unmatched/{message_id}", status_code=204)
async def dismiss_unmatched(
    message_id: str,
    user: CurrentUser = Depends(require_cap("admin")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """處理過的訊息就刪掉——這張表是待辦清單，不是紀錄。"""
    row = (
        await db.execute(
            select(UnmatchedMessage).where(
                UnmatchedMessage.tenant_id == user.tenant_id, UnmatchedMessage.id == message_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "找不到這筆訊息")
    await db.delete(row)
    await db.commit()
