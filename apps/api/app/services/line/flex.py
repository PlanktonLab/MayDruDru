"""LINE 訊息組裝（SPEC §8.4）。

每個 builder 回傳的都是 LINE 的 JSON dict，沒有 SDK 型別，所以測試可以直接斷言，
`sender` 也可以在最後一刻才轉型。

**這個檔案裡沒有一個中文字串常數**：所有文字都以 content key 從 `services/contents`
取得（CLAUDE.md 規則 4），連圖文選單的標題與按鈕字都是。要改字請到後台改。

案件時間軸是 12 個內部狀態壓成 5 個民眾看得懂的階段（送出 → 審核 → 核定 → 撥款 →
完成）。需要補件、逾期、不通過這些「卡住了」的狀態不另外開一個階段，而是把它
所在的那一階段標成 blocked，因為民眾要知道的是「卡在哪一關」，不是我們內部有幾種狀態。
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime
from typing import Any
from urllib.parse import urlencode

from sqlalchemy.ext.asyncio import AsyncSession

from ...config import get_settings
from ...models import Application, DocumentType, Scheme
from .. import contents
from . import theme

__all__ = [
    "MAIN_MENU",
    "STATUS_STEP",
    "TIMELINE_STEP_KEYS",
    "case_timeline_bubble",
    "case_timeline_message",
    "checklist_message",
    "main_menu_labels",
    "main_menu_quick_reply",
    "my_cases_message",
    "notification_messages",
    "postback",
    "preview_surfaces",
    "quick_reply",
    "scheme_carousel_message",
    "scheme_message",
    "step_card_message",
    "text_message",
]

SEPARATOR = "────────"
MARKER_DONE = "✓"
MARKER_CURRENT = "●"
MARKER_BLOCKED = "⚠"
MARKER_UPCOMING = "○"
CHECKED_BOX = "☑"
UNCHECKED_BOX = "☐"

# 主選單的六個入口（SPEC §8.4 的 rich menu），(action, 標籤 content key)。
# 順序就是 quick reply 的順序，也是 rich menu 的 tile 順序。
MAIN_MENU: tuple[tuple[str, str], ...] = (
    ("case_status", "button.case_status"),
    ("my_cases", "button.my_cases"),
    ("scheme_info", "button.subsidy_info"),
    ("sop_start", "button.eligibility"),
    ("faq", "button.faq"),
    ("contact", "button.contact"),
)

TIMELINE_STEP_KEYS: tuple[str, ...] = (
    "case.timeline.step0",
    "case.timeline.step1",
    "case.timeline.step2",
    "case.timeline.step3",
    "case.timeline.step4",
)

# 12 個狀態各自落在哪一個公開階段上。
STATUS_STEP: dict[str, int] = {
    "SUBMITTED": 0,
    "UNDER_REVIEW": 1,
    "NEEDS_REVISION": 1,
    "REVISION_SUBMITTED": 1,
    "APPROVED": 2,
    "DISBURSING": 3,
    "DISBURSED": 4,
    "REJECTED": 2,
    "WITHDRAWN": 0,
    "CANCELLED_BY_STAFF": 0,
    "EXPIRED": 1,
}

# 走不下去的狀態：所在階段畫成警示，而不是「正在進行」。
BLOCKED_STATUSES = frozenset({"NEEDS_REVISION", "REJECTED", "WITHDRAWN", "CANCELLED_BY_STAFF", "EXPIRED"})

STATUS_COLOR: dict[str, str] = {
    "APPROVED": theme.SUCCESS,
    "DISBURSING": theme.SUCCESS,
    "DISBURSED": theme.SUCCESS,
    "NEEDS_REVISION": theme.WARNING,
    "EXPIRED": theme.WARNING,
    "REJECTED": theme.ERROR,
    "CANCELLED_BY_STAFF": theme.ERROR,
    "WITHDRAWN": theme.TEXT_MUTED,
}

LABEL_LIMIT = 20  # LINE 的 quick reply / 按鈕字數上限
CAROUSEL_LIMIT = 10
ROW_LIMIT = 10


# ------------------------------------------------------------------ 小工具

def postback(action: str, **params: Any) -> str:
    """postback data 一律是 `action=…&k=v`（youth-line-bot 的格式，上限 300 bytes）。"""
    pairs = [("action", action)] + [(k, str(v)) for k, v in params.items() if v not in (None, "")]
    return urlencode(pairs)


def _clip(label: str, limit: int = LABEL_LIMIT) -> str:
    return label if len(label) <= limit else label[: limit - 1] + "…"


def _day(value: datetime | date | None) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    return value.isoformat()


async def _t(db: AsyncSession, tenant_id: str, key: str, **variables: Any) -> str:
    return await contents.tf(db, tenant_id, key, **variables)


def text_message(text: str, quick: dict[str, Any] | None = None) -> dict[str, Any]:
    message: dict[str, Any] = {"type": "text", "text": text}
    if quick:
        message["quickReply"] = quick
    return message


def quick_reply(items: Sequence[tuple[str, str]]) -> dict[str, Any]:
    """`[(label, postback_data)]` → LINE quick reply（最多 13 個）。"""
    return {
        "items": [
            {"type": "action", "action": {"type": "postback", "label": _clip(label), "data": data, "displayText": _clip(label)}}
            for label, data in items[:13]
        ]
    }


async def main_menu_labels(db: AsyncSession, tenant_id: str) -> list[str]:
    return [await _t(db, tenant_id, key) for _, key in MAIN_MENU]


async def main_menu_quick_reply(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    return quick_reply([(await _t(db, tenant_id, key), postback(action)) for action, key in MAIN_MENU])


async def cancel_quick_reply(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    return quick_reply([(await _t(db, tenant_id, "button.cancel"), postback("cancel"))])


async def sop_quick_reply(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    """SOP session 的四個動作（SPEC §8.4）。P4 才會真的有 session，按鈕先備好。"""
    return quick_reply(
        [
            (await _t(db, tenant_id, "line.quickreply.next"), postback("sop_next")),
            (await _t(db, tenant_id, "line.quickreply.stuck"), postback("sop_stuck")),
            (await _t(db, tenant_id, "line.quickreply.switch"), postback("sop_switch")),
            (await _t(db, tenant_id, "line.quickreply.exit"), postback("sop_exit")),
        ]
    )


# ----------------------------------------------------------- Flex 基本零件

def _row(label: str, value: str) -> dict[str, Any]:
    return {
        "type": "box",
        "layout": "baseline",
        "spacing": "sm",
        "contents": [
            {"type": "text", "text": label, "color": theme.TEXT_SECONDARY, "size": "sm", "flex": 2},
            {"type": "text", "text": value or "-", "color": theme.TEXT, "size": "sm", "flex": 5, "wrap": True},
        ],
    }


def _header(eyebrow: str, title: str) -> dict[str, Any]:
    return {
        "type": "box",
        "layout": "vertical",
        "backgroundColor": theme.PRIMARY,
        "paddingAll": "16px",
        "spacing": "xs",
        "contents": [
            {"type": "text", "text": eyebrow, "color": theme.ON_PRIMARY_MUTED, "size": "xs"},
            {"type": "text", "text": title, "color": theme.ON_PRIMARY, "size": "lg", "weight": "bold", "wrap": True},
        ],
    }


def _separator() -> dict[str, Any]:
    return {"type": "separator", "color": theme.BORDER, "margin": "md"}


def _button(label: str, data: str, *, style: str = "primary") -> dict[str, Any]:
    return {
        "type": "button",
        "style": style,
        "height": "sm",
        "color": theme.PRIMARY if style == "primary" else None,
        "action": {"type": "postback", "label": _clip(label), "data": data, "displayText": _clip(label)},
    }


def _link_button(label: str, uri: str) -> dict[str, Any]:
    return {
        "type": "button",
        "style": "link",
        "height": "sm",
        "action": {"type": "uri", "label": _clip(label), "uri": uri},
    }


def _prune(node: dict[str, Any]) -> dict[str, Any]:
    """把 `None` 的欄位拿掉——LINE 對多餘的 null 很嚴格。"""
    return {k: _prune_value(v) for k, v in node.items() if v is not None}


def _prune_value(value: Any) -> Any:
    if isinstance(value, dict):
        return _prune(value)
    if isinstance(value, list):
        return [_prune_value(v) for v in value]
    return value


# --------------------------------------------------------------- 案件時間軸

def _markers(status: str) -> list[str]:
    step = STATUS_STEP.get(status, 0)
    blocked = status in BLOCKED_STATUSES
    out: list[str] = []
    for index in range(len(TIMELINE_STEP_KEYS)):
        if index < step:
            out.append(MARKER_DONE)
        elif index == step:
            out.append(MARKER_BLOCKED if blocked else (MARKER_DONE if status == "DISBURSED" else MARKER_CURRENT))
        else:
            out.append(MARKER_UPCOMING)
    return out


def _marker_style(marker: str) -> tuple[str, str]:
    if marker == MARKER_DONE:
        return theme.PRIMARY_SOFT, "regular"
    if marker == MARKER_CURRENT:
        return theme.PRIMARY, "bold"
    if marker == MARKER_BLOCKED:
        return theme.WARNING, "bold"
    return theme.TEXT_MUTED, "regular"


async def case_timeline_bubble(
    db: AsyncSession,
    tenant_id: str,
    application: Application,
    *,
    scheme_name: str = "",
) -> dict[str, Any]:
    """案件進度卡：狀態標籤 + 欄位 + 五段時間軸 + 下一步 + 兩個按鈕。"""
    status = application.status
    body: list[dict[str, Any]] = [
        {
            "type": "box",
            "layout": "baseline",
            "spacing": "sm",
            "contents": [
                {"type": "text", "text": MARKER_CURRENT, "color": STATUS_COLOR.get(status, theme.INFO), "flex": 0, "size": "sm"},
                {
                    "type": "text",
                    "text": await _t(db, tenant_id, "case.status_chip",
                                     status=await _t(db, tenant_id, f"status.{status}.public_label")),
                    "color": theme.TEXT,
                    "size": "sm",
                    "weight": "bold",
                    "wrap": True,
                },
            ],
        },
        _separator(),
        _row(await _t(db, tenant_id, "case.field.case_id"), application.case_no),
        _row(await _t(db, tenant_id, "case.field.applicant"), application.applicant_name),
        _row(await _t(db, tenant_id, "case.field.subsidy"), scheme_name),
        _row(await _t(db, tenant_id, "case.field.submitted_at"), _day(application.first_submitted_at)),
        _row(await _t(db, tenant_id, "case.field.updated_at"), _day(application.updated_at)),
    ]
    if application.supplement_deadline:
        body.append(_row(await _t(db, tenant_id, "case.field.supplement_deadline"), _day(application.supplement_deadline)))
    if application.payment_date:
        body.append(_row(await _t(db, tenant_id, "case.field.payment_date"), _day(application.payment_date)))

    body.append(_separator())
    body.append({"type": "text", "text": await _t(db, tenant_id, "case.timeline_title"),
                 "size": "sm", "weight": "bold", "color": theme.TEXT, "margin": "md"})
    markers = _markers(status)
    for index, key in enumerate(TIMELINE_STEP_KEYS):
        color, weight = _marker_style(markers[index])
        body.append(
            {
                "type": "box",
                "layout": "baseline",
                "spacing": "sm",
                "contents": [
                    {"type": "text", "text": markers[index], "color": color, "size": "sm", "flex": 0},
                    {"type": "text", "text": await _t(db, tenant_id, key), "color": color,
                     "size": "sm", "weight": weight, "wrap": True},
                ],
            }
        )

    body.append(_separator())
    body.append({"type": "text", "text": await _t(db, tenant_id, "case.next_action_title"),
                 "size": "sm", "weight": "bold", "color": theme.TEXT, "margin": "md"})
    body.append({"type": "text", "text": await _t(db, tenant_id, f"status.{status}.next_action"),
                 "size": "sm", "color": theme.TEXT_SECONDARY, "wrap": True})

    bubble = {
        "type": "bubble",
        "header": _header(await _t(db, tenant_id, "case.card_eyebrow"), application.case_no),
        "body": {"type": "box", "layout": "vertical", "spacing": "sm", "backgroundColor": theme.CARD, "contents": body},
        "footer": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "contents": [
                _button(await _t(db, tenant_id, "button.refresh_case"), postback("refresh_case", case_no=application.case_no)),
                _button(await _t(db, tenant_id, "button.my_cases_secondary"), postback("my_cases"), style="secondary"),
            ],
        },
    }
    return _prune(bubble)


async def case_timeline_message(
    db: AsyncSession,
    tenant_id: str,
    application: Application,
    *,
    scheme_name: str = "",
) -> dict[str, Any]:
    label = await _t(db, tenant_id, f"status.{application.status}.public_label")
    return {
        "type": "flex",
        "altText": f"{application.case_no} / {label}",
        "contents": await case_timeline_bubble(db, tenant_id, application, scheme_name=scheme_name),
    }


# ----------------------------------------------------------------- 我的案件

async def my_cases_message(
    db: AsyncSession,
    tenant_id: str,
    entries: Sequence[tuple[Application, str]],
) -> dict[str, Any]:
    """已綁定案件清單。整列可點，點下去就是重新整理那一件的進度。"""
    rows: list[dict[str, Any]] = []
    for application, scheme_name in list(entries)[:ROW_LIMIT]:
        status_label = await _t(db, tenant_id, f"status.{application.status}.public_label")
        rows.append(
            {
                "type": "box",
                "layout": "vertical",
                "spacing": "xs",
                "paddingAll": "8px",
                "action": {"type": "postback", "data": postback("refresh_case", case_no=application.case_no)},
                "contents": [
                    {"type": "text", "text": application.case_no, "size": "sm", "weight": "bold", "color": theme.TEXT},
                    {"type": "text", "text": status_label, "size": "xs",
                     "color": STATUS_COLOR.get(application.status, theme.INFO)},
                    {"type": "text", "text": scheme_name or "-", "size": "xs", "color": theme.TEXT_SECONDARY, "wrap": True},
                    {
                        "type": "text",
                        "text": (await _t(db, tenant_id, "mycase.updated_prefix")) + _day(application.updated_at),
                        "size": "xxs",
                        "color": theme.TEXT_MUTED,
                    },
                ],
            }
        )
    rows.append({"type": "text", "text": await _t(db, tenant_id, "mycase.hint"),
                 "size": "xxs", "color": theme.TEXT_MUTED, "margin": "md"})
    bubble = {
        "type": "bubble",
        "header": _header(
            await _t(db, tenant_id, "mycase.title"),
            await _t(db, tenant_id, "mycase.subtitle", count=len(entries)),
        ),
        "body": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": rows},
    }
    return {
        "type": "flex",
        "altText": await _t(db, tenant_id, "mycase.subtitle", count=len(entries)),
        "contents": _prune(bubble),
    }


# ------------------------------------------------------------------- 方案卡

async def scheme_bubble(db: AsyncSession, tenant_id: str, scheme: Scheme) -> dict[str, Any]:
    if scheme.age_min or scheme.age_max:
        age = f"{scheme.age_min or ''}-{scheme.age_max or ''}"
    else:
        age = await _t(db, tenant_id, "subsidy.age_unlimited")
    period = await _t(db, tenant_id, "subsidy.period_unset")
    if scheme.application_start or scheme.application_end:
        period = f"{_day(scheme.application_start)} ~ {_day(scheme.application_end)}"

    # 還沒寫進資料庫的方案（後台預覽用的範例）欄位預設值尚未套用，一律當成空字串。
    body: list[dict[str, Any]] = [
        {"type": "text", "text": scheme.description or "-", "size": "sm", "color": theme.TEXT_SECONDARY, "wrap": True},
        _separator(),
        _row(await _t(db, tenant_id, "subsidy.field.eligibility"), scheme.eligibility),
        _row(await _t(db, tenant_id, "subsidy.field.age"), age),
        _row(await _t(db, tenant_id, "subsidy.field.period"), period),
        _row(await _t(db, tenant_id, "subsidy.field.amount"), scheme.amount_note),
        _row(await _t(db, tenant_id, "subsidy.field.method"), scheme.application_method),
        _row(await _t(db, tenant_id, "subsidy.field.contact"), scheme.contact),
    ]
    footer: list[dict[str, Any]] = [
        _button(await _t(db, tenant_id, "button.checklist"), postback("checklist", scheme=scheme.code), style="secondary"),
    ]
    # LINE 自己會去抓連結，所以只接受 https；http 會被它拒絕。
    if (scheme.official_url or "").startswith("https://"):
        footer.append(_link_button(await _t(db, tenant_id, "button.official_url"), scheme.official_url))

    bubble = {
        "type": "bubble",
        "size": "mega",
        "header": _header(scheme.category or scheme.code, scheme.name),
        "body": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": body},
        "footer": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": footer},
    }
    return _prune(bubble)


async def scheme_message(db: AsyncSession, tenant_id: str, scheme: Scheme) -> dict[str, Any]:
    return {"type": "flex", "altText": scheme.name, "contents": await scheme_bubble(db, tenant_id, scheme)}


async def scheme_carousel_message(
    db: AsyncSession, tenant_id: str, schemes: Sequence[Scheme], *, alt_text: str = ""
) -> dict[str, Any]:
    bubbles = [await scheme_bubble(db, tenant_id, s) for s in list(schemes)[:CAROUSEL_LIMIT]]
    return {
        "type": "flex",
        "altText": alt_text or (schemes[0].name if schemes else "-"),
        "contents": {"type": "carousel", "contents": bubbles},
    }


# --------------------------------------------------------------- 文件清單

async def checklist_message(
    db: AsyncSession,
    tenant_id: str,
    scheme: Scheme,
    document_types: Sequence[DocumentType],
    checked: Sequence[str] = (),
) -> dict[str, Any]:
    """應備文件清單。每一列可以點一下打勾，勾選狀態存在對話狀態裡。"""
    ticked = set(checked)
    rows: list[dict[str, Any]] = []
    for doc in document_types:
        on = doc.code in ticked
        rows.append(
            {
                "type": "box",
                "layout": "baseline",
                "spacing": "sm",
                "action": {"type": "postback", "data": postback("apply_toggle", scheme=scheme.code, doc=doc.code)},
                "contents": [
                    {"type": "text", "text": CHECKED_BOX if on else UNCHECKED_BOX, "flex": 0, "size": "sm",
                     "color": theme.PRIMARY if on else theme.TEXT_MUTED},
                    {"type": "text", "text": doc.label or doc.code, "size": "sm", "wrap": True,
                     "color": theme.TEXT_MUTED if on else theme.TEXT,
                     "decoration": "line-through" if on else "none"},
                ],
            }
        )
    if not rows:
        rows.append({"type": "text", "text": await _t(db, tenant_id, "apply.checklist_empty"),
                     "size": "sm", "color": theme.TEXT_SECONDARY, "wrap": True})

    missing = len([d for d in document_types if d.code not in ticked])
    summary = (
        await _t(db, tenant_id, "apply.checklist_done")
        if document_types and missing == 0
        else await _t(db, tenant_id, "apply.checklist_missing", count=missing)
    )
    bubble = {
        "type": "bubble",
        "header": _header(await _t(db, tenant_id, "apply.checklist_eyebrow"), scheme.name),
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "contents": [
                {"type": "text", "text": await _t(db, tenant_id, "apply.checklist_hint"),
                 "size": "xxs", "color": theme.TEXT_MUTED},
                *rows,
                _separator(),
                {"type": "text", "text": f"{summary} ({len(document_types) - missing}/{len(document_types)})",
                 "size": "sm", "color": theme.TEXT, "wrap": True},
            ],
        },
    }
    return {"type": "flex", "altText": scheme.name, "contents": _prune(bubble)}


# --------------------------------------------------------------------- 推播

async def notification_messages(
    db: AsyncSession,
    tenant_id: str,
    application: Application,
    *,
    transition_code: str,
    scheme_name: str = "",
    document_code: str = "",
) -> list[dict[str, Any]]:
    """狀態變更推播：一則文字 + 一張時間軸（SPEC §8.7）。

    T2（要求補件）另外附兩個按鈕：一個把人帶進 SOP 教學，一個把人帶到補件網頁。
    退件通知只給這兩條路，是因為民眾這時候需要的是「怎麼補」而不是「再看一次狀態」。
    """
    headline = await _t(db, tenant_id, f"status.{application.status}.notify_headline")
    body = await _t(
        db, tenant_id, f"notify.{transition_code}",
        headline=headline, case_no=application.case_no, deadline=_day(application.supplement_deadline),
    )
    messages: list[dict[str, Any]] = [text_message(body)]
    timeline = await case_timeline_message(db, tenant_id, application, scheme_name=scheme_name)
    if transition_code == "T2":
        timeline["contents"]["footer"] = {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "contents": [
                _button(
                    await _t(db, tenant_id, "button.sop_prepare"),
                    postback("sop_prepare", case_no=application.case_no, doc=document_code),
                ),
                _link_button(
                    await _t(db, tenant_id, "button.go_supplement"),
                    f"{get_settings().apply_web_base_url.rstrip('/')}/status/{application.case_no}",
                ),
            ],
        }
    messages.append(timeline)
    return messages


# ------------------------------------------------------------------ step card

async def step_card_message(
    db: AsyncSession,
    tenant_id: str,
    *,
    image_url: str,
    alt_text: str,
    width: int = 1040,
    height: int = 1040,
) -> list[dict[str, Any]]:
    """SOP step card：一張圖 + 四個動作快速回覆。session 本體是 P4，這裡只負責長相。"""
    return [
        {
            "type": "image",
            "originalContentUrl": image_url,
            "previewImageUrl": image_url,
            "animated": False,
            "altText": alt_text,
            "size": "full",
            "aspectRatio": f"{width}:{height}",
            "quickReply": await sop_quick_reply(db, tenant_id),
        }
    ]


# -------------------------------------------------------------- 後台預覽面

PREVIEW_SURFACES: tuple[str, ...] = (
    "welcome",
    "case_ask",
    "case_card",
    "my_cases",
    "scheme_card",
    "contact",
    "notification",
)


async def preview_surfaces(db: AsyncSession, tenant_id: str) -> list[dict[str, Any]]:
    """後台預覽：用**同一組** builder 畫出七個真實畫面，不是另外做一份近似品。

    範例案件與範例方案都是記憶體物件，不寫資料庫。
    """
    from ...models import Application as App

    stamp = datetime.now().astimezone()
    sample = App(
        tenant_id=tenant_id,
        case_no=contents.SAMPLE_VARIABLES["case_no"],
        scheme_id="sample",
        # 範例值集中在 services/contents.SAMPLE_VARIABLES，這個檔案裡不放任何中文字串。
        applicant_name=contents.SAMPLE_VARIABLES["applicant"],
        status="UNDER_REVIEW",
        first_submitted_at=stamp,
    )
    sample.updated_at = stamp
    scheme = Scheme(tenant_id=tenant_id, code="SAMPLE", name=contents.SAMPLE_VARIABLES["scheme_name"])

    out: list[dict[str, Any]] = []
    for surface in PREVIEW_SURFACES:
        out.append({"id": surface, "messages": await _surface_messages(db, tenant_id, surface, sample, scheme)})
    return out


async def _surface_messages(
    db: AsyncSession, tenant_id: str, surface: str, sample: Application, scheme: Scheme
) -> list[dict[str, Any]]:
    if surface == "welcome":
        return [text_message(await _t(db, tenant_id, "home.welcome"), await main_menu_quick_reply(db, tenant_id))]
    if surface == "case_ask":
        return [text_message(await _t(db, tenant_id, "case.ask_case_id"), await cancel_quick_reply(db, tenant_id))]
    if surface == "case_card":
        return [await case_timeline_message(db, tenant_id, sample, scheme_name=scheme.name)]
    if surface == "my_cases":
        return [await my_cases_message(db, tenant_id, [(sample, scheme.name)])]
    if surface == "scheme_card":
        return [await scheme_message(db, tenant_id, scheme)]
    if surface == "contact":
        return [text_message(await contact_text(db, tenant_id), await main_menu_quick_reply(db, tenant_id))]
    if surface == "notification":
        return await notification_messages(db, tenant_id, sample, transition_code="T3", scheme_name=scheme.name)
    return []


async def contact_text(db: AsyncSession, tenant_id: str) -> str:
    """聯絡我們：六段文字接起來。每一段都是可編輯的 content key。"""
    lines = [
        await _t(db, tenant_id, "contact.title"),
        "",
        await _t(db, tenant_id, "contact.unit"),
        await _t(db, tenant_id, "contact.phone"),
        await _t(db, tenant_id, "contact.email"),
        await _t(db, tenant_id, "contact.address"),
        await _t(db, tenant_id, "contact.hours"),
        "",
        await _t(db, tenant_id, "contact.footer_note"),
    ]
    return "\n".join(lines)
