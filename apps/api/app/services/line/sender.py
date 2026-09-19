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
    "fixture_png",
    "get_sender",
    "reset_sender",
    "set_sender_for_testing",
]

MAX_MESSAGES = 5


class LineSender(Protocol):
    """LINE 需要的三個動作。回覆 token 只能用一次、30 秒內有效。

    `get_message_content()` 是 P4 加的：民眾在 LINE 傳圖片時，事件裡只有
    `message.id`，圖檔要另外去 blob API 取。取回來的 bytes **只在記憶體**——
    定位完就丟，不寫物件儲存、不寫資料庫（SPEC §11 紅線 3）。
    """

    enabled: bool

    async def reply(self, reply_token: str, messages: list[dict[str, Any]]) -> None: ...

    async def push(self, line_user_id: str, messages: list[dict[str, Any]]) -> None: ...

    async def get_message_content(self, message_id: str) -> bytes: ...


def fixture_png(width: int = 64, height: int = 96) -> bytes:
    """離線開發用的替身圖檔，**在記憶體裡畫出來**而不是讀檔。

    git 裡不放任何真實截圖（CLAUDE.md 規則 9），而測試又需要「民眾傳了一張圖」
    這件事真的有 bytes 可以走完整條路。畫一張固定內容的小圖最省事，
    `LLM_PROVIDER=fake` 的描述器看到它會回一組固定的關鍵字，定位結果因此也是決定性的。
    """
    import io

    from PIL import Image, ImageDraw

    img = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle((4, 4, width - 5, 20), fill=(46, 163, 93))
    for row in range(3):
        top = 30 + row * 20
        draw.rectangle((6, top, width - 7, top + 12), fill=(214, 217, 222))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


@dataclass
class NoopLineSender:
    """不連網路的 sender。`sent` 是一串 `{kind, to, messages}`。"""

    enabled: bool = False
    sent: list[dict[str, Any]] = field(default_factory=list)
    fail_with: Exception | None = None
    #: 測試可以換掉：`get_message_content()` 回傳的 bytes。None 代表用內建的替身圖。
    content: bytes | None = None
    fetched: list[str] = field(default_factory=list)

    async def reply(self, reply_token: str, messages: list[dict[str, Any]]) -> None:
        self._record("reply", reply_token, messages)

    async def push(self, line_user_id: str, messages: list[dict[str, Any]]) -> None:
        self._record("push", line_user_id, messages)

    async def get_message_content(self, message_id: str) -> bytes:
        self.fetched.append(message_id)
        if self.fail_with is not None:
            raise self.fail_with
        return self.content if self.content is not None else fixture_png()

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

    async def get_message_content(self, message_id: str) -> bytes:
        """民眾傳的圖片。走的是 blob endpoint（`api-data.line.me`），不是一般 API host。

        回傳的 bytes 由呼叫端立刻用掉就丟，這裡不快取、不寫檔（SPEC §11 紅線 3）。
        """
        from linebot.v3.messaging import AsyncApiClient, AsyncMessagingApiBlob, Configuration

        client = AsyncApiClient(Configuration(access_token=self._access_token))
        try:
            data = await AsyncMessagingApiBlob(client).get_message_content(message_id)
            return bytes(data)
        finally:
            await client.close()

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
