"""API key scopes and outbound webhooks (SPEC §10.1/§10.3)."""

import hashlib
import hmac
import json

import httpx
from app.models import ApiKey, WebhookDelivery, WebhookSubscription
from app.security import hash_api_key
from app.services import webhooks
from sqlalchemy import select


async def make_key(db, tenant, raw: str, scopes: list[str]) -> dict[str, str]:
    db.add(ApiKey(tenant_id=tenant.id, name=raw, prefix=raw[:8], key_hash=hash_api_key(raw), scopes=scopes))
    await db.commit()
    return {"Authorization": f"Bearer {raw}"}


async def test_bearer_api_key_requires_the_endpoint_scope(client, db, tenant):
    headers = await make_key(db, tenant, "read-only-key", ["read"])
    denied = await client.get("/v1/sop/catalog/platforms", headers=headers)
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "forbidden"

    key = await db.get(ApiKey, (await db.execute(select(ApiKey.id).where(ApiKey.name == "read-only-key"))).scalar_one())
    key.scopes = ["sop"]
    await db.commit()
    assert (await client.get("/v1/sop/catalog/platforms", headers=headers)).status_code == 200


async def test_webhook_subscription_secret_is_only_returned_at_creation(client, db, tenant, monkeypatch):
    headers = await make_key(db, tenant, "webhook-key", ["webhooks"])
    monkeypatch.setattr(webhooks, "enqueue_deliveries", lambda rows: _noop())
    created = await client.post("/v1/webhooks", headers=headers, json={
        "url": "https://example.test/events", "events": ["application.created"],
    })
    assert created.status_code == 201
    body = created.json()
    assert len(body["secret"]) >= 16
    listed = (await client.get("/v1/webhooks", headers=headers)).json()
    assert len(listed) == 1
    assert {k: listed[0][k] for k in ("id", "url", "events", "active", "secret")} == {
        "id": body["id"], "url": body["url"], "events": body["events"], "active": True, "secret": None,
    }

    queued = await client.post(f"/v1/webhooks/{body['id']}/test", headers=headers)
    assert queued.status_code == 202
    delivery = await db.get(WebhookDelivery, queued.json()["delivery_id"])
    assert delivery.payload["event"] == "webhook.test"
    deliveries = (await client.get(f"/v1/webhook-deliveries?subscription_id={body['id']}", headers=headers)).json()
    assert deliveries[0]["id"] == delivery.id
    assert (await client.post(f"/v1/webhook-deliveries/{delivery.id}/resend", headers=headers)).status_code == 202
    assert (await client.delete(f"/v1/webhooks/{body['id']}", headers=headers)).json() == {"ok": True}


async def _noop() -> None:
    return None


async def test_delivery_uses_the_exact_body_for_hmac_and_is_idempotent(db, tenant):
    sub = WebhookSubscription(tenant_id=tenant.id, url="https://receiver.test/hook", secret="s" * 24,
                              events=["application.created"])
    db.add(sub)
    await db.flush()
    rows = await webhooks.create_deliveries(db, tenant.id, "application.created", {"case_no": "HC-1"})
    await db.commit()
    seen: list[httpx.Request] = []

    def receive(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        expected = "sha256=" + hmac.new(sub.secret.encode(), request.content, hashlib.sha256).hexdigest()
        assert request.headers["X-MayDru-Signature"] == expected
        assert request.headers["X-MayDru-Delivery"] == rows[0].id
        assert json.loads(request.content)["data"] == {"case_no": "HC-1"}
        return httpx.Response(204)

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as outbound:
        assert await webhooks.deliver(db, rows[0].id, client=outbound) == "delivered"
        assert await webhooks.deliver(db, rows[0].id, client=outbound) == "delivered"
    assert len(seen) == 1
    assert rows[0].attempts == 1 and rows[0].last_error == ""


async def test_failed_delivery_records_attempt_and_error(db, tenant):
    sub = WebhookSubscription(tenant_id=tenant.id, url="https://receiver.test/hook", secret="s" * 24,
                              events=["content.published"])
    db.add(sub)
    await db.flush()
    rows = await webhooks.create_deliveries(db, tenant.id, "content.published", {"key": "x"})
    await db.commit()

    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(503))) as outbound:
        try:
            await webhooks.deliver(db, rows[0].id, client=outbound)
        except httpx.HTTPStatusError:
            pass
        else:
            raise AssertionError("503 must be retried by arq")
    assert rows[0].status == "failed" and rows[0].attempts == 1
    assert "503" in rows[0].last_error
