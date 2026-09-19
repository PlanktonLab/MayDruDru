from functools import lru_cache

import redis.asyncio as aioredis

from .config import get_settings


@lru_cache
def redis() -> aioredis.Redis:
    return aioredis.from_url(get_settings().redis_url, decode_responses=False)


async def get_redis() -> aioredis.Redis:
    """FastAPI dependency 版本，測試用 `dependency_overrides` 換成假的（SPEC §14）。"""
    return redis()
