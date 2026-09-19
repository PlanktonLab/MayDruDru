from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def engine():
    global _engine
    if _engine is None:
        # One API process (or one worker with max_jobs=4) per engine. Turns
        # release their connection before awaiting a model, so 10 + 10 overflow
        # covers bursts; waiting 30s for a connection surfaces pool exhaustion
        # as an error instead of a hang, and recycling every 30 min avoids
        # connections silently dropped by proxies/firewalls.
        _engine = create_async_engine(get_settings().database_url, pool_pre_ping=True, pool_size=10, max_overflow=10,
                                      pool_timeout=30, pool_recycle=1800)
    return _engine


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(engine(), expire_on_commit=False)
    return _sessionmaker


async def release_connection(db: AsyncSession) -> None:
    """End the session's transaction so its pooled connection goes back to the
    pool. Call before awaiting anything slow (model calls, renderer). Loaded
    objects stay usable (expire_on_commit=False); pending changes are committed."""
    if db.in_transaction():
        await db.commit()


async def get_db() -> AsyncIterator[AsyncSession]:
    async with sessionmaker()() as session:
        yield session
