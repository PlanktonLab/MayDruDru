from functools import lru_cache

import redis.asyncio as aioredis

from .config import get_settings


@lru_cache
def redis() -> aioredis.Redis:
    return aioredis.from_url(get_settings().redis_url, decode_responses=False)
