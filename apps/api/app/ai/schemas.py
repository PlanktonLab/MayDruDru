"""Structured output schemas for every model task (SPEC §7)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class UIElement(BaseModel):
    text: str = Field(description="元件上的可見文字，若無則空字串")
    kind: Literal["button", "tab", "link", "input", "toggle", "icon", "list_item", "card", "label", "other"] = "other"
    region: str = Field(default="", description="所在區塊名稱")
    position: str = Field(default="", description="相對位置描述，例如 上方/右上/清單第 2 列")


class DataRegion(BaseModel):
    name: str
    data_type: str = Field(description="例如 金額、日期、卡號、姓名、帳號、店名、數量")
    position: str = ""


class FocusMapping(BaseModel):
    focus_box_id: str
    element_description: str
    texts: list[str] = Field(default_factory=list, description="框內逐字的可見文字")


class StructureAnalysis(BaseModel):
    """Agent A output."""
    screen_title: str = ""
    navigation: str = Field(default="", description="導覽結構：頂部列、Tab bar、返回鍵等")
    layout_summary: str = Field(default="", description="主要區塊由上到下的相對位置")
    sections: list[str] = Field(default_factory=list)
    elements: list[UIElement] = Field(default_factory=list)
    data_regions: list[DataRegion] = Field(default_factory=list)
    focus_mappings: list[FocusMapping] = Field(default_factory=list)
    structural_texts: list[str] = Field(default_factory=list, description="頁面標題、Tab、區段名、按鈕、欄位名等結構性文字")
    sensitive_texts: list[str] = Field(default_factory=list, description="畫面上所有屬於資料或個資的可見字串（姓名、金額、日期、帳號、店名等），逐字")
    visible_keywords: list[str] = Field(default_factory=list, description="辨識此畫面用的關鍵字")
    theme_guess: Literal["light", "dark"] = "light"
    style_notes: str = Field(default="", description="主色、字體感、圓角等風格摘要")
    has_tab_bar: bool = Field(default=False, description="畫面底部是否有跨頁共用的 Tab bar（分頁列）")
    has_nav_bar: bool = Field(default=False, description="畫面頂部是否有跨頁共用的導覽列或標題列")


class FakeDatum(BaseModel):
    """One value Agent B put on the screen in place of real data. `key` ties it
    back to the platform's 示範資料 so the reviewer can tell 沿用 from 新增."""
    key: str = Field(default="", description="沿用【示範資料】的欄位時填該欄位的識別字；自行編造的留空")
    label: str = Field(default="", description="這筆資料是什麼欄位，例如 使用者姓名、申請時間、案件編號")
    value: str = Field(default="", description="實際出現在畫面上的值")


class ReplicaOutput(BaseModel):
    """Agent B output."""
    html: str = Field(description="單一自包含 HTML 文件")
    kept_texts: list[str] = Field(default_factory=list, description="逐字保留的文字清單")
    fake_data: list[FakeDatum] = Field(default_factory=list, description="這張畫面上每一筆假資料的欄位、值與來源")
    notes: str = ""


class StyleDocAI(BaseModel):
    """Agent C output — the ai_generated section of a Style Doc."""
    primary_colors: list[str] = Field(default_factory=list)
    secondary_colors: list[str] = Field(default_factory=list)
    gradients: str = ""
    corner_style: str = ""
    typography_feel: str = ""
    navigation_pattern: str = ""
    signature_components: list[str] = Field(default_factory=list)
    common_keywords: list[str] = Field(default_factory=list)
    summary: str = Field(default="", description="總結，全部欄位合計不超過約 300 字")


SCREEN_KINDS = ("app_screen", "web_page", "home_screen", "lock_screen", "system_screen", "not_a_screen", "unreadable")


class ScreenshotDescription(BaseModel):
    """Description of a citizen screenshot, same schema family as ingestion,
    plus what kind of picture it is — the retrieval fallback ladder reads
    `kind` and `photographed` before it decides how to guide the citizen."""
    kind: Literal["app_screen", "web_page", "home_screen", "lock_screen", "system_screen", "not_a_screen", "unreadable"] = Field(
        default="app_screen",
        description="app_screen＝某個 App 裡的畫面；web_page＝瀏覽器網頁；home_screen＝手機桌面／主畫面；lock_screen＝鎖定畫面；"
                    "system_screen＝系統設定、通知中心、App 切換器等；not_a_screen＝不是螢幕畫面（實體文件、風景、人物等）；unreadable＝太模糊、太暗或被裁到看不出內容")
    photographed: bool = Field(default=False, description="是否為用相機翻拍螢幕（有邊框、反光、透視變形、摩爾紋）而不是系統截圖")
    app_guess: str = Field(default="", description="若能判斷，這是哪個 App、網站或品牌的畫面（依畫面上的 logo、名稱、配色判斷）；不確定則空字串")
    screen_title: str = ""
    navigation: str = ""
    layout_summary: str = ""
    structural_texts: list[str] = Field(default_factory=list, description="畫面上的結構性文字，逐字：頁面標題、Tab、按鈕、欄位名、區段名、選單項。不含任何資料值")
    elements: list[UIElement] = Field(default_factory=list, description="可操作的元件（按鈕、Tab、連結、輸入框）與它們的位置")
    visible_keywords: list[str] = Field(default_factory=list)
    style_notes: str = ""
    theme: Literal["light", "dark"] = "light"
    quality_issues: list[str] = Field(default_factory=list, description="影響辨識的問題：模糊、過暗、只截到局部、有遮擋等；沒有則空")
    platform_guess: str = Field(default="", description="同 app_guess（舊欄位，保留相容）")


class RerankResult(BaseModel):
    best_candidate_index: int = Field(description="最可能的候選索引，從 0 起；-1 代表都不像")
    confidence: float = Field(ge=0, le=1)
    relation: Literal["same_screen", "same_app_other_screen", "different_app", "not_app"] = Field(
        default="different_app",
        description="same_screen＝與最佳候選是同一個畫面；same_app_other_screen＝同一個 App 但是候選裡沒有的另一頁；"
                    "different_app＝不是候選所屬的 App；not_app＝根本不是 App 畫面")
    difference: str = Field(default="", description="民眾畫面與最佳候選的差異，一句話；例如「同一頁但尚未展開篩選」「在候選的上一層選單」。完全相同則空")
    reason: str = ""
    theme: Literal["light", "dark"] = "light"


class IntentResult(BaseModel):
    platform_id: str | None = None
    platform_confidence: float = 0
    brand: str | None = None
    channel_ambiguous: bool = False
    goal_id: str | None = None
    goal_confidence: float = 0
    needs: list[Literal["platform", "channel", "goal"]] = Field(default_factory=list)
    reason: str = ""


class IntentClassification(BaseModel):
    """LINE 意圖分類（SPEC §9.1）。模型只能**挑**候選，不產生任何給市民的字。"""

    intent: str = Field(default="unknown", description="候選清單裡的 intent 識別字；都不像就填 unknown")
    target_id: str = Field(default="", description="候選帶 target_id 時（例如 FAQ）填該候選的 target_id，否則留空")
    confidence: float = Field(default=0.0, ge=0, le=1)
    reason: str = Field(default="", description="一句話說明為什麼選它，給稽核看的")


class VisualReview(BaseModel):
    """Self-check after rendering: does the replica look like the original?"""
    score: float = Field(ge=0, le=1, description="版面相似度 0~1（只看版面比例與元件，不看資料內容）")
    issues: list[str] = Field(default_factory=list, description="具體可修正的版面問題，每條一句")
    privacy_leak: bool = Field(default=False, description="復刻圖上是否仍看得到原圖的個資或資料字串")


# ------------------------------------------------------- 內容助理（SPEC §8.6 / §9.6）
# 三支助理共用同一組型別。共通的設計是「每句話都要指得出依據」：模型回的是一串
# **句子**加上一份引用清單，句子自己說它引用第幾筆；沒有依據的句子由
# `services/copilot.py` 在伺服器端標上「待查證」，而不是靠提示詞請模型自律。

COPILOT_SOURCE_TYPES = (
    "scheme", "document_type", "payment_channel", "rejection_code",
    "review_rule", "knowledge_document", "content", "faq",
)


class Citation(BaseModel):
    """一筆依據：它來自哪張表、哪一列、原文是哪一句。"""

    source_type: Literal["scheme", "document_type", "payment_channel", "rejection_code",
                         "review_rule", "knowledge_document", "content", "faq"] = "scheme"
    source_id: str = Field(default="", description="那一列的識別字：方案代碼、文件類型代碼、文案 key、知識文件 id")
    quote: str = Field(default="", description="被引用的原文，逐字，不要改寫")


class DraftSentence(BaseModel):
    """草稿的一句話。`citation_index` 指向 citations 的索引；沒有依據就留 null。"""

    text: str = ""
    citation_index: int | None = Field(default=None, description="這句話的依據是 citations 的第幾筆（從 0 起）；憑空推測就留空")


class ContentDraft(BaseModel):
    """助理 (a)：一則罐頭訊息的草稿。"""

    sentences: list[DraftSentence] = Field(default_factory=list, description="草稿逐句，依顯示順序")
    citations: list[Citation] = Field(default_factory=list)
    notes: str = Field(default="", description="給承辦人的一句提醒，例如還缺哪個資訊")


class FaqSuggestion(BaseModel):
    """助理 (b)：一群問不出答案的句子收斂成的一則 FAQ 建議。"""

    question: str = Field(default="", description="用民眾的說法寫成一個問句")
    sentences: list[DraftSentence] = Field(default_factory=list, description="答案逐句")
    citations: list[Citation] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list, description="讓 bot 比對得到這一則的關鍵字，3~6 個")
    category: str = Field(default="", description="分類，沿用既有 FAQ 的分類名稱")


class SchemeCopyItem(BaseModel):
    """助理 (c)：方案文案集裡的一則。`key` 必須是呼叫方給的那一份清單裡的值。"""

    key: str = ""
    sentences: list[DraftSentence] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)


class SchemeCopySet(BaseModel):
    items: list[SchemeCopyItem] = Field(default_factory=list)
