"""API-key managed outbound webhook subscriptions (SPEC §10.1/§10.3)."""

import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, HttpUrl, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import ApiCaller, require_api_scope
from ..models import WebhookDelivery, WebhookSubscription
from ..services import webhooks

router = APIRouter(prefix="/v1", tags=["webhooks"])


class SubscriptionIn(BaseModel):
    url: HttpUrl
    events: list[str] = Field(min_length=1)
    secret: str | None = Field(default=None, min_length=16, max_length=128)

    @field_validator("events")
    @classmethod
    def known_events(cls, value: list[str]) -> list[str]:
        unknown = set(value) - (webhooks.EVENTS - {"webhook.test"})
        if unknown:
            raise ValueError("unknown webhook events: " + ", ".join(sorted(unknown)))
        return sorted(set(value))


class SubscriptionOut(BaseModel):
    id: str
    url: str
    events: list[str]
    active: bool
    created_at: datetime
    secret: str | None = None


def _out(row: WebhookSubscription, secret: str | None = None) -> SubscriptionOut:
    return SubscriptionOut(id=row.id, url=row.url, events=list(row.events or []), active=row.active,
                           created_at=row.created_at, secret=secret)


@router.post("/webhooks", response_model=SubscriptionOut, status_code=201)
async def create_subscription(body: SubscriptionIn, caller: ApiCaller = Depends(require_api_scope("webhooks")),
                              db: AsyncSession = Depends(get_db)):
    secret = body.secret or secrets.token_urlsafe(32)
    row = WebhookSubscription(tenant_id=caller.tenant_id, api_key_id=caller.api_key_id,
                              url=str(body.url), secret=secret, events=body.events)
    db.add(row)
    await db.commit()
    return _out(row, secret)


@router.get("/webhooks", response_model=list[SubscriptionOut])
async def list_subscriptions(caller: ApiCaller = Depends(require_api_scope("webhooks")),
                             db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(WebhookSubscription).where(
        WebhookSubscription.tenant_id == caller.tenant_id,
    ).order_by(WebhookSubscription.created_at))).scalars().all()
    return [_out(row) for row in rows]


async def _owned(db: AsyncSession, caller: ApiCaller, subscription_id: str) -> WebhookSubscription:
    row = (await db.execute(select(WebhookSubscription).where(
        WebhookSubscription.id == subscription_id, WebhookSubscription.tenant_id == caller.tenant_id,
    ))).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "找不到 webhook subscription")
    return row


@router.delete("/webhooks/{subscription_id}")
async def delete_subscription(subscription_id: str, caller: ApiCaller = Depends(require_api_scope("webhooks")),
                              db: AsyncSession = Depends(get_db)):
    row = await _owned(db, caller, subscription_id)
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.post("/webhooks/{subscription_id}/test", status_code=202)
async def test_subscription(subscription_id: str, caller: ApiCaller = Depends(require_api_scope("webhooks")),
                            db: AsyncSession = Depends(get_db)):
    await _owned(db, caller, subscription_id)
    rows = await webhooks.create_deliveries(db, caller.tenant_id, "webhook.test",
                                             {"message": "MayDru webhook test"}, subscription_id=subscription_id)
    await db.commit()
    await webhooks.enqueue_deliveries(rows)
    return {"delivery_id": rows[0].id}


@router.get("/webhook-deliveries")
async def list_deliveries(subscription_id: str | None = None,
                          caller: ApiCaller = Depends(require_api_scope("webhooks")),
                          db: AsyncSession = Depends(get_db)):
    query = select(WebhookDelivery).where(WebhookDelivery.tenant_id == caller.tenant_id)
    if subscription_id:
        await _owned(db, caller, subscription_id)
        query = query.where(WebhookDelivery.subscription_id == subscription_id)
    rows = (await db.execute(query.order_by(WebhookDelivery.created_at.desc()).limit(100))).scalars().all()
    return rows


@router.post("/webhook-deliveries/{delivery_id}/resend", status_code=202)
async def resend_delivery(delivery_id: str, caller: ApiCaller = Depends(require_api_scope("webhooks")),
                          db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(WebhookDelivery).where(
        WebhookDelivery.id == delivery_id, WebhookDelivery.tenant_id == caller.tenant_id,
    ))).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "找不到 webhook delivery")
    row.status = "pending"
    row.last_error = ""
    await db.commit()
    await webhooks.enqueue_deliveries([row])
    return {"ok": True}
