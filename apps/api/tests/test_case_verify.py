"""案件查詢驗證與短效 token（SPEC §8.1 / 決策 D17）。"""

import jwt
import pytest
from app.deps import require_case_token
from app.security import CASE_TOKEN_MINUTES, create_case_token, create_token, decode_case_token
from app.services import application as case_service
from fastapi import HTTPException

from tests.test_state_machine import make_case


async def _case(db, tenant, scheme):
    return await make_case(db, tenant, scheme)


async def test_correct_phone_last4_returns_a_case_token(db, tenant, scheme, fake_redis):
    app = await _case(db, tenant, scheme)
    got, token = await case_service.verify_case(db, app.case_no, "5678", ip="1.1.1.1", redis=fake_redis)
    assert got.id == app.id
    payload = decode_case_token(token)
    assert payload["case_no"] == app.case_no
    assert payload["scope"] == f"case:{app.case_no}"


async def test_id_last4_also_verifies(db, tenant, scheme, fake_redis):
    app = await _case(db, tenant, scheme)
    _, token = await case_service.verify_case(db, app.case_no, "6789", ip="1.1.1.1", redis=fake_redis)
    assert decode_case_token(token)["case_no"] == app.case_no


async def test_full_phone_number_is_accepted_too(db, tenant, scheme, fake_redis):
    app = await _case(db, tenant, scheme)
    _, token = await case_service.verify_case(db, app.case_no, "0912-345-678", ip="1.1.1.1", redis=fake_redis)
    assert token


async def test_wrong_last4_is_refused(db, tenant, scheme, fake_redis):
    app = await _case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.verify_case(db, app.case_no, "0000", ip="1.1.1.1", redis=fake_redis)
    assert e.value.status_code == 401


async def test_unknown_case_answers_exactly_like_a_wrong_last4(db, tenant, scheme, fake_redis):
    """兩者的回應必須一模一樣，否則錯誤訊息就成了「這個案號存在嗎」的查詢介面。"""
    app = await _case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as wrong:
        await case_service.verify_case(db, app.case_no, "0000", ip="1.1.1.1", redis=fake_redis)
    with pytest.raises(case_service.TransitionError) as missing:
        await case_service.verify_case(db, "HC-2026-999999", "5678", ip="1.1.1.1", redis=fake_redis)
    assert wrong.value.status_code == missing.value.status_code
    assert wrong.value.detail == missing.value.detail


async def test_five_failures_lock_the_case_for_fifteen_minutes(db, tenant, scheme, fake_redis):
    app = await _case(db, tenant, scheme)
    for _ in range(case_service.VERIFY_MAX_FAILURES):
        with pytest.raises(case_service.TransitionError) as e:
            await case_service.verify_case(db, app.case_no, "0000", ip="1.1.1.1", redis=fake_redis)
        assert e.value.status_code == 401

    with pytest.raises(case_service.TransitionError) as locked:
        await case_service.verify_case(db, app.case_no, "5678", ip="1.1.1.1", redis=fake_redis)
    assert locked.value.status_code == 429
    assert fake_redis.ttls[f"case:verify:fail:{app.case_no}"] == case_service.VERIFY_LOCK_SECONDS


async def test_the_lock_also_follows_the_client_ip(db, tenant, scheme, fake_redis):
    """同一個 IP 掃號段，換案號一樣被擋——不然鎖定只是在幫攻擊者分頁。"""
    a = await _case(db, tenant, scheme)
    b = await _case(db, tenant, scheme)
    for _ in range(case_service.VERIFY_MAX_FAILURES):
        with pytest.raises(case_service.TransitionError):
            await case_service.verify_case(db, a.case_no, "0000", ip="9.9.9.9", redis=fake_redis)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.verify_case(db, b.case_no, "5678", ip="9.9.9.9", redis=fake_redis)
    assert e.value.status_code == 429


async def test_another_ip_is_unaffected_by_someone_elses_lockout(db, tenant, scheme, fake_redis):
    app = await _case(db, tenant, scheme)
    for _ in range(case_service.VERIFY_MAX_FAILURES):
        with pytest.raises(case_service.TransitionError):
            await case_service.verify_case(db, "HC-2026-999999", "0000", ip="9.9.9.9", redis=fake_redis)
    _, token = await case_service.verify_case(db, app.case_no, "5678", ip="2.2.2.2", redis=fake_redis)
    assert token


async def test_success_clears_the_failure_counter(db, tenant, scheme, fake_redis):
    app = await _case(db, tenant, scheme)
    for _ in range(3):
        with pytest.raises(case_service.TransitionError):
            await case_service.verify_case(db, app.case_no, "0000", ip="1.1.1.1", redis=fake_redis)
    await case_service.verify_case(db, app.case_no, "5678", ip="1.1.1.1", redis=fake_redis)
    assert f"case:verify:fail:{app.case_no}" not in fake_redis.values


async def test_verification_is_scoped_to_the_tenant(db, tenant, scheme, fake_redis):
    app = await _case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError):
        await case_service.verify_case(
            db, app.case_no, "5678", ip="1.1.1.1", tenant_id="someone-else", redis=fake_redis)


# ----------------------------------------------------------- 案件 token

def test_case_token_expires_in_thirty_minutes():
    payload = decode_case_token(create_case_token("HC-2026-000001", "t1"))
    assert (payload["exp"] - payload["iat"]) == CASE_TOKEN_MINUTES * 60


def test_an_admin_jwt_is_not_a_case_token():
    """兩種憑證共用同一把簽章金鑰，所以 scope 必須被檢查，不能只看簽名對不對。"""
    with pytest.raises(jwt.InvalidTokenError):
        decode_case_token(create_token("u1", "t1", "admin"))


def test_a_token_whose_scope_does_not_match_its_case_is_refused():
    import jwt as pyjwt
    from app.config import get_settings

    forged = pyjwt.encode(
        {"case_no": "HC-2026-000002", "scope": "case:HC-2026-000001", "tid": "t1"},
        get_settings().secret_key, algorithm="HS256",
    )
    with pytest.raises(pyjwt.InvalidTokenError):
        decode_case_token(forged)


class _Req:
    def __init__(self, headers):
        self.headers = headers


async def test_require_case_token_accepts_both_header_styles():
    token = create_case_token("HC-2026-000001", "t1")
    for headers in ({"authorization": f"Bearer {token}"}, {"x-case-token": token}):
        caller = await require_case_token(_Req(headers))
        assert caller.case_no == "HC-2026-000001" and caller.tenant_id == "t1"


async def test_require_case_token_refuses_a_missing_or_bad_token():
    with pytest.raises(HTTPException) as missing:
        await require_case_token(_Req({}))
    assert missing.value.status_code == 401
    with pytest.raises(HTTPException) as bad:
        await require_case_token(_Req({"x-case-token": "nope"}))
    assert bad.value.status_code == 401
