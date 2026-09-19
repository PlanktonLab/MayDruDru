"""LINE webhook 簽章驗證（SPEC §8.4 / §11）。

youth-line-bot 在沒有設定 channel secret 時會「跳過驗證」照收事件，方便離線示範；
那等於在正式站上開了一個任何人都能偽造推播的入口。這裡把那條路堵死：
**沒有 secret 就是驗不過**，webhook 一律回 401。要離線測試請走
`POST /__test__/line/inbound`（只在非 production 且 sender 為 noop 時存在）。

驗的是**原始 bytes**，不是解析過再序列化回去的 JSON——中間任何一次
re-encode 都會讓簽章對不上。
"""

from __future__ import annotations

import base64
import hashlib
import hmac

__all__ = ["sign", "verify"]


def sign(body: bytes, secret: str) -> str:
    """算出 `X-Line-Signature` 的值（測試與 `__test__` 端點用）。"""
    return base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()


def verify(body: bytes, signature: str | None, secret: str) -> bool:
    """定時比較。secret 或 signature 缺一律 False，任何例外也是 False。"""
    if not secret or not signature:
        return False
    try:
        expected = sign(body, secret)
    except Exception:
        return False
    return hmac.compare_digest(expected, signature)
