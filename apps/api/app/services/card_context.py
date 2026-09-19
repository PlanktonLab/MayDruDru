"""Everything a Step Card render needs besides the replica, gathered once for
the worker and for the live preview so both draw the same card.

A layout comes in two parts (SPEC §9.1): the *template* — the tenant's for
this channel, or the built-in one — and the step's *patch*, only the keys the
clerk changed on this step. `merge_layout` lays the patch over the template;
a later template edit still reaches every key the step left alone."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..dag import step_number
from ..models import Edge, Flow, Platform, Step, Tenant, Variant
from ..schemas import StepCardLayout, StepCardLayoutPatch
from .stepcard import default_layout

log = logging.getLogger("sop.stepcard")

TENANT_LAYOUT_KEY = "stepcard_layout"  # tenant.settings[key][channel]


@dataclass
class CardContext:
    tenant_id: str
    channel: str
    title: str
    instruction: str
    number: int | None
    layout: dict     # what this variant renders with: template + patch
    template: dict   # tenant template, or the built-in one
    patch: dict      # the step's own changes ({} when it follows the template)
    built_in: dict


def valid_template(layout: object, what: str) -> dict | None:
    """A stored template that no longer validates (or predates the current
    shape) is ignored rather than breaking every render."""
    if not layout:
        return None
    try:
        return StepCardLayout.model_validate(layout).model_dump()
    except ValidationError:
        log.warning("ignoring invalid %s layout", what)
        return None


def valid_patch(patch: object) -> dict:
    if not patch:
        return {}
    try:
        return StepCardLayoutPatch.model_validate(patch).sparse()
    except ValidationError:
        log.warning("ignoring invalid step layout patch")
        return {}


def merge_layout(template: dict, patch: dict) -> dict:
    """The template with the patch's keys laid over it, block by block."""
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in template.items()}
    for block, values in patch.items():
        if isinstance(values, dict) and isinstance(out.get(block), dict):
            out[block].update(values)
    return out


def tenant_layout(tenant: Tenant | None, channel: str) -> dict | None:
    return valid_template(((tenant.settings if tenant else None) or {}).get(TENANT_LAYOUT_KEY, {}).get(channel), "tenant")


def resolve_layouts(v: Variant, tenant: Tenant | None, channel: str) -> tuple[dict, dict, dict, dict]:
    """(effective layout, template, patch, built-in) for a variant."""
    built_in = default_layout(v.replica_width, v.replica_height, channel)
    template = tenant_layout(tenant, channel) or built_in
    patch = valid_patch(v.stepcard_layout)
    return merge_layout(template, patch), template, patch, built_in


async def load_card_context(db: AsyncSession, v: Variant) -> CardContext:
    step = await db.get(Step, v.step_id)
    flow = await db.get(Flow, step.flow_id)
    platform = await db.get(Platform, flow.platform_id)
    tenant = await db.get(Tenant, flow.tenant_id)
    start_id = await db.scalar(select(Step.id).where(Step.flow_id == flow.id, Step.is_start.is_(True)).limit(1))
    edges = (await db.execute(select(Edge.from_step_id, Edge.to_step_id).where(Edge.flow_id == flow.id))).all()
    number = step_number([tuple(e) for e in edges], start_id, step.id) if start_id else None
    layout, template, patch, built_in = resolve_layouts(v, tenant, platform.channel)
    return CardContext(tenant_id=flow.tenant_id, channel=platform.channel, title=step.title, instruction=step.instruction,
                       number=number, layout=layout, template=template, patch=patch, built_in=built_in)
