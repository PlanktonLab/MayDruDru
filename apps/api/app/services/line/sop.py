"""LINE 的 SOP 教學對話（SPEC §8.4 `sop_session`、§16 P4）。

一個 LINE 使用者最多有一個進行中的教學，狀態存在 `line_conversations`：
`flow='sop_session'`、`sop_session_id` 指向 SOP_Tutor 的 Session API、
`expires_at` 是 30 分鐘後（SPEC §8.4「30 分鐘無互動就退出」）。

真正的對話引擎是 `ai/session_graph.py::SessionEngine`——跟 `/v1/sop/sessions`、
Playground 用的是**同一顆**。這個模組只做三件事：

1. 開一個 session（文件類型 → `services/sop_links` 找對照 → 已發布的 flow）；
2. 把 LINE 事件翻成引擎的 event（文字→意圖→動作、圖片→screenshot）；
3. 把引擎的回應（step / clarification / escalation / completed）翻成 LINE 訊息。

**退出**有四條路，四條都會把 Redis 裡的 session 一起刪掉，不留孤兒：
完成、`結束`、任何 rich menu 的 postback（使用者顯然改去做別的事了）、以及逾時
（`conversation.sweep_expired()` 那一支排程，見 `worker/tasks.py`）。

這個檔案裡沒有任何中文字串常數，所有文案都是 content key（CLAUDE.md 規則 4）；
引擎產出的句子則來自 `services/policy.py`，那些字也在後台改得到（`sop.template.*`）。
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...ai import intent as intent_rules
from ...ai.session_graph import SessionEngine, SessionStore
from ...models import DocumentType, Flow, Platform, Scheme
from ...pii import hash_user_id
from .. import contents, sop_links
from . import conversation, flex

log = logging.getLogger("maydru.line.sop")

__all__ = [
    "SESSION_FLOW",
    "PICKER_FLOW",
    "SopTurn",
    "choose_option",
    "close",
    "begin_platform_picker",
    "document_picker",
    "flow_picker_for_platform",
    "handle_action",
    "handle_image",
    "handle_text",
    "open_for_document",
    "open_for_flow",
    "open_from_screenshot",
    "platform_picker",
    "platform_from_text",
    "flow_from_text",
    "render",
]

SESSION_FLOW = "sop_session"
PICKER_FLOW = "sop_picker"
#: 一份文件最多列幾個平台讓人選。超過這個數字的選擇題本身就是個問題。
PLATFORM_CHOICE_LIMIT = 10
FLOW_CHOICE_LIMIT = 12
THEME = "light"


class SopTurn:
    """一回合需要的東西。跟 handlers 的 `_Context` 同一個形狀，只是少了 params。"""

    def __init__(
        self,
        *,
        db: AsyncSession,
        tenant_id: str,
        user_id: str,
        now: datetime | None = None,
    ) -> None:
        self.db = db
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.now = now

    async def t(self, key: str, **variables: Any) -> str:
        return await contents.tf(self.db, self.tenant_id, key, **variables)

    async def say(self, key: str, **variables: Any) -> list[dict[str, Any]]:
        return [flex.text_message(await self.t(key, **variables))]

    async def say_with_menu(self, key: str, **variables: Any) -> list[dict[str, Any]]:
        return [
            flex.text_message(
                await self.t(key, **variables),
                await flex.main_menu_quick_reply(self.db, self.tenant_id),
            )
        ]

    @property
    def external_user_hash(self) -> str:
        """引擎只認得雜湊過的使用者；LINE 的 userId 不進 session 狀態（SPEC §11）。"""
        return hash_user_id(self.user_id)


# ------------------------------------------------------------------ 開場

async def open_for_document(
    ctx: SopTurn, document_code: str, *, document_label: str = "", platform_id: str | None = None
) -> list[dict[str, Any]]:
    """民眾選了一份文件 → 開教學。

    對照只有一條就直接開始；有好幾條（同一份文件在 App 與網頁拿法不同）就先問平台；
    一條都沒有就老實說還沒有教學，而不是丟一個空的選擇題給他。
    """
    label = document_label or document_code
    flows = await sop_links.resolve_flows(ctx.db, ctx.tenant_id, document_code, platform_id=platform_id)
    if not flows:
        await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
        return await ctx.say_with_menu("line.sop.no_flow", document=label)
    if len(flows) == 1:
        return await open_for_flow(ctx, flows[0], document_code=document_code, document_label=label)
    return [await _platform_choice(ctx, flows, document_code, label)]


async def platform_picker(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    """只列出至少有一條已發布流程的平台。"""
    rows = (
        await db.execute(
            select(Platform)
            .join(Flow, Flow.platform_id == Platform.id)
            .where(Platform.tenant_id == tenant_id, Flow.status == "published")
            .order_by(Platform.display_name)
        )
    ).scalars().unique().all()
    items = [
        (row.display_name, flex.postback("sop_platform", platform=row.id))
        for row in rows[:PLATFORM_CHOICE_LIMIT]
    ]
    return flex.quick_reply(items) if items else {}


async def begin_platform_picker(ctx: SopTurn, *, key: str = "line.sop.ask_platform_general") -> list[dict[str, Any]]:
    """進入平台選擇狀態；後續可按 quick reply、直接打平台名或傳截圖。"""
    await conversation.set_state(
        ctx.db, ctx.tenant_id, ctx.user_id, PICKER_FLOW, "platform", {}, now=ctx.now
    )
    return [
        flex.text_message(
            await ctx.t(key), await platform_picker(ctx.db, ctx.tenant_id) or None
        )
    ]


async def flow_picker_for_platform(ctx: SopTurn, platform_id: str) -> list[dict[str, Any]]:
    """選定平台後列出它的全部已發布操作指引。"""
    platform = await ctx.db.get(Platform, platform_id)
    if platform is None or platform.tenant_id != ctx.tenant_id:
        return await begin_platform_picker(ctx, key="line.sop.platform_not_found")
    flows = (
        await ctx.db.execute(
            select(Flow)
            .where(
                Flow.tenant_id == ctx.tenant_id,
                Flow.platform_id == platform.id,
                Flow.status == "published",
            )
            .order_by(Flow.name)
        )
    ).scalars().all()
    if not flows:
        return await begin_platform_picker(ctx, key="line.sop.platform_not_found")
    await conversation.set_state(
        ctx.db, ctx.tenant_id, ctx.user_id, PICKER_FLOW, "flow",
        {"platform": platform.id}, now=ctx.now,
    )
    guide_list = "\n".join(f"{index + 1}. {flow.name}" for index, flow in enumerate(flows))
    quick = flex.quick_reply([
        (flow.name, flex.postback("sop_open", flow=flow.id))
        for flow in flows[:FLOW_CHOICE_LIMIT]
    ])
    return [
        flex.text_message(
            await ctx.t("line.sop.platform_guides", platform=platform.display_name, guides=guide_list),
            quick or None,
        )
    ]


async def platform_from_text(db: AsyncSession, tenant_id: str, text: str) -> Platform | None:
    """以名稱、品牌或別名比對民眾直接輸入的平台。"""
    needle = text.strip().casefold()
    if not needle:
        return None
    rows = (
        await db.execute(
            select(Platform)
            .join(Flow, Flow.platform_id == Platform.id)
            .where(Platform.tenant_id == tenant_id, Flow.status == "published")
            .order_by(Platform.display_name)
        )
    ).scalars().unique().all()
    for row in rows:
        names = [row.display_name, row.brand, *(row.aliases or [])]
        if any(name and (name.casefold() in needle or needle in name.casefold()) for name in names):
            return row
    return None


async def flow_from_text(db: AsyncSession, tenant_id: str, platform_id: str, text: str) -> Flow | None:
    """平台已選定時，以操作名稱或序號選一條流程。"""
    rows = (
        await db.execute(
            select(Flow)
            .where(
                Flow.tenant_id == tenant_id,
                Flow.platform_id == platform_id,
                Flow.status == "published",
            )
            .order_by(Flow.name)
        )
    ).scalars().all()
    needle = text.strip().casefold()
    if needle.isdigit() and 1 <= int(needle) <= len(rows):
        return rows[int(needle) - 1]
    return next(
        (row for row in rows if row.name.casefold() in needle or needle in row.name.casefold()),
        None,
    )


async def _platform_choice(
    ctx: SopTurn, flows: list[Flow], document_code: str, label: str
) -> dict[str, Any]:
    options: list[tuple[str, str]] = []
    for flow in flows[:PLATFORM_CHOICE_LIMIT]:
        platform = await ctx.db.get(Platform, flow.platform_id)
        options.append((
            platform.display_name if platform is not None else flow.name,
            flex.postback("sop_open", flow=flow.id, doc=document_code),
        ))
    return await flex.sop_options_message(
        ctx.db, ctx.tenant_id, await ctx.t("line.sop.ask_platform", document=label), options
    )


async def open_for_flow(
    ctx: SopTurn, flow: Flow, *, document_code: str = "", document_label: str = ""
) -> list[dict[str, Any]]:
    """開一個 session 並回第一張步驟卡。

    `known_context` 直接指名平台與流程，引擎因此一題都不問就從第一步開始——
    民眾剛剛已經選過文件了，再問一次「你用的是哪個 App」只會讓人覺得沒在聽。
    """
    engine = SessionEngine(ctx.db)
    response = await engine.start(
        ctx.tenant_id, ctx.external_user_hash, hint=None,
        known_context={"platform_id": flow.platform_id, "flow_id": flow.id},
        theme=THEME, source="line",
    )
    session_id = str(response.get("session_id") or "")
    if not session_id or response.get("type") == "escalation":
        await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
        return await ctx.say_with_menu("line.sop.no_flow", document=document_label or document_code or flow.name)

    await _remember(ctx, session_id, document_code=document_code, document_label=document_label, flow_id=flow.id)
    lead = await ctx.t("line.sop.started", document=document_label or document_code or flow.name)
    notice = await contents.t(ctx.db, ctx.tenant_id, "security.screenshot_notice")
    messages = [flex.text_message(lead), flex.text_message(notice)]
    messages.extend(await render(ctx, response))
    return messages[:5]


async def open_from_screenshot(ctx: SopTurn, png: bytes) -> list[dict[str, Any]] | None:
    """idle 收到圖片：開一個空 session 讓引擎替這張截圖定位（SPEC §8.4）。

    定位到了就留著那個 session（民眾已經在教學裡了，接著可以按「下一步」）；
    認不出來就把剛開的 session 刪掉並回 `None`，由呼叫端改回文件選擇器——
    留一個沒有流程的 session 只會讓下一句話得到奇怪的回應。

    bytes 只是參數，進引擎、進檢索、然後就沒了；這個函式不寫任何儲存。
    """
    engine = SessionEngine(ctx.db)
    opened = await engine.start(
        ctx.tenant_id, ctx.external_user_hash, hint=None, known_context=None, theme=THEME, source="line"
    )
    session_id = str(opened.get("session_id") or "")
    if not session_id:
        return None
    try:
        response = await engine.handle(ctx.tenant_id, session_id, {"kind": "screenshot"}, screenshot=png)
    except Exception:
        log.warning("idle 截圖定位失敗", exc_info=True)
        await SessionStore.delete(ctx.tenant_id, session_id)
        return None
    if response.get("type") != "step":
        await SessionStore.delete(ctx.tenant_id, session_id)
        return None
    await _remember(ctx, session_id)
    return await render(ctx, response)


async def _remember(
    ctx: SopTurn,
    session_id: str,
    *,
    document_code: str = "",
    document_label: str = "",
    flow_id: str = "",
) -> None:
    """把 session 綁到這個 LINE 使用者身上，並把逾時推到 30 分鐘後。"""
    data = {k: v for k, v in
            {"doc": document_code, "doc_label": document_label, "flow": flow_id}.items() if v}
    await conversation.set_state(
        ctx.db, ctx.tenant_id, ctx.user_id, SESSION_FLOW, "running", data,
        sop_session_id=session_id, now=ctx.now,
    )


# ------------------------------------------------------------------ 對話中

async def handle_text(
    ctx: SopTurn, state: conversation.State, text: str
) -> list[dict[str, Any]]:
    """教學進行中的自由文字：先分類意圖，再變成引擎的動作。

    分類認不出來時不裝懂：把原文交給引擎當成 text event，引擎自己有一套
    「這句話是在回答剛才那個選擇題嗎」的比對（`match_option`）。
    """
    decision = await intent_rules.classify(
        ctx.db, ctx.tenant_id, text,
        mode="sop_session",
        candidates=await _session_candidates(ctx),
        ref_id=state.sop_session_id or "",
    )
    if decision.intent in intent_rules.SESSION_INTENTS:
        return await handle_action(ctx, state, decision.intent)
    return await _turn(ctx, state, {"kind": "text", "text": text})


async def _session_candidates(ctx: SopTurn) -> list[intent_rules.IntentCandidate]:
    """四個動作的候選，標籤用的是民眾在快速回覆上真的看到的那幾個字。"""
    labels = (
        ("sop_next", "line.quickreply.next"),
        ("sop_stuck", "line.quickreply.stuck"),
        ("sop_switch", "line.quickreply.switch"),
        ("sop_exit", "line.quickreply.exit"),
    )
    return [
        intent_rules.IntentCandidate(action, await contents.t(ctx.db, ctx.tenant_id, key))
        for action, key in labels
    ]


async def handle_action(
    ctx: SopTurn, state: conversation.State, action: str
) -> list[dict[str, Any]]:
    """四個動作。`sop_switch` 與 `sop_exit` 都會結束目前的 session。"""
    if action == "sop_exit":
        await close(ctx, state)
        return await ctx.say_with_menu("line.sop.ended")
    if action == "sop_switch":
        await close(ctx, state)
        return await begin_platform_picker(ctx, key="line.sop.switch")
    if action == "sop_stuck":
        return await ctx.say("line.sop.stuck_ask_screenshot")
    return await _turn(ctx, state, {"kind": "action", "action": "next"})


async def choose_option(
    ctx: SopTurn, state: conversation.State, option_id: str
) -> list[dict[str, Any]]:
    """教學中的選擇題（引擎的 clarification）被按下去了。"""
    return await _turn(ctx, state, {"kind": "action", "action": "choose_option", "option_id": option_id})


async def handle_image(
    ctx: SopTurn, state: conversation.State, png: bytes
) -> list[dict[str, Any]]:
    """教學進行中收到截圖：交給引擎定位（它知道民眾停在哪一步，排序會偏向附近）。"""
    return await _turn(ctx, state, {"kind": "screenshot"}, screenshot=png)


async def _turn(
    ctx: SopTurn,
    state: conversation.State,
    event: dict[str, Any],
    *,
    screenshot: bytes | None = None,
) -> list[dict[str, Any]]:
    """跑一回合。session 不在了（Redis 過期、被清掉）就據實以告並回到 idle。"""
    session_id = state.sop_session_id or ""
    if not session_id:
        await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
        return await ctx.say_with_menu("line.sop.expired")
    engine = SessionEngine(ctx.db)
    try:
        response = await engine.handle(ctx.tenant_id, session_id, event, screenshot=screenshot)
    except Exception:
        log.warning("SOP session %s 這一回合失敗", session_id, exc_info=True)
        await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
        return await ctx.say_with_menu("line.sop.expired")
    # 每一回合都把逾時往後推：30 分鐘算的是「無互動」，不是「開始之後」。
    await _remember(
        ctx, session_id,
        document_code=str(state.value("doc", "") or ""),
        document_label=str(state.value("doc_label", "") or ""),
        flow_id=str(state.value("flow", "") or ""),
    )
    return await render(ctx, response)


# ------------------------------------------------------------------ 退出

async def close(ctx: SopTurn, state: conversation.State | None = None) -> None:
    """結束教學：對話狀態與 Redis 裡的 session 一起清掉。

    只清資料庫那一列會留下一個孤兒 session，佔著 TTL 直到過期；只清 Redis 則會讓
    下一句話撞上「session 不存在」。兩邊一起清才是真的結束。
    """
    session_id = (state.sop_session_id if state is not None else None) or ""
    if not session_id:
        current = await conversation.get(ctx.db, ctx.tenant_id, ctx.user_id, now=ctx.now)
        session_id = current.sop_session_id or ""
    await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
    if session_id:
        try:
            await SessionStore.delete(ctx.tenant_id, session_id)
        except Exception:
            log.warning("刪除 SOP session %s 失敗", session_id, exc_info=True)


# ------------------------------------------------------------------ 渲染

async def render(ctx: SopTurn, response: dict[str, Any]) -> list[dict[str, Any]]:
    """引擎的四種回應 → LINE 訊息。

    `completed` 與 `escalation` 都代表這條路走完了，順手把 session 收掉；
    引擎給的句子（`message`）是 policy 產出的，也就是承辦人在後台改得到的字。
    """
    kind = response.get("type")
    if kind == "step":
        return await flex.sop_step_messages(ctx.db, ctx.tenant_id, response, lead=str(response.get("note") or ""))
    if kind == "clarification":
        options = [
            (str(option.get("label") or ""), flex.postback("sop_choose", option=str(option.get("option_id") or "")))
            for option in (response.get("options") or [])
            if option.get("label") and option.get("option_id")
        ]
        return [
            await flex.sop_options_message(
                ctx.db, ctx.tenant_id, str(response.get("question") or ""), options
            )
        ]
    if kind == "completed":
        await close(ctx)
        text = str(response.get("message") or "") or await ctx.t("line.sop.ended")
        return [flex.text_message(text, await flex.main_menu_quick_reply(ctx.db, ctx.tenant_id))]
    # escalation：引擎說不出下一步了。訊息是 policy 的句子，收尾一樣把 session 清掉。
    await close(ctx)
    text = str(response.get("message") or "")
    if not text.strip():
        return await ctx.say_with_menu("line.sop.not_recognized")
    return [flex.text_message(text, await flex.main_menu_quick_reply(ctx.db, ctx.tenant_id))]


# ------------------------------------------------- 文件選擇器（handlers 共用）

async def document_picker(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    """所有啟用方案的文件類型，去重後當成快速回覆。

    放在這裡而不是 handlers：開場、換流程、認不出截圖三個地方都要用同一份清單。
    """
    rows = (
        await db.execute(
            select(DocumentType)
            .join(Scheme, Scheme.id == DocumentType.scheme_id)
            .where(Scheme.tenant_id == tenant_id, Scheme.active.is_(True))
            .order_by(DocumentType.sort_order)
        )
    ).scalars().all()
    seen: dict[str, str] = {}
    for row in rows:
        seen.setdefault(row.code, row.label or row.code)
    items = [(label, flex.postback("sop_document", doc=code)) for code, label in list(seen.items())[:12]]
    return flex.quick_reply(items) if items else {}
