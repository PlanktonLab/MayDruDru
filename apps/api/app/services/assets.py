"""Private storage objects owned by variants (originals, replicas).

Rows referencing these objects must only be deleted after the objects are gone;
otherwise a clerk's encrypted original outlives every pointer to it.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..models import Flow, Step, Variant

PURGE_FAILED_MESSAGE = "無法刪除已儲存的截圖，請稍後再試"


class AssetPurgeError(RuntimeError):
    """Storage refused to delete a variant's private object; nothing should be deleted from the DB."""


def private_objects(v: Variant) -> list[tuple[str, str]]:
    """(kind, key) for every private object a variant points at."""
    keys = [("original", v.original_key), ("private", v.replica_html_key), ("private", v.replica_png_key)]
    return [(kind, key) for kind, key in keys if key]


async def purge_variant_assets(variants: Iterable[Variant]) -> None:
    for v in variants:
        for kind, key in private_objects(v):
            delete = storage.delete_original if kind == "original" else storage.delete_private
            try:
                await asyncio.to_thread(delete, key)
            except Exception as e:
                raise AssetPurgeError(f"variant {v.id}: cannot delete {key}") from e


async def variants_of_step(db: AsyncSession, step_id: str) -> list[Variant]:
    return list((await db.execute(select(Variant).where(Variant.step_id == step_id))).scalars())


async def variants_of_flow(db: AsyncSession, flow_id: str) -> list[Variant]:
    q = select(Variant).join(Step, Step.id == Variant.step_id).where(Step.flow_id == flow_id)
    return list((await db.execute(q)).scalars())


async def variants_of_platform(db: AsyncSession, platform_id: str) -> list[Variant]:
    q = (select(Variant).join(Step, Step.id == Variant.step_id).join(Flow, Flow.id == Step.flow_id)
         .where(Flow.platform_id == platform_id))
    return list((await db.execute(q)).scalars())
