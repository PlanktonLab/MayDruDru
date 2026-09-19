"""Shared building blocks for every table (SPEC §6).

`TsMixin` gives a row its timestamps; `VersionMixin` gives an editable
configuration row the optimistic-locking counter that `services/versioning.py`
compares against and bumps on write.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

EMBED_DIM = 1536

__all__ = ["EMBED_DIM", "Base", "TsMixin", "VersionMixin", "new_id", "now"]


def now() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return uuid.uuid4().hex


class TsMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class VersionMixin:
    """Optimistic locking for editable configuration (SPEC §6).

    A writer sends the version it loaded; `services.versioning.check_version`
    refuses the write with 409 when the row moved on, and bumps it afterwards.
    """

    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
