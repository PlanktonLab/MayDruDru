"""匿名端點的 per-IP 限流（SPEC §10.2）。

`/api/apply/*` 與 `/api/sop/*` 都是「不登入、任何人都打得到」的門，兩邊用同一份
固定視窗計數器，桶子的名字不同而已。

**Redis 掛掉時不擋流量**：限流是防濫用，不是防火牆；計數器讀不到就等於沒有限制，
而不是把所有市民一起擋在外面。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, HTTPException, Request

from .redis_client import get_redis

__all__ = ["RATE_LIMITED", "client_ip", "rate_limit"]

RATE_LIMITED = "RATE_LIMITED"


def client_ip(request: Request) -> str:
    """反向代理後面的真實來源；`deploy/nginx` 會設 `X-Forwarded-For`。"""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, limit: int, window: int = 60) -> Any:
    """固定視窗的 per-IP 計數，回傳一個 FastAPI dependency。"""

    async def dep(request: Request, r: Any = Depends(get_redis)) -> None:
        key = f"{bucket}:{client_ip(request)}:{int(datetime.now(UTC).timestamp() // window)}"
        try:
            hits = await r.incr(key)
            if hits == 1:
                await r.expire(key, window + 10)
        except Exception:
            return
        if hits > limit:
            raise HTTPException(429, {"code": RATE_LIMITED, "retry_after_seconds": window})

    return dep
