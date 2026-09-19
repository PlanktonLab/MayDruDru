"""Enqueue helpers used by the API process.

Jobs are serialised as JSON, not arq's default pickle: anything able to write
to Redis could otherwise run code in the worker. Job arguments and results
must therefore be JSON-serialisable (ids, small dicts, strings).
"""

import json

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from .config import get_settings


def job_serializer(obj) -> bytes:
    return json.dumps(obj, default=str).encode()


def job_deserializer(data: bytes):
    return json.loads(data)


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(get_settings().redis_url)


_pool: ArqRedis | None = None


async def pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(redis_settings(), job_serializer=job_serializer, job_deserializer=job_deserializer)
    return _pool


async def enqueue(name: str, *args, **kwargs) -> str | None:
    job = await (await pool()).enqueue_job(name, *args, **kwargs)
    return job.job_id if job else None
