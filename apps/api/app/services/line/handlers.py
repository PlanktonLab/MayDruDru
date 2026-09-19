"""LINE 事件路由（SPEC §8.4）。

`build_event_reply()` 吃一個 LINE 事件、吐一串要回覆的訊息 dict。它不送訊息、
不 commit，也不碰 HTTP——router 負責那些，測試因此可以直接呼叫它並對回覆斷言。

三條路：

* **postback**：`ACTIONS` 那張表，一個 action 一個函式。所有按鈕的 data 都長
  `action=…&k=v`，所以永遠不必猜使用者按了什麼。
* **文字**：先看是不是「取消」，再看有沒有正在進行的流程（流程中的輸入優先於
  意圖分類，否則使用者打「0912」會被當成在問補助），接著 §9.1 的意圖分類
  （LLM ＋ 規則式 fallback ＋ FAQ 向量檢索，見 `ai/intent.py`），
  最後才是「聽不懂」——並把這句話留一筆 `unmatched_messages`
  （只存 userId 的 hash）餵給內容助理。
* **圖片**：先給截圖安全提醒，再把圖交給 §9.2 定位。教學進行中就定位到目前這條
  流程上；idle 則橫掃整個機關已發布的流程，命中就直接開一段教學（`services/line/sop.py`）。
  圖片的 bytes 只在記憶體裡走一遭，永不落地（SPEC §11 紅線 3）。

SOP 教學（`sop_session`）本身在 `services/line/sop.py`；這裡只負責「哪個事件
交給它」。任何 rich menu 的 postback 都會先把進行中的教學收掉——使用者顯然
改去做別的事了，把他留在教學狀態只會讓下一句話得到牛頭不對馬嘴的回應（SPEC §8.4）。

案件查詢是兩段式的：案號 → 末四碼。**案號那一步刻意不檢查案件存不存在**，
先確認案號真偽等於送一個查詢介面給想猜案號的人（youth-line-bot 的教訓）。
失敗訊息永遠是同一句，鎖定時才換成帶分鐘數的那一句。

這個檔案裡沒有任何中文字串常數，所有文案都是 content key。
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import parse_qsl

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...ai import intent as intent_rules
from ...models import (
    Application,
    CaseVerification,
    DocumentType,
    Faq,
    Flow,
    LineUser,
    Scheme,
    UnmatchedMessage,
)
from ...pii import hash_user_id
from .. import application as case_service
from .. import contents
from .. import faq as faq_service
from .. import scheme as scheme_service
from . import conversation, flex, sender
from . import sop as sop_service

log = logging.getLogger("maydru.line.handlers")

__all__ = ["ACTIONS", "build_event_reply", "parse_postback"]

# 一個 action 就是一個「吃 context、吐訊息」的協程。
type Handler = Callable[[_Context], Awaitable[list[dict[str, Any]]]]

VERIFY_FLOW = "case_verify"
SESSION_FLOW = sop_service.SESSION_FLOW
PICKER_FLOW = sop_service.PICKER_FLOW
STEP_CASE_NO = "case_no"
STEP_LAST4 = "last4"
PICKER_LIMIT = 12
FAQ_MENU_LIMIT = 8
FAQ_ANSWER_LIMIT = 5
SECTION_BREAK = "\n────────\n"


def parse_postback(data: str) -> dict[str, str]:
    return dict(parse_qsl(data or "", keep_blank_values=True))


# --------------------------------------------------------------- 事件入口

async def build_event_reply(
    db: AsyncSession,
    tenant_id: str,
    event: dict[str, Any],
    *,
    redis: Any = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """一個事件 → 要回的訊息。沒有 userId 的事件（群組退出等）一律不回。"""
    user_id = ((event.get("source") or {}).get("userId") or "").strip()
    if not user_id:
        return []
    kind = event.get("type", "")
    await _touch(db, tenant_id, user_id, followed=kind == "follow", blocked=kind == "unfollow")

    if kind == "follow":
        await conversation.clear(db, tenant_id, user_id)
        return [
            flex.text_message(
                await contents.t(db, tenant_id, "home.welcome"),
                await flex.main_menu_quick_reply(db, tenant_id),
            ),
            flex.text_message(await contents.t(db, tenant_id, "security.screenshot_notice")),
        ]
    if kind == "unfollow":
        await conversation.clear(db, tenant_id, user_id)
        return []
    if kind == "postback":
        return await _handle_postback(db, tenant_id, user_id, (event.get("postback") or {}).get("data", ""),
                                      redis=redis, now=now)
    if kind == "message":
        message = event.get("message") or {}
        if message.get("type") == "text":
            return await _handle_text(db, tenant_id, user_id, message.get("text", ""), redis=redis, now=now)
        if message.get("type") == "image":
            return await _handle_image(db, tenant_id, user_id, str(message.get("id") or ""), now=now)
        return [flex.text_message(await contents.t(db, tenant_id, "error.non_text_message"))]
    return []


async def _touch(db: AsyncSession, tenant_id: str, user_id: str, *, followed: bool, blocked: bool) -> LineUser:
    """每個事件都留一筆「這個人還在」。加好友與封鎖各自記一個時間點。"""
    row = (
        await db.execute(
            select(LineUser).where(LineUser.tenant_id == tenant_id, LineUser.line_user_id == user_id)
        )
    ).scalar_one_or_none()
    stamp = datetime.now(UTC)
    if row is None:
        row = LineUser(tenant_id=tenant_id, line_user_id=user_id, followed_at=stamp)
        db.add(row)
    row.last_seen_at = stamp
    if followed:
        row.followed_at = stamp
        row.blocked_at = None
    if blocked:
        row.blocked_at = stamp
    await db.flush()
    return row


# ------------------------------------------------------------- postback 表

async def _handle_postback(
    db: AsyncSession, tenant_id: str, user_id: str, data: str, *, redis: Any = None, now: datetime | None = None
) -> list[dict[str, Any]]:
    params = parse_postback(data)
    action = params.get("action", "")
    handler = ACTIONS.get(action)
    if handler is None:
        return await _unknown(db, tenant_id)
    ctx = _Context(db=db, tenant_id=tenant_id, user_id=user_id, params=params, redis=redis, now=now)
    # SPEC §8.4：任一 rich menu 的按鈕都會退出進行中的教學。使用者按了「案件查詢」
    # 就是要查案件，不是要看下一張教學圖；把他留在 sop_session 只會讓回應牛頭不對馬嘴。
    if action in MENU_ACTIONS:
        state = await conversation.get(db, tenant_id, user_id, now=now)
        if state.flow == SESSION_FLOW:
            await sop_service.close(ctx.sop, state)
    return await handler(ctx)


class _Context:
    """一次 postback 需要的東西。用類別而不是一堆參數，action 表才排得整齊。"""

    def __init__(
        self,
        *,
        db: AsyncSession,
        tenant_id: str,
        user_id: str,
        params: dict[str, str],
        redis: Any = None,
        now: datetime | None = None,
    ) -> None:
        self.db = db
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.params = params
        self.redis = redis
        self.now = now

    async def t(self, key: str, **variables: Any) -> str:
        return await contents.tf(self.db, self.tenant_id, key, **variables)

    async def say(self, key: str, **variables: Any) -> list[dict[str, Any]]:
        return [flex.text_message(await self.t(key, **variables))]

    async def say_with_menu(self, key: str, **variables: Any) -> list[dict[str, Any]]:
        return [
            flex.text_message(
                await self.t(key, **variables), await flex.main_menu_quick_reply(self.db, self.tenant_id)
            )
        ]

    @property
    def sop(self) -> sop_service.SopTurn:
        """同一回合的 SOP 版 context。`services/line/sop.py` 只需要這三個欄位。"""
        return sop_service.SopTurn(db=self.db, tenant_id=self.tenant_id, user_id=self.user_id, now=self.now)


# ---- 案件 --------------------------------------------------------------

async def _act_case_status(ctx: _Context) -> list[dict[str, Any]]:
    await conversation.set_state(ctx.db, ctx.tenant_id, ctx.user_id, VERIFY_FLOW, STEP_CASE_NO, {}, now=ctx.now)
    return [
        flex.text_message(
            await ctx.t("case.ask_case_id"), await flex.cancel_quick_reply(ctx.db, ctx.tenant_id)
        )
    ]


async def _act_refresh_case(ctx: _Context) -> list[dict[str, Any]]:
    """只有綁定過這件案子的人才看得到內容；沒綁定就回跟驗證失敗一樣的話。"""
    case_no = ctx.params.get("case_no", "")
    application = await _linked_application(ctx.db, ctx.tenant_id, ctx.user_id, case_no)
    if application is None:
        return await ctx.say("case.verify_failed")
    return [await _timeline(ctx.db, ctx.tenant_id, application)]


async def _act_my_cases(ctx: _Context) -> list[dict[str, Any]]:
    entries = await _linked_applications(ctx.db, ctx.tenant_id, ctx.user_id)
    if not entries:
        return await ctx.say_with_menu("mycase.empty")
    if len(entries) == 1:
        return [await _timeline(ctx.db, ctx.tenant_id, entries[0][0], scheme_name=entries[0][1])]
    return [await flex.my_cases_message(ctx.db, ctx.tenant_id, entries)]


# ---- FAQ ---------------------------------------------------------------

async def _act_faq(ctx: _Context) -> list[dict[str, Any]]:
    rows = await faq_service.list_faqs(ctx.db, ctx.tenant_id, active_only=True, limit=FAQ_MENU_LIMIT)
    listing = "\n".join(f"{i + 1}. {row.question}" for i, row in enumerate(rows))
    categories = await faq_service.categories(ctx.db, ctx.tenant_id)
    quick = flex.quick_reply([(c, flex.postback("faq_category", category=c)) for c in categories[:12]])
    return [flex.text_message(await ctx.t("faq.menu_intro", list=listing), quick or None)]


async def _act_faq_category(ctx: _Context) -> list[dict[str, Any]]:
    category = ctx.params.get("category", "")
    rows = await faq_service.list_faqs(
        ctx.db, ctx.tenant_id, category=category, active_only=True, limit=FAQ_ANSWER_LIMIT
    )
    if not rows:
        return await ctx.say("faq.category_empty")
    body = SECTION_BREAK.join(f"{row.question}\n{row.answer}" for row in rows)
    return [flex.text_message(f"[{category}]\n{body}", await flex.main_menu_quick_reply(ctx.db, ctx.tenant_id))]


# ---- 方案 --------------------------------------------------------------

async def _act_scheme_info(ctx: _Context) -> list[dict[str, Any]]:
    schemes = await scheme_service.list_schemes(ctx.db, ctx.tenant_id, active=True)
    if not schemes:
        return await ctx.say("subsidy.empty")
    return [
        flex.text_message(await ctx.t("subsidy.menu_intro")),
        await flex.scheme_carousel_message(ctx.db, ctx.tenant_id, schemes),
    ]


async def _act_scheme_category(ctx: _Context) -> list[dict[str, Any]]:
    category = ctx.params.get("category", "")
    schemes = [
        s for s in await scheme_service.list_schemes(ctx.db, ctx.tenant_id, active=True) if s.category == category
    ]
    if not schemes:
        return await ctx.say("subsidy.category_empty", category=category)
    return [await flex.scheme_carousel_message(ctx.db, ctx.tenant_id, schemes, alt_text=category)]


async def _act_scheme_latest(ctx: _Context) -> list[dict[str, Any]]:
    schemes = await scheme_service.list_schemes(ctx.db, ctx.tenant_id, active=True)
    # 沒填開始日的排最後：`date.min` 當哨兵，才不會拿 None 去跟日期比大小。
    schemes.sort(key=lambda s: s.application_start or date.min, reverse=True)
    if not schemes:
        return await ctx.say("subsidy.empty")
    return [await flex.scheme_carousel_message(ctx.db, ctx.tenant_id, schemes[:10])]


async def _act_scheme_closing(ctx: _Context) -> list[dict[str, Any]]:
    today = (ctx.now or datetime.now(UTC)).date()
    schemes = [
        s
        for s in await scheme_service.list_schemes(ctx.db, ctx.tenant_id, active=True)
        if s.application_end is not None and s.application_end >= today
    ]
    schemes.sort(key=lambda s: s.application_end or date.max)
    if not schemes:
        return await ctx.say("subsidy.empty")
    return [await flex.scheme_carousel_message(ctx.db, ctx.tenant_id, schemes[:10])]


async def _act_scheme_detail(ctx: _Context) -> list[dict[str, Any]]:
    scheme = await _scheme(ctx.db, ctx.tenant_id, ctx.params.get("scheme", ""))
    if scheme is None:
        return await ctx.say("subsidy.not_found")
    return [await flex.scheme_message(ctx.db, ctx.tenant_id, scheme)]


# ---- 申請小幫手 / 文件清單 ----------------------------------------------

async def _act_sop_start(ctx: _Context) -> list[dict[str, Any]]:
    """決策 D20：先問銀行／平台，再列出該平台全部已發布的操作指引。"""
    await sop_service.close(ctx.sop)
    return await sop_service.begin_platform_picker(ctx.sop)


async def _act_sop_platform(ctx: _Context) -> list[dict[str, Any]]:
    return await sop_service.flow_picker_for_platform(ctx.sop, ctx.params.get("platform", ""))


async def _ask_document(ctx: _Context, key: str = "line.sop.ask_document") -> dict[str, Any]:
    picker = await sop_service.document_picker(ctx.db, ctx.tenant_id)
    return flex.text_message(await ctx.t(key), picker or None)


async def _act_sop_document(ctx: _Context) -> list[dict[str, Any]]:
    """文件選擇器的選項：開一段這份文件的教學。"""
    code = ctx.params.get("doc", "")
    label = await _document_label(ctx.db, ctx.tenant_id, code)
    return await sop_service.open_for_document(ctx.sop, code, document_label=label)


async def _act_sop_open(ctx: _Context) -> list[dict[str, Any]]:
    """同一份文件有好幾條教學時，選了其中一條（`sop_open&flow=…`）。"""
    code = ctx.params.get("doc", "")
    flow = await ctx.db.get(Flow, ctx.params.get("flow", ""))
    if flow is None or flow.tenant_id != ctx.tenant_id or flow.status != "published":
        return await sop_service.begin_platform_picker(ctx.sop)
    label = await _document_label(ctx.db, ctx.tenant_id, code)
    return await sop_service.open_for_flow(ctx.sop, flow, document_code=code, document_label=label)


async def _act_sop_choose(ctx: _Context) -> list[dict[str, Any]]:
    """教學中的選擇題（引擎的 clarification）被按下去了。"""
    state = await conversation.get(ctx.db, ctx.tenant_id, ctx.user_id, now=ctx.now)
    if state.flow != SESSION_FLOW:
        return [await _ask_document(ctx, "line.sop.expired")]
    return await sop_service.choose_option(ctx.sop, state, ctx.params.get("option", ""))


async def _act_sop_prepare(ctx: _Context) -> list[dict[str, Any]]:
    """退件推播的「教我準備」（SPEC §8.4 的雙按鈕之一）。

    推播帶著案號與卡住的那一份文件，所以這裡可以直接開始教，不必再問一次。
    文件沒帶到（舊推播、或案件根本沒有補件項目）才退回選擇器。
    """
    case_no = ctx.params.get("case_no", "")
    doc = ctx.params.get("doc", "")
    if not doc:
        return [await _ask_document(ctx)]
    label = await _document_label(ctx.db, ctx.tenant_id, doc)
    messages = await sop_service.open_for_document(ctx.sop, doc, document_label=label)
    if case_no:
        log.info("sop_prepare 由退件推播開啟：case=%s doc=%s", case_no, doc)
    return messages


async def _act_checklist(ctx: _Context) -> list[dict[str, Any]]:
    scheme = await _scheme(ctx.db, ctx.tenant_id, ctx.params.get("scheme", ""))
    if scheme is None:
        return await ctx.say_with_menu("apply.need_subsidy_first")
    return [await _checklist(ctx.db, ctx.tenant_id, ctx.user_id, scheme, now=ctx.now)]


async def _act_apply_toggle(ctx: _Context) -> list[dict[str, Any]]:
    """勾掉一份文件。勾選狀態存在對話狀態裡，換方案就自動歸零。"""
    scheme = await _scheme(ctx.db, ctx.tenant_id, ctx.params.get("scheme", ""))
    if scheme is None:
        return await ctx.say_with_menu("apply.need_subsidy_first")
    doc = ctx.params.get("doc", "")
    state = await conversation.get(ctx.db, ctx.tenant_id, ctx.user_id, now=ctx.now)
    checked: list[str] = list(state.value("checked", [])) if state.value("scheme") == scheme.code else []
    if doc in checked:
        checked.remove(doc)
    elif doc:
        checked.append(doc)
    await conversation.set_state(
        ctx.db, ctx.tenant_id, ctx.user_id, "checklist", "browsing",
        {"scheme": scheme.code, "checked": checked}, now=ctx.now,
    )
    return [await flex.checklist_message(ctx.db, ctx.tenant_id, scheme,
                                         await _document_types(ctx.db, scheme), checked)]


async def _act_sop_exit(ctx: _Context) -> list[dict[str, Any]]:
    state = await conversation.get(ctx.db, ctx.tenant_id, ctx.user_id, now=ctx.now)
    if state.flow == SESSION_FLOW:
        return await sop_service.handle_action(ctx.sop, state, "sop_exit")
    await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
    return await ctx.say_with_menu("error.cancelled")


async def _act_sop_session(ctx: _Context) -> list[dict[str, Any]]:
    """下一步／我卡住了／換流程。沒有進行中的教學就把人帶回文件選擇器。"""
    state = await conversation.get(ctx.db, ctx.tenant_id, ctx.user_id, now=ctx.now)
    action = ctx.params.get("action", "")
    if state.flow != SESSION_FLOW:
        return await sop_service.begin_platform_picker(ctx.sop)
    return await sop_service.handle_action(ctx.sop, state, action)


# ---- 其他 --------------------------------------------------------------

async def _act_contact(ctx: _Context) -> list[dict[str, Any]]:
    return [
        flex.text_message(
            await flex.contact_text(ctx.db, ctx.tenant_id),
            await flex.main_menu_quick_reply(ctx.db, ctx.tenant_id),
        )
    ]


async def _act_cancel(ctx: _Context) -> list[dict[str, Any]]:
    await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
    return await ctx.say_with_menu("error.cancelled")


async def _act_security(ctx: _Context) -> list[dict[str, Any]]:
    """防詐提醒。這一版不做訊息判讀，只把提醒與 165 專線交出去。"""
    text = "\n".join(
        [await ctx.t("security.title"), "", await ctx.t("security.disclaimer")]
    )
    return [flex.text_message(text, await flex.main_menu_quick_reply(ctx.db, ctx.tenant_id))]


async def _act_help(ctx: _Context) -> list[dict[str, Any]]:
    return await ctx.say_with_menu("home.welcome")


# rich menu 上的六個入口。按下其中任何一個都代表「我要做別的事了」，
# 進行中的教學因此會先被收掉（SPEC §8.4 的退出條件之一）。
MENU_ACTIONS: frozenset[str] = frozenset(
    [*(action for action, _ in flex.MAIN_MENU), "subsidy_info", "eligibility"]
)

ACTIONS: dict[str, Handler] = {
    "case_status": _act_case_status,
    "refresh_case": _act_refresh_case,
    "my_cases": _act_my_cases,
    "faq": _act_faq,
    "faq_category": _act_faq_category,
    "scheme_info": _act_scheme_info,
    "scheme_category": _act_scheme_category,
    "scheme_latest": _act_scheme_latest,
    "scheme_closing": _act_scheme_closing,
    "scheme_detail": _act_scheme_detail,
    # 舊 youth-line-bot 已發布選單的 postback；保留相容，避免切版期間按鈕失效。
    "subsidy_info": _act_scheme_info,
    "eligibility": _act_sop_start,
    "sop_start": _act_sop_start,
    "sop_platform": _act_sop_platform,
    "sop_document": _act_sop_document,
    "sop_open": _act_sop_open,
    "sop_choose": _act_sop_choose,
    "sop_prepare": _act_sop_prepare,
    "sop_next": _act_sop_session,
    "sop_stuck": _act_sop_session,
    "sop_switch": _act_sop_session,
    "sop_exit": _act_sop_exit,
    "checklist": _act_checklist,
    "apply_toggle": _act_apply_toggle,
    "contact": _act_contact,
    "cancel": _act_cancel,
    "security_check": _act_security,
    "help": _act_help,
    "greeting": _act_help,
}


# ---------------------------------------------------------------- 文字路由

async def _handle_text(
    db: AsyncSession, tenant_id: str, user_id: str, text: str, *, redis: Any = None, now: datetime | None = None
) -> list[dict[str, Any]]:
    """自由文字的四段路：取消 → 深連結 → 進行中的流程 → §9.1 意圖分類。

    順序不是隨便排的。進行中的流程要**優先於**意圖分類，否則使用者在「請輸入手機
    末四碼」那一步打「0912」會被當成在問補助；教學進行中打「下一步」也該是下一步，
    不是重新開一段。
    """
    entities = intent_rules.extract_entities(text)
    ctx = _Context(db=db, tenant_id=tenant_id, user_id=user_id, params=entities, redis=redis, now=now)

    # 深連結（送件完成頁的「加入好友」按鈕）：案號已經知道了，直接問末四碼。
    if entities.get("deep_link"):
        await sop_service.close(ctx.sop)
        return await _start_last4(ctx, entities["case_no"])

    state = await conversation.get(db, tenant_id, user_id, now=now)
    if state.flow == VERIFY_FLOW:
        # 驗證流程裡「取消」還是要能離開，其餘的字一律當成答案。
        if intent_rules.classify_rules(text).intent == "cancel":
            return await _act_cancel(ctx)
        return await _verify_step(ctx, state, text.strip())
    if state.flow == SESSION_FLOW:
        return await sop_service.handle_text(ctx.sop, state, text)
    if state.flow == PICKER_FLOW:
        if intent_rules.classify_rules(text).intent == "cancel":
            return await _act_cancel(ctx)
        if state.step == "platform":
            platform = await sop_service.platform_from_text(db, tenant_id, text)
            if platform is None:
                return await sop_service.begin_platform_picker(ctx.sop, key="line.sop.platform_not_found")
            return await sop_service.flow_picker_for_platform(ctx.sop, platform.id)
        flow = await sop_service.flow_from_text(
            db, tenant_id, str(state.value("platform", "") or ""), text
        )
        if flow is None:
            return await sop_service.flow_picker_for_platform(
                ctx.sop, str(state.value("platform", "") or "")
            )
        return await sop_service.open_for_flow(ctx.sop, flow, document_label=flow.name)

    decision = await intent_rules.classify(
        db, tenant_id, text, mode="idle", candidates=await _idle_candidates(db, tenant_id),
        ref_id=hash_user_id(user_id),
    )
    if decision.intent == "cancel":
        return await _act_cancel(ctx)
    if decision.intent == intent_rules.FAQ_INTENT:
        answer = await _faq_answer(db, tenant_id, decision.target_id)
        if answer is not None:
            return answer

    # 意圖的名字就是 action 的名字，所以文字與按鈕走的是同一張表，不會兩邊行為不一致。
    handler = ACTIONS.get(decision.intent)
    if handler is not None:
        if decision.intent == "case_status" and entities.get("case_no"):
            return await _start_last4(ctx, entities["case_no"])
        return await handler(ctx)

    await _record_unmatched(db, tenant_id, user_id, text, decision)
    return await ctx.say_with_menu("home.unknown")


async def _idle_candidates(db: AsyncSession, tenant_id: str) -> list[intent_rules.IntentCandidate]:
    """idle 時模型能挑的動作，標籤用的是民眾在選單上真的看到的那幾個字。

    FAQ 候選由 `ai/intent.py` 自己補（它才知道怎麼算向量）；這裡只負責按鈕那一半。
    """
    labels = (
        ("case_status", "button.case_status"),
        ("my_cases", "button.my_cases"),
        ("scheme_info", "button.subsidy_info"),
        ("sop_start", "button.eligibility"),
        ("faq", "button.faq"),
        ("contact", "button.contact"),
        ("checklist", "button.checklist"),
        ("security_check", "security.title"),
        ("cancel", "button.cancel"),
    )
    out: list[intent_rules.IntentCandidate] = []
    for action, key in labels:
        label = await contents.t(db, tenant_id, key)
        if label.strip():
            out.append(intent_rules.IntentCandidate(action, label.strip()))
    return out


async def _faq_answer(db: AsyncSession, tenant_id: str, faq_id: str) -> list[dict[str, Any]] | None:
    """一則 FAQ 的問與答。找不到那一筆就回 None，讓呼叫端往下走。"""
    if not faq_id:
        return None
    row = (
        await db.execute(select(Faq).where(Faq.tenant_id == tenant_id, Faq.id == faq_id, Faq.active.is_(True)))
    ).scalar_one_or_none()
    if row is None:
        return None
    return [
        flex.text_message(
            f"{row.question}\n{row.answer}", await flex.main_menu_quick_reply(db, tenant_id)
        )
    ]


async def _record_unmatched(
    db: AsyncSession, tenant_id: str, user_id: str, text: str, decision: intent_rules.IntentDecision
) -> None:
    """留給內容助理 (b) 聚類用。只存 userId 的 hash（SPEC §11 外送清單）。"""
    db.add(
        UnmatchedMessage(
            tenant_id=tenant_id,
            line_user_id_hash=hash_user_id(user_id),
            text=text[:2000],
            intent_result=decision.dict(),
        )
    )
    await db.flush()


# ------------------------------------------------------------ 案件查詢流程

async def _start_last4(ctx: _Context, case_no: str) -> list[dict[str, Any]]:
    await conversation.set_state(
        ctx.db, ctx.tenant_id, ctx.user_id, VERIFY_FLOW, STEP_LAST4, {"case_no": case_no}, now=ctx.now
    )
    return [
        flex.text_message(await ctx.t("case.ask_phone"), await flex.cancel_quick_reply(ctx.db, ctx.tenant_id))
    ]


async def _verify_step(ctx: _Context, state: conversation.State, text: str) -> list[dict[str, Any]]:
    if state.step == STEP_CASE_NO:
        entities = intent_rules.extract_entities(text)
        case_no = entities.get("case_no", "")
        if not case_no:
            return await ctx.say("error.invalid_case_id")
        # 這裡刻意不查案件在不在：先確認案號真偽等於提供一個猜案號的介面。
        return await _start_last4(ctx, case_no)

    if state.step == STEP_LAST4:
        last4 = text.strip()
        if not intent_rules.LAST4_PATTERN.match(last4):
            return await ctx.say("error.invalid_phone")
        return await _verify(ctx, str(state.value("case_no", "")), last4)

    await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
    return await ctx.say_with_menu("home.unknown")


async def _verify(ctx: _Context, case_no: str, last4: str) -> list[dict[str, Any]]:
    """驗證成功就綁定並回時間軸；失敗永遠是同一句話，鎖定才換成帶分鐘的那一句。"""
    try:
        application, _token = await case_service.verify_case(
            ctx.db, case_no, last4, ip=hash_user_id(ctx.user_id), tenant_id=ctx.tenant_id, redis=ctx.redis
        )
    except HTTPException as e:
        await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
        if e.status_code == 429:
            minutes = case_service.VERIFY_LOCK_SECONDS // 60
            return await ctx.say("case.verify_locked", minutes=minutes)
        return await ctx.say("case.verify_failed")

    await _bind(ctx.db, ctx.tenant_id, ctx.user_id, application)
    await conversation.clear(ctx.db, ctx.tenant_id, ctx.user_id)
    return [
        await _timeline(ctx.db, ctx.tenant_id, application),
        flex.text_message(await ctx.t("case.link_success"), await flex.main_menu_quick_reply(ctx.db, ctx.tenant_id)),
    ]


async def _bind(db: AsyncSession, tenant_id: str, user_id: str, application: Application) -> CaseVerification:
    """一個人對一件案子只留一筆綁定；重複驗證只更新時間。"""
    row = (
        await db.execute(
            select(CaseVerification).where(
                CaseVerification.application_id == application.id,
                CaseVerification.line_user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = CaseVerification(
            tenant_id=tenant_id, application_id=application.id, line_user_id=user_id, method="line"
        )
        db.add(row)
    row.verified_at = datetime.now(UTC)
    await db.flush()
    return row


# ------------------------------------------------------------------ 圖片

async def _handle_image(
    db: AsyncSession, tenant_id: str, user_id: str, message_id: str, *, now: datetime | None = None
) -> list[dict[str, Any]]:
    """民眾傳了一張截圖（SPEC §8.4、§9.2）。

    圖檔要另外去 LINE 的 blob API 取；取回來的 bytes **只在記憶體**，交給定位之後
    就離開作用域，這個函式不寫物件儲存、不寫資料庫（SPEC §11 紅線 3）。

    教學進行中就定位到那條流程上；idle 則橫掃整個機關已發布的流程，命中就直接開一段
    教學，沒命中才回「認不出來，你要準備哪一份文件？」。

    取不到圖（token 過期、LINE 那邊出錯）不是沉默的理由：照樣回選擇器。
    """
    ctx = _Context(db=db, tenant_id=tenant_id, user_id=user_id, params={}, now=now)
    state = await conversation.get(db, tenant_id, user_id, now=now)
    notice = flex.text_message(await contents.t(db, tenant_id, "security.screenshot_notice"))

    png = await _message_content(message_id)
    if png is None:
        return [notice, *(await sop_service.begin_platform_picker(ctx.sop, key="line.sop.not_recognized"))]

    if state.flow == SESSION_FLOW:
        return await sop_service.handle_image(ctx.sop, state, png)

    located = await sop_service.open_from_screenshot(ctx.sop, png)
    if located is not None:
        return [notice, *located][:5]
    return [notice, *(await sop_service.begin_platform_picker(ctx.sop, key="line.sop.not_recognized"))]


async def _message_content(message_id: str) -> bytes | None:
    """LINE 的 blob API。失敗一律回 None——一張取不到的圖不該讓 bot 整個沉默。"""
    if not message_id:
        return None
    try:
        return await sender.get_sender().get_message_content(message_id)
    except Exception:
        log.warning("取得 LINE 圖片內容失敗")
        return None


# ------------------------------------------------------------------ 查詢

async def _unknown(db: AsyncSession, tenant_id: str) -> list[dict[str, Any]]:
    return [
        flex.text_message(
            await contents.t(db, tenant_id, "home.unknown"), await flex.main_menu_quick_reply(db, tenant_id)
        )
    ]


async def _timeline(
    db: AsyncSession, tenant_id: str, application: Application, *, scheme_name: str = ""
) -> dict[str, Any]:
    if not scheme_name:
        scheme = await db.get(Scheme, application.scheme_id)
        scheme_name = scheme.name if scheme else ""
    return await flex.case_timeline_message(db, tenant_id, application, scheme_name=scheme_name)


async def _linked_application(
    db: AsyncSession, tenant_id: str, user_id: str, case_no: str
) -> Application | None:
    if not case_no:
        return None
    return (
        await db.execute(
            select(Application)
            .join(CaseVerification, CaseVerification.application_id == Application.id)
            .where(
                Application.tenant_id == tenant_id,
                Application.case_no == case_no,
                CaseVerification.line_user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def _linked_applications(
    db: AsyncSession, tenant_id: str, user_id: str
) -> list[tuple[Application, str]]:
    rows = (
        await db.execute(
            select(Application)
            .join(CaseVerification, CaseVerification.application_id == Application.id)
            .where(Application.tenant_id == tenant_id, CaseVerification.line_user_id == user_id)
            .order_by(Application.updated_at.desc())
        )
    ).scalars().all()
    out: list[tuple[Application, str]] = []
    for application in rows:
        scheme = await db.get(Scheme, application.scheme_id)
        out.append((application, scheme.name if scheme else ""))
    return out


async def _scheme(db: AsyncSession, tenant_id: str, code: str) -> Scheme | None:
    if not code:
        return None
    return (
        await db.execute(select(Scheme).where(Scheme.tenant_id == tenant_id, Scheme.code == code))
    ).scalar_one_or_none()


async def _scheme_of_case(db: AsyncSession, tenant_id: str, case_no: str) -> Scheme | None:
    application = (
        await db.execute(
            select(Application).where(Application.tenant_id == tenant_id, Application.case_no == case_no)
        )
    ).scalar_one_or_none()
    if application is None:
        return None
    return await db.get(Scheme, application.scheme_id)


async def _document_types(db: AsyncSession, scheme: Scheme) -> list[DocumentType]:
    rows = (
        await db.execute(
            select(DocumentType).where(DocumentType.scheme_id == scheme.id).order_by(DocumentType.sort_order)
        )
    ).scalars().all()
    return list(rows)


async def _document_label(db: AsyncSession, tenant_id: str, code: str) -> str:
    """一個文件類型代碼在這個機關的顯示名稱。沒有設 label 就用代碼本身。"""
    if not code:
        return ""
    row = (
        await db.execute(
            select(DocumentType)
            .join(Scheme, Scheme.id == DocumentType.scheme_id)
            .where(Scheme.tenant_id == tenant_id, DocumentType.code == code)
            .order_by(DocumentType.sort_order)
        )
    ).scalars().first()
    return (row.label or code) if row is not None else code


async def _checklist(
    db: AsyncSession, tenant_id: str, user_id: str, scheme: Scheme, *, now: datetime | None = None
) -> dict[str, Any]:
    state = await conversation.get(db, tenant_id, user_id, now=now)
    checked = list(state.value("checked", [])) if state.value("scheme") == scheme.code else []
    return await flex.checklist_message(db, tenant_id, scheme, await _document_types(db, scheme), checked)
