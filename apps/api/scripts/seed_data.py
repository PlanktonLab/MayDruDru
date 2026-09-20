"""seed.py 用的資料常數：新竹市「AI 領航青年數位工具補助計畫」的完整設定。

內容逐字取自 submit-flow 的 `lib/types.ts` 與 `lib/seed.ts`（盤點 §A7 / §A10），
以及 youth-line-bot 的 `data/mock/subsidies.json`。純資料，沒有邏輯——所以它是
「新增一個方案不用改 code」（SPEC 決策 D6）的證明，而不是反例。
"""

from __future__ import annotations

from typing import Any

SCHEME_CODE = "HCAI115"

SCHEME: dict[str, Any] = {
    "code": SCHEME_CODE,
    "name": "115年度 AI領航青年數位工具補助計畫",
    "category": "數位工具",
    "description": "補助設籍新竹市青年購買 AI 數位工具的訂閱費用。",
    "eligibility": "設籍新竹市、16–40 歲青年。",
    "age_min": 16,
    "age_max": 40,
    "application_start": "2026-04-02",
    "application_end": "2026-11-30",
    "official_url": "https://youthhsinchu.hccg.gov.tw/youth/app/artwebsite?module=artwebsite&id=64&serno=null",
    "contact": "新竹市青年發展中心 03-522-0557／LINE 官方帳號 @youthhsinchu",
    "amount_note": "一般青年：補助購買金額 50%，每人上限 3,000 元；特定對象及文化語言保存者：補助 90%，每人上限 6,000 元。",
    "tags": ["AI", "數位工具", "ChatGPT", "Claude", "Gemini", "Canva", "Copilot", "Midjourney", "軟體訂閱", "數位"],
    "identity_tags": ["一般青年", "應屆畢業生", "待業中", "創業者"],
    "residency_requirement": "新竹市",
    "student_requirement": "any",
    "employment_requirement": "any",
    "retention_days": 90,
    "supplement_days": 14,
    "max_revisions": 3,
    "required_documents": [
        "身分證正反面照片",
        "官方收據（含訂閱人姓名、電子信箱、完整 AI 軟體名稱、公司名稱、訂閱日期與期間）",
        "臺幣換算及繳款憑證",
        "存摺封面影本",
        "切結書（親筆簽名正本）",
        "特定對象或本土語言證照證明",
        "第三人代付切結與身分證明",
    ],
    "details": [
        {"label": "申請期間", "value": "115/4/2 – 115/11/30"},
        {"label": "購買日期限制", "value": "115/4/2 – 115/10/31"},
        {"label": "申請時限", "value": "月費 1 個月／年費 2 個月內"},
        {"label": "補助次數", "value": "每年一次"},
        {"label": "可補助 AI 工具", "value": "ChatGPT、Gemini、Grok、Claude、Perplexity、Canva AI、Adobe Firefly、Midjourney、Figma AI、Microsoft Copilot、copy.ai、Notion AI、Jasper、Grammarly、Speak、Elicit、Cursor"},
        {"label": "不予補助項目", "value": "中國大陸軟體（CapCut／Kling／Meitu／Wink）；集合式平台（Poe.com／GoingBus）；預付儲值、點數、代幣、API 額度"},
        {"label": "補件期限", "value": "10 個工作天"},
        {"label": "計畫經費", "value": "570 萬"},
        {"label": "線上申辦", "value": "https://dgservice.hccg.gov.tw/serviceNotice.do?rule=guest&id=1323"},
        {"label": "資料來源", "value": "新竹市青年發展中心"},
    ],
}

# submit-flow TIER_META
TIERS: list[dict[str, Any]] = [
    {"code": "GENERAL", "label": "一般青年", "subsidy_rate": 0.5, "cap_amount": 3000,
     "required_proof_doc_types": [], "sort_order": 1},
    {"code": "LOW_INCOME", "label": "特定對象及文化語言保存者", "subsidy_rate": 0.9, "cap_amount": 6000,
     "required_proof_doc_types": ["SPECIAL_STATUS_PROOF"], "sort_order": 2},
]

IMAGE_MIME = ["image/jpeg", "image/png", "application/pdf"]

# submit-flow DOC_META（12 種）。requirement REQUIRED → required=True；
# CONDITIONAL 的文件由繳費管道、級距或代付旗標決定。
DOCUMENT_TYPES: list[dict[str, Any]] = [
    {"code": "ID_CARD_FRONT", "label": "身分證正面", "required": True,
     "hint": "姓名、出生年月日、身分證字號需清楚可辨識。",
     "keep_visible": "姓名、出生年月日、身分證字號"},
    {"code": "ID_CARD_BACK", "label": "身分證反面", "required": True,
     "hint": "須可辨識設籍新竹市的住址。", "keep_visible": "設籍新竹市住址"},
    {"code": "OFFICIAL_RECEIPT", "label": "官方收據", "required": True,
     "hint": "軟體公司或平台開立的收據、發票或訂單確認信。"},
    {"code": "BILLING_STATEMENT", "label": "信用卡帳單扣款紀錄", "must_mask": True,
     "hint": "需看得到刷卡本人姓名、卡號末四碼、購買品項名稱、臺幣金額。",
     "keep_visible": "刷卡本人姓名、卡號末四碼、購買品項名稱、臺幣金額"},
    {"code": "CARD_LAST4_PHOTO", "label": "信用卡圖片", "must_mask": True,
     "hint": "需看得到持卡本人姓名、簽名與卡號末四碼。照片或截圖都可以。",
     "keep_visible": "持卡本人姓名、簽名、卡號末四碼"},
    {"code": "TELECOM_BILL", "label": "電信帳單", "must_mask": True,
     "hint": "需看得到繳款人、電話末三碼、購買品項名稱、臺幣金額。",
     "keep_visible": "繳款人、電話末三碼、購買品項名稱、臺幣金額"},
    {"code": "PAYER_ACCOUNT_PROOF", "label": "支付帳戶為本人之證明", "must_mask": True,
     "hint": "可證明該支付帳戶為你本人的資料，例如帳戶頁面顯示你的姓名。",
     "keep_visible": "帳戶持有人姓名"},
    {"code": "TRANSACTION_DETAIL", "label": "交易明細", "must_mask": True,
     "hint": "需看得到付款日期、付款金額、購買品項名稱。",
     "keep_visible": "付款日期、付款金額、購買品項名稱"},
    {"code": "BANKBOOK_COVER", "label": "存摺封面影本", "required": True,
     "hint": "撥款用。需看得到戶名、帳號、分行。", "keep_visible": "戶名、帳號、分行"},
    {"code": "AFFIDAVIT", "label": "切結書", "required": True,
     "hint": "需親筆簽名後拍照或掃描上傳。"},
    {"code": "PROXY_AFFIDAVIT", "label": "代為支付切結書", "required_when": "proxy",
     "hint": "由父母、配偶或法定代理人代為付款時才需要。"},
    {"code": "SPECIAL_STATUS_PROOF", "label": "特定對象證明",
     "hint": "低收入戶或中低收入戶證明。"},
]

# submit-flow CHANNEL_DOCS + CHANNEL_LABEL
PAYMENT_CHANNELS: list[dict[str, Any]] = [
    {"code": "CREDIT_CARD", "label": "信用卡繳費",
     "required_document_type_codes": ["CARD_LAST4_PHOTO", "BILLING_STATEMENT"],
     "hint": "信用卡圖片與信用卡帳單扣款紀錄，兩份都要。",
     "guide_content_key": "channel.CREDIT_CARD.guide", "sort_order": 1},
    {"code": "TELECOM", "label": "電信繳費",
     "required_document_type_codes": ["TELECOM_BILL"],
     "hint": "電信帳單須含繳款人、電話末三碼、購買品項名稱、臺幣金額。",
     "guide_content_key": "channel.TELECOM.guide", "sort_order": 2},
    {"code": "E_PAYMENT", "label": "電子支付工具繳費",
     "required_document_type_codes": ["PAYER_ACCOUNT_PROOF", "TRANSACTION_DETAIL"],
     "hint": "支付帳戶須為申請人本人，並附交易明細。兩份都要。",
     "guide_content_key": "channel.E_PAYMENT.guide", "sort_order": 3},
    {"code": "OTHER", "label": "其他繳費",
     "required_document_type_codes": ["PAYER_ACCOUNT_PROOF", "TRANSACTION_DETAIL"],
     "hint": "須可證明支付帳戶為申請人本人，並附付款明細。兩份都要。",
     "guide_content_key": "channel.OTHER.guide", "sort_order": 4},
]

# submit-flow REJECTION_META（12 個）
REJECTION_CODES: list[dict[str, Any]] = [
    {"code": "BILLING_NO_TWD", "staff_label": "出帳帳單缺臺幣換算金額",
     "public_what_wrong": "出帳帳單上看不到換算後的臺幣金額",
     "public_how_to_fix": "請重新取得一份含臺幣金額的帳單。下方是你的付款方式的取得步驟。",
     "related_document_type_codes": ["BILLING_STATEMENT"]},
    {"code": "BILLING_NO_CARD_DIGITS", "staff_label": "出帳帳單無法辨識卡號末四碼",
     "public_what_wrong": "出帳帳單上看不到卡號末四碼",
     "public_how_to_fix": "請提供含卡號末四碼的帳單頁面，或改用網銀的交易明細截圖。",
     "related_document_type_codes": ["BILLING_STATEMENT"]},
    {"code": "BILLING_UNREADABLE", "staff_label": "出帳帳單影像模糊或不完整",
     "public_what_wrong": "出帳帳單的照片看不清楚",
     "public_how_to_fix": "請在光線充足處重拍，確認四個角都在畫面內、文字沒有晃到。",
     "related_document_type_codes": ["BILLING_STATEMENT"]},
    {"code": "BILLING_AMOUNT_MISMATCH", "staff_label": "帳單金額與申請金額不符",
     "public_what_wrong": "帳單上的金額與你填寫的金額不一致",
     "public_how_to_fix": "請以帳單上實際扣款的臺幣金額為準，回到申請資料修正填報金額。",
     "related_document_type_codes": ["BILLING_STATEMENT"]},
    {"code": "CARD_DIGITS_MISMATCH", "staff_label": "卡號末四碼與信用卡照片不一致",
     "public_what_wrong": "帳單與信用卡照片的末四碼不是同一張卡",
     "public_how_to_fix": "帳單與卡片佐證必須是同一張卡。請確認後重新上傳其中一份。",
     "related_document_type_codes": ["CARD_LAST4_PHOTO"]},
    {"code": "ID_ADDRESS_UNCLEAR", "staff_label": "身分證住址無法辨識",
     "public_what_wrong": "身分證背面的住址看不清楚",
     "public_how_to_fix": "請重拍身分證背面，確認住址那一行沒有反光或模糊。",
     "related_document_type_codes": ["ID_CARD_BACK"]},
    {"code": "ID_NOT_HSINCHU", "staff_label": "設籍地非新竹市",
     "public_what_wrong": "身分證上的設籍地不在新竹市",
     "public_how_to_fix": "本計畫限設籍新竹市的青年申請。若你已遷入，請提供最新的身分證背面。",
     "related_document_type_codes": ["ID_CARD_BACK"]},
    {"code": "OVER_MASKED", "staff_label": "遮罩蓋住必要資訊",
     "public_what_wrong": "遮罩把需要保留的資訊也蓋住了",
     "public_how_to_fix": "請重新上傳並確認保留必要欄位——系統會標示哪些位置不可以遮。"},
    {"code": "AFFIDAVIT_NO_SIGNATURE", "staff_label": "切結書缺親筆簽名",
     "public_what_wrong": "切結書上沒有親筆簽名",
     "public_how_to_fix": "請列印後親筆簽名，再拍照上傳。",
     "related_document_type_codes": ["AFFIDAVIT"]},
    {"code": "DOC_MISSING", "staff_label": "缺少必要文件",
     "public_what_wrong": "有一份必要文件沒有收到",
     "public_how_to_fix": "請補上承辦標示的那一份文件。"},
    {"code": "TOOL_NOT_ELIGIBLE", "staff_label": "該工具不符補助資格",
     "public_what_wrong": "你申請的工具不符合補助資格",
     "public_how_to_fix": "請參考判定理由與替代工具建議。"},
    {"code": "OTHER", "staff_label": "其他（請填說明）",
     "public_what_wrong": "其他需要修正的事項",
     "public_how_to_fix": "請參考承辦的補充說明。"},
]

# SPEC §8.3 的四種 rule_type 各有代表。P3 的規則引擎照這些設定跑，不需要新的程式碼。
REVIEW_RULES: list[dict[str, Any]] = [
    {"code": "BILLING_TWD_AMOUNT", "label": "帳單上有換算後的臺幣金額",
     "document_type_code": "BILLING_STATEMENT", "rule_type": "keyword_extract", "required": True,
     "severity": "error", "sort_order": 1,
     "config": {"keywords": ["新臺幣", "台幣", "臺幣", "TWD", "NT$", "NTD"],
                "value_after_keyword": True, "regex": r"[\d,]+(?:\.\d{2})?",
                "normalize": "amount", "rejection_code": "BILLING_NO_TWD"}},
    {"code": "BILLING_CARD_LAST4", "label": "帳單上有卡號末四碼",
     "document_type_code": "BILLING_STATEMENT", "rule_type": "keyword_extract", "required": False,
     "severity": "warning", "sort_order": 2,
     "config": {"keywords": ["卡號", "末四碼", "card", "ending"],
                "value_after_keyword": True, "regex": r"\d{4}",
                "normalize": "last4", "rejection_code": "BILLING_NO_CARD_DIGITS"}},
    {"code": "BILLING_CHARGE_DATE", "label": "帳單上有扣款日期",
     "document_type_code": "BILLING_STATEMENT", "rule_type": "keyword_extract", "required": True,
     "severity": "error", "sort_order": 3,
     "config": {"keywords": ["扣款日", "交易日", "消費日", "date"],
                "value_after_keyword": True,
                "regex": r"\d{4}[/-]\d{1,2}[/-]\d{1,2}",
                "normalize": "date", "rejection_code": "BILLING_UNREADABLE"}},
    {"code": "RECEIPT_AMOUNT", "label": "收據上的金額",
     "document_type_code": "OFFICIAL_RECEIPT", "rule_type": "regex_extract", "required": False,
     "severity": "warning", "sort_order": 4,
     "config": {"pattern": r"(?:NT\$|TWD|新臺幣)\s*([\d,]+(?:\.\d{2})?)", "group": 1, "normalize": "amount"}},
    {"code": "AMOUNT_MATCHES_CLAIM", "label": "帳單金額與申報金額相符",
     "document_type_code": "BILLING_STATEMENT", "rule_type": "amount_tolerance", "required": True,
     "severity": "error", "sort_order": 5,
     # tolerance_pct 是百分比（5 = 5%），與 services/review.py 和 @maydru/review-rules 一致。
     "config": {"source_rule_code": "BILLING_TWD_AMOUNT", "compare_to": "purchase_amount",
                "tolerance_pct": 5, "tolerance_abs": 150,
                "rejection_code": "BILLING_AMOUNT_MISMATCH"}},
    {"code": "REQUIRED_DOCS_PRESENT", "label": "必要文件齊備",
     "document_type_code": "", "rule_type": "required_doc", "required": True,
     "severity": "error", "sort_order": 6,
     "config": {"document_type_codes": [], "from_payment_channel": True,
                "rejection_code": "DOC_MISSING"}},
]

# submit-flow TOOLS（17 筆現行判定；第 18 筆是被取代的舊版判定，MayDru 的
# eligible_tools 沒有版本概念，見 README「資料層」）。
_ELIGIBLE = "APPROVED"
_NOT_ELIGIBLE = "REJECTED"
_CASE_BY_CASE = "PENDING"

ELIGIBLE_TOOLS: list[dict[str, Any]] = [
    {"name": "ChatGPT Plus", "vendor": "OpenAI, L.L.C.", "status": _ELIGIBLE,
     "aliases": ["chatgpt", "ChatGPT", "chat gpt", "GPT", "gpt plus", "OpenAI", "查特 GPT", "chatgtp"],
     "verdict_note": "美國公司，無中資背景。屬一般性生成式 AI 工具，符合本計畫補助範圍。"},
    {"name": "Claude Pro", "vendor": "Anthropic PBC", "status": _ELIGIBLE,
     "aliases": ["claude", "Claude", "克勞德", "anthropic", "claude pro"],
     "verdict_note": "美國公司，無中資背景。符合本計畫補助範圍。"},
    {"name": "Gemini Advanced（Google One AI Premium）", "vendor": "Google LLC", "status": _ELIGIBLE,
     "aliases": ["gemini", "Gemini", "雙子星", "google one ai", "bard", "google gemini"],
     "verdict_note": "美國公司，無中資背景。符合本計畫補助範圍。"},
    {"name": "Microsoft 365 Copilot", "vendor": "Microsoft Corporation", "status": _ELIGIBLE,
     "aliases": ["copilot", "Copilot", "微軟 copilot", "office copilot", "m365 copilot"],
     "verdict_note": "美國公司，無中資背景。符合本計畫補助範圍。"},
    {"name": "GitHub Copilot", "vendor": "GitHub, Inc.（Microsoft 子公司）", "status": _ELIGIBLE,
     "aliases": ["github copilot", "gh copilot", "副駕駛", "coding copilot"],
     "verdict_note": "美國公司，無中資背景。程式開發輔助工具，符合本計畫補助範圍。"},
    {"name": "Midjourney", "vendor": "Midjourney, Inc.", "status": _ELIGIBLE,
     "aliases": ["midjourney", "MJ", "mid journey"],
     "verdict_note": "美國公司，無中資背景。影像生成工具，符合本計畫補助範圍。"},
    {"name": "Notion AI", "vendor": "Notion Labs, Inc.", "status": _ELIGIBLE,
     "aliases": ["notion ai", "notion", "NotionAI"],
     "verdict_note": "美國公司，無中資背景。符合本計畫補助範圍。"},
    {"name": "豆包（Doubao）", "vendor": "北京字節跳動科技有限公司", "status": _NOT_ELIGIBLE,
     "aliases": ["豆包", "doubao", "Doubao", "字節 AI"],
     "verdict_note": "母公司為字節跳動（中國），屬中資背景服務。依本計畫規定，具中資背景之服務不予補助。"},
    {"name": "DeepSeek", "vendor": "杭州深度求索人工智能基礎技術研究有限公司", "status": _NOT_ELIGIBLE,
     "aliases": ["deepseek", "DeepSeek", "深度求索", "deep seek"],
     "verdict_note": "中國公司，具中資背景。依本計畫規定不予補助。"},
    {"name": "CapCut（剪映）", "vendor": "北京字節跳動科技有限公司 / ByteDance", "status": _NOT_ELIGIBLE,
     "aliases": ["capcut", "CapCut", "剪映", "cap cut", "ByteDance"],
     "verdict_note": "由中國字節跳動營運開發，屬中資背景 AI 影音剪輯工具，依本計畫規定不予補助。"},
    {"name": "Kling AI（快手可靈）", "vendor": "北京快手科技有限公司", "status": _NOT_ELIGIBLE,
     "aliases": ["kling", "Kling", "可靈", "快手", "快手AI", "Kling AI"],
     "verdict_note": "由中國快手科技開發營運，屬中資背景服務，依本計畫規定不予補助。"},
    {"name": "Meitu（美圖秀秀 / Wink / WHEE）", "vendor": "廈門美圖網科技有限公司", "status": _NOT_ELIGIBLE,
     "aliases": ["meitu", "Meitu", "美圖秀秀", "美圖", "Wink", "wink", "WHEE", "whee"],
     "verdict_note": "廈門美圖公司開發營運，屬中國地區軟體及服務，依本計畫規定不予補助。"},
    {"name": "Manus", "vendor": "Manus Team", "status": _NOT_ELIGIBLE,
     "aliases": ["manus", "Manus", "manus ai", "Manus AI"],
     "verdict_note": "屬中國團隊開發之 AI Agent 服務，具中資背景，依本計畫規定不予補助。"},
    {"name": "SenseAvatar（商湯）", "vendor": "商湯科技 SenseTime", "status": _NOT_ELIGIBLE,
     "aliases": ["senseavatar", "SenseAvatar", "商湯", "商湯科技"],
     "verdict_note": "中國商湯科技開發營運，具中資背景，依本計畫規定不予補助。"},
    {"name": "Poe.com", "vendor": "Quora", "status": _NOT_ELIGIBLE,
     "aliases": ["poe", "Poe", "poe.com", "Poe.com", "Quora Poe"],
     "verdict_note": "透過集合式 AI 平台購買涉及非合規軟體綑綁銷售，本計畫僅補助直接向 AI 官網購買，故不予補助。"},
    {"name": "GoingBus", "vendor": "GoingBus", "status": _NOT_ELIGIBLE,
     "aliases": ["goingbus", "GoingBus", "going bus"],
     "verdict_note": "屬代購／帳號合租網站，非申請人向 AI 軟體官網直購，不屬本計畫補助範圍，不予補助。"},
    {"name": "Canva Pro", "vendor": "Canva Pty Ltd（澳洲）", "status": _CASE_BY_CASE,
     "aliases": ["canva", "Canva", "canva pro"],
     "verdict_note": "澳洲公司，無中資背景，但本身為設計工具、AI 功能僅為其中一部分。"
                     "是否屬「AI 數位工具」需依申請人實際使用目的逐案認定。"},
]

# submit-flow PENDING_TOOLS：民眾輸入過但還沒判定的工具，request_count 是被問到的次數。
PENDING_TOOLS: list[dict[str, Any]] = [
    {"name": "Perplexity Pro", "request_count": 23},
    {"name": "Cursor", "request_count": 17},
    {"name": "Suno AI 音樂", "request_count": 11},
    {"name": "ElevenLabs", "request_count": 6},
    {"name": "Kimi 月之暗面", "request_count": 4},
    {"name": "Grammarly Premium", "request_count": 2},
]

# submit-flow FAQS（10 筆）
FAQS: list[dict[str, Any]] = [
    {"code": "faq_billing", "category": "DOCUMENTS", "priority": 100,
     "question": "什麼是「出帳帳單」？我要去哪裡拿？",
     "keywords": ["出帳帳單是什麼", "繳款憑證怎麼拿", "換算臺幣的憑證"],
     "answer": "出帳帳單是指你的付款管道（信用卡、Apple、Google Play、PayPal）所出具、並且看得到"
               "「換算後臺幣金額」的那一份紀錄。\n\n這是最容易被退件的一份文件——約 8 成需要補件的案件"
               "都卡在這裡。系統會依你選的付款方式，一步一步告訴你去哪裡找。"},
    {"code": "faq_privacy_mask", "category": "PRIVACY", "priority": 100,
     "question": "為什麼要我上傳整份帳單？我不想給你們看我所有的消費",
     "keywords": ["個資太多", "不想給全部帳單", "隱私", "會看到我買什麼"],
     "answer": "你不需要。系統會在你的手機上自動把「與本次申請無關的消費紀錄」遮起來，遮好之後才上傳"
               "——原圖永遠不會離開你的手機。\n\n市府端收到的，只有已經遮罩過的影像。必須保留的只有："
               "本次 AI 訂閱的那筆交易、卡號末四碼、帳單日期。"},
    {"code": "faq_revision_queue", "category": "PROCESS", "priority": 100,
     "question": "被退件補傳之後，是不是要重新排隊？",
     "keywords": ["補件要重新排隊嗎", "補件會不會變慢", "重新排隊"],
     "answer": "不用。補件後你的案件依「第一次送件的時間」排序，不會回到隊伍最後面。\n\n"
               "你只需要重傳有問題的那幾份文件，其他已經通過的不用再上傳一次。"},
    {"code": "faq_eligible_tool", "category": "TOOLS", "priority": 100,
     "question": "我買的 AI 工具可以申請嗎？",
     "keywords": ["哪些工具可以補助", "工具資格", "軟體能不能申請"],
     "answer": "在申請的第一步輸入工具名稱，系統會立刻告訴你結果。\n\n若系統尚未收錄該工具，你仍然可以送件"
               "——會由承辦人員人工認定，不會因為沒收錄而被擋住。具中資背景的服務依規定不予補助。"},
    {"code": "faq_amount", "category": "ELIGIBILITY", "priority": 95,
     "question": "補助金額怎麼算？一般青年與特定對象補助多少？",
     "keywords": ["可以拿多少", "補助比例", "上限多少", "補助金額"],
     "answer": "• 一般青年：補助購買金額之 50%，每人上限 NT$3,000。\n"
               "• 特定對象及文化語言保存者：補助購買金額之 90%，每人上限 NT$6,000。\n\n"
               "※ 特定對象包含：低收入戶、中低收入戶、獨立負擔家計者、身心障礙者、原住民、新住民及就業服務法第 24 條第 1 項各款。\n"
               "※ 計算基準以帳單扣款之實際臺幣金額為準。"},
    {"code": "faq_qualification", "category": "ELIGIBILITY", "priority": 100,
     "question": "誰可以申請？年齡與身分限制為何？",
     "keywords": ["資格條件", "年齡限制", "要設籍新竹嗎", "出生日期"],
     "answer": "申請人須為設籍新竹市 16 歲(含)至 40 歲(含)以下新竹市青年（出生日期於民國 74 年 4 月 3 日（含）至民國 99 年 4 月 2 日（含）之間）。\n\n"
               "申請時需檢附身分證正反面照片，且須能清楚辨識設籍於新竹市。"},
    {"code": "faq_language_preservation", "category": "ELIGIBILITY", "priority": 90,
     "question": "什麼是「文化語言保存者」？具備哪些本土語言證照可補助 90%？",
     "keywords": ["文化語言保存者", "台語認證", "客語認證", "原住民語認證", "證照證明"],
     "answer": "文化語言保存者包含具備以下任一本土語言能力認證合格者：\n"
               "1. 原住民族語言能力認證\n2. 臺灣台語語言能力認證\n3. 客語能力認證\n\n"
               "申請時檢附本土語言合格證照證明，即可享有 90% 補助成數（每人上限 NT$6,000）。"},
    {"code": "faq_api_token", "category": "TOOLS", "priority": 95,
     "question": "購買 API 額度、Token 代幣或預付儲值點數可以申請補助嗎？",
     "keywords": ["API", "Token", "代幣", "儲值點數", "Credit", "額度扣抵"],
     "answer": "不行。\n\n依計畫規定第伍點第（三）款，本計畫不補助以預付儲值、購買使用額度（Credit）、點數、代幣（Token）或 API（Application Programming Interface）額度等方式取得之 AI 服務。\n\n"
               "凡採預先儲值、依實際使用量扣抵費用之服務，均不屬本計畫補助範圍。"},
    {"code": "faq_application_deadline", "category": "PROCESS", "priority": 100,
     "question": "購買 AI 工具後，最晚要在多久以內提出線上申請？",
     "keywords": ["申請期限", "多久內申請", "購買後多久", "截止日期"],
     "answer": "自 115 年 8 月 14 日起開放線上申請，購買後之申請期限為：\n"
               "• 月費制：購買日期起「一個月內」提出申請。\n"
               "• 年費制：購買日期起「兩個月內」提出申請。\n\n"
               "受理期間至 115 年 11 月 30 日截止或經費用罄止，超過規定期限將不予受理。"},
    {"code": "faq_monthly_accumulation", "category": "DOCUMENTS", "priority": 90,
     "question": "月費制可以累積多個月份一起提出申請嗎？",
     "keywords": ["月費累積", "連續訂閱", "累積申請", "多個月"],
     "answer": "可以。\n\n申請月費制 AI 工具補助者，可累積連續月份之訂閱費用，並於累積訂閱之最後一個月提出申請；"
               "惟訂閱期間不得中斷（不得跨月），且應逐月檢附官方收據或訂閱憑證、臺幣換算證明及繳款憑證。"},
    {"code": "faq_proxy_payment", "category": "DOCUMENTS", "priority": 90,
     "question": "我未持有信用卡，可以由父母、配偶或法定代理人代為支付嗎？",
     "keywords": ["代刷", "家人信用卡", "父母代付", "法定代理人", "切結書"],
     "answer": "可以。\n\n申請人如未持有信用卡，由法定代理人（或父母、配偶）代為支付款項者：\n"
               "1. 應檢附身分關係證明文件（如戶口名簿、戶籍謄本或其他足資證明之文件）。\n"
               "2. 應由申請人與代付款人共同親筆簽名切結書（附件四）後拍照上傳。"},
    {"code": "faq_iphone", "category": "DOCUMENTS", "priority": 10,
     "question": "我用 iPhone 拍的照片上傳後打不開？",
     "keywords": ["HEIC", "iPhone 照片格式", "檔案打不開"],
     "answer": "系統會在你的手機上自動把 iPhone 的 HEIC 照片轉成 JPEG 再上傳，所以承辦端一定打得開。"
               "你不需要自己轉檔。"},
    {"code": "faq_card_photo", "category": "DOCUMENTS", "priority": 10,
     "question": "一定要拍實體信用卡嗎？我的卡在別的地方",
     "keywords": ["沒有實體卡", "網銀截圖可以嗎", "卡片照片"],
     "answer": "不一定。網路銀行截圖、銀行 APP 截圖、信用卡帳單、即時消費通知都可以，"
               "只要看得到「卡號末四碼」與「持卡人姓名」即可。\n\n簽名不需要出現在畫面上。"},
    {"code": "faq_regulation", "category": "REGULATION", "priority": 100,
     "question": "計畫簡章去哪裡看？有哪些重要規定要注意？",
     "keywords": ["簡章", "規範", "注意事項", "規章重點"],
     "answer": "新竹市「AI 領航青年數位工具補助計畫」重點規章：\n"
               "1. 資格：設籍新竹市 16–40 歲青年（民國 74/4/3 至 99/4/2 出生）。\n"
               "2. 期程：115 年 8 月 14 日起至 115 年 11 月 30 日止線上申請（或經費用罄止）。\n"
               "3. 期限：月費制購買後 1 個月內、年費制購買後 2 個月內提出申請。\n"
               "4. 限制：每人每年限補助一次；不補助中資/港澳 AI；不補助預先儲值/Token/API 額度；不得跨月斷訂。\n"
               "5. 補正：通知補件起 10 日(工作天)內須完成補正。"},
]

# youth-line-bot 的其餘四個現行方案，只帶基本資料（SPEC §12）。
OTHER_SCHEMES: list[dict[str, Any]] = [
    {"code": "HCDIV115", "name": "促進青年多元發展補助", "category": "青年發展",
     "age_min": 16, "age_max": 40, "application_end": "2026-11-30", "residency_requirement": "新竹市"},
    {"code": "HCLOAN115", "name": "115年度新竹市青年創業貸款利息補貼計畫", "category": "創業",
     "age_min": 18, "age_max": 45, "application_end": "2026-11-30", "residency_requirement": "新竹市"},
    {"code": "HCCLUB115", "name": "安心Go Young青年學生社團發展補助計畫", "category": "學生社團",
     "application_end": "2026-11-30", "residency_requirement": "新竹市", "student_requirement": "required"},
    {"code": "HCRENT115", "name": "115年度新竹好好租－新竹市青年租金加碼補貼", "category": "居住",
     "age_max": 39, "application_end": "2026-12-31", "residency_requirement": "新竹市"},
]

# 六筆示範案件；`20260001` 專供 LINE Demo 綁定與推播，其餘每個狀態一筆。
# 資料全是假的；文件列指向不存在的 object key，
# 預覽一律 null，所以後台看得到案件結構但不會有任何真實影像（CLAUDE.md 規則 9）。
DEMO_CASES: list[dict[str, Any]] = [
    {
        "case_no": "20260001", "status": "UNDER_REVIEW", "days_ago": 3,
        "applicant_name": "示範用小明", "phone": "0912345678", "id_number": "A123456789",
        "tier_code": "GENERAL", "payment_channel_code": "CREDIT_CARD",
        "tool_name": "ChatGPT Plus", "purchase_amount": 6000, "purchase_date": "2026-08-15",
        "documents": ["ID_CARD_FRONT", "ID_CARD_BACK", "OFFICIAL_RECEIPT", "CARD_LAST4_PHOTO",
                      "BILLING_STATEMENT", "BANKBOOK_COVER", "AFFIDAVIT"],
    },
    {
        "case_no": "HC-2026-900001", "status": "SUBMITTED", "days_ago": 1,
        "applicant_name": "示範用小明", "phone": "0900000001", "id_number": "A100000001",
        "tier_code": "GENERAL", "payment_channel_code": "CREDIT_CARD",
        "tool_name": "ChatGPT Plus", "purchase_amount": 6000, "purchase_date": "2026-08-01",
        "documents": ["ID_CARD_FRONT", "ID_CARD_BACK", "OFFICIAL_RECEIPT", "CARD_LAST4_PHOTO",
                      "BILLING_STATEMENT", "BANKBOOK_COVER", "AFFIDAVIT"],
    },
    {
        "case_no": "HC-2026-900002", "status": "UNDER_REVIEW", "days_ago": 5,
        "applicant_name": "示範用小華", "phone": "0900000002", "id_number": "B100000002",
        "tier_code": "GENERAL", "payment_channel_code": "TELECOM",
        "tool_name": "Claude Pro", "purchase_amount": 7200, "purchase_date": "2026-07-20",
        "documents": ["ID_CARD_FRONT", "ID_CARD_BACK", "OFFICIAL_RECEIPT", "TELECOM_BILL",
                      "BANKBOOK_COVER", "AFFIDAVIT"],
    },
    {
        "case_no": "HC-2026-900003", "status": "NEEDS_REVISION", "days_ago": 9,
        "applicant_name": "示範用小美", "phone": "0900000003", "id_number": "C100000003",
        "tier_code": "LOW_INCOME", "payment_channel_code": "CREDIT_CARD",
        "tool_name": "Midjourney", "purchase_amount": 3600, "purchase_date": "2026-07-02",
        "documents": ["ID_CARD_FRONT", "ID_CARD_BACK", "OFFICIAL_RECEIPT", "CARD_LAST4_PHOTO",
                      "BILLING_STATEMENT", "BANKBOOK_COVER", "AFFIDAVIT", "SPECIAL_STATUS_PROOF"],
        "supplement_items": [
            {"document_type_code": "BILLING_STATEMENT", "rejection_code": "BILLING_NO_TWD",
             "note": "帳單上看不到換算後的臺幣金額，請重新取得一份含臺幣金額的帳單。"},
        ],
    },
    {
        "case_no": "HC-2026-900004", "status": "APPROVED", "days_ago": 20,
        "applicant_name": "示範用小強", "phone": "0900000004", "id_number": "D100000004",
        "tier_code": "GENERAL", "payment_channel_code": "E_PAYMENT",
        "tool_name": "Notion AI", "purchase_amount": 4800, "purchase_date": "2026-06-15",
        "approved_amount": 2400,
        "documents": ["ID_CARD_FRONT", "ID_CARD_BACK", "OFFICIAL_RECEIPT", "PAYER_ACCOUNT_PROOF",
                      "TRANSACTION_DETAIL", "BANKBOOK_COVER", "AFFIDAVIT"],
    },
    {
        "case_no": "HC-2026-900005", "status": "DISBURSED", "days_ago": 40,
        "applicant_name": "示範用小芳", "phone": "0900000005", "id_number": "E100000005",
        "tier_code": "LOW_INCOME", "payment_channel_code": "CREDIT_CARD",
        "tool_name": "GitHub Copilot", "purchase_amount": 3000, "purchase_date": "2026-05-10",
        "approved_amount": 2700, "paid_by_proxy": True,
        "documents": ["ID_CARD_FRONT", "ID_CARD_BACK", "OFFICIAL_RECEIPT", "CARD_LAST4_PHOTO",
                      "BILLING_STATEMENT", "BANKBOOK_COVER", "AFFIDAVIT", "PROXY_AFFIDAVIT",
                      "SPECIAL_STATUS_PROOF"],
    },
]

# 每個示範案件要走的轉移。SUBMITTED 的那一筆連 T1 都不跑（seed 專用旗標）。
DEMO_PATHS: dict[str, list[str]] = {
    "SUBMITTED": [],
    "UNDER_REVIEW": [],
    "NEEDS_REVISION": ["T2"],
    "APPROVED": ["T3"],
    "DISBURSED": ["T3", "T6", "T7"],
}
