"""Public image delivery for Step Cards: content-addressed keys, long cache."""

import asyncio

from fastapi import APIRouter, HTTPException, Response

from .. import storage

router = APIRouter(tags=["media"])

# `media/`：後台上傳的公開圖與圖文選單美術稿（SPEC §6.4）。其餘都是 Step Card 相關。
PUBLIC_PREFIXES = ("cards/", "previews/", "thumbs/", "media/")
CONTENT_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


@router.get("/media/{key:path}")
async def media(key: str):
    if ".." in key or not key.startswith(PUBLIC_PREFIXES):
        raise HTTPException(404, "找不到圖片")
    try:
        data = await asyncio.to_thread(storage.get_public, key)
    except Exception:
        raise HTTPException(404, "找不到圖片")
    ctype = CONTENT_TYPES.get(key.rsplit(".", 1)[-1].lower(), "image/png")
    return Response(data, media_type=ctype, headers={"Cache-Control": "public, max-age=31536000, immutable"})
