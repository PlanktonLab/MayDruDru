import asyncio
from datetime import UTC, datetime, timedelta

from app.deps import last_used_is_stale
from app.routers.auth import login_rate_key
from app.security import (
    create_token,
    decode_token,
    hash_password,
    token_predates_password_change,
    verify_password_async,
)


def test_token_carries_iat_and_is_rejected_after_password_change():
    payload = decode_token(create_token("u1", "t1", "admin"))
    assert isinstance(payload["iat"], int)
    issued = datetime.fromtimestamp(payload["iat"], UTC)
    assert not token_predates_password_change(payload, None)
    assert not token_predates_password_change(payload, issued)  # same second: still valid
    assert token_predates_password_change(payload, issued + timedelta(seconds=2))
    assert token_predates_password_change({"sub": "u1"}, issued)  # legacy token without iat


def test_unknown_account_never_verifies():
    assert asyncio.run(verify_password_async("whatever-password", None)) is False
    h = hash_password("correct horse battery")
    assert asyncio.run(verify_password_async("correct horse battery", h)) is True


def test_login_rate_key_normalises_email():
    assert login_rate_key("1.2.3.4", "  Clerk@Gov.TW ") == "login:1.2.3.4:clerk@gov.tw"


def test_api_key_last_used_written_at_most_once_a_minute():
    now = datetime.now(UTC)
    assert last_used_is_stale(None, now)
    assert not last_used_is_stale(now - timedelta(seconds=30), now)
    assert last_used_is_stale(now - timedelta(seconds=61), now)
