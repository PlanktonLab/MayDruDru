"""罐頭訊息 registry（SPEC §8.6）。

這份檔案同時是兩件事：

1. **seed**：`contents` 資料表裡缺的 key，開機／seed 時會用 `default` 補進去。
2. **runtime fallback**：`content.t()` 查不到資料列時回傳 `default`，所以就算
   資料表是空的（全新安裝、測試用的空資料庫），畫面也不會開天窗。

要改文案請到承辦人後台改，不要改這裡：後台改的是資料表，這裡改只會影響
下一次 seed，而且已經有資料列的 key 不會被覆蓋。這裡只在「新增一個可編輯的
文字」時才動——加一筆，然後用 `content.t('你的.key')` 讀它，後台就會自動出現。

`default` 裡的 `{{name}}` 是雙大括號的佔位符，由 `content.tf()` 代入；
`sop.template.*` 是例外，見該區塊的說明。
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = [
    "BY_KEY",
    "CONTENT_CATEGORIES",
    "CONTENT_REGISTRY",
    "CONTENT_TYPES",
    "ContentCategory",
    "ContentDefinition",
    "get_default",
    "get_definition",
    "has_key",
    "keys_in_category",
]

# text：多行訊息本文。button：按鈕／快速回覆上的短標籤，長度受 LINE 限制。
# label：卡片或表格裡的欄位名稱。
CONTENT_TYPES = ("text", "button", "label")


@dataclass(frozen=True)
class ContentDefinition:
    key: str
    category: str
    title: str
    description: str
    default: str
    content_type: str = "text"
    variables: tuple[str, ...] = ()
    sort_order: int = 0


@dataclass(frozen=True)
class ContentCategory:
    id: str
    label: str
    icon: str
    description: str


# 後台側邊欄與篩選器的排列順序。
CONTENT_CATEGORIES: tuple[ContentCategory, ...] = (
    ContentCategory("home", "首頁／歡迎", "📌", "使用者加入好友或打招呼時看到的內容"),
    ContentCategory("case", "案件進度", "📋", "查詢案件、驗證、進度卡片上的文字"),
    ContentCategory("subsidy", "補助資訊", "🎁", "補助列表與補助卡片上的文字"),
    ContentCategory("apply", "申請小幫手", "📝", "資格檢查問卷與文件準備清單"),
    ContentCategory("mycase", "我的案件", "👤", "已驗證案件清單的文字"),
    ContentCategory("faq", "常見問題", "❓", "FAQ 選單與回答時的提示文字"),
    ContentCategory("contact", "聯絡我們", "📞", "承辦單位聯絡資訊"),
    ContentCategory("notify", "通知", "🔔", "案件狀態改變時主動推播的訊息"),
    ContentCategory("security", "防詐檢查", "🛡️", "可疑訊息檢查的回覆文字"),
    ContentCategory("error", "錯誤訊息", "⚠️", "格式錯誤、系統忙碌等提示"),
    ContentCategory("button", "按鈕文字", "🔘", "按鈕與快速回覆上的顯示文字（不會改變按鈕功能）"),
    ContentCategory("status", "案件狀態文案", "🧭", "每個案件狀態的名稱、下一步說明與推播標題"),
    ContentCategory("rejection", "退件說明", "↩️", "承辦勾選退件原因時，市民看到的哪裡不對與怎麼修"),
    ContentCategory("review", "審核判定說明", "🔎", "規則引擎判不出來時，案件頁那一行「為什麼」"),
    # 標籤刻意不叫「申請小幫手」——那是 apply 分類的名字，後台側邊欄不該出現兩個同名項目。
    ContentCategory("sop", "教學對話", "🧑‍🏫", "一步一圖教學對話裡的固定語句"),
    # registry 裡沒有任何 key 屬於這一類：方案專屬文案是內容助理 (c) 依方案設定生出來的
    # 資料列（`contents.scheme_id` 有值），出廠時不存在，所以只有分類、沒有預設值。
    ContentCategory("scheme", "方案專屬文案", "🗂️", "某一個方案自己的狀態說明、退件說明與文件指引"),
)


def _def(
    key: str,
    category: str,
    title: str,
    description: str,
    default: str,
    *,
    content_type: str = "text",
    variables: tuple[str, ...] = (),
    sort_order: int = 0,
) -> ContentDefinition:
    """讓每一筆定義維持成一個看得完的呼叫，diff 起來一筆就是一筆。"""
    return ContentDefinition(
        key=key,
        category=category,
        title=title,
        description=description,
        default=default,
        content_type=content_type,
        variables=variables,
        sort_order=sort_order,
    )


# ---- 首頁／歡迎
_HOME: tuple[ContentDefinition, ...] = (
    _def(
        "home.welcome",
        "home",
        "歡迎訊息",
        "民眾第一次加入好友，或輸入「你好」時，最先看到的訊息。",
        "👋 歡迎使用「新竹市青年補助智慧助手」！\n"
        "\n"
        "我可以幫你：\n"
        "🔍 查詢案件進度\n"
        "❓ 回答常見問題\n"
        "📋 介紹青年補助\n"
        "👤 管理你的案件\n"
        "📝 找出可能符合的補助\n"
        "📞 提供聯絡方式\n"
        "\n"
        "你可以點下方選單，或直接用自己的話問我，例如：\n"
        "「我的案件到哪了？」「有什麼補助可以申請？」",
        sort_order=1,
    ),
    _def(
        "home.unknown",
        "home",
        "聽不懂時的回覆",
        "系統無法判斷民眾在問什麼時的回覆，通常會附上引導範例。",
        "🤔 抱歉，我還不太理解你的問題。\n"
        "\n"
        "你可以試著這樣問我：\n"
        "・我的案件到哪了？\n"
        "・審查要多久？\n"
        "・有什麼補助可以申請？\n"
        "・我需要準備哪些文件？\n"
        "\n"
        "或直接點下方選單。",
        sort_order=2,
    ),
)

# ---- 案件進度
_CASE: tuple[ContentDefinition, ...] = (
    _def(
        "case.ask_case_id",
        "case",
        "請民眾輸入案件編號",
        "民眾點「案件進度」後的第一個問題。",
        "🔍 查詢案件進度\n"
        "\n"
        "請輸入你的「案件編號」（8 位數字）\n"
        "例如：20260001",
        sort_order=1,
    ),
    _def(
        "case.ask_phone",
        "case",
        "請民眾輸入手機號碼",
        "輸入案件編號後的第二個問題。兩項都通過才會顯示案件，請勿刪除個資保護說明。",
        "請再輸入申請時填寫的「手機號碼」\n"
        "例如：0912345678\n"
        "\n"
        "（為保護你的個資，需同時通過案件編號與手機號碼驗證）",
        sort_order=2,
    ),
    _def(
        "case.verify_failed",
        "case",
        "驗證失敗",
        "⚠️ 重要：這段文字「不可以」說明是案件編號錯還是手機錯，否則會被拿來試出真實案件編號。",
        "❌ 案件編號或手機號碼驗證失敗，請確認資料後再試。\n"
        "\n"
        "小提醒：\n"
        "・案件編號為 8 位數字\n"
        "・手機號碼請填寫申請時登記的號碼\n"
        "\n"
        "需要協助嗎？可以點「📞 聯絡我們」由承辦人員協助查詢。",
        sort_order=3,
    ),
    _def(
        "case.link_success",
        "case",
        "驗證成功後的提示",
        "驗證通過、案件加入「我的案件」後附帶的一句話。",
        "已將此案件加入「👤 我的案件」，下次可以直接查看 🙂",
        sort_order=4,
    ),
    # 連續驗證失敗會鎖一段時間（決策 D17）。這句話是唯一會透露「你被擋下來了」的回覆，
    # 其餘失敗一律用上面那句統一的 case.verify_failed。
    _def(
        "case.verify_locked",
        "case",
        "驗證被暫時鎖住",
        "同一件案子連續驗證失敗多次後顯示。{{minutes}} 會換成還要等幾分鐘。",
        "為了保護你的案件，驗證已暫時停用，請 {{minutes}} 分鐘後再試一次。\n如果急著查詢，可以點「📞 聯絡我們」由承辦人員協助。",
        variables=("minutes",),
        sort_order=5,
    ),
    _def(
        "case.card_eyebrow",
        "case",
        "進度卡片標題列",
        "案件進度卡片最上方的小標。",
        "案件進度",
        content_type="label",
        sort_order=10,
    ),
    _def(
        "case.status_chip",
        "case",
        "目前狀態標籤",
        "進度卡片上的狀態列。{{status}} 會換成實際狀態名稱。",
        "目前狀態：{{status}}",
        content_type="label",
        variables=("status",),
        sort_order=11,
    ),
    _def(
        "case.timeline_title",
        "case",
        "時間軸標題",
        "五個階段清單上方的標題。",
        "進度時間軸",
        content_type="label",
        sort_order=12,
    ),
    _def(
        "case.next_action_title",
        "case",
        "下一步標題",
        "「我現在要做什麼？」那一段的標題。",
        "我現在要做什麼？",
        content_type="label",
        sort_order=13,
    ),
    _def(
        "case.field.case_id",
        "case",
        "欄位：案件編號",
        "進度卡片的欄位名稱。",
        "案件編號",
        content_type="label",
        sort_order=20,
    ),
    _def(
        "case.field.applicant",
        "case",
        "欄位：申請人",
        "進度卡片的欄位名稱。",
        "申請人",
        content_type="label",
        sort_order=21,
    ),
    _def(
        "case.field.subsidy",
        "case",
        "欄位：補助項目",
        "進度卡片的欄位名稱。",
        "補助項目",
        content_type="label",
        sort_order=22,
    ),
    _def(
        "case.field.submitted_at",
        "case",
        "欄位：申請日期",
        "進度卡片的欄位名稱。",
        "申請日期",
        content_type="label",
        sort_order=23,
    ),
    _def(
        "case.field.updated_at",
        "case",
        "欄位：最後更新",
        "進度卡片的欄位名稱。",
        "最後更新",
        content_type="label",
        sort_order=24,
    ),
    _def(
        "case.field.supplement_deadline",
        "case",
        "欄位：補件期限",
        "只有待補件的案件會出現。",
        "補件期限",
        content_type="label",
        sort_order=25,
    ),
    _def(
        "case.field.payment_date",
        "case",
        "欄位：撥款日期",
        "只有已撥款的案件會出現。",
        "撥款日期",
        content_type="label",
        sort_order=26,
    ),
    _def(
        "case.timeline.step0",
        "case",
        "階段 1 名稱",
        "時間軸第一個階段。",
        "已送出申請",
        content_type="label",
        sort_order=30,
    ),
    _def(
        "case.timeline.step1",
        "case",
        "階段 2 名稱",
        "時間軸第二個階段。",
        "資格審查",
        content_type="label",
        sort_order=31,
    ),
    _def(
        "case.timeline.step2",
        "case",
        "階段 3 名稱",
        "時間軸第三個階段。",
        "文件審查",
        content_type="label",
        sort_order=32,
    ),
    _def(
        "case.timeline.step3",
        "case",
        "階段 4 名稱",
        "時間軸第四個階段。",
        "審查完成",
        content_type="label",
        sort_order=33,
    ),
    _def(
        "case.timeline.step4",
        "case",
        "階段 5 名稱",
        "時間軸第五個階段。",
        "撥款",
        content_type="label",
        sort_order=34,
    ),
    _def(
        "case.status.submitted.label",
        "case",
        "狀態名稱：已送出申請",
        "案件狀態的顯示名稱。",
        "已送出申請",
        content_type="label",
        sort_order=40,
    ),
    _def(
        "case.status.submitted.next_action",
        "case",
        "狀態說明：已送出申請",
        "案件在這個狀態時，「我現在要做什麼？」顯示的內容。",
        "申請已送出，正在等待承辦人員收件。\n"
        "目前不需要做任何事情，有新進度我們會主動通知你。",
        sort_order=41,
    ),
    _def(
        "case.status.eligibility_review.label",
        "case",
        "狀態名稱：資格審查中",
        "案件狀態的顯示名稱。",
        "資格審查中",
        content_type="label",
        sort_order=42,
    ),
    _def(
        "case.status.eligibility_review.next_action",
        "case",
        "狀態說明：資格審查中",
        "案件在這個狀態時，「我現在要做什麼？」顯示的內容。",
        "承辦單位正在確認你的申請資格。\n"
        "目前不需要做任何事情，有新進度我們會主動通知你。",
        sort_order=43,
    ),
    _def(
        "case.status.document_review.label",
        "case",
        "狀態名稱：文件審查中",
        "案件狀態的顯示名稱。",
        "文件審查中",
        content_type="label",
        sort_order=44,
    ),
    _def(
        "case.status.document_review.next_action",
        "case",
        "狀態說明：文件審查中",
        "案件在這個狀態時，「我現在要做什麼？」顯示的內容。",
        "你的文件正在審查中。\n"
        "目前不需要做任何事情，如果需要補件我們會立即通知你。",
        sort_order=45,
    ),
    _def(
        "case.status.supplement_required.label",
        "case",
        "狀態名稱：待補件",
        "案件狀態的顯示名稱。",
        "待補件",
        content_type="label",
        sort_order=46,
    ),
    _def(
        "case.status.supplement_required.next_action",
        "case",
        "狀態說明：待補件",
        "案件在這個狀態時，「我現在要做什麼？」顯示的內容。後面會自動接上補件項目與期限。",
        "⚠️ 你的案件需要補件，請依照下方清單於期限前完成補件，逾期可能影響審查結果。",
        sort_order=47,
    ),
    _def(
        "case.status.review_completed.label",
        "case",
        "狀態名稱：審查完成",
        "案件狀態的顯示名稱。",
        "審查完成",
        content_type="label",
        sort_order=48,
    ),
    _def(
        "case.status.review_completed.next_action",
        "case",
        "狀態說明：審查完成",
        "案件在這個狀態時，「我現在要做什麼？」顯示的內容。",
        "審查已完成，正在等待核定結果公告。\n"
        "目前不需要做任何事情。",
        sort_order=49,
    ),
    _def(
        "case.status.approved.label",
        "case",
        "狀態名稱：已核准",
        "案件狀態的顯示名稱。",
        "已核准",
        content_type="label",
        sort_order=50,
    ),
    _def(
        "case.status.approved.next_action",
        "case",
        "狀態說明：已核准",
        "案件在這個狀態時，「我現在要做什麼？」顯示的內容。",
        "🎉 恭喜，你的案件已核准。\n"
        "\n"
        "下一步：等待撥款作業，款項將匯入你申請時填寫的帳戶。",
        sort_order=51,
    ),
    _def(
        "case.status.rejected.label",
        "case",
        "狀態名稱：未核准",
        "案件狀態的顯示名稱。",
        "未核准",
        content_type="label",
        sort_order=52,
    ),
    _def(
        "case.status.rejected.next_action",
        "case",
        "狀態說明：未核准",
        "案件在這個狀態時，「我現在要做什麼？」顯示的內容。用字請保持中性、提供申訴管道。",
        "很抱歉，本次申請未通過審查。\n"
        "如果想了解原因或申請複查，請聯絡承辦單位。",
        sort_order=53,
    ),
    _def(
        "case.status.paid.label",
        "case",
        "狀態名稱：已撥款",
        "案件狀態的顯示名稱。",
        "已撥款",
        content_type="label",
        sort_order=54,
    ),
    _def(
        "case.status.paid.next_action",
        "case",
        "狀態說明：已撥款",
        "案件在這個狀態時，「我現在要做什麼？」顯示的內容。",
        "💰 款項已撥出，本案件流程完成。\n"
        "如果未收到款項，請聯絡承辦單位協助查詢。",
        sort_order=55,
    ),
)

# ---- 我的案件
_MYCASE: tuple[ContentDefinition, ...] = (
    _def(
        "mycase.empty",
        "mycase",
        "尚未綁定任何案件",
        "民眾還沒通過驗證就點「我的案件」時顯示。",
        "👤 你目前沒有已驗證的案件。\n"
        "\n"
        "請先點「🔍 案件進度」，用案件編號 + 手機號碼完成驗證，\n"
        "之後就可以在這裡直接查看你的案件。",
        sort_order=1,
    ),
    _def(
        "mycase.title",
        "mycase",
        "清單標題",
        "案件清單卡片的標題。",
        "👤 我的案件",
        content_type="label",
        sort_order=2,
    ),
    _def(
        "mycase.subtitle",
        "mycase",
        "清單副標",
        "{{count}} 會換成案件件數。",
        "共 {{count}} 件已驗證案件",
        content_type="label",
        variables=("count",),
        sort_order=3,
    ),
    _def(
        "mycase.hint",
        "mycase",
        "清單底部提示",
        "案件清單最下方的小字。",
        "點選案件即可查看完整進度",
        content_type="label",
        sort_order=4,
    ),
    _def(
        "mycase.updated_prefix",
        "mycase",
        "更新日期前綴",
        "清單每一列的更新時間前綴。",
        "更新：",
        content_type="label",
        sort_order=5,
    ),
)

# ---- 補助資訊
_SUBSIDY: tuple[ContentDefinition, ...] = (
    _def(
        "subsidy.menu_intro",
        "subsidy",
        "補助列表開場白",
        "民眾點「補助資訊」時，卡片前的一段文字。",
        "📋 青年補助資訊\n"
        "\n"
        "以下是目前開放查詢的補助項目，左右滑動可查看更多。",
        sort_order=1,
    ),
    _def(
        "subsidy.empty",
        "subsidy",
        "沒有補助資料",
        "資料庫中一筆補助都沒有時顯示。",
        "目前尚未建立補助資料，請稍後再試。",
        sort_order=2,
    ),
    _def(
        "subsidy.category_empty",
        "subsidy",
        "分類中沒有補助",
        "{{category}} 會換成分類名稱。",
        "「{{category}}」分類目前沒有補助資料。",
        variables=("category",),
        sort_order=3,
    ),
    _def(
        "subsidy.not_found",
        "subsidy",
        "查無此補助",
        "補助被停用或代碼錯誤時顯示。",
        "查無此補助項目。",
        sort_order=4,
    ),
    _def(
        "subsidy.search_empty",
        "subsidy",
        "搜尋不到補助",
        "{{keyword}} 會換成民眾輸入的關鍵字。",
        "找不到與「{{keyword}}」相關的補助，可以點「📋 補助資訊」瀏覽全部項目。",
        variables=("keyword",),
        sort_order=5,
    ),
    _def(
        "subsidy.field.eligibility",
        "subsidy",
        "欄位：補助對象",
        "補助卡片的欄位名稱。",
        "補助對象",
        content_type="label",
        sort_order=10,
    ),
    _def(
        "subsidy.field.age",
        "subsidy",
        "欄位：年齡限制",
        "補助卡片的欄位名稱。",
        "年齡限制",
        content_type="label",
        sort_order=11,
    ),
    _def(
        "subsidy.field.period",
        "subsidy",
        "欄位：申請期間",
        "補助卡片的欄位名稱。",
        "申請期間",
        content_type="label",
        sort_order=12,
    ),
    _def(
        "subsidy.field.amount",
        "subsidy",
        "欄位：補助額度",
        "補助卡片的欄位名稱。",
        "補助額度",
        content_type="label",
        sort_order=13,
    ),
    _def(
        "subsidy.field.method",
        "subsidy",
        "欄位：申請方式",
        "補助卡片的欄位名稱。",
        "申請方式",
        content_type="label",
        sort_order=14,
    ),
    _def(
        "subsidy.field.contact",
        "subsidy",
        "欄位：洽詢窗口",
        "補助卡片的欄位名稱。",
        "洽詢窗口",
        content_type="label",
        sort_order=15,
    ),
    _def(
        "subsidy.period_unset",
        "subsidy",
        "未填申請期間時",
        "補助沒有填申請起訖日時顯示的字。",
        "請見官方公告",
        content_type="label",
        sort_order=16,
    ),
    _def(
        "subsidy.age_unlimited",
        "subsidy",
        "年齡不限時",
        "補助沒有年齡上下限時顯示的字。",
        "不限",
        content_type="label",
        sort_order=17,
    ),
)

# ---- 申請小幫手（資格檢查與文件清單）
_APPLY: tuple[ContentDefinition, ...] = (
    _def(
        "apply.question_header",
        "apply",
        "資格檢查題目標題",
        "每一題上方的標題。{{current}} 是第幾題，{{total}} 是總題數。",
        "📝 資格檢查（{{current}}/{{total}}）",
        variables=("current", "total"),
        sort_order=1,
    ),
    _def(
        "apply.no_match",
        "apply",
        "找不到符合的補助",
        "資格檢查做完但沒有任何補助符合時顯示。",
        "很抱歉，依照你提供的條件，目前資料庫中沒有明顯符合的補助。\n"
        "\n"
        "建議你：\n"
        "・點「📋 補助資訊」瀏覽全部補助\n"
        "・點「📞 聯絡我們」由承辦人員協助評估",
        sort_order=2,
    ),
    _def(
        "apply.result_intro",
        "apply",
        "檢查結果開場白",
        "列出符合的補助前的一段文字。{{list}} 會換成補助清單。",
        "根據你提供的資料，目前可能符合以下補助：\n"
        "\n"
        "{{list}}\n"
        "\n"
        "點擊下方卡片查看申請資格。",
        variables=("list",),
        sort_order=3,
    ),
    _def(
        "apply.disclaimer",
        "apply",
        "免責聲明",
        "⚠️ 每一份資格檢查結果都會附上。用字必須保守，不可承諾一定能申請到。",
        "※ 以上為系統依你填寫資料所做的「初步」篩選結果，不代表最終審查結果。實際資格請以主管機關公告與承辦單位審核為準。",
        sort_order=4,
    ),
    _def(
        "apply.result_eyebrow",
        "apply",
        "建議卡片編號",
        "每張建議卡片左上角的小標。{{index}} 是第幾個建議。",
        "建議 {{index}}",
        content_type="label",
        variables=("index",),
        sort_order=5,
    ),
    _def(
        "apply.reasons_title",
        "apply",
        "符合原因標題",
        "建議卡片上「為什麼符合」那一段的標題。",
        "符合原因",
        content_type="label",
        sort_order=6,
    ),
    _def(
        "apply.caveats_title",
        "apply",
        "仍需確認標題",
        "建議卡片上尚待確認條件的標題。",
        "仍需確認",
        content_type="label",
        sort_order=7,
    ),
    _def(
        "apply.checklist_eyebrow",
        "apply",
        "文件清單標題列",
        "文件準備清單卡片最上方的小標。",
        "📋 申請前準備",
        content_type="label",
        sort_order=10,
    ),
    _def(
        "apply.checklist_hint",
        "apply",
        "文件清單操作提示",
        "文件清單上方的小字。",
        "點擊項目可標記完成",
        content_type="label",
        sort_order=11,
    ),
    _def(
        "apply.checklist_done",
        "apply",
        "文件都備齊了",
        "所有文件都勾選完成時顯示。",
        "🎉 文件都準備好了！",
        sort_order=12,
    ),
    _def(
        "apply.checklist_missing",
        "apply",
        "還缺文件",
        "{{count}} 會換成還沒勾選的項目數。",
        "還缺少 {{count}} 項文件",
        variables=("count",),
        sort_order=13,
    ),
    _def(
        "apply.checklist_empty",
        "apply",
        "補助未列文件",
        "該補助沒有填「需要文件」時顯示。",
        "此補助未列出應備文件",
        sort_order=14,
    ),
    _def(
        "apply.need_subsidy_first",
        "apply",
        "請先選補助",
        "民眾問「要準備什麼文件」但還沒指定補助時顯示。",
        "請先選擇你想申請的補助項目，我就能列出需要準備的文件 👇",
        sort_order=15,
    ),
)

# ---- 常見問題
_FAQ: tuple[ContentDefinition, ...] = (
    _def(
        "faq.menu_intro",
        "faq",
        "FAQ 選單開場白",
        "民眾點「常見問題」時看到的內容。{{list}} 會換成問題清單。",
        "❓ 常見問題\n"
        "\n"
        "{{list}}\n"
        "\n"
        "你可以直接輸入問題，例如「審查要多久？」\n"
        "或選擇下方分類。",
        variables=("list",),
        sort_order=1,
    ),
    _def(
        "faq.also_ask",
        "faq",
        "你可能也想問",
        "回答後附上相關問題的標題。",
        "你可能也想問：",
        content_type="label",
        sort_order=2,
    ),
    _def(
        "faq.source_label",
        "faq",
        "資料來源標題",
        "AI 回答時列出參考文件的標題。",
        "資料來源：",
        content_type="label",
        sort_order=3,
    ),
    _def(
        "faq.ungrounded_note",
        "faq",
        "未引用官方文件的提醒",
        "⚠️ 當回答沒有官方文件佐證時一定會附上，請勿刪除這個提醒。",
        "（此回答未引用官方文件，請以承辦單位說明為準）",
        sort_order=4,
    ),
    _def(
        "faq.category_empty",
        "faq",
        "分類中沒有問題",
        "該分類底下沒有啟用中的 FAQ 時顯示。",
        "這個分類目前沒有常見問題，你可以直接輸入想問的問題 🙂",
        sort_order=5,
    ),
)

# ---- 聯絡我們
_CONTACT: tuple[ContentDefinition, ...] = (
    _def(
        "contact.title",
        "contact",
        "標題",
        "聯絡資訊的第一行。",
        "📞 聯絡我們",
        content_type="label",
        sort_order=1,
    ),
    _def(
        "contact.unit",
        "contact",
        "承辦單位",
        "顯示在「承辦單位：」後面。",
        "新竹市政府 青年事務科",
        content_type="label",
        sort_order=2,
    ),
    _def(
        "contact.phone",
        "contact",
        "電話",
        "⚠️ 目前是示範號碼，上線前請換成正式電話。",
        "03-000-0000（示範號碼，上線前請替換為正式電話）",
        content_type="label",
        sort_order=3,
    ),
    _def(
        "contact.email",
        "contact",
        "Email",
        "⚠️ 目前是示範信箱，上線前請換成正式信箱。",
        "youth@example.gov.tw（示範信箱，上線前請替換）",
        content_type="label",
        sort_order=4,
    ),
    _def(
        "contact.address",
        "contact",
        "地址",
        "⚠️ 目前是示範地址，上線前請換成正式地址。",
        "新竹市○○路○○號（示範地址）",
        content_type="label",
        sort_order=5,
    ),
    _def(
        "contact.hours",
        "contact",
        "服務時間",
        "承辦單位的服務時間。",
        "週一至週五 08:30-12:00、13:30-17:30（例假日休息）",
        content_type="label",
        sort_order=6,
    ),
    _def(
        "contact.footer_note",
        "contact",
        "結尾提醒",
        "聯絡資訊最後一段提醒文字。",
        "洽詢案件時，請準備好你的案件編號，可以加快查詢速度。",
        sort_order=7,
    ),
)

# ---- 通知（含 SPEC 7 六個會推播的轉移）
_NOTIFY: tuple[ContentDefinition, ...] = (
    _def(
        "notify.headline.default",
        "notify",
        "通知標題：一般進度",
        "案件狀態改變時推播的第一行。",
        "📢 你的青年補助案件有最新進度！",
        sort_order=1,
    ),
    _def(
        "notify.headline.approved",
        "notify",
        "通知標題：已核准",
        "案件核准時推播的第一行。",
        "🎉 你的青年補助案件已核准！",
        sort_order=2,
    ),
    _def(
        "notify.headline.paid",
        "notify",
        "通知標題：已撥款",
        "款項撥出時推播的第一行。",
        "💰 你的青年補助款項已撥出！",
        sort_order=3,
    ),
    _def(
        "notify.headline.supplement_required",
        "notify",
        "通知標題：待補件",
        "需要補件時推播的第一行。",
        "⚠️ 你的青年補助案件需要補件",
        sort_order=4,
    ),
    _def(
        "notify.headline.rejected",
        "notify",
        "通知標題：審查結果",
        "未核准時推播的第一行。用字請保持中性。",
        "📢 你的青年補助案件審查結果已公布",
        sort_order=5,
    ),
    _def(
        "notify.case_id_label",
        "notify",
        "欄位：案件編號",
        "推播訊息中的欄位名稱。",
        "案件編號：",
        content_type="label",
        sort_order=10,
    ),
    _def(
        "notify.status_label",
        "notify",
        "欄位：目前狀態",
        "推播訊息中的欄位名稱。",
        "目前狀態：",
        content_type="label",
        sort_order=11,
    ),
    _def(
        "notify.supplement_items_title",
        "notify",
        "需要補交標題",
        "待補件通知中列出項目前的標題。",
        "需要補交：",
        content_type="label",
        sort_order=12,
    ),
    _def(
        "notify.supplement_deadline_label",
        "notify",
        "欄位：補件期限",
        "待補件通知中的欄位名稱。",
        "補件期限：",
        content_type="label",
        sort_order=13,
    ),
    _def(
        "notify.payment_date_label",
        "notify",
        "欄位：撥款日期",
        "撥款通知中的欄位名稱。",
        "撥款日期：",
        content_type="label",
        sort_order=14,
    ),
    _def(
        "notify.footer",
        "notify",
        "結尾引導",
        "推播訊息最後一行，後面會接上進度卡片。",
        "以下是最新的案件進度 👇",
        sort_order=15,
    ),
    _def(
        "notify.T2",
        "notify",
        "通知範本：要求補件（T2）",
        "案件從審核中轉為「需要補件」時送出的推播內容。",
        "{{headline}}\n"
        "案件編號：{{case_no}}\n"
        "\n"
        "請打開案件進度頁看補件清單，並在 {{deadline}} 前補齊送出。\n"
        "逾期沒有補件，案件會直接結案。",
        variables=("headline", "case_no", "deadline"),
        sort_order=20,
    ),
    _def(
        "notify.T3",
        "notify",
        "通知範本：核定（T3）",
        "案件核定通過時送出的推播內容。",
        "{{headline}}\n"
        "案件編號：{{case_no}}\n"
        "\n"
        "接下來會進入撥款作業，款項會匯入你申請時填寫的帳戶。\n"
        "目前不需要做任何事情。",
        variables=("headline", "case_no"),
        sort_order=21,
    ),
    _def(
        "notify.T7",
        "notify",
        "通知範本：撥款完成（T7）",
        "款項撥出、案件結案時送出的推播內容。",
        "{{headline}}\n"
        "案件編號：{{case_no}}\n"
        "\n"
        "款項已經撥出，這件申請到此結案。\n"
        "如果超過一週還沒收到，請聯絡承辦單位協助查詢。",
        variables=("headline", "case_no"),
        sort_order=22,
    ),
    _def(
        "notify.T8",
        "notify",
        "通知範本：補件逾期（T8）",
        "補件期限過了、案件自動結案時送出的推播內容。",
        "{{headline}}\n"
        "案件編號：{{case_no}}\n"
        "\n"
        "補件期限已經過了，案件依規定結案。\n"
        "想知道能不能重新申請，請聯絡承辦單位詢問。",
        variables=("headline", "case_no"),
        sort_order=23,
    ),
    _def(
        "notify.T9",
        "notify",
        "通知範本：不通過（T9）",
        "審查結果為不通過時送出的推播內容。用字請保持中性。",
        "{{headline}}\n"
        "案件編號：{{case_no}}\n"
        "\n"
        "審查結果與原因已經寫在案件進度頁，請打開查看。\n"
        "想提出申訴或了解細節，請聯絡承辦單位。",
        variables=("headline", "case_no"),
        sort_order=24,
    ),
    _def(
        "notify.T11",
        "notify",
        "通知範本：註銷案件（T11）",
        "承辦單位註銷案件時送出的推播內容。",
        "{{headline}}\n"
        "案件編號：{{case_no}}\n"
        "\n"
        "這件申請已經由承辦單位註銷，原因寫在案件進度頁。\n"
        "有疑問請聯絡承辦單位確認。",
        variables=("headline", "case_no"),
        sort_order=25,
    ),
    _def(
        "notify.demo_missing",
        "notify",
        "Demo：缺少信用卡消費紀錄",
        "後台按 Demo 發送時，推播給已綁定該案件的 LINE 使用者。",
        "📎 {{scheme}}案件 {{case_no}} 還需要一份信用卡消費紀錄。\n"
        "如果你不知道怎麼從銀行 App 取得，點下方按鈕，我會直接帶你走完整流程。",
        variables=("case_no", "scheme"),
        sort_order=26,
    ),
)

# ---- 防詐檢查與敏感提醒
_SECURITY: tuple[ContentDefinition, ...] = (
    _def(
        "security.title",
        "security",
        "標題",
        "可疑訊息檢查結果的第一行。",
        "🛡️ 可疑訊息初步檢查",
        content_type="label",
        sort_order=1,
    ),
    _def(
        "security.result_label",
        "security",
        "判斷結果標題",
        "風險等級前的欄位名稱。",
        "判斷結果：",
        content_type="label",
        sort_order=2,
    ),
    _def(
        "security.reasons_title",
        "security",
        "判斷理由標題",
        "列出理由前的標題。",
        "判斷理由：",
        content_type="label",
        sort_order=3,
    ),
    _def(
        "security.advice_title",
        "security",
        "提醒標題",
        "列出建議前的標題。",
        "提醒你：",
        content_type="label",
        sort_order=4,
    ),
    _def(
        "security.disclaimer",
        "security",
        "免責聲明",
        "⚠️ 每次檢查結果都會附上，請保留 165 反詐騙專線資訊。",
        "※ 本結果為系統初步判斷，不代表最終認定。如有疑慮請撥打 165 反詐騙專線。",
        sort_order=5,
    ),
    _def(
        "security.level.low",
        "security",
        "風險等級：低",
        "風險等級的顯示文字。",
        "🟢 風險偏低",
        content_type="label",
        sort_order=6,
    ),
    _def(
        "security.level.medium",
        "security",
        "風險等級：中",
        "風險等級的顯示文字。",
        "🟡 需要留意",
        content_type="label",
        sort_order=7,
    ),
    _def(
        "security.level.high",
        "security",
        "風險等級：高",
        "風險等級的顯示文字。",
        "🔴 高度可疑",
        content_type="label",
        sort_order=8,
    ),
    _def(
        "security.level.unknown",
        "security",
        "風險等級：無法判斷",
        "風險等級的顯示文字。",
        "⚪ 無法判斷",
        content_type="label",
        sort_order=9,
    ),
    _def(
        "security.screenshot_notice",
        "security",
        "截圖敏感資訊提醒",
        "民眾要傳截圖給申請小幫手之前顯示的提醒，SPEC §8.4 的敏感提醒。",
        "🛡️ 傳截圖前請先確認：畫面上不要出現完整卡號、密碼，以及完整的身分證字號。\n"
        "從網頁上傳的話，可以先用遮罩工具把不需要的地方蓋起來再送出。\n"
        "這張圖只用來判斷你走到哪一步，看完不會留存。",
        sort_order=20,
    ),
)

# ---- 錯誤訊息
_ERROR: tuple[ContentDefinition, ...] = (
    _def(
        "error.invalid_case_id",
        "error",
        "案件編號格式錯誤",
        "民眾輸入的案件編號不是 8 位數字時顯示。",
        "案件編號格式不正確，請輸入 8 位數字（例如 20260001）。",
        sort_order=1,
    ),
    _def(
        "error.invalid_phone",
        "error",
        "手機格式錯誤",
        "民眾輸入的手機號碼格式不對時顯示。",
        "手機號碼格式不正確，請輸入 09 開頭的 10 碼手機號碼（例如 0912345678）。",
        sort_order=2,
    ),
    _def(
        "error.cancelled",
        "error",
        "已取消操作",
        "民眾輸入「取消」或點取消按鈕時顯示。",
        "已取消目前的操作，需要什麼再告訴我 🙂",
        sort_order=3,
    ),
    _def(
        "error.system_busy",
        "error",
        "系統忙碌",
        "系統發生錯誤時的回覆。",
        "😥 系統忙碌中，請稍後再試一次。如果持續發生，請點「📞 聯絡我們」。",
        sort_order=4,
    ),
    _def(
        "error.image_not_supported",
        "error",
        "收到圖片",
        "民眾傳圖片時的回覆（圖片辨識尚未開放）。",
        "🛡️ 收到你的圖片。\n"
        "\n"
        "圖片辨識功能尚在開發中，目前無法分析截圖內容。\n"
        "你可以把訊息「文字」貼給我，我會先做初步的可疑訊息判斷。",
        sort_order=5,
    ),
    _def(
        "error.non_text_message",
        "error",
        "收到非文字訊息",
        "民眾傳貼圖、語音、位置等訊息時的回覆。",
        "目前我只看得懂文字訊息，請用文字告訴我你的問題 🙂",
        sort_order=6,
    ),
)

# ---- 按鈕文字
_BUTTON: tuple[ContentDefinition, ...] = (
    _def(
        "button.case_status",
        "button",
        "快速回覆：案件進度",
        "功能固定為「查詢案件進度」，只有顯示文字可改。",
        "🔍 案件進度",
        content_type="button",
        sort_order=1,
    ),
    _def(
        "button.faq",
        "button",
        "快速回覆：常見問題",
        "功能固定為「常見問題」，只有顯示文字可改。",
        "❓ 常見問題",
        content_type="button",
        sort_order=2,
    ),
    _def(
        "button.subsidy_info",
        "button",
        "快速回覆：補助資訊",
        "功能固定為「補助資訊」，只有顯示文字可改。",
        "📋 補助資訊",
        content_type="button",
        sort_order=3,
    ),
    _def(
        "button.my_cases",
        "button",
        "快速回覆：我的案件",
        "功能固定為「我的案件」，只有顯示文字可改。",
        "👤 我的案件",
        content_type="button",
        sort_order=4,
    ),
    _def(
        "button.eligibility",
        "button",
        "快速回覆：申請小幫手",
        "功能固定為「申請小幫手」，只有顯示文字可改。",
        "📝 申請小幫手",
        content_type="button",
        sort_order=5,
    ),
    _def(
        "button.contact",
        "button",
        "快速回覆：聯絡我們",
        "功能固定為「聯絡我們」，只有顯示文字可改。",
        "📞 聯絡我們",
        content_type="button",
        sort_order=6,
    ),
    _def(
        "button.cancel",
        "button",
        "取消按鈕",
        "多步驟流程中的取消按鈕。",
        "取消",
        content_type="button",
        sort_order=7,
    ),
    _def(
        "button.refresh_case",
        "button",
        "重新整理進度",
        "進度卡片上的主要按鈕。",
        "重新整理進度",
        content_type="button",
        sort_order=8,
    ),
    _def(
        "button.my_cases_secondary",
        "button",
        "進度卡片：我的案件",
        "進度卡片上的次要按鈕。",
        "我的案件",
        content_type="button",
        sort_order=9,
    ),
    _def(
        "button.checklist",
        "button",
        "文件準備清單",
        "補助卡片上的主要按鈕。",
        "文件準備清單",
        content_type="button",
        sort_order=10,
    ),
    _def(
        "button.official_url",
        "button",
        "官方說明頁",
        "補助卡片上連到官網的按鈕。",
        "官方說明頁",
        content_type="button",
        sort_order=11,
    ),
    _def(
        "button.subsidy_detail",
        "button",
        "查看申請資格",
        "資格檢查結果卡片上的按鈕。",
        "查看申請資格",
        content_type="button",
        sort_order=12,
    ),
)

# ---- 案件狀態文案（對應 models/application.py 的 STATUSES）
_STATUS: tuple[ContentDefinition, ...] = (
    _def(
        "status.SUBMITTED.public_label",
        "status",
        "狀態名稱（民眾看）：已收件，等待審核",
        "市民在案件進度頁看到的狀態名稱。",
        "已收件，等待審核",
        content_type="label",
        sort_order=10,
    ),
    _def(
        "status.SUBMITTED.staff_label",
        "status",
        "狀態名稱（承辦看）：已送件",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "已送件",
        content_type="label",
        sort_order=11,
    ),
    _def(
        "status.SUBMITTED.next_action",
        "status",
        "狀態說明：已收件，等待審核",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "申請已送出，正在等待承辦人員收件。\n"
        "目前不需要做任何事情，有新進度我們會主動通知你。",
        sort_order=12,
    ),
    _def(
        "status.SUBMITTED.notify_headline",
        "status",
        "通知標題：已收件，等待審核",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "📮 我們已經收到你的申請案件",
        sort_order=13,
    ),
    _def(
        "status.UNDER_REVIEW.public_label",
        "status",
        "狀態名稱（民眾看）：審核中",
        "市民在案件進度頁看到的狀態名稱。",
        "審核中",
        content_type="label",
        sort_order=20,
    ),
    _def(
        "status.UNDER_REVIEW.staff_label",
        "status",
        "狀態名稱（承辦看）：審核中",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "審核中",
        content_type="label",
        sort_order=21,
    ),
    _def(
        "status.UNDER_REVIEW.next_action",
        "status",
        "狀態說明：審核中",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "承辦人員正在審查你的文件。\n"
        "目前不需要做任何事情，如果需要補件我們會立刻通知你。",
        sort_order=22,
    ),
    _def(
        "status.UNDER_REVIEW.notify_headline",
        "status",
        "通知標題：審核中",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "🔍 你的案件已進入審核",
        sort_order=23,
    ),
    _def(
        "status.NEEDS_REVISION.public_label",
        "status",
        "狀態名稱（民眾看）：需要補件",
        "市民在案件進度頁看到的狀態名稱。",
        "需要補件",
        content_type="label",
        sort_order=30,
    ),
    _def(
        "status.NEEDS_REVISION.staff_label",
        "status",
        "狀態名稱（承辦看）：待補件",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "待補件",
        content_type="label",
        sort_order=31,
    ),
    _def(
        "status.NEEDS_REVISION.next_action",
        "status",
        "狀態說明：需要補件",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "請依照下方的補件清單，在期限前把缺的資料補齊並重新送出。\n"
        "逾期沒有補件，案件會直接結案。",
        sort_order=32,
    ),
    _def(
        "status.NEEDS_REVISION.notify_headline",
        "status",
        "通知標題：需要補件",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "⚠️ 你的案件需要補件",
        sort_order=33,
    ),
    _def(
        "status.REVISION_SUBMITTED.public_label",
        "status",
        "狀態名稱（民眾看）：已收到補件，等待再次審核",
        "市民在案件進度頁看到的狀態名稱。",
        "已收到補件，等待再次審核",
        content_type="label",
        sort_order=40,
    ),
    _def(
        "status.REVISION_SUBMITTED.staff_label",
        "status",
        "狀態名稱（承辦看）：補正待審核",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "補正待審核",
        content_type="label",
        sort_order=41,
    ),
    _def(
        "status.REVISION_SUBMITTED.next_action",
        "status",
        "狀態說明：已收到補件，等待再次審核",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "已經收到你補上的資料，承辦人員會重新審查一次。\n"
        "目前不需要做任何事情，有結果我們會主動通知你。",
        sort_order=42,
    ),
    _def(
        "status.REVISION_SUBMITTED.notify_headline",
        "status",
        "通知標題：已收到補件，等待再次審核",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "📨 我們已經收到你補上的資料",
        sort_order=43,
    ),
    _def(
        "status.APPROVED.public_label",
        "status",
        "狀態名稱（民眾看）：已核定，準備撥款",
        "市民在案件進度頁看到的狀態名稱。",
        "已核定，準備撥款",
        content_type="label",
        sort_order=50,
    ),
    _def(
        "status.APPROVED.staff_label",
        "status",
        "狀態名稱（承辦看）：已核定",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "已核定",
        content_type="label",
        sort_order=51,
    ),
    _def(
        "status.APPROVED.next_action",
        "status",
        "狀態說明：已核定，準備撥款",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "🎉 恭喜，你的案件已經核定。\n"
        "接下來等待撥款作業，款項會匯入你申請時填寫的帳戶。",
        sort_order=52,
    ),
    _def(
        "status.APPROVED.notify_headline",
        "status",
        "通知標題：已核定，準備撥款",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "🎉 你的申請已核定",
        sort_order=53,
    ),
    _def(
        "status.DISBURSING.public_label",
        "status",
        "狀態名稱（民眾看）：撥款作業中",
        "市民在案件進度頁看到的狀態名稱。",
        "撥款作業中",
        content_type="label",
        sort_order=60,
    ),
    _def(
        "status.DISBURSING.staff_label",
        "status",
        "狀態名稱（承辦看）：撥款中",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "撥款中",
        content_type="label",
        sort_order=61,
    ),
    _def(
        "status.DISBURSING.next_action",
        "status",
        "狀態說明：撥款作業中",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "撥款作業進行中，款項會匯入你申請時填寫的帳戶。\n"
        "目前不需要做任何事情，撥款完成後我們會通知你。",
        sort_order=62,
    ),
    _def(
        "status.DISBURSING.notify_headline",
        "status",
        "通知標題：撥款作業中",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "🏦 你的案件已進入撥款作業",
        sort_order=63,
    ),
    _def(
        "status.DISBURSED.public_label",
        "status",
        "狀態名稱（民眾看）：已撥款完成",
        "市民在案件進度頁看到的狀態名稱。",
        "已撥款完成",
        content_type="label",
        sort_order=70,
    ),
    _def(
        "status.DISBURSED.staff_label",
        "status",
        "狀態名稱（承辦看）：已撥款",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "已撥款",
        content_type="label",
        sort_order=71,
    ),
    _def(
        "status.DISBURSED.next_action",
        "status",
        "狀態說明：已撥款完成",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "💰 款項已經撥出，這件申請到此結案。\n"
        "如果超過一週還沒收到款項，請聯絡承辦單位協助查詢。",
        sort_order=72,
    ),
    _def(
        "status.DISBURSED.notify_headline",
        "status",
        "通知標題：已撥款完成",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "💰 你的補助款項已撥出",
        sort_order=73,
    ),
    _def(
        "status.REJECTED.public_label",
        "status",
        "狀態名稱（民眾看）：未通過",
        "市民在案件進度頁看到的狀態名稱。",
        "未通過",
        content_type="label",
        sort_order=80,
    ),
    _def(
        "status.REJECTED.staff_label",
        "status",
        "狀態名稱（承辦看）：不通過",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "不通過",
        content_type="label",
        sort_order=81,
    ),
    _def(
        "status.REJECTED.next_action",
        "status",
        "狀態說明：未通過",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "本次申請未通過審查，未通過的原因請看下方說明。\n"
        "想了解詳細原因或提出申訴，請聯絡承辦單位。",
        sort_order=82,
    ),
    _def(
        "status.REJECTED.notify_headline",
        "status",
        "通知標題：未通過",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "📢 你的案件審查結果已公布",
        sort_order=83,
    ),
    _def(
        "status.WITHDRAWN.public_label",
        "status",
        "狀態名稱（民眾看）：已撤回",
        "市民在案件進度頁看到的狀態名稱。",
        "已撤回",
        content_type="label",
        sort_order=90,
    ),
    _def(
        "status.WITHDRAWN.staff_label",
        "status",
        "狀態名稱（承辦看）：已撤回（自行註銷）",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "已撤回（自行註銷）",
        content_type="label",
        sort_order=91,
    ),
    _def(
        "status.WITHDRAWN.next_action",
        "status",
        "狀態說明：已撤回",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "你已經自行撤回這件申請，案件不再繼續審查。\n"
        "想重新申請的話，請在申請期間內重新送一次件。",
        sort_order=92,
    ),
    _def(
        "status.WITHDRAWN.notify_headline",
        "status",
        "通知標題：已撤回",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "📕 你的案件已撤回",
        sort_order=93,
    ),
    _def(
        "status.CANCELLED_BY_STAFF.public_label",
        "status",
        "狀態名稱（民眾看）：已註銷",
        "市民在案件進度頁看到的狀態名稱。",
        "已註銷",
        content_type="label",
        sort_order=100,
    ),
    _def(
        "status.CANCELLED_BY_STAFF.staff_label",
        "status",
        "狀態名稱（承辦看）：已註銷",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "已註銷",
        content_type="label",
        sort_order=101,
    ),
    _def(
        "status.CANCELLED_BY_STAFF.next_action",
        "status",
        "狀態說明：已註銷",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "這件申請已經由承辦單位註銷，註銷原因請看下方說明。\n"
        "有疑問請聯絡承辦單位確認。",
        sort_order=102,
    ),
    _def(
        "status.CANCELLED_BY_STAFF.notify_headline",
        "status",
        "通知標題：已註銷",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "📢 你的案件已註銷",
        sort_order=103,
    ),
    _def(
        "status.EXPIRED.public_label",
        "status",
        "狀態名稱（民眾看）：補件逾期，已結案",
        "市民在案件進度頁看到的狀態名稱。",
        "補件逾期，已結案",
        content_type="label",
        sort_order=110,
    ),
    _def(
        "status.EXPIRED.staff_label",
        "status",
        "狀態名稱（承辦看）：逾期未補件",
        "承辦人後台案件列表與篩選器上的狀態名稱。",
        "逾期未補件",
        content_type="label",
        sort_order=111,
    ),
    _def(
        "status.EXPIRED.next_action",
        "status",
        "狀態說明：補件逾期，已結案",
        "案件在這個狀態時，市民進度頁「我現在要做什麼？」顯示的內容。",
        "補件期限已經過了，案件依規定結案。\n"
        "想知道能不能重新申請，請聯絡承辦單位詢問。",
        sort_order=112,
    ),
    _def(
        "status.EXPIRED.notify_headline",
        "status",
        "通知標題：補件逾期，已結案",
        "案件轉到這個狀態時，推播訊息的第一行。",
        "⏰ 你的案件因補件逾期已結案",
        sort_order=113,
    ),
)

# ---- 退件說明（對應 12 個退件原因代碼）
_REJECTION: tuple[ContentDefinition, ...] = (
    _def(
        "rejection.BILLING_NO_TWD.public_what_wrong",
        "rejection",
        "退件說明：出帳帳單缺臺幣換算金額（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "出帳帳單上看不到換算後的臺幣金額",
        sort_order=10,
    ),
    _def(
        "rejection.BILLING_NO_TWD.public_how_to_fix",
        "rejection",
        "退件說明：出帳帳單缺臺幣換算金額（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請重新取得一份含臺幣金額的帳單。下方是你的付款方式的取得步驟。",
        sort_order=11,
    ),
    _def(
        "rejection.BILLING_NO_CARD_DIGITS.public_what_wrong",
        "rejection",
        "退件說明：出帳帳單無法辨識卡號末四碼（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "出帳帳單上看不到卡號末四碼",
        sort_order=20,
    ),
    _def(
        "rejection.BILLING_NO_CARD_DIGITS.public_how_to_fix",
        "rejection",
        "退件說明：出帳帳單無法辨識卡號末四碼（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請提供含卡號末四碼的帳單頁面，或改用網銀的交易明細截圖。",
        sort_order=21,
    ),
    _def(
        "rejection.BILLING_UNREADABLE.public_what_wrong",
        "rejection",
        "退件說明：出帳帳單影像模糊或不完整（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "出帳帳單的照片看不清楚",
        sort_order=30,
    ),
    _def(
        "rejection.BILLING_UNREADABLE.public_how_to_fix",
        "rejection",
        "退件說明：出帳帳單影像模糊或不完整（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請在光線充足處重拍，確認四個角都在畫面內、文字沒有晃到。",
        sort_order=31,
    ),
    _def(
        "rejection.BILLING_AMOUNT_MISMATCH.public_what_wrong",
        "rejection",
        "退件說明：帳單金額與申請金額不符（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "帳單上的金額與你填寫的金額不一致",
        sort_order=40,
    ),
    _def(
        "rejection.BILLING_AMOUNT_MISMATCH.public_how_to_fix",
        "rejection",
        "退件說明：帳單金額與申請金額不符（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請以帳單上實際扣款的臺幣金額為準，回到申請資料修正填報金額。",
        sort_order=41,
    ),
    _def(
        "rejection.CARD_DIGITS_MISMATCH.public_what_wrong",
        "rejection",
        "退件說明：卡號末四碼與信用卡照片不一致（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "帳單與信用卡照片的末四碼不是同一張卡",
        sort_order=50,
    ),
    _def(
        "rejection.CARD_DIGITS_MISMATCH.public_how_to_fix",
        "rejection",
        "退件說明：卡號末四碼與信用卡照片不一致（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "帳單與卡片佐證必須是同一張卡。請確認後重新上傳其中一份。",
        sort_order=51,
    ),
    _def(
        "rejection.ID_ADDRESS_UNCLEAR.public_what_wrong",
        "rejection",
        "退件說明：身分證住址無法辨識（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "身分證背面的住址看不清楚",
        sort_order=60,
    ),
    _def(
        "rejection.ID_ADDRESS_UNCLEAR.public_how_to_fix",
        "rejection",
        "退件說明：身分證住址無法辨識（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請重拍身分證背面，確認住址那一行沒有反光或模糊。",
        sort_order=61,
    ),
    _def(
        "rejection.ID_NOT_HSINCHU.public_what_wrong",
        "rejection",
        "退件說明：設籍地非新竹市（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "身分證上的設籍地不在新竹市",
        sort_order=70,
    ),
    _def(
        "rejection.ID_NOT_HSINCHU.public_how_to_fix",
        "rejection",
        "退件說明：設籍地非新竹市（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "本計畫限設籍新竹市的青年申請。若你已遷入，請提供最新的身分證背面。",
        sort_order=71,
    ),
    _def(
        "rejection.OVER_MASKED.public_what_wrong",
        "rejection",
        "退件說明：遮罩蓋住必要資訊（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "遮罩把需要保留的資訊也蓋住了",
        sort_order=80,
    ),
    _def(
        "rejection.OVER_MASKED.public_how_to_fix",
        "rejection",
        "退件說明：遮罩蓋住必要資訊（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請重新上傳並確認保留必要欄位——系統會標示哪些位置不可以遮。",
        sort_order=81,
    ),
    _def(
        "rejection.AFFIDAVIT_NO_SIGNATURE.public_what_wrong",
        "rejection",
        "退件說明：切結書缺親筆簽名（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "切結書上沒有親筆簽名",
        sort_order=90,
    ),
    _def(
        "rejection.AFFIDAVIT_NO_SIGNATURE.public_how_to_fix",
        "rejection",
        "退件說明：切結書缺親筆簽名（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請列印後親筆簽名，再拍照上傳。",
        sort_order=91,
    ),
    _def(
        "rejection.DOC_MISSING.public_what_wrong",
        "rejection",
        "退件說明：缺少必要文件（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "有一份必要文件沒有收到",
        sort_order=100,
    ),
    _def(
        "rejection.DOC_MISSING.public_how_to_fix",
        "rejection",
        "退件說明：缺少必要文件（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請補上承辦標示的那一份文件。",
        sort_order=101,
    ),
    _def(
        "rejection.TOOL_NOT_ELIGIBLE.public_what_wrong",
        "rejection",
        "退件說明：該工具不符補助資格（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "你申請的工具不符合補助資格",
        sort_order=110,
    ),
    _def(
        "rejection.TOOL_NOT_ELIGIBLE.public_how_to_fix",
        "rejection",
        "退件說明：該工具不符補助資格（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請參考判定理由與替代工具建議。",
        sort_order=111,
    ),
    _def(
        "rejection.OTHER.public_what_wrong",
        "rejection",
        "退件說明：其他（請填說明）（哪裡不對）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「哪裡不對」。",
        "其他需要修正的事項",
        sort_order=120,
    ),
    _def(
        "rejection.OTHER.public_how_to_fix",
        "rejection",
        "退件說明：其他（請填說明）（怎麼修）",
        "承辦勾選這個退件原因後，市民在補件頁看到的「怎麼修」。",
        "請參考承辦的補充說明。",
        sort_order=121,
    ),
)

# ---- 申請小幫手：SOP 教學對話的固定語句
# 注意：以下 sop.template.* 的內文用的是 Python str.format 的單大括號
# 佔位符（{name}、{flow}、{index} …），由 services/policy.py 直接以 .format()
# 代入，不走 content.tf() 的 {{var}} 取代。所以 variables 一律留空，改文案時
# 也請保留原本的單大括號欄位名稱。
_SOP: tuple[ContentDefinition, ...] = (
    _def(
        "sop.template.name",
        "sop",
        "助手名稱",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "線上客服",
        sort_order=1,
    ),
    _def(
        "sop.template.goal_noun",
        "sop",
        "目標文件的稱呼",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "文件",
        sort_order=2,
    ),
    _def(
        "sop.template.tone",
        "sop",
        "說話語氣",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "簡短口語，像真人客服在打字",
        sort_order=3,
    ),
    _def(
        "sop.template.handoff",
        "sop",
        "無法協助時的轉介語",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "目前沒有提供這項協助，建議您改向承辦單位詢問。",
        sort_order=4,
    ),
    _def(
        "sop.template.greeting",
        "sop",
        "開場白",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "您好，我是{name}。我可以一步一圖帶您在 {brands} 完成 {goals}。\n"
        "請告訴我您用的是哪個 App 或網站、想完成哪一項；如果已經卡在某個畫面，也可以直接把截圖貼給我，我會幫您看您走到哪一步。",
        sort_order=5,
    ),
    _def(
        "sop.template.greeting_empty",
        "sop",
        "開場白（還沒有任何流程）",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "您好，我是{name}。目前還沒有可以協助的服務流程。",
        sort_order=6,
    ),
    _def(
        "sop.template.located",
        "sop",
        "已定位：告知目前在第幾步",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "您目前在「{flow}」的步驟 {index}「{step}」。",
        sort_order=7,
    ),
    _def(
        "sop.template.located_difference",
        "sop",
        "已定位：與教學圖的差異",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "與教學圖的差異：{difference}",
        sort_order=8,
    ),
    _def(
        "sop.template.located_lead",
        "sop",
        "已定位：接著照圖操作的引導語",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "看起來您目前在「{step}」這一步，接下來請照下面的圖操作：",
        sort_order=9,
    ),
    _def(
        "sop.template.ambiguous_ask",
        "sop",
        "無法確定時請民眾選一個",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "您的畫面看起來像下列哪一個？",
        sort_order=10,
    ),
    _def(
        "sop.template.off_flow",
        "sop",
        "畫面不在教學流程裡",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "這個畫面是{where}裡的一頁，但不在教學流程裡。",
        sort_order=11,
    ),
    _def(
        "sop.template.off_flow_restart",
        "sop",
        "請民眾回首頁重新開始",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "請回到{where}的首頁，從步驟 1「{step}」重新開始。",
        sort_order=12,
    ),
    _def(
        "sop.template.off_flow_ask",
        "sop",
        "詢問民眾想完成哪一項",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "請問您要在{where}完成哪一項{goal_noun}？",
        sort_order=13,
    ),
    _def(
        "sop.template.not_app_screen",
        "sop",
        "這張圖不是 App 畫面",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "這張圖是{what}。",
        sort_order=14,
    ),
    _def(
        "sop.template.not_app_restart",
        "sop",
        "請民眾先打開指定的 App",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "請先打開「{platform}」，照步驟 1「{step}」開始。",
        sort_order=15,
    ),
    _def(
        "sop.template.ask_platform",
        "sop",
        "詢問使用哪一個 App 或網站",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "請問您使用的是哪一個 App 或網站？",
        sort_order=16,
    ),
    _def(
        "sop.template.not_a_screenshot",
        "sop",
        "這張圖不是螢幕截圖",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "這張圖不是螢幕畫面，請在手機上直接截圖再傳過來。",
        sort_order=17,
    ),
    _def(
        "sop.template.restart_lead",
        "sop",
        "從步驟 1 開始的引導語",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "也可以先照「{platform}」的步驟 1「{step}」開始。",
        sort_order=18,
    ),
    _def(
        "sop.template.unreadable",
        "sop",
        "截圖看不清楚",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "這張圖{issues}，看不清楚內容；請重新截一張完整、清楚的畫面。",
        sort_order=19,
    ),
    _def(
        "sop.template.unreadable_default_issue",
        "sop",
        "看不清楚的預設原因",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "太模糊或太暗",
        sort_order=20,
    ),
    _def(
        "sop.template.unknown_platform_seen",
        "sop",
        "認得畫面但沒有這個教學",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "畫面看起來是「{seen}」，目前沒有這個 App 或網站的教學。",
        sort_order=21,
    ),
    _def(
        "sop.template.unknown_platform_unseen",
        "sop",
        "認不出是哪個 App 或網站",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "看不出這是哪個 App 或網站的畫面。",
        sort_order=22,
    ),
    _def(
        "sop.template.photographed",
        "sop",
        "翻拍照片的提醒",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "這張是翻拍的照片，直接截圖會更清楚。",
        sort_order=23,
    ),
    _def(
        "sop.template.this_app",
        "sop",
        "泛稱「這個 App」",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "這個 App",
        sort_order=24,
    ),
    _def(
        "sop.template.kind_home_screen",
        "sop",
        "畫面種類：手機主畫面",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "手機主畫面",
        sort_order=25,
    ),
    _def(
        "sop.template.kind_lock_screen",
        "sop",
        "畫面種類：鎖定畫面",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "鎖定畫面",
        sort_order=26,
    ),
    _def(
        "sop.template.kind_system_screen",
        "sop",
        "畫面種類：系統畫面",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "系統畫面",
        sort_order=27,
    ),
    _def(
        "sop.template.kind_other",
        "sop",
        "畫面種類：不是 App 裡的畫面",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "不是 App 裡的畫面",
        sort_order=28,
    ),
    _def(
        "sop.template.step_head",
        "sop",
        "步驟卡標題",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "步驟 {index}／{total}：{title}",
        sort_order=29,
    ),
    _def(
        "sop.template.no_screenshot",
        "sop",
        "這則訊息沒有附截圖",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "這一則沒有附截圖。",
        sort_order=30,
    ),
    _def(
        "sop.template.busy",
        "sop",
        "上一則訊息還在處理",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "上一則訊息還在處理中，請稍候。",
        sort_order=31,
    ),
    _def(
        "sop.template.model_failure",
        "sop",
        "系統暫時無法處理",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "抱歉，我這邊暫時無法處理您的訊息，請稍後再試一次。",
        sort_order=32,
    ),
    _def(
        "sop.template.clarify_fallback",
        "sop",
        "需要民眾再說明一次",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "這一題我需要再確認一下，請您換個方式描述，或直接傳截圖給我。",
        sort_order=33,
    ),
    _def(
        "sop.template.empty_reply",
        "sop",
        "沒有內容可回覆時",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "收到，請問還有哪裡需要協助？",
        sort_order=34,
    ),
    _def(
        "sop.template.next_prompt",
        "sop",
        "提示回覆「下一步」",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "看完這一步後，回覆「下一步」我再傳下一張。",
        sort_order=35,
    ),
    _def(
        "sop.template.located_note",
        "sop",
        "定位來源與信心度註記",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "已從您的截圖辨識出目前位置（信心 {confidence}）",
        sort_order=36,
    ),
    _def(
        "sop.template.ask_brand",
        "sop",
        "詢問使用哪一家的服務",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "請問您使用的是哪一家的服務？",
        sort_order=37,
    ),
    _def(
        "sop.template.ask_channel",
        "sop",
        "詢問用 App 還是網頁",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "您是用 {brand} 的 App 還是網頁？",
        sort_order=38,
    ),
    _def(
        "sop.template.ask_goal",
        "sop",
        "詢問需要哪一種文件",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "請問您需要取得哪一種{goal_noun}？",
        sort_order=39,
    ),
    _def(
        "sop.template.ask_branch",
        "sop",
        "詢問接下來看到哪一種情況",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "接下來您看到的是哪一種情況？",
        sort_order=40,
    ),
    _def(
        "sop.template.ask_next_goal",
        "sop",
        "詢問還需要哪一種文件",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "接下來還需要取得哪一種{goal_noun}？",
        sort_order=41,
    ),
    _def(
        "sop.template.completed",
        "sop",
        "全部步驟都完成了",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "「{goal}」的步驟已全部完成。",
        sort_order=42,
    ),
    _def(
        "sop.template.candidate_confirmed",
        "sop",
        "依民眾確認定位的註記",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "已依您的確認定位到此步驟",
        sort_order=43,
    ),
    _def(
        "sop.template.clarification_limit",
        "sop",
        "多次追問仍無法判斷",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "多次追問後仍無法判斷，請轉由人工協助",
        sort_order=44,
    ),
    _def(
        "sop.template.channel_mobile_app",
        "sop",
        "管道名稱：手機 App",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "手機 App",
        sort_order=45,
    ),
    _def(
        "sop.template.channel_web",
        "sop",
        "管道名稱：網頁版",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "網頁版",
        sort_order=46,
    ),
    _def(
        "sop.template.channel_desktop",
        "sop",
        "管道名稱：電腦版",
        "SOP 教學對話的固定語句，由 services/policy.py 以 {placeholder} 代入。",
        "電腦版",
        sort_order=47,
    ),
    _def(
        "line.sop.ask_document",
        "sop",
        "請民眾選要準備的文件",
        "LINE 申請小幫手的開場提問，下方會跟著一排文件選項。",
        "請問你要準備哪一份文件？\n"
        "可以點下方的選項，或直接用自己的話告訴我。",
        sort_order=100,
    ),
    _def(
        "line.sop.ask_platform_general",
        "sop",
        "申請小幫手詢問銀行或平台",
        "民眾開啟申請小幫手時的第一句，下方會列出目前有教學的平台。",
        "請問你使用哪一家銀行或平台？\n"
        "可以點下方選項、直接輸入名稱，或上傳目前畫面的截圖，我會幫你找操作方式。",
        sort_order=100,
    ),
    _def(
        "line.sop.platform_guides",
        "sop",
        "平台的全部操作指引",
        "民眾選定銀行或平台後，列出該平台所有已發布的操作教學。",
        "{{platform}}目前提供以下操作指引：\n{{guides}}\n\n請點選想看的項目，或直接輸入操作名稱。",
        variables=("platform", "guides"),
        sort_order=101,
    ),
    _def(
        "line.sop.platform_not_found",
        "sop",
        "找不到銀行或平台",
        "民眾輸入的平台名稱無法對應到已發布教學時顯示。",
        "目前找不到這個銀行或平台的操作教學。\n請從下方選項挑一個，或上傳目前畫面的截圖。",
        sort_order=102,
    ),
    _def(
        "line.sop.not_recognized",
        "sop",
        "認不出截圖時的回覆",
        "民眾傳來的截圖比對不到任何教學步驟時的回覆。",
        "抱歉，我看不出這張截圖是哪一個畫面。\n"
        "請告訴我你使用哪一家銀行或平台，我再列出可以查看的操作指引。",
        sort_order=101,
    ),
    _def(
        "line.sop.no_flow",
        "sop",
        "這份文件還沒有教學",
        "民眾選了一份文件，但它還沒有對照到任何已發布的 SOP 流程時的回覆。",
        "這一份「{{document}}」目前還沒有逐步教學。\n"
        "你可以先看常見問題，或直接聯絡承辦單位，我們會盡快補上。",
        variables=("document",),
        sort_order=102,
    ),
    _def(
        "line.sop.ask_platform",
        "sop",
        "同一份文件有好幾種拿法",
        "一份文件在不同 App 或網站有不同拿法時，請民眾先選一個。",
        "「{{document}}」在不同的 App 或網站拿法不一樣。\n"
        "請問你要用哪一個？",
        variables=("document",),
        sort_order=103,
    ),
    _def(
        "line.sop.started",
        "sop",
        "教學開始的第一句",
        "開始逐步教學時，第一張圖之前的那一句話。",
        "好，我們來準備「{{document}}」。\n"
        "我會一步一張圖，做完一步就點「下一步」；卡住了就點「我卡住了」，把畫面截圖傳給我。",
        variables=("document",),
        sort_order=104,
    ),
    _def(
        "line.sop.all_steps_started",
        "sop",
        "一次顯示完整教學",
        "LINE 選定操作指引後，完整步驟圖片之前的說明。",
        "以下是「{{document}}」的完整操作指引，請左右滑動查看全部步驟。\n"
        "如果畫面和教學不同，可以點「我卡住了」並上傳截圖。",
        variables=("document",),
        sort_order=104,
    ),
    _def(
        "line.sop.stuck_ask_screenshot",
        "sop",
        "請民眾傳截圖",
        "民眾點「我卡住了」之後的提示。",
        "請把你現在的畫面截圖傳給我，我看看你走到哪一步了。",
        sort_order=105,
    ),
    _def(
        "line.sop.ended",
        "sop",
        "教學結束",
        "民眾點「結束」或教學逾時退出時的回覆。",
        "好的，教學先到這裡。\n"
        "之後想再看一次，隨時點下面的「申請小幫手」。",
        sort_order=106,
    ),
    _def(
        "line.sop.expired",
        "sop",
        "教學已經逾時",
        "超過 30 分鐘沒有互動、教學自動退出之後，民眾又傳訊息進來時的回覆。",
        "剛才那段教學已經結束了。\n"
        "要再看一次的話，告訴我你要準備哪一份文件就好。",
        sort_order=107,
    ),
    _def(
        "line.sop.switch",
        "sop",
        "換一個流程",
        "民眾點「換流程」時，重新問要準備哪一份文件。",
        "沒問題，那我們換一份。\n"
        "請問你要準備哪一份文件？",
        sort_order=108,
    ),
    _def(
        "feedback.prompt",
        "sop",
        "邀請用戶輸入回饋",
        "民眾點 Feedback 後，邀請他直接輸入一段文字。",
        "謝謝你願意幫忙！請直接輸入使用心得或遇到的問題，我們會把回饋交給團隊改善。",
        sort_order=109,
    ),
    _def(
        "feedback.thanks",
        "sop",
        "回饋送出完成",
        "系統保存 LINE 回饋後顯示。",
        "已收到你的 Feedback，謝謝你幫我們把服務做得更好 🙌",
        sort_order=110,
    ),
)

# ---- LINE 教學對話的快速回覆按鈕
_LINE: tuple[ContentDefinition, ...] = (
    _def(
        "line.quickreply.next",
        "button",
        "快速回覆：下一步",
        "SOP 教學進行中的快速回覆，功能固定為「看下一步」，只有顯示文字可改。",
        "下一步",
        content_type="button",
        sort_order=20,
    ),
    _def(
        "line.quickreply.stuck",
        "button",
        "快速回覆：我卡住了",
        "SOP 教學進行中的快速回覆，功能固定為「求助」，只有顯示文字可改。",
        "我卡住了",
        content_type="button",
        sort_order=21,
    ),
    _def(
        "line.quickreply.switch",
        "button",
        "快速回覆：換流程",
        "SOP 教學進行中的快速回覆，功能固定為「換一個流程」，只有顯示文字可改。",
        "換流程",
        content_type="button",
        sort_order=22,
    ),
    _def(
        "line.quickreply.exit",
        "button",
        "快速回覆：結束",
        "SOP 教學進行中的快速回覆，功能固定為「結束教學」，只有顯示文字可改。",
        "結束",
        content_type="button",
        sort_order=23,
    ),
    # 退件推播上的兩個按鈕（SPEC §8.4「退件推播附兩個按鈕」）。
    _def(
        "button.sop_prepare",
        "button",
        "退件推播：教我準備",
        "補件通知上的主要按鈕，功能固定為「開啟這份文件的教學」，只有顯示文字可改。",
        "教我準備",
        content_type="button",
        sort_order=30,
    ),
    _def(
        "button.go_supplement",
        "button",
        "退件推播：前往補件",
        "補件通知上的連結按鈕，功能固定為「開啟補件網頁」，只有顯示文字可改。",
        "前往補件",
        content_type="button",
        sort_order=31,
    ),
    _def(
        "button.demo_credit_record_help",
        "button",
        "Demo：信用卡消費紀錄教學",
        "Demo 缺件通知上的主要按鈕，開啟該文件的完整 SOP。",
        "不會獲取信用卡消費紀錄嗎？",
        content_type="button",
        sort_order=32,
    ),
    _def(
        "button.feedback",
        "button",
        "提供 Feedback",
        "功能完成後邀請民眾留下文字回饋。",
        "提供 Feedback",
        content_type="button",
        sort_order=33,
    ),
    # 圖文選單本身的兩段字。LINE 對長度有限制：名稱 300 字、聊天列 14 字。
    _def(
        "line.richmenu.name",
        "button",
        "圖文選單名稱",
        "只有承辦人在 LINE 後台看得到，民眾看不到。上限 300 字。",
        "MayDru 申辦小幫手主選單",
        content_type="label",
        sort_order=40,
    ),
    _def(
        "line.richmenu.chat_bar_text",
        "button",
        "圖文選單開關文字",
        "聊天室下方那一條「開啟選單」的字。LINE 上限 14 字。",
        "開啟選單",
        content_type="button",
        sort_order=41,
    ),
)

# ---- 審核判定說明（`services/review.py` 的 `Finding.note`）
# service 回的是 key 不是句子，字在這裡；後台案件頁與市民補件頁讀的是同一份。
_REVIEW: tuple[ContentDefinition, ...] = (
    _def(
        "review.note.no_document",
        "review",
        "判定說明：要看的文件還沒上傳",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "這條規則要看的那份文件還沒有上傳。",
        sort_order=10,
    ),
    _def(
        "review.note.no_text",
        "review",
        "判定說明：文件辨識不到文字",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "這份文件沒有辨識到任何文字，可能是空白頁或影像太模糊。",
        sort_order=20,
    ),
    _def(
        "review.note.field_not_found",
        "review",
        "判定說明：文件上找不到欄位",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "在這份文件上找不到這條規則要的欄位。",
        sort_order=30,
    ),
    _def(
        "review.note.normalize_failed",
        "review",
        "判定說明：讀到值但轉不成標準格式",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "讀到了值，但轉不成標準格式，需要人工確認。",
        sort_order=40,
    ),
    _def(
        "review.note.bad_regex",
        "review",
        "判定說明：規則的 regex 無法編譯",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "這條規則的 regex 無法編譯，請到方案管理修正這條規則。",
        sort_order=50,
    ),
    _def(
        "review.note.amount_source_missing",
        "review",
        "判定說明：還沒讀到憑證金額",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "還沒有從憑證上讀到金額，沒辦法比對。",
        sort_order=60,
    ),
    _def(
        "review.note.amount_unreadable",
        "review",
        "判定說明：憑證金額看不出是多少",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "憑證上讀到的字看不出是多少錢，需要人工確認。",
        sort_order=70,
    ),
    _def(
        "review.note.amount_pending",
        "review",
        "判定說明：申請人還沒填申報金額",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "申請人還沒有填寫申報金額，填好之後才會比對。",
        sort_order=80,
    ),
    _def(
        "review.note.amount_mismatch",
        "review",
        "判定說明：金額差距超出容許範圍",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "憑證上的金額與申報金額差距超出容許範圍。",
        sort_order=90,
    ),
    _def(
        "review.note.missing_documents",
        "review",
        "判定說明：必要文件還沒收齊",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "還有必要文件沒有收到。",
        sort_order=100,
    ),
    _def(
        "review.note.unknown_rule_type",
        "review",
        "判定說明：規則類型系統看不懂",
        "規則引擎判不出來時，案件頁在這一條規則下顯示的原因。",
        "這條規則的類型系統還看不懂，需要人工確認。",
        sort_order=110,
    ),
)

CONTENT_REGISTRY: tuple[ContentDefinition, ...] = (
    _def("help_chat.fallback", "faq", "文件助手：fallback", "文件助手回覆", "目前找不到符合的常見問題，請換個關鍵字，或透過說明頁洽詢承辦單位。"),
    _def("help_chat.disabled", "faq", "文件助手：disabled", "文件助手回覆", "文件助手暫停服務，請查看說明頁或洽詢承辦單位。"),
    _def("help_chat.limited", "faq", "文件助手：limited", "文件助手回覆", "詢問次數已達上限，請稍後再試，或查看常見問題。"),
    _def("help_chat.unavailable", "faq", "文件助手：unavailable", "文件助手回覆", "目前無法查詢，請稍後再試。"),
    _def("help_chat.too_long", "faq", "文件助手：too_long", "文件助手回覆", "問題太長，請縮短後再試。"),

    *_HOME,
    *_CASE,
    *_MYCASE,
    *_SUBSIDY,
    *_APPLY,
    *_FAQ,
    *_CONTACT,
    *_NOTIFY,
    *_SECURITY,
    *_ERROR,
    *_BUTTON,
    *_STATUS,
    *_REJECTION,
    *_REVIEW,
    *_SOP,
    *_LINE,
)

BY_KEY: dict[str, ContentDefinition] = {d.key: d for d in CONTENT_REGISTRY}


def get_definition(key: str) -> ContentDefinition | None:
    return BY_KEY.get(key)


def get_default(key: str) -> str:
    """出廠文案：資料表沒有這一列時就用它。不認得的 key 回空字串，
    寧可少一段文字也不要讓整個回覆爆掉。"""
    d = BY_KEY.get(key)
    return d.default if d else ""


def has_key(key: str) -> bool:
    return key in BY_KEY


def keys_in_category(category: str) -> tuple[str, ...]:
    """後台列表的顯示順序：先 sort_order，同分再用 key 讓順序穩定。"""
    found = [d for d in CONTENT_REGISTRY if d.category == category]
    return tuple(d.key for d in sorted(found, key=lambda d: (d.sort_order, d.key)))
