"""虛擬客服：a tool-calling agent over the guidance building blocks (SPEC §10).

One chat = a plain transcript the citizen sees (text bubbles, image bubbles,
the occasional list of choices), no forms. The model decides what to do with
four tools over the same content every channel reads (`services.guide`):
list a flow's steps, send Step Cards as image messages, locate a screenshot,
and put a question with options to the citizen. Everything the model needs
to know about the tenant (its wording, platforms, goals, flows) is in the
system prompt.

Every picture gets an answer. The screenshot tool never fails silently: the
retrieval ladder classifies the picture and the guidance layer turns the
outcome into concrete next steps (send from here, restart the flow, ask which
platform, ask for a clearer picture). If the model itself is unavailable the
turn falls back to that guidance directly, so a citizen who sent a screenshot
still gets their steps.

Privacy: the citizen screenshot lives in the turn context only; it is never
in the transcript stored in Redis and never sent to the assistant model — the
retrieval pipeline (describe + rerank) sees it, in memory, and drops it.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..config import get_settings
from ..db import release_connection
from ..events import log_event
from ..redis_client import redis
from ..services import guide
from ..services.content import load_snapshot, tenant_catalog
from ..services.guide import goal_for, locate_guidance, step_messages, step_rows
from ..services.policy import Policy
from . import fake, retrieval
from .llm import _chat_model, dumps, record_usage
from .retrieval import locate
from .session_graph import SessionLock

log = logging.getLogger(__name__)

MODEL_FAILURE_TEXT = Policy().text("model_failure")  # the zh-TW built-in; turns use the policy's
HISTORY_LIMIT = 24
SCREENSHOT_NOTE = "（民眾附上一張截圖）"


# ------------------------------------------------------------------ prompt

def system_prompt(tenant_name: str, platforms: list[dict], goals: list[dict], flows: list[dict], policy: Policy | dict | None = None) -> str:
    """The assistant's instructions, assembled from the policy: language,
    persona, tone, delivery, and what each screenshot outcome turns into.
    The catalog is listed inline so the model never invents a flow."""
    pol = policy if isinstance(policy, Policy) else Policy.from_dict(policy)
    noun = pol.noun
    pname = {p["id"]: p["display_name"] for p in platforms}
    gname = {g["id"]: g["name"] for g in goals}
    chan = {"mobile_app": pol.text("channel_mobile_app"), "web": pol.text("channel_web"), "desktop": pol.text("channel_desktop")}
    p_lines = [f"- platform_id={p['id']}：{p['display_name']}（品牌：{p['brand']}，管道：{chan.get(p['channel'], p['channel'])}"
               + (f"，別名：{'、'.join(p['aliases'])}" if p.get("aliases") else "") + "）" for p in platforms if p["has_flows"]]
    g_lines = [f"- goal_id={g['id']}：{g['name']}" + (f"（別名：{'、'.join(g['aliases'])}）" if g.get("aliases") else "") for g in goals if g["has_flows"]]
    f_lines = [f"- flow_id={f['id']}：{pname.get(f['platform_id'], '?')}｜{'、'.join(gname.get(g, '?') for g in f['goal_ids']) or f'（尚未指定{noun}）'}"
               f"（platform_id={f['platform_id']}，goal_ids={'、'.join(f['goal_ids'])}）" for f in flows]
    extra = f"\n【本單位的補充規則】\n{pol.extra_rules}\n" if pol.extra_rules else ""
    if pol.delivery == "one_by_one":
        delivery = ("一次只傳一張步驟圖：先傳民眾目前該做的那一步，圖後用一句話請他做完回覆「下一步」；他回覆後再傳下一張。"
                    "分岔前那一步傳完後用 ask_choice 問他看到哪種情況。")
    else:
        delivery = "流程是直線時一次傳完全部步驟；還有分岔時先傳到分岔前那一步，用 ask_choice 問民眾看到的是哪種情況，再傳對應的後續步驟。"
    lang = f"一律使用{pol.language_name}回覆民眾" if pol.language != "zh-TW" else "一律使用台灣正體中文"
    if pol.language != "zh-TW":
        lang += "（步驟圖上的文字是內容原本的語言，不必翻譯；工具回傳的建議文字請用民眾的語言重新說）"
    off_flow = {"restart": "先用一句話告訴民眾這一頁不是流程的一部分、請他回到 App 首頁（這句話要和 send_step_cards 的呼叫放在同一則回覆裡，先說再傳圖），然後用 guidance.step_ids 從步驟 1 重新傳圖",
                "ask_goal": "說明這一頁不在流程裡，然後用 ask_choice 把 guidance.options 列出來問他要完成哪個" + noun,
                "handoff": "說明這一頁不在流程裡，並照 guidance.advice 告訴民眾改由誰協助，不要傳圖"}[pol.on_off_flow]
    not_app = {"restart": "先說明並請民眾打開對應的 App（先說再傳圖）；已知平台時用 guidance.step_ids 傳步驟 1 起的圖，不知道時用 ask_choice 問他要用哪個 App 或網站",
               "ask_platform": "說明這不是 App 畫面，用 ask_choice 問他要用哪個 App 或網站",
               "handoff": "照 guidance.advice 說明並告訴民眾改由誰協助"}[pol.on_not_app_screen]
    unknown = {"ask_platform": "照 guidance.advice 說明，並用 ask_choice 列出可協助的平台請民眾選；民眾選了之後照第 1、2 點處理",
               "handoff": "照 guidance.advice 說明並告訴民眾改由誰協助"}[pol.on_unknown_platform]
    ambiguous = {"ask": "不確定是哪一步。用 ask_choice 把 guidance.options 列給民眾確認",
                 "best_guess": "當作已定位，照 located 處理，但先說明這是依畫面推測的"}[pol.on_ambiguous]
    return f"""你是「{tenant_name}」的{pol.display_name}，用文字訊息協助民眾在指定的 App 或網站上完成目標{noun}。你手上有一套「步驟圖」：每張圖示範一個畫面該按哪裡，民眾照著圖一步步做就能完成。

【目前可以協助的服務】
平台：
{chr(10).join(p_lines) or '（尚無）'}
目標{noun}：
{chr(10).join(g_lines) or '（尚無）'}
可用流程（平台｜可完成的{noun}；一條流程可能通往好幾種{noun}）：
{chr(10).join(f_lines) or '（尚無）'}

【工作方式】
1. 先弄清楚民眾用的是哪個平台、要完成哪個{noun}。只有上面清單有的組合才能協助；清單上沒有的，直接說明：{pol.handoff_line}。不要自己編步驟。
2. 對應到流程後，先呼叫 get_flow_steps（帶上民眾要的 goal_id，工具只會回傳通往那個{noun}的步驟，其他{noun}的分岔會自動略過），再呼叫 send_step_cards 把步驟圖傳給民眾。{delivery}
3. 民眾傳截圖時，一律先呼叫 locate_screenshot。工具會回傳 outcome 與 guidance，照下面的【截圖處理守則】處理。
4. 同一品牌同時有 App 和網頁而民眾沒說明時，先問一句用的是哪一個。看不出要哪個{noun}時，用 ask_choice 列出可完成的{noun}讓民眾選。但只要民眾說的平台只能完成一種{noun}，就一律直接傳那條流程的步驟圖，不要先問「是不是要這個」——民眾只是不知道{noun}的正式名稱。
5. 需要民眾從幾個選項中挑一個時（候選畫面、平台、{noun}、分岔），一律用 ask_choice，不要把選項寫在文字裡；問題本身要短。
6. 回覆風格：{pol.tone_line}。步驟內容以圖為主：步驟圖本身已印有標題與操作說明，傳圖時不附文字，也不要把步驟逐字重打一遍；圖傳完用一兩句話收尾，並提醒卡住可以傳截圖。
7. {lang}。不要向民眾提到工具、outcome、flow_id、platform_id 這類內部名詞。
{extra}
【截圖處理守則】locate_screenshot 的 outcome 與對應做法（guidance.action 已依本單位的規則算好：send＝從該步傳圖、restart＝從步驟 1 傳圖、ask＝用 ask_choice 提問、retake＝請民眾重截、handoff＝說明後交由人工）：
- located：民眾在某一步。用 guidance.step_ids 呼叫 send_step_cards，從那一步（含）往後傳；若 guidance.advice 提到與教學圖的差異，先用一句話告訴民眾該按哪裡。
- ambiguous：{ambiguous}。
- off_flow：是這個 App 裡的畫面，但不在教學流程裡。{off_flow}。
- not_app_screen：手機主畫面、鎖定畫面或系統畫面。{not_app}。
- unknown_platform：看不出是哪個平台，或是我們沒有教學的 App。{unknown}。
- not_a_screenshot：不是螢幕畫面（例如拍到實體文件或桌面）。請民眾直接在手機上截圖再傳；guidance 有 step_ids 時順便從步驟 1 傳圖。
- unreadable：太模糊、太暗或只截到一角。請民眾重新截一張完整清楚的畫面。
- guidance.advice 提到「翻拍」時，提醒民眾直接截圖會更清楚，但不要因此拒絕協助。"""


def greeting(platforms: list[dict], goals: list[dict], policy: Policy | dict | None = None) -> str:
    """The one canned message a chat opens with — what the assistant can do
    and how to ask. Built from the catalog and the policy's template, no
    model call."""
    pol = policy if isinstance(policy, Policy) else Policy.from_dict(policy)
    brands = list(dict.fromkeys(p["brand"] for p in platforms if p["has_flows"]))
    docs = [g["name"] for g in goals if g["has_flows"]]
    if not brands or not docs:
        return pol.text("greeting_empty")
    return pol.text("greeting", brands="、".join(brands), goals="、".join(docs))


# ------------------------------------------------------------------ store

@dataclass
class ChatState:
    chat_id: str
    tenant_id: str
    content_mode: str = "published"
    theme: str = "light"
    source: str = "playground"           # playground | api
    external_user_hash: str = ""
    platform_id: str | None = None
    flow_id: str | None = None
    goal_id: str | None = None           # the goal the citizen is after — picks the branch at a fork
    step_id: str | None = None           # where the citizen most likely is (last located, or first card of the last batch)
    started_flows: list[str] = field(default_factory=list)
    policy: dict = field(default_factory=dict)  # per-conversation overrides of the tenant policy (language, delivery …)
    history: list[dict] = field(default_factory=list)  # [{"role": "user"|"assistant", "text": str}]
    created_at: float = 0.0
    last_active_at: float = 0.0

    def to_json(self) -> dict:
        return self.__dict__.copy()

    @classmethod
    def from_json(cls, data: dict) -> ChatState:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


class ChatStore:
    @staticmethod
    def key(tenant_id: str, chat_id: str) -> str:
        return f"chat:{tenant_id}:{chat_id}"

    @staticmethod
    async def save(state: ChatState) -> None:
        await redis().set(ChatStore.key(state.tenant_id, state.chat_id), json.dumps(state.to_json(), ensure_ascii=False),
                          ex=get_settings().session_ttl_seconds)

    @staticmethod
    async def load(tenant_id: str, chat_id: str) -> ChatState | None:
        raw = await redis().get(ChatStore.key(tenant_id, chat_id))
        return ChatState.from_json(json.loads(raw)) if raw else None


# ------------------------------------------------------------------ turn

@dataclass
class ChatTurn:
    """Everything one turn touches: the DB session, the (in-memory only)
    screenshot, the messages going back to the citizen and the debug trail."""
    db: AsyncSession
    state: ChatState
    policy: Policy = field(default_factory=Policy)
    screenshot: bytes | None = None
    outgoing: list[dict] = field(default_factory=list)
    tool_calls: list[dict] = field(default_factory=list)
    usage: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)  # what the tools did, kept in the transcript for later turns
    locate_debug: dict | None = None
    _snapshots: dict[str, dict | None] = field(default_factory=dict)

    async def snapshot(self, flow_id: str) -> dict | None:
        if flow_id not in self._snapshots:
            loaded = await load_snapshot(self.db, self.state.tenant_id, flow_id, self.state.content_mode)
            self._snapshots[flow_id] = loaded[0] if loaded else None
        return self._snapshots[flow_id]

    def say(self, text: str) -> None:
        if text and text.strip():
            self.outgoing.append({"kind": "text", "text": text.strip()})

    # ---- tools

    async def get_flow_steps(self, flow_id: str, goal_id: str | None = None) -> str:
        snap = await self.snapshot(flow_id)
        if not snap:
            return "找不到這個流程，或它尚未發布。"
        goal = goal_for(snap, goal_id, self.state.goal_id)
        if goal_id and not goal:
            names = "、".join(g["name"] for g in guide.snapshot_goals(snap)) or "（尚未指定）"
            return f"這個流程不提供 goal_id={goal_id}；它可完成的是：{names}。"
        self.state.goal_id = goal
        return dumps(step_rows(snap, goal))

    async def send_step_cards(self, flow_id: str, step_ids: list[str]) -> str:
        snap = await self.snapshot(flow_id)
        if not snap:
            return "找不到這個流程，或它尚未發布；沒有傳出任何圖片。"
        goal = goal_for(snap, self.state.goal_id)
        batch = await step_messages(snap, step_ids, self.state.theme, goal_id=goal, policy=self.policy)
        self.outgoing.extend(batch.messages)
        st = self.state
        st.flow_id, st.platform_id = flow_id, snap["flow"]["platform_id"]
        first = next((m["step_id"] for m in batch.messages if m.get("step_id")), None)
        if first:
            st.step_id = first
        if flow_id not in st.started_flows:
            st.started_flows.append(flow_id)
            await log_event(self.db, st.tenant_id, st.chat_id, "flow_started", flow_id=flow_id, step_id=first, source=st.source)
        parts = []
        if batch.sent:
            parts.append(f"已傳出 {len(batch.sent)} 張步驟圖：{'、'.join(batch.sent)}")
        if batch.textual:
            parts.append(f"這些步驟還沒有圖片，已改用文字說明：{'、'.join(batch.textual)}")
        if batch.unknown:
            parts.append(f"找不到這些步驟：{'、'.join(batch.unknown)}")
        if batch.sent or batch.textual:
            self.notes.append(f"已傳送「{snap['flow']['name']}」的步驟：{'、'.join(batch.sent + batch.textual)}")
        return "；".join(parts) or "沒有傳出任何內容。"

    async def locate_screenshot(self) -> str:
        png, self.screenshot = self.screenshot, None
        if not png:
            return dumps({"outcome": "no_screenshot", "guidance": {"advice": self.policy.text("no_screenshot")}})
        st = self.state
        await log_event(self.db, st.tenant_id, st.chat_id, "stuck_upload", flow_id=st.flow_id, step_id=st.step_id, source=st.source)
        try:
            snap = await self.snapshot(st.flow_id) if st.flow_id else None
            res = await locate(self.db, st.tenant_id, png, flow_id=st.flow_id, platform_id=None,
                               content_mode=st.content_mode, session_id=st.chat_id,
                               step_id=st.step_id, goal_id=st.goal_id, snapshot=snap,
                               threshold=self.policy.locate_threshold, low=self.policy.locate_low)
        finally:
            del png
        self.usage.extend(res.usage)
        st.theme = res.theme or st.theme
        if not res.platform_id and st.platform_id and res.outcome in (retrieval.OFF_FLOW, retrieval.NOT_APP_SCREEN,
                                                                        retrieval.NOT_A_SCREENSHOT, retrieval.UNREADABLE):
            # a home screen or a stray page from someone already on a platform: restart that platform, don't ask again
            res.platform_id = st.platform_id
        await log_event(self.db, st.tenant_id, st.chat_id, "locate_result", flow_id=res.flow_id or st.flow_id, step_id=res.step_id,
                        payload={"ok": res.ok, "outcome": res.outcome, "confidence": res.confidence, "scope": res.scope}, source=st.source)
        g = await locate_guidance(self.db, st.tenant_id, res, content_mode=st.content_mode, theme=st.theme,
                                  session_flow_id=st.flow_id, session_goal_id=st.goal_id, policy=self.policy,
                                  snapshots=self._snapshots)
        if g.outcome == retrieval.LOCATED and g.flow_id and g.step_id:
            st.flow_id, st.step_id, st.platform_id = g.flow_id, g.step_id, res.platform_id or st.platform_id
            self.notes.append(f"截圖定位：「{g.flow_name}」步驟 {g.step_index}（{g.step_title}），信心 {res.confidence:.0%}")
        else:
            self.notes.append(f"截圖判讀：{g.advice}" if g.advice else f"截圖判讀：{g.outcome}")
        pub = res.public()
        by_id = {c["variant_id"]: c for c in res.candidates}
        self.locate_debug = {**pub, "scope": res.scope, "guidance": g.to_dict(),
                             "candidates": [{**c, "lexical": by_id.get(c["variant_id"], {}).get("lexical"),
                                             "distance": round(by_id.get(c["variant_id"], {}).get("distance", 0.0), 3)} for c in pub["candidates"]]}
        # what the model sees: the outcome and what to do about it — no
        # descriptions of the citizen's screen beyond its structural words
        out = {"outcome": res.outcome, "confidence": pub["confidence"], "kind": res.kind, "photographed": res.photographed,
               "platform_guess": res.platform_guess, "difference": res.difference, "reason": res.reason,
               "screen_texts": pub["screen"].get("structural_texts", [])[:15], "guidance": g.to_dict()}
        return dumps(out)

    def ask_choice(self, question: str, options: list[str]) -> str:
        opts = [{"label": o.strip()} for o in options if o and o.strip()]
        if not opts:
            return "沒有選項，沒有送出問題。"
        self.outgoing.append({"kind": "choices", "text": question.strip(), "options": opts})
        self.notes.append(f"已詢問：{question.strip()}（選項：{'、'.join(o['label'] for o in opts)}）")
        return f"已把問題與 {len(opts)} 個選項送給民眾。"

    def tools(self) -> list:
        turn = self
        noun = self.policy.noun

        @tool
        async def get_flow_steps(flow_id: str, goal_id: str | None = None) -> str:
            """取得某個流程的步驟（順序、step_id、標題、說明、是否有圖、分岔）。傳步驟圖前先呼叫這個。帶上民眾要的 goal_id 時，只回傳通往那個目標的步驟，通往其他目標的分岔會自動略過。"""
            return await turn.get_flow_steps(flow_id, goal_id)

        @tool
        async def send_step_cards(flow_id: str, step_ids: list[str]) -> str:
            """把指定步驟的步驟圖依序傳給民眾，一張圖一則訊息，只有圖片、不附文字（圖本身已含標題與操作說明）。step_ids 依要傳的順序排列。"""
            return await turn.send_step_cards(flow_id, step_ids)

        @tool
        async def locate_screenshot() -> str:
            """分析民眾這一則附上的截圖：回傳 outcome（located／ambiguous／off_flow／not_app_screen／unknown_platform／not_a_screenshot／unreadable）與 guidance（該傳的 step_ids、該問的問題與選項、一句建議）。民眾有附圖時一律先呼叫。"""
            return await turn.locate_screenshot()

        @tool
        def ask_choice(question: str, options: list[str]) -> str:
            """把一個問題與幾個選項送給民眾讓他挑一個（候選畫面、平台、目標、分岔情況）。options 是要顯示的文字，2 到 6 個。"""
            return turn.ask_choice(question, options)

        ask_choice.description = f"把一個問題與幾個選項送給民眾讓他挑一個（候選畫面、平台、{noun}、分岔情況）。options 是要顯示的文字，2 到 6 個。"
        return [get_flow_steps, send_step_cards, locate_screenshot, ask_choice]

    # ---- deterministic fallback (no model)

    async def answer_without_model(self) -> None:
        """When the assistant model is unavailable but the citizen sent a
        screenshot, the guidance layer alone still answers it."""
        if not self.screenshot:
            return
        try:
            data = json.loads(await self.locate_screenshot())
        except Exception:
            log.exception("fallback locate failed (chat %s)", self.state.chat_id)
            return
        g = data.get("guidance") or {}
        action = g.get("action", "")
        if action == guide.SEND and g.get("flow_id") and g.get("step_ids"):
            self.say(self.policy.text("located_lead", step=g.get("step_title", "")))
            await self.send_step_cards(g["flow_id"], g["step_ids"])
        elif action == guide.ASK and g.get("ask") and g.get("options"):
            self.say(g.get("advice", ""))
            self.ask_choice(g["ask"], [o["label"] for o in g["options"]])
        elif action == guide.RESTART and g.get("flow_id") and g.get("step_ids"):
            self.say(g.get("advice", ""))
            await self.send_step_cards(g["flow_id"], g["step_ids"])
        elif g.get("advice"):
            self.say(g["advice"])


# ------------------------------------------------------------------ engine

class ChatEngine:
    def __init__(self, db: AsyncSession, tenant_name: str = "", tenant_settings: dict | None = None):
        self.db = db
        self.tenant_name = tenant_name
        self.tenant_settings = tenant_settings

    def policy_for(self, state: ChatState | None = None) -> Policy:
        return Policy.from_settings(self.tenant_settings, state.policy if state else None)

    async def start(self, tenant_id: str, *, content_mode: str = "published", source: str = "playground",
                    external_user_hash: str = "", theme: str = "light", policy: dict | None = None) -> tuple[ChatState, str]:
        """`policy`: per-conversation overrides (language, delivery, …) on top of the tenant's."""
        platforms, goals, _ = await tenant_catalog(self.db, tenant_id, content_mode)
        state = ChatState(chat_id=uuid.uuid4().hex, tenant_id=tenant_id, content_mode=content_mode, source=source, theme=theme,
                          external_user_hash=external_user_hash, policy=dict(policy or {}), created_at=time.time(), last_active_at=time.time())
        hello = greeting(platforms, goals, self.policy_for(state))
        state.history.append({"role": "assistant", "text": hello})
        await ChatStore.save(state)
        await log_event(self.db, tenant_id, state.chat_id, "session_created", payload={"content_mode": content_mode, "channel": "chat"}, source=source)
        return state, hello

    async def status(self, tenant_id: str, chat_id: str) -> dict:
        state = await ChatStore.load(tenant_id, chat_id)
        if not state:
            raise errors.ApiError(404, errors.SESSION_EXPIRED, "對話不存在或已過期")
        return {k: getattr(state, k) for k in ("chat_id", "content_mode", "theme", "platform_id", "flow_id", "goal_id", "step_id",
                                               "started_flows", "policy", "created_at", "last_active_at")}

    async def handle(self, tenant_id: str, chat_id: str, text: str | None, screenshot: bytes | None) -> dict:
        lock = SessionLock(tenant_id, chat_id)
        if not await lock.acquire():
            return {"chat_id": chat_id, "messages": [{"kind": "text", "text": self.policy_for().text("busy")}], "_debug": {"busy": True}}
        try:
            state = await ChatStore.load(tenant_id, chat_id)
            if not state:
                raise errors.ApiError(404, errors.SESSION_EXPIRED, "對話不存在或已過期")
            return await self._turn(state, text or "", screenshot)
        finally:
            await lock.release()

    async def _turn(self, state: ChatState, text: str, screenshot: bytes | None) -> dict:
        t0 = time.perf_counter()
        s = get_settings()
        policy = self.policy_for(state)
        turn = ChatTurn(db=self.db, state=state, policy=policy, screenshot=screenshot)
        platforms, goals, flows = await tenant_catalog(self.db, state.tenant_id, state.content_mode)
        user_text = text.strip()
        if screenshot:
            user_text = f"{user_text}\n{SCREENSHOT_NOTE}".strip()
        messages = [SystemMessage(content=system_prompt(self.tenant_name, platforms, goals, flows, policy))]
        for h in state.history[-HISTORY_LIMIT:]:
            messages.append(HumanMessage(content=h["text"]) if h["role"] == "user" else AIMessage(content=h["text"]))
        messages.append(HumanMessage(content=user_text or "（空白訊息）"))

        tools = turn.tools()
        by_name = {t.name: t for t in tools}
        catalog = {"platforms": platforms, "goals": goals, "flows": flows}
        rounds = 0
        try:
            for rounds in range(1, s.assistant_max_tool_rounds + 1):
                await release_connection(self.db)
                ai = await self._model_call(turn, messages, tools, catalog)
                messages.append(ai)
                turn.say(_text_of(ai))
                calls = list(getattr(ai, "tool_calls", None) or [])
                if not calls:
                    break
                for call in calls:
                    t1 = time.perf_counter()
                    fn = by_name.get(call["name"])
                    try:
                        result = await fn.ainvoke(call["args"]) if fn else f"未知的工具 {call['name']}"
                    except Exception:
                        log.exception("tool %s failed (chat %s)", call["name"], state.chat_id)
                        result = "工具執行失敗，請改用文字向民眾說明目前無法處理。"
                    turn.tool_calls.append({"name": call["name"], "args": call["args"], "result": result[:2000], "ms": int((time.perf_counter() - t1) * 1000)})
                    messages.append(ToolMessage(content=result, tool_call_id=call["id"], name=call["name"]))
            else:
                turn.say(policy.text("clarify_fallback"))
        except Exception:
            log.exception("assistant turn failed (chat %s)", state.chat_id)
            await turn.answer_without_model()
            if not turn.outgoing:
                turn.outgoing.append({"kind": "text", "text": policy.text("model_failure")})
        finally:
            turn.screenshot = None

        if not turn.outgoing:
            turn.say(policy.text("empty_reply"))
        state.history.append({"role": "user", "text": user_text or "（空白訊息）"})
        reply_text = "\n".join(m["text"] for m in turn.outgoing if m["kind"] in ("text", "choices") and not m.get("step_id"))
        state.history.append({"role": "assistant", "text": "\n".join(x for x in [*(f"[{n}]" for n in turn.notes), reply_text] if x)})
        state.history = state.history[-(HISTORY_LIMIT * 2):]
        state.last_active_at = time.time()
        await ChatStore.save(state)
        return {"chat_id": state.chat_id, "messages": turn.outgoing,
                "_debug": {"elapsed_ms": int((time.perf_counter() - t0) * 1000), "rounds": rounds, "tool_calls": turn.tool_calls, "usage": turn.usage,
                           "locate": turn.locate_debug,
                           "state": {"content_mode": state.content_mode, "theme": state.theme, "platform_id": state.platform_id, "flow_id": state.flow_id,
                                     "goal_id": state.goal_id, "step_id": state.step_id, "policy": state.policy or None,
                                     "language": policy.language, "delivery": policy.delivery}}}

    async def _model_call(self, turn: ChatTurn, messages: list, tools: list, catalog: dict) -> AIMessage:
        s = get_settings()
        t0 = time.perf_counter()
        if s.llm_provider == "fake":
            ai = fake.assistant_reply(messages, catalog)
            model_name = "fake"
            usage = {"input_tokens": sum(len(str(m.content)) for m in messages) // 3, "output_tokens": len(str(ai.content)) // 3 + 40 * len(ai.tool_calls)}
        else:
            model_name = s.model_for("assistant")
            ai = await _chat_model(model_name, responses_api=True).bind_tools(tools).ainvoke(messages)
            usage = dict(getattr(ai, "usage_metadata", None) or {})
        turn.usage.append(await record_usage("assistant", model_name, usage, int((time.perf_counter() - t0) * 1000),
                                             turn.state.tenant_id, "chat", turn.state.chat_id))
        return ai


def _text_of(ai: AIMessage) -> str:
    c = ai.content
    if isinstance(c, str):
        return c
    return "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in c)
