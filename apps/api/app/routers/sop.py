"""`/api/sop/*`：市民端的 SOP 教學（SPEC §8.1、§8.5、§10.2）。

**匿名**（跟 `/api/apply/*` 一樣不登入、依來源 IP 限流）、**只讀已發布的流程**。
apply-web 的 `/sop` 與 `/sop/:flow` 走這一組端點。

薄殼一如其他 router：所有邏輯在 `services/sop_public.py`，`/v1/sop/*`（API key）
呼叫的是同一組函式，兩個門不會各自長出一套行為（CLAUDE.md 規則 2）。

`POST /locate` 收的是市民的截圖：bytes 讀進記憶體、交給檢索、函式結束就沒了，
**中途不寫任何物件儲存、不寫資料庫**（SPEC §11 紅線 3）。
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..ai.image_utils import ImageTooLarge, InvalidImage, read_image_upload
from ..db import get_db
from ..ratelimit import rate_limit
from ..services import sop_public, tenancy

router = APIRouter(prefix="/api/sop", tags=["sop"])

# 讀多寫少：瀏覽步驟卡很頻繁，定位要跑模型所以嚴格得多。
READ_LIMIT_PER_MINUTE = 120
LOCATE_LIMIT_PER_MINUTE = 12

read_guard = Depends(rate_limit("sop:rl:read", READ_LIMIT_PER_MINUTE))
locate_guard = Depends(rate_limit("sop:rl:locate", LOCATE_LIMIT_PER_MINUTE))


async def _tenant(db: AsyncSession) -> str:
    return await tenancy.default_tenant_id(db)


@router.get("/catalog/platforms", dependencies=[read_guard])
async def catalog_platforms(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    """有教學的平台（App／網頁／電腦版）。"""
    return await sop_public.platforms(db, await _tenant(db))


@router.get("/catalog/goals", dependencies=[read_guard])
async def catalog_goals(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    """有教學的目標文件。"""
    return await sop_public.goals(db, await _tenant(db))


@router.get("/catalog/flows", dependencies=[read_guard])
async def catalog_flows(
    platform_id: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """已發布的流程，可依平台過濾。"""
    return await sop_public.flows(db, await _tenant(db), platform_id=platform_id)


@router.get("/document-types/{code}/flows", dependencies=[read_guard])
async def document_type_flows(
    code: str,
    platform_id: str | None = Query(default=None),
    scheme: str = Query(default=""),
    rejection_code: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """這份文件有哪些教學（SPEC §8.5 的 `document_type_sop_flows`）。

    帶 `scheme` + `rejection_code` 時先看承辦人在那個退件碼上挑過哪幾條，
    沒挑才退回文件類型本身的對照。
    """
    return await sop_public.document_type_flows(
        db, await _tenant(db), code, platform_id=platform_id,
        scheme_code=scheme, rejection_code=rejection_code,
    )


@router.get("/flows/{flow_id}/steps", dependencies=[read_guard])
async def flow_steps(
    flow_id: str,
    goal_id: str | None = Query(default=None),
    from_step_id: str | None = Query(default=None),
    theme: Literal["light", "dark"] = "light",
    number_from: int = 1,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """一條已發布流程的逐步卡片（每一步一張編號圖，沒有圖就退回文字）。"""
    return await sop_public.flow_steps(
        db, await _tenant(db), flow_id, goal_id=goal_id,
        from_step_id=from_step_id, theme=theme, number_from=number_from,
    )


@router.post("/locate", dependencies=[locate_guard])
async def locate(
    file: UploadFile = File(...),
    platform_id: str | None = Form(default=None),
    flow_id: str | None = Form(default=None),
    step_id: str | None = Form(default=None),
    goal_id: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """「我卡住了」：這張截圖是哪一步。

    回 `{outcome, step, guidance, cards}`。圖片只在記憶體裡走一遭，永不落地。
    """
    try:
        png = await read_image_upload(file)
    except ImageTooLarge:
        raise errors.ApiError(413, errors.IMAGE_TOO_LARGE, "圖片過大")
    except InvalidImage:
        raise errors.ApiError(400, errors.IMAGE_INVALID, "無法讀取圖片")
    out = await sop_public.locate(
        db, await _tenant(db), png,
        platform_id=platform_id, flow_id=flow_id, step_id=step_id, goal_id=goal_id,
        session_id="web",
    )
    return {
        "outcome": out.get("outcome"),
        "step": {"flow_id": out.get("flow_id"), "step_id": out.get("step_id"), "confidence": out.get("confidence")},
        "guidance": out.get("guidance"),
        "cards": out.get("cards"),
        "screen": out.get("screen"),
    }
