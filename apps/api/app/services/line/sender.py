"""送訊息給 LINE（SPEC §8.4）。

兩個實作、一個介面：

- `RealLineSender` 打真正的 Messaging API（line-bot-sdk v3）。
- `NoopLineSender` 什麼都不送，只把訊息記在 `.sent` 裡。測試與離線開發用，
  也是 `POST /__test__/line/inbound` 能把 bot 的回覆原封不動交出來的原因。

訊息在整個程式裡都是 **LINE 的 JSON dict**（camelCase），只有在真的要送出去的
那一刻才用 SDK 的 `from_dict` 轉成型別物件。builder 因此不必認識 SDK，測試也
可以直接對 dict 斷言。

LINE 一次最多收 5 則，超過的部分**丟掉不是選項**——會讓最後一則（通常是最重要的
那張卡）消失，所以 builder 自己負責不要組超過 5 則，這裡只做最後一道保險。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from ...config import get_settings

log = logging.getLogger("maydru.line.sender")

__all__ = [
    "MAX_MESSAGES",
    "LineSender",
    "NoopLineSender",
    "RealLineSender",
    "get_sender",
    "reset_sender",
    "set_sender_for_testing",
]

MAX_MESSAGES = 5


class LineSender(Protocol):
    """LINE 需要的兩個動作。回覆 token 只能用一次、30 秒內有效。"""

    enabled: bool

    async def reply(self, reply_token: str, messages: list[dict[str, Any]]) -> None: ...

    async def push(self, line_user_id: str, messages: list[dict[str, Any]]) -> None: ...


@dataclass
class NoopLineSender:
    """不連網路的 sender。`sent` 是一串 `{kind, to, messages}`。"""

    enabled: bool = False
    sent: list[dict[str, Any]] = field(default_factory=list)
    fail_with: Exception | None = None

    async def reply(self, reply_token: str, messages: list[dict[str, Any]]) -> None:
        self._record("reply", reply_token, messages)

    async def push(self, line_user_id: str, messages: list[dict[str, Any]]) -> None:
        self._record("push", line_user_id, messages)

    def _record(self, kind: str, to: str, messages: list[dict[str, Any]]) -> None:
        if self.fail_with is not None:
            raise self.fail_with
        self.sent.append({"kind": kind, "to": to, "messages": list(messages)[:MAX_MESSAGES]})

    def clear(self) -> None:
        self.sent.clear()

    def last(self, kind: str | None = None) -> list[dict[str, Any]]:
        for item in reversed(self.sent):
            if kind is None or item["kind"] == kind:
                return list(item["messages"])
        return []


class RealLineSender:
    """真的 Messaging API。每次呼叫開一個 client，長連線交給 SDK 自己處理。"""

    enabled = True

    def __init__(self, access_token: str) -> None:
        self._access_token = access_token

    async def reply(self, reply_token: str, messages: list[dict[str, Any]]) -> None:
        from linebot.v3.messaging import ReplyMessageRequest

        payload = {"replyToken": reply_token, "messages": messages[:MAX_MESSAGES]}
        await self._call(lambda api: api.reply_message(ReplyMessageRequest.from_dict(payload)))

    async def push(self, line_user_id: str, messages: list[dict[str, Any]]) -> None:
        from linebot.v3.messaging import PushMessageRequest

        payload = {"to": line_user_id, "messages": messages[:MAX_MESSAGES]}
        await self._call(lambda api: api.push_message(PushMessageRequest.from_dict(payload)))

    async def _call(self, run: Any) -> Any:
        from linebot.v3.messaging import AsyncApiClient, AsyncMessagingApi, Configuration

        client = AsyncApiClient(Configuration(access_token=self._access_token))
        try:
            return await run(AsyncMessagingApi(client))
        finally:
            await client.close()


_sender: LineSender | None = None


def get_sender() -> LineSender:
    """依 `LINE_SENDER` 決定用哪一個；一個程序共用一份。"""
    global _sender
    if _sender is None:
        s = get_settings()
        if s.line_sender == "line" and s.line_channel_access_token:
            _sender = RealLineSender(s.line_channel_access_token)
        else:
            if s.line_sender == "line":
                log.warning("LINE_SENDER=line 但缺少 access token，改用 Noop sender")
            _sender = NoopLineSender()
    return _sender


def set_sender_for_testing(sender: LineSender | None) -> None:
    """測試注入。傳 None 等於還原成依設定決定。"""
    global _sender
    _sender = sender


def reset_sender() -> None:
    set_sender_for_testing(None)
