"""Policy: the variables that make the same building blocks fit different
places.

The engines (`ai/assistant.py`, `ai/session_graph.py`) and the guidance
layer (`services/guide.py`) contain no wording, no tone, no language and no
"what to do when" of their own: everything of that kind is a field here. A
tenant sets its policy once (`tenant.settings["policy"]`); a channel may
override parts of it per conversation (a LINE bot for new immigrants asks for
Vietnamese and one card at a time, the web widget for the same tenant keeps
the defaults).

Three groups of fields:

* **voice** — language, the assistant's name, tone, what a goal is called,
  extra rules, the hand-off line.
* **behaviour** — how cards are delivered (all at once or one by one) and
  what each screenshot outcome turns into (restart the flow, ask, hand off …),
  plus the two confidence thresholds.
* **templates** — every sentence the deterministic paths say to a citizen,
  as templates with `{placeholders}`. Built-in sets exist for zh-TW and en;
  a tenant overrides any key, in any language. The chat assistant rephrases
  in the policy language anyway, so a language without a built-in set still
  works there.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from . import contents as contents_service

POLICY_KEY = "policy"
# `contents` 裡 SOP 語句的 key 前綴（決策 D23：內文用 Python 的單大括號佔位符）。
CONTENT_PREFIX = "sop.template."
LEGACY_KEY = "assistant"  # the first version stored name/goal_noun/extra_rules/handoff_message here

DELIVERY = ("all_at_once", "one_by_one")
ON_AMBIGUOUS = ("ask", "best_guess")
ON_OFF_FLOW = ("restart", "ask_goal", "handoff")
ON_NOT_APP_SCREEN = ("restart", "ask_platform", "handoff")
ON_UNKNOWN_PLATFORM = ("ask_platform", "handoff")
ON_UNREADABLE = ("retake", "handoff")

DEFAULTS: dict[str, Any] = {
    # voice
    "language": "zh-TW",
    "name": "",             # empty: the built-in name for the language
    "tone": "",             # empty: the built-in tone line for the language
    "goal_noun": "",        # empty: the built-in noun for the language (文件 / document)
    "extra_rules": "",
    "handoff_message": "",  # empty: the built-in hand-off line
    # behaviour
    "delivery": "all_at_once",
    "on_ambiguous": "ask",
    "on_off_flow": "restart",
    "on_not_app_screen": "restart",
    "on_unknown_platform": "ask_platform",
    "on_unreadable": "retake",
    "locate_threshold": 0.6,
    "locate_low": 0.35,
    # templates: {key: text}
    "templates": {},
}

_ENUMS = {"delivery": DELIVERY, "on_ambiguous": ON_AMBIGUOUS, "on_off_flow": ON_OFF_FLOW, "on_not_app_screen": ON_NOT_APP_SCREEN,
          "on_unknown_platform": ON_UNKNOWN_PLATFORM, "on_unreadable": ON_UNREADABLE}

# ------------------------------------------------------------------ built-in wording

TEMPLATES: dict[str, dict[str, str]] = {
    "zh-TW": {
        "name": "線上客服",
        "goal_noun": "文件",
        "tone": "簡短口語，像真人客服在打字",
        "handoff": "目前沒有提供這項協助，建議您改向承辦單位詢問。",
        "greeting": "您好，我是{name}。我可以一步一圖帶您在 {brands} 完成 {goals}。\n請告訴我您用的是哪個 App 或網站、想完成哪一項；如果已經卡在某個畫面，也可以直接把截圖貼給我，我會幫您看您走到哪一步。",
        "greeting_empty": "您好，我是{name}。目前還沒有可以協助的服務流程。",
        "located": "您目前在「{flow}」的步驟 {index}「{step}」。",
        "located_difference": "與教學圖的差異：{difference}",
        "located_lead": "看起來您目前在「{step}」這一步，接下來請照下面的圖操作：",
        "ambiguous_ask": "您的畫面看起來像下列哪一個？",
        "off_flow": "這個畫面是{where}裡的一頁，但不在教學流程裡。",
        "off_flow_restart": "請回到{where}的首頁，從步驟 1「{step}」重新開始。",
        "off_flow_ask": "請問您要在{where}完成哪一項{goal_noun}？",
        "not_app_screen": "這張圖是{what}。",
        "not_app_restart": "請先打開「{platform}」，照步驟 1「{step}」開始。",
        "ask_platform": "請問您使用的是哪一個 App 或網站？",
        "not_a_screenshot": "這張圖不是螢幕畫面，請在手機上直接截圖再傳過來。",
        "restart_lead": "也可以先照「{platform}」的步驟 1「{step}」開始。",
        "unreadable": "這張圖{issues}，看不清楚內容；請重新截一張完整、清楚的畫面。",
        "unreadable_default_issue": "太模糊或太暗",
        "unknown_platform_seen": "畫面看起來是「{seen}」，目前沒有這個 App 或網站的教學。",
        "unknown_platform_unseen": "看不出這是哪個 App 或網站的畫面。",
        "photographed": "這張是翻拍的照片，直接截圖會更清楚。",
        "this_app": "這個 App",
        "kind_home_screen": "手機主畫面",
        "kind_lock_screen": "鎖定畫面",
        "kind_system_screen": "系統畫面",
        "kind_other": "不是 App 裡的畫面",
        "step_head": "步驟 {index}／{total}：{title}",
        "no_screenshot": "這一則沒有附截圖。",
        "busy": "上一則訊息還在處理中，請稍候。",
        "model_failure": "抱歉，我這邊暫時無法處理您的訊息，請稍後再試一次。",
        "clarify_fallback": "這一題我需要再確認一下，請您換個方式描述，或直接傳截圖給我。",
        "empty_reply": "收到，請問還有哪裡需要協助？",
        "next_prompt": "看完這一步後，回覆「下一步」我再傳下一張。",
        "located_note": "已從您的截圖辨識出目前位置（信心 {confidence}）",
        "ask_brand": "請問您使用的是哪一家的服務？",
        "ask_channel": "您是用 {brand} 的 App 還是網頁？",
        "ask_goal": "請問您需要取得哪一種{goal_noun}？",
        "ask_branch": "接下來您看到的是哪一種情況？",
        "ask_next_goal": "接下來還需要取得哪一種{goal_noun}？",
        "completed": "「{goal}」的步驟已全部完成。",
        "candidate_confirmed": "已依您的確認定位到此步驟",
        "clarification_limit": "多次追問後仍無法判斷，請轉由人工協助",
        "channel_mobile_app": "手機 App",
        "channel_web": "網頁版",
        "channel_desktop": "電腦版",
    },
    "en": {
        "name": "Support assistant",
        "goal_noun": "document",
        "tone": "short and conversational, like a human agent typing",
        "handoff": "We can't help with that here yet; please contact the office in charge.",
        "greeting": "Hi, I'm {name}. I can walk you through {brands} to get {goals}, one picture per step.\nTell me which app or website you're using and what you need; if you're stuck on a screen, just send me a screenshot and I'll find where you are.",
        "greeting_empty": "Hi, I'm {name}. There are no guides available yet.",
        "located": "You're at step {index} of \"{flow}\": {step}.",
        "located_difference": "Compared with the guide: {difference}",
        "located_lead": "It looks like you're at \"{step}\". Follow the pictures below:",
        "ambiguous_ask": "Which of these looks like your screen?",
        "off_flow": "This is a page in {where}, but not part of the guide.",
        "off_flow_restart": "Please go back to the home screen of {where} and start again from step 1: {step}.",
        "off_flow_ask": "Which {goal_noun} do you need from {where}?",
        "not_app_screen": "This picture is {what}.",
        "not_app_restart": "Please open \"{platform}\" first and start from step 1: {step}.",
        "ask_platform": "Which app or website are you using?",
        "not_a_screenshot": "This isn't a screenshot. Please take a screenshot on your phone and send that.",
        "restart_lead": "You can also start from step 1 of \"{platform}\": {step}.",
        "unreadable": "This picture is {issues}; I can't make it out. Please send a full, clear screenshot.",
        "unreadable_default_issue": "too blurry or too dark",
        "unknown_platform_seen": "This looks like \"{seen}\", which we don't have a guide for.",
        "unknown_platform_unseen": "I can't tell which app or website this is.",
        "photographed": "This is a photo of a screen; a screenshot would be clearer.",
        "this_app": "this app",
        "kind_home_screen": "the phone's home screen",
        "kind_lock_screen": "the lock screen",
        "kind_system_screen": "a system screen",
        "kind_other": "not a screen inside an app",
        "step_head": "Step {index}/{total}: {title}",
        "no_screenshot": "There was no screenshot in this message.",
        "busy": "Still working on your last message, one moment.",
        "model_failure": "Sorry, I can't process your message right now. Please try again shortly.",
        "clarify_fallback": "I need to check that one. Could you describe it differently, or send a screenshot?",
        "empty_reply": "Got it. Anything else I can help with?",
        "next_prompt": "When you're done with this step, reply \"next\" and I'll send the next one.",
        "located_note": "Located from your screenshot (confidence {confidence})",
        "ask_brand": "Which provider are you using?",
        "ask_channel": "Are you using the {brand} app or the website?",
        "ask_goal": "Which {goal_noun} do you need?",
        "ask_branch": "Which of these do you see next?",
        "ask_next_goal": "Which other {goal_noun} do you need?",
        "completed": "All steps for \"{goal}\" are done.",
        "candidate_confirmed": "Located at the step you confirmed",
        "clarification_limit": "I still can't tell after several questions; please ask a human agent.",
        "channel_mobile_app": "mobile app",
        "channel_web": "website",
        "channel_desktop": "desktop",
    },
}

LANGUAGE_NAMES = {"zh-TW": "台灣正體中文", "zh-CN": "简体中文", "en": "English", "ja": "日本語", "vi": "Tiếng Việt", "id": "Bahasa Indonesia",
                  "th": "ภาษาไทย", "tl": "Filipino", "ko": "한국어"}


# ------------------------------------------------------------------ the object

@dataclass
class Policy:
    language: str = "zh-TW"
    name: str = ""
    tone: str = ""
    goal_noun: str = ""
    extra_rules: str = ""
    handoff_message: str = ""
    delivery: str = "all_at_once"
    on_ambiguous: str = "ask"
    on_off_flow: str = "restart"
    on_not_app_screen: str = "restart"
    on_unknown_platform: str = "ask_platform"
    on_unreadable: str = "retake"
    locate_threshold: float = 0.6
    locate_low: float = 0.35
    templates: dict[str, str] = field(default_factory=dict)

    # ---- construction

    @classmethod
    def from_settings(cls, settings: dict | None, overrides: dict | None = None) -> Policy:
        """Tenant settings (the `policy` block, or the first version's
        `assistant` block) with per-conversation overrides on top. Unknown
        keys and invalid values are ignored, never fatal."""
        raw: dict[str, Any] = {}
        s = settings or {}
        raw.update({k: v for k, v in (s.get(LEGACY_KEY) or {}).items() if k in DEFAULTS})
        raw.update(s.get(POLICY_KEY) or {})
        raw.update(overrides or {})
        return cls.from_dict(raw)

    @classmethod
    async def load(cls, db: AsyncSession, tenant_id: str, settings: dict | None = None,
                   overrides: dict | None = None) -> Policy:
        """同 `from_settings()`，外加把承辦人在後台改過的 `sop.template.*` 灌進語句表。

        優先序（高到低）：tenant settings 裡明寫的 `policy.templates` → `contents` 的
        已發布文案 → registry 出廠預設 → 這個檔案內建的 zh-TW／en 句子。
        中間那兩層都由 `contents.prefixed()` 供應，所以承辦人在「教學對話」那一區改字，
        LINE 與網頁的 SOP 對話下一次就會說新的話，不必改 code（SPEC §8.5、CLAUDE.md 規則 4）。

        讀不到 `contents`（資料表還沒建、連線斷了）就照舊用內建句子——一個機關的
        語氣設定失敗，不該讓整條教學啞掉。
        """
        p = cls.from_settings(settings, overrides)
        try:
            published = await contents_service.prefixed(db, tenant_id, CONTENT_PREFIX)
        except Exception:  # pragma: no cover - 防禦性；contents 自己已經不拋錯了
            return p
        merged = {k: v for k, v in published.items() if v.strip()}
        merged.update(p.templates)  # 明寫的 policy.templates 仍然最大
        p.templates = merged
        return p

    @classmethod
    def from_dict(cls, raw: dict | None) -> Policy:
        raw = raw or {}
        p = cls()
        for k in DEFAULTS:
            if k not in raw or raw[k] is None:
                continue
            v = raw[k]
            if k == "templates":
                if isinstance(v, dict):
                    p.templates = {str(a): str(b) for a, b in v.items() if isinstance(b, str) and b.strip()}
            elif k in ("locate_threshold", "locate_low"):
                try:
                    p.__dict__[k] = min(1.0, max(0.0, float(v)))
                except (TypeError, ValueError):
                    pass
            elif k in _ENUMS:
                if v in _ENUMS[k]:
                    p.__dict__[k] = v
            elif isinstance(v, str):
                p.__dict__[k] = v.strip()
        if p.locate_low > p.locate_threshold:
            p.locate_low = p.locate_threshold
        return p

    def to_dict(self) -> dict:
        """Every field, with the language's built-in wording filled in where
        the tenant left a blank — what the settings UI shows."""
        d = {k: getattr(self, k) for k in DEFAULTS}
        d.update(name=self.display_name, tone=self.tone_line, goal_noun=self.noun, handoff_message=self.handoff_line)
        return d

    # ---- voice, resolved

    @property
    def language_name(self) -> str:
        return LANGUAGE_NAMES.get(self.language, self.language)

    def _builtin(self, key: str) -> str:
        base = TEMPLATES.get(self.language) or TEMPLATES["zh-TW"]
        return base.get(key) or TEMPLATES["zh-TW"].get(key, "")

    def _resolved(self, key: str) -> str:
        """語句表（承辦人改過的 `sop.template.*`）優先，否則語言的內建句子。"""
        return self.templates.get(key) or self._builtin(key)

    @property
    def display_name(self) -> str:
        return self.name or self._resolved("name")

    @property
    def tone_line(self) -> str:
        return self.tone or self._resolved("tone")

    @property
    def noun(self) -> str:
        return self.goal_noun or self._resolved("goal_noun")

    @property
    def handoff_line(self) -> str:
        return self.handoff_message or self.text("handoff")

    # ---- templates

    def text(self, key: str, **kw: Any) -> str:
        """A sentence for the citizen: the tenant's template for `key` if it
        set one, else the built-in one for the language (zh-TW as the last
        resort). Missing placeholders render empty instead of failing."""
        tpl = self.templates.get(key) or self._builtin(key)
        kw.setdefault("name", self.display_name)
        kw.setdefault("goal_noun", self.noun)
        try:
            return tpl.format_map(_Safe(kw))
        except (ValueError, IndexError):
            return tpl

    def kind_label(self, kind: str) -> str:
        return self.text(f"kind_{kind}") if kind in ("home_screen", "lock_screen", "system_screen") else self.text("kind_other")


class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return ""
