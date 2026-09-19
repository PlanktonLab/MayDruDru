"""`/api/apply/*` 的請求與回應模型（SPEC §8.1 / §10.2）。

放在 router 旁邊而不是 `app/schemas.py`：它們只服務這一支 router，而且是宣告不是
邏輯。薄殼的規則管的是判斷，不是型別。

送件是 multipart，兩個 JSON 欄位（`application`、`documents`）加上依序編號的檔案
`file_0`、`file_1`…，所以這裡的模型是**從字串 parse 出來的**，而不是 request body
本身——FastAPI 只看得到那兩個字串。
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "ApplicationIn",
    "CaseDocumentOut",
    "CaseEventOut",
    "CasePublicOut",
    "CreatedOut",
    "DocumentIn",
    "FaqOut",
    "FindingOut",
    "RequiredDocumentsIn",
    "RequiredDocumentsOut",
    "SchemeSummaryOut",
    "SubmitResultOut",
    "SupplementItemOut",
    "VerifyIn",
    "VerifyOut",
]


class BBoxOut(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class FindingOut(BaseModel):
    """與 `@maydru/review-rules` 的 Finding 同形狀（契約 §Finding）。"""

    rule_code: str
    status: str
    extracted_value: str | None = None
    expected_value: str | None = None
    confidence: float | None = None
    bbox: dict[str, float] | None = None
    document_type_code: str | None = None
    note: str | None = None
    suggested_supplement: list[str] | None = None


class SchemeSummaryOut(BaseModel):
    code: str
    name: str
    category: str = ""
    description: str = ""
    application_start: date | None = None
    application_end: date | None = None
    amount_note: str = ""
    tags: list[str] = Field(default_factory=list)
    active: bool = True


class RequiredDocumentsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tier_code: str = ""
    payment_channel_code: str = ""
    paid_by_proxy: bool = False


class RequiredDocumentsOut(BaseModel):
    document_type_codes: list[str]


class DocumentIn(BaseModel):
    """`documents` 欄位的一個元素；順序對應 `file_0`、`file_1`…。"""

    model_config = ConfigDict(extra="ignore")

    document_type_code: str = Field(min_length=1, max_length=40)
    masked: bool = False
    mime: str = ""
    page_count: int = Field(default=1, ge=1, le=50)
    ocr: dict[str, Any] | None = None


class PrecheckIn(BaseModel):
    """前端跑出來的即時判定。伺服器**不信任**它，只當作送件時的附註（SPEC §8.1 第 5 步）。"""

    model_config = ConfigDict(extra="ignore")

    verdict: str = ""
    findings: list[dict[str, Any]] = Field(default_factory=list)


class ApplicationIn(BaseModel):
    """`application` 欄位（JSON 字串）的內容。"""

    model_config = ConfigDict(extra="forbid")

    scheme_code: str = Field(min_length=1, max_length=40)
    tier_code: str = ""
    payment_channel_code: str = ""
    applicant_name: str = Field(min_length=1, max_length=120)
    phone: str = Field(default="", max_length=40)
    # 完整身分證字號（D36）。`id_last4` 保留相容：舊客戶端只送末四碼時仍然收得下，
    # 末四碼 hash 由 service 自己從這兩個欄位中有值的那個算出來。
    id_number: str = Field(default="", max_length=20)
    id_last4: str = Field(default="", max_length=20)
    email: str = Field(default="", max_length=320)
    tool_name: str = Field(default="", max_length=200)
    tool_id: str | None = None
    purchase_amount: int | None = Field(default=None, ge=0, le=10_000_000)
    purchase_date: date | None = None
    paid_by_proxy: bool = False
    note: str = Field(default="", max_length=2000)
    precheck: PrecheckIn | None = None


class SubmitResultOut(BaseModel):
    case_no: str
    status: str
    verdict: str
    findings: list[FindingOut]


class CreatedOut(SubmitResultOut):
    pass


class VerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_no: str = Field(min_length=1, max_length=40)
    last4: str = Field(min_length=1, max_length=40)


class VerifyOut(BaseModel):
    token: str
    expires_at: datetime
    case_no: str


class SupplementItemOut(BaseModel):
    document_type_code: str | None = None
    rejection_code: str = ""
    note: str = ""


class CaseDocumentOut(BaseModel):
    document_type_code: str
    revision: int
    is_current: bool
    uploaded_at: datetime | None = None
    page_count: int


class CaseEventOut(BaseModel):
    transition_code: str
    from_status: str | None = None
    to_status: str
    actor_type: str
    created_at: datetime | None = None
    rejection_codes: list[str] = Field(default_factory=list)


class CaseSchemeOut(BaseModel):
    code: str
    name: str


class CasePublicOut(BaseModel):
    """市民看到的案件（契約 §CasePublic）。沒有姓名、電話、也沒有承辦人資訊。"""

    case_no: str
    scheme: CaseSchemeOut
    status: str
    # 文案 key 而不是句子（CLAUDE.md 規則 4）：狀態的市民用語與「現在換你做什麼」都
    # 存在 `contents`。key 留著（前端要嘛自己 overlay、要嘛拿去查 `GET /api/contents`），
    # 旁邊再附一份伺服器已經渲染好的字，讓第一次繪製就不必再多一次往返。
    public_label_key: str | None = None
    next_action: str | None = None
    public_label: str | None = None
    next_action_text: str | None = None
    first_submitted_at: datetime | None = None
    last_submitted_at: datetime | None = None
    revision_count: int
    supplement_items: list[SupplementItemOut] = Field(default_factory=list)
    supplement_deadline: datetime | None = None
    payment_date: datetime | None = None
    tool_name: str = ""
    purchase_amount: int | None = None
    documents: list[CaseDocumentOut] = Field(default_factory=list)
    events: list[CaseEventOut] = Field(default_factory=list)
    can_supplement: bool = False
    can_withdraw: bool = False


class WithdrawOut(BaseModel):
    status: str


class FaqOut(BaseModel):
    id: str
    category: str = ""
    question: str
    answer: str = ""
    priority: int = 0
