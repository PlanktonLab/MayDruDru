"""Public image delivery for Step Cards: content-addressed keys, long cache."""

import asyncio

from fastapi import APIRouter, HTTPException, Response

from .. import storage

router = APIRouter(tags=["media"])

PUBLIC_PREFIXES = ("cards/", "previews/", "thumbs/")


@router.get("/media/{key:path}")
async def media(key: str):
    if ".." in key or not key.startswith(PUBLIC_PREFIXES):
        raise HTTPException(404, "找不到圖片")
    try:
        data = await asyncio.to_thread(storage.get_public, key)
    except Exception:
        raise HTTPException(404, "找不到圖片")
    ctype = "image/jpeg" if key.endswith(".jpg") else "image/png"
    return Response(data, media_type=ctype, headers={"Cache-Control": "public, max-age=31536000, immutable"})
