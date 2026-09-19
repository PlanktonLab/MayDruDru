import asyncio
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import jwt
from passlib.context import CryptContext

from .config import get_settings

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

PASSWORD_MIN_LENGTH = 12


def hash_password(p: str) -> str:
    return pwd.hash(p)


def verify_password(p: str, h: str) -> bool:
    try:
        return pwd.verify(p, h)
    except Exception:
        return False


@lru_cache
def _dummy_hash() -> str:
    return pwd.hash(secrets.token_urlsafe(16))


async def hash_password_async(p: str) -> str:
    """bcrypt is slow on purpose: keep it off the event loop."""
    return await asyncio.to_thread(hash_password, p)


async def verify_password_async(p: str, h: str | None) -> bool:
    """Always spends one bcrypt verification, even for unknown accounts (h is None),
    so response timing does not reveal which emails exist."""
    ok = await asyncio.to_thread(verify_password, p, h or _dummy_hash())
    return ok and h is not None


def create_token(user_id: str, tenant_id: str, role: str) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    claims = {"sub": user_id, "tid": tenant_id, "role": role, "iat": now, "exp": now + timedelta(minutes=s.jwt_expire_minutes)}
    return jwt.encode(claims, s.secret_key, algorithm="HS256")


def decode_token(token: str) -> dict:
    return jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])


CASE_TOKEN_MINUTES = 30


def case_scope(case_no: str) -> str:
    return f"case:{case_no}"


def create_case_token(case_no: str, tenant_id: str) -> str:
    """查詢驗證成功後發的短效 token（SPEC §8.1）：只對這一件案子有效，30 分鐘。

    它不是登入憑證——沒有 `sub`，也不對應任何帳號；`scope` 就是它的全部權限。
    """
    now = datetime.now(UTC)
    claims = {
        "scope": case_scope(case_no),
        "case_no": case_no,
        "tid": tenant_id,
        "iat": now,
        "exp": now + timedelta(minutes=CASE_TOKEN_MINUTES),
    }
    return jwt.encode(claims, get_settings().secret_key, algorithm="HS256")


def decode_case_token(token: str) -> dict:
    """解碼並確認它真的是案件 token（而不是一張後台 JWT 拿來當案件 token 用）。"""
    payload = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    case_no = payload.get("case_no", "")
    if not case_no or payload.get("scope") != case_scope(case_no):
        raise jwt.InvalidTokenError("not a case token")
    return payload


def token_predates_password_change(payload: dict, password_changed_at: datetime | None) -> bool:
    """JWT `iat` has whole-second precision, so compare at that precision."""
    if password_changed_at is None:
        return False
    iat = payload.get("iat")
    return not isinstance(iat, (int, float)) or int(iat) < int(password_changed_at.timestamp())


def generate_api_key() -> tuple[str, str, str]:
    """Returns (plaintext, prefix, hash). Plaintext is shown once."""
    raw = "sk_" + secrets.token_urlsafe(32)
    return raw, raw[:10], hash_api_key(raw)


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def hash_external_user(tenant_id: str, external_user_id: str) -> str:
    return hashlib.sha256(f"{tenant_id}:{external_user_id}".encode()).hexdigest()[:32]
