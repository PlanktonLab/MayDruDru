"""申請人個資的加密、雜湊與遮蔽（SPEC §11）。

三條硬規則：
1. 完整手機號只以 Fernet 密文落地（推播綁定要打回去，所以不能只存 hash）。
2. 完整身分證字號同樣只以 Fernet 密文落地（D36：核銷造冊要用，但不放明文）；
   末四碼的加鹽 hash 另存，供查詢驗證用。
3. 任何寫進日誌、稽核或承辦人清單的姓名與電話都先遮蔽。

金鑰：`PII_ENCRYPTION_KEY`（與承辦人原圖的 `ORIGINAL_ENCRYPTION_KEY` 分開輪替）。
開發模式沒設定時由 `SECRET_KEY` 推導一把穩定的金鑰，作法與 `storage.fernet()` 相同，
api 與 worker 才會算出同一把；production 缺金鑰直接拒絕啟動（config.insecure_defaults）。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

__all__ = [
    "LAST4_LENGTH",
    "decrypt_phone",
    "decrypt_pii",
    "encrypt_phone",
    "encrypt_pii",
    "fernet",
    "hash_last4",
    "hash_user_id",
    "last4",
    "mask_name",
    "mask_phone",
]

LAST4_LENGTH = 4
_NON_ALNUM = re.compile(r"[^0-9A-Za-z]")


@lru_cache
def fernet() -> Fernet:
    s = get_settings()
    key = s.pii_encryption_key
    if not key:
        if s.is_production:
            raise RuntimeError("PII_ENCRYPTION_KEY must be set in production")
        # 開發用：由 SECRET_KEY 推導，api / worker / 測試三邊算得到同一把。
        key = base64.urlsafe_b64encode(hashlib.sha256(("pii:" + s.secret_key).encode()).digest()).decode()
    return Fernet(key.encode())


@lru_cache
def _salt() -> bytes:
    """末四碼 hash 的鹽。只有四個字元的明文，沒有鹽等於沒有 hash。"""
    return hashlib.sha256(("pii-last4:" + get_settings().secret_key).encode()).digest()


def encrypt_pii(value: str) -> str:
    """回傳密文；空字串進、空字串出（紙本案件可能沒填）。"""
    if not value:
        return ""
    return fernet().encrypt(value.encode()).decode()


def decrypt_pii(token: str) -> str:
    """解不開就回空字串——輪替金鑰後的舊資料不該讓整支流程炸掉。"""
    if not token:
        return ""
    try:
        return fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return ""


# 手機沿用原本的名字，實作與身分證字號共用同一把金鑰與同一組函式。
encrypt_phone = encrypt_pii
decrypt_phone = decrypt_pii


def last4(value: str) -> str:
    """把使用者輸入正規化成末四碼：去掉非英數字、轉大寫、取最後四碼。

    `0912-345-678` 與 `+886912345678` 會得到同一個答案。
    """
    cleaned = _NON_ALNUM.sub("", value or "").upper()
    return cleaned[-LAST4_LENGTH:]


def hash_last4(value: str) -> str:
    """加鹽 hash。輸入可以是完整號碼，也可以是使用者只打的四碼。"""
    tail = last4(value)
    if len(tail) < LAST4_LENGTH:
        return ""
    return hmac.new(_salt(), tail.encode(), hashlib.sha256).hexdigest()


def mask_name(name: str) -> str:
    """`測試用小明` → `測OOO明`。一個字不遮，兩個字遮後面那個。"""
    if not name:
        return ""
    if len(name) == 1:
        return name
    if len(name) == 2:
        return name[0] + "O"
    return name[0] + "O" * (len(name) - 2) + name[-1]


def mask_phone(phone: str) -> str:
    """`0912345678` → `******5678`。只留末四碼，長度不洩漏以外的資訊。"""
    digits = _NON_ALNUM.sub("", phone or "")
    if len(digits) <= LAST4_LENGTH:
        return digits
    return "*" * (len(digits) - LAST4_LENGTH) + digits[-LAST4_LENGTH:]


def hash_user_id(value: str) -> str:
    """外部識別碼（LINE userId）的加鹽 hash。

    未命中訊息要餵給內容助理分析，但 SPEC §11 的外送清單寫明「去 LINE userId」；
    存 hash 才能同時做到「同一個人問了三次」的聚類與「查不回是誰」。
    """
    if not value:
        return ""
    return hmac.new(_salt(), value.encode(), hashlib.sha256).hexdigest()
