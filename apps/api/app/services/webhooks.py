"""Outbound webhook outbox, signing and delivery (SPEC §10.3)."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..jobs import enqueue
from ..models import WebhookDelivery, WebhookSubscription, new_id

EVENTS = frozenset({
    "application.status_changed", "application.created", "application.document_uploaded",
    "review.findings_updated", "sop.session_completed", "content.published", "webhook.test",
})
MAX_TRIES = 5
log = logging.getLogger("maydru.webhooks")


def encoded_payload(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def signature(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def create_deliveries(
    db: AsyncSession, tenant_id: str, event: str, data: dict[str, Any], *, subscription_id: str | None = None,
) -> list[WebhookDelivery]:
    if event not in EVENTS:
        raise ValueError(f"unsupported webhook event: {event}")
    query = select(WebhookSubscription).where(
        WebhookSubscription.tenant_id == tenant_id, WebhookSubscription.active.is_(True)
    )
    if subscription_id:
        query = query.where(WebhookSubscription.id == subscription_id)
    subscriptions = (await db.execute(query)).scalars().all()
    occurred_at = datetime.now(UTC).isoformat()
    rows: list[WebhookDelivery] = []
    for sub in subscriptions:
        if event != "webhook.test" and event not in (sub.events or []):
            continue
        delivery_id = new_id()
        payload = {"id": delivery_id, "event": event, "occurred_at": occurred_at,
                   "tenant_id": tenant_id, "data": data}
        rows.append(WebhookDelivery(id=delivery_id, tenant_id=tenant_id, subscription_id=sub.id,
                                    event=event, payload=payload))
    db.add_all(rows)
    await db.flush()
    return rows


async def enqueue_deliveries(rows: Sequence[WebhookDelivery]) -> None:
    for row in rows:
        try:
            await enqueue("deliver_webhook", row.id)
        except Exception:
            log.warning("排入 webhook 工作失敗，delivery %s 保留 pending", row.id, exc_info=True)


async def queue_pending(db: AsyncSession) -> int:
    rows = (await db.execute(select(WebhookDelivery).where(
        WebhookDelivery.status == "pending",
    ).order_by(WebhookDelivery.created_at).limit(100))).scalars().all()
    await enqueue_deliveries(rows)
    return len(rows)


async def deliver(db: AsyncSession, delivery_id: str, *, client: httpx.AsyncClient | None = None) -> str:
    delivery = await db.get(WebhookDelivery, delivery_id)
    if delivery is None:
        return "missing"
    if delivery.status == "delivered":
        return "delivered"
    sub = await db.get(WebhookSubscription, delivery.subscription_id)
    if sub is None or not sub.active:
        delivery.status = "cancelled"
        delivery.last_error = "subscription_inactive"
        await db.commit()
        return "cancelled"
    body = encoded_payload(delivery.payload or {})
    headers = {"Content-Type": "application/json", "X-MayDru-Signature": signature(sub.secret, body),
               "X-MayDru-Delivery": delivery.id}
    delivery.attempts += 1
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=10, follow_redirects=False)
    try:
        response = await client.post(sub.url, content=body, headers=headers)
        response.raise_for_status()
    except Exception as exc:
        delivery.status = "failed"
        delivery.last_error = repr(exc)[:2000]
        await db.commit()
        raise
    finally:
        if owns_client:
            await client.aclose()
    delivery.status = "delivered"
    delivery.last_error = ""
    delivery.delivered_at = datetime.now(UTC)
    await db.commit()
    return "delivered"
