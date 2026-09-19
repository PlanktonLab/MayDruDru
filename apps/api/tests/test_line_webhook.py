"""LINE webhook：簽章、先回 200、測試用同步端點（SPEC §8.4 / §11 / §14）。"""

from __future__ import annotations

import json

import pytest
from app.config import get_settings
from app.routers import line as line_router
from app.services.line import signature

SECRET = "test-channel-secret"
USER = "Uline0000000000000000000000000009"


@pytest.fixture(autouse=True)
def channel_secret():
    """webhook 沒有 secret 就一律拒絕，所以每個測試都要先裝一把。"""
    s = get_settings()
    before = s.line_channel_secret
    s.line_channel_secret = SECRET
    yield SECRET
    s.line_channel_secret = before


def body_of(*events) -> bytes:
    return json.dumps({"destination": "Uxxxx", "events": list(events)}).encode()


def follow_event(user_id: str = USER) -> dict:
    return {"type": "follow", "source": {"type": "user", "userId": user_id}, "replyToken": "rt"}


# ------------------------------------------------------------------- 簽章

def test_a_correct_signature_verifies():
    body = body_of(follow_event())
    assert signature.verify(body, signature.sign(body, SECRET), SECRET)


def test_a_tampered_body_is_refused():
    body = body_of(follow_event())
    sig = signature.sign(body, SECRET)
    assert not signature.verify(body + b" ", sig, SECRET)


def test_a_signature_from_another_secret_is_refused():
    body = body_of(follow_event())
    assert not signature.verify(body, signature.sign(body, "another"), SECRET)


def test_a_missing_secret_never_verifies():
    """youth-line-bot 在缺憑證時會跳過驗證；那等於開一個偽造推播的入口（SPEC §11）。"""
    body = body_of(follow_event())
    assert not signature.verify(body, signature.sign(body, SECRET), "")


def test_a_missing_signature_header_is_refused():
    assert not signature.verify(body_of(follow_event()), None, SECRET)


def test_a_signature_of_the_wrong_length_is_refused():
    assert not signature.verify(body_of(follow_event()), "abc", SECRET)


# ----------------------------------------------------------------- webhook

async def test_the_webhook_accepts_a_signed_request(client, tenant, monkeypatch):
    seen: list[dict] = []

    async def record(event):
        seen.append(event)

    monkeypatch.setattr(line_router, "dispatch", record)
    body = body_of(follow_event())
    r = await client.post("/line/webhook", content=body,
                          headers={"X-Line-Signature": signature.sign(body, SECRET)})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "received": 1}
    assert [e["type"] for e in seen] == ["follow"]


async def test_the_webhook_answers_before_the_events_are_handled(client, tenant, monkeypatch):
    """LINE 只等幾秒；處理必須在回應之後（否則它會重送整批事件）。"""
    order: list[str] = []

    async def slow(event):
        order.append("handled")

    monkeypatch.setattr(line_router, "dispatch", slow)
    body = body_of(follow_event(), follow_event("Uother"))
    r = await client.post("/line/webhook", content=body,
                          headers={"X-Line-Signature": signature.sign(body, SECRET)})
    assert r.json()["received"] == 2
    assert order == ["handled", "handled"]   # 背景工作在回應送出後才跑


async def test_the_webhook_refuses_a_bad_signature(client, tenant):
    body = body_of(follow_event())
    r = await client.post("/line/webhook", content=body, headers={"X-Line-Signature": "nope"})
    assert r.status_code == 401


async def test_the_webhook_refuses_a_request_with_no_signature(client, tenant):
    r = await client.post("/line/webhook", content=body_of(follow_event()))
    assert r.status_code == 401


async def test_the_webhook_refuses_everything_when_the_secret_is_missing(client, tenant):
    s = get_settings()
    s.line_channel_secret = ""
    body = body_of(follow_event())
    r = await client.post("/line/webhook", content=body,
                          headers={"X-Line-Signature": signature.sign(body, SECRET)})
    assert r.status_code == 401


async def test_a_signed_but_broken_body_is_a_400(client, tenant):
    body = b"{not json"
    r = await client.post("/line/webhook", content=body,
                          headers={"X-Line-Signature": signature.sign(body, SECRET)})
    assert r.status_code == 400


# ------------------------------------------------- 測試用同步端點（§14）

async def test_the_test_endpoint_returns_what_the_bot_would_send(client, tenant, line_sender):
    r = await client.post("/__test__/line/inbound", json={"event": follow_event()})
    assert r.status_code == 200
    messages = r.json()["messages"]
    assert messages and messages[0]["type"] == "text"


async def test_the_test_endpoint_also_feeds_the_noop_sender(client, tenant, line_sender):
    await client.post("/__test__/line/inbound", json={"event": follow_event()})
    assert line_sender.sent and line_sender.sent[0]["kind"] == "reply"


async def test_the_test_endpoint_runs_a_whole_conversation(client, tenant, scheme, line_sender):
    """SPEC §14 的 E2E 走的就是這條路：沒有 LINE、沒有簽章，行為完全一樣。"""
    r = await client.post("/__test__/line/inbound", json={
        "event": {"type": "postback", "source": {"userId": USER},
                  "replyToken": "rt", "postback": {"data": "action=scheme_info"}},
    })
    assert r.json()["messages"][1]["contents"]["type"] == "carousel"


async def test_the_test_endpoint_is_hidden_in_production(client, tenant, monkeypatch):
    monkeypatch.setattr(line_router, "test_endpoint_enabled", lambda: False)
    r = await client.post("/__test__/line/inbound", json={"event": follow_event()})
    assert r.status_code == 404


def test_the_test_endpoint_is_disabled_when_a_real_sender_is_configured():
    s = get_settings()
    before = (s.env, s.line_sender)
    try:
        s.line_sender = "line"
        assert line_router.test_endpoint_enabled() is False
        s.line_sender = "noop"
        s.env = "production"
        assert line_router.test_endpoint_enabled() is False
    finally:
        s.env, s.line_sender = before
