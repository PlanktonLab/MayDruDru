"""`/api/admin` 方案與案件端點的請求／回應模型。

放在 router 旁邊而不是 `app/schemas.py`，是因為它們只服務這兩支 router，而且是
宣告而不是邏輯——薄殼的規則管的是判斷，不是型別。
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "ApplicationDetailOut",
    "ApplicationOut",
    "AssignIn",
    "AssignOut",
    "ChildIn",
    "DocumentOut",
    "DocumentTypeSettingOut",
    "DocumentUrlOut",
    "EvaluateOut",
    "EventOut",
    "FindingOut",
    "FindingOverrideIn",
    "FindingsOut",
    "OcrIn",
    "PaymentChannelSettingOut",
    "QueueOut",
    "RejectionCodeSettingOut",
    "ReorderIn",
    "ReviewerOut",
    "RuleEvaluateIn",
    "RuleEvaluateOut",
    "SchemeIn",
    "SchemeOut",
    "SchemePatch",
    "SchemeSettingsOut",
    "StaffOut",
    "SupplementItemIn",
    "TierSettingOut",
    "ToolResolveIn",
    "TransitionIn",
    "TransitionResultOut",
]


class SchemeIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    category: str = ""
    description: str = ""
    eligibility: str = ""
    age_min: int | None = Field(default=None, ge=0, le=120)
    age_max: int | None = Field(default=None, ge=0, le=120)
    application_start: date | None = None
    application_end: date | None = None
    official_url: str = ""
    contact: str = ""
    amount_note: str = ""
    tags: list[str] = Field(default_factory=list, max_length=30)
    identity_tags: list[str] = Field(default_factory=list, max_length=30)
    details: list[dict[str, Any]] = Field(default_factory=list)
    active: bool = True
    retention_days: int = Field(default=90, ge=1, le=3650)
    supplement_days: int = Field(default=14, ge=1, le=365)
    max_revisions: int = Field(default=3, ge=0, le=20)
    application_method: str = ""
    required_documents: list[str] = Field(default_factory=list, max_length=30)
    student_requirement: str = "any"
    employment_requirement: str = "any"
    residency_requirement: str = ""
    image_url: str = ""


class SchemePatch(BaseModel):
    """PATCH：只送要改的欄位。`expected_version` 是樂觀鎖，不送等於放棄檢查。"""

    model_config = ConfigDict(extra="forbid")

    expected_version: int | None = None
    name: str | None = None
    category: str | None = None
    description: str | None = None
    eligibility: str | None = None
    age_min: int | None = None
    age_max: int | None = None
    application_start: date | None = None
    application_end: date | None = None
    official_url: str | None = None
    contact: str | None = None
    amount_note: str | None = None
    tags: list[str] | None = None
    identity_tags: list[str] | None = None
    details: list[dict[str, Any]] | None = None
    active: bool | None = None
    retention_days: int | None = Field(default=None, ge=1, le=3650)
    supplement_days: int | None = Field(default=None, ge=1, le=365)
    max_revisions: int | None = Field(default=None, ge=0, le=20)
    application_method: str | None = None
    required_documents: list[str] | None = None
    student_requirement: str | None = None
    employment_requirement: str | None = None
    residency_requirement: str | None = None
    image_url: str | None = None


class ChildIn(BaseModel):
    """子設定表（級距、文件類型、繳費管道、規則、退件碼、工具、SOP 對照）的通用載體。

    欄位集合每張表都不一樣，而且方案管理頁本來就是照 schema 產表單，所以這裡收
    自由欄位，由 `services/scheme.py` 決定哪些套得進去。
    """

    model_config = ConfigDict(extra="allow")

    expected_version: int | None = None


class ReorderIn(BaseModel):
    """把整個分頁重新排序：送上新的 id 順序，伺服器把 `sort_order` 重寫成 0、1、2…。"""

    ids: list[str] = Field(default_factory=list, max_length=200)


class ToolResolveIn(BaseModel):
    """處理一筆待審工具。`merge_into_id` 有值時 `status` 不生效——併入就是併入。"""

    status: Literal["APPROVED", "REJECTED", "PENDING"] = "APPROVED"
    verdict_note: str = Field(default="", max_length=500)
    merge_into_id: str | None = None


class RuleEvaluateIn(BaseModel):
    """規則試算的輸入：一組（可選的）規則、幾份 OCR 結果、申請書上的事實。

    `rules` 省略時用方案目前存著的那一份；規則編輯器在存檔前試算時會把編輯中的
    版本送上來，所以這裡收的是完整的規則物件而不是 code。
    """

    rules: list[dict[str, Any]] | None = None
    documents: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    facts: dict[str, Any] = Field(default_factory=dict)


class RuleEvaluateOut(BaseModel):
    verdict: str
    findings: list[dict[str, Any]] = Field(default_factory=list)
    blocking: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    suggested_supplement: list[str] = Field(default_factory=list)


class SchemeOut(BaseModel):
    id: str
    code: str
    name: str
    category: str
    active: bool
    version: int
    retention_days: int
    supplement_days: int
    max_revisions: int
    application_start: date | None = None
    application_end: date | None = None
    updated_at: datetime | None = None


class TierSettingOut(BaseModel):
    code: str
    label: str = ""
    subsidy_rate: float = 0.0
    cap_amount: int = 0
    required_proof_doc_types: list[str] = Field(default_factory=list)
    sort_order: int = 0


class DocumentTypeSettingOut(BaseModel):
    code: str
    label: str = ""
    hint: str = ""
    required: bool = False
    required_when: str = ""
    must_mask: bool = False
    keep_visible: str = ""
    keep_after_disbursed: bool = False
    accepted_mime: list[str] = Field(default_factory=list)
    max_pages: int = 5
    sort_order: int = 0


class PaymentChannelSettingOut(BaseModel):
    code: str
    label: str = ""
    hint: str = ""
    required_document_type_codes: list[str] = Field(default_factory=list)
    guide_content_key: str = ""
    sort_order: int = 0


class RejectionCodeSettingOut(BaseModel):
    """退件碼的後台形狀：比公開檢視多一個 `staff_label`。

    承辦人在決策列上選的是機關內部的說法，市民收到的是 `public_what_wrong` 與
    `public_how_to_fix`——同一份清單，兩段不同的字。
    """

    code: str
    staff_label: str = ""
    public_what_wrong: str = ""
    public_how_to_fix: str = ""
    related_document_type_codes: list[str] = Field(default_factory=list)
    related_sop_flow_ids: list[str] = Field(default_factory=list)


class SchemeSettingsOut(BaseModel):
    """案件頁組表單要的方案設定（`GET /api/admin/schemes/{code}/settings`）。

    也直接內嵌在 `ApplicationDetailOut.scheme_settings`：案件頁開一次就夠，不用為了
    一份退件碼清單再打一支 API。
    """

    code: str
    name: str = ""
    supplement_days: int = 14
    max_revisions: int = 3
    retention_days: int = 90
    tiers: list[TierSettingOut] = Field(default_factory=list)
    document_types: list[DocumentTypeSettingOut] = Field(default_factory=list)
    payment_channels: list[PaymentChannelSettingOut] = Field(default_factory=list)
    rejection_codes: list[RejectionCodeSettingOut] = Field(default_factory=list)


class StaffOut(BaseModel):
    """`GET /api/admin/reviewers` 的一列：可以被指派案件的人。"""

    id: str
    name: str = ""
    email: str = ""
    role: str = ""


class SupplementItemIn(BaseModel):
    document_type_code: str | None = None
    rejection_code: str = "OTHER"
    note: str = ""


class TransitionIn(BaseModel):
    code: str = Field(min_length=2, max_length=10)
    reason: str = ""
    rejection_codes: list[str] = Field(default_factory=list)
    supplement_items: list[SupplementItemIn] = Field(default_factory=list)
    supplement_deadline: datetime | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class OcrLineOut(BaseModel):
    text: str = ""
    confidence: float | None = None
    bbox: dict[str, float] | None = None
    words: list[dict[str, Any]] = Field(default_factory=list)


class OcrOut(BaseModel):
    source: str
    engine: str = ""
    confidence: float = 0.0
    lines: list[dict[str, Any]] = Field(default_factory=list)


class DocumentOut(BaseModel):
    id: str
    document_type_code: str
    document_type_label: str = ""
    revision: int
    is_current: bool
    supersedes_id: str | None = None
    mime: str
    size: int
    page_count: int
    masked: bool
    preview_key: str | None = None
    uploaded_at: datetime | None = None
    purged_at: datetime | None = None
    ocr: OcrOut | None = None


class DocumentUrlOut(BaseModel):
    """private bucket 的短效連結（SPEC §11：5 分鐘）。"""

    url: str
    expires_at: datetime


class OcrIn(BaseModel):
    """承辦人在自己的瀏覽器重新辨識的結果（`source=reviewer`，SPEC §8.2）。"""

    ocr: dict[str, Any] = Field(default_factory=dict)


class FindingOverrideIn(BaseModel):
    """人工覆寫：另寫一列 `source=reviewer`，舊的留著（SPEC §8.3）。"""

    model_config = ConfigDict(extra="forbid")

    status: str = Field(pattern="^(MATCH|MISMATCH|UNREADABLE|PENDING)$")
    extracted_value: str | None = None
    note: str | None = None


class ReviewerOut(BaseModel):
    id: str
    name: str = ""


class AssignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reviewer_id: str | None = None


class AssignOut(BaseModel):
    assigned_reviewer: ReviewerOut | None = None


class EventOut(BaseModel):
    id: str
    from_status: str | None
    to_status: str
    transition_code: str
    actor_type: str
    actor_id: str | None
    # STAFF 才有名字；APPLICANT 與 SYSTEM 一律 null——時間軸上寫「由系統」是前端的事，
    # 這裡不替不存在的人編一個名字出來。
    actor_name: str | None = None
    reason: str
    rejection_codes: list[str]
    payload: dict[str, Any]
    created_at: datetime | None = None


class FindingOut(BaseModel):
    """契約 §Finding + 案件頁需要的落地欄位。

    `superseded=True` 代表這一列已經被同一條規則更新的判定取代，只留在歷史裡。
    """

    id: str
    rule_id: str | None = None
    rule_code: str
    document_id: str | None = None
    status: str
    extracted_value: str | None = None
    expected_value: str | None = None
    confidence: float | None = None
    bbox: dict[str, float] | None = None
    document_type_code: str | None = None
    note: str | None = None
    # `note` 是 `review.note.*` 的文案 key；`note_text` 是它在 `contents` 裡的字。
    note_text: str | None = None
    suggested_supplement: list[str] | None = None
    source: str
    reviewer: ReviewerOut | None = None
    decided_at: datetime | None = None
    superseded: bool = False


class FindingsOut(BaseModel):
    findings: list[FindingOut]


class EvaluateOut(BaseModel):
    findings: list[FindingOut]
    verdict: str


class BlockerOut(BaseModel):
    rule_code: str
    label: str = ""
    status: str = "PENDING"


class AllowedTransitionOut(BaseModel):
    code: str
    label: str = ""
    to_status: str = ""
    needs_reason: bool = False
    needs_rejection_codes: bool = False
    needs_supplement_items: bool = False


class TransitionResultOut(BaseModel):
    status: str
    events: list[EventOut]


class ApplicationOut(BaseModel):
    """佇列列（契約 §QueueRow）。姓名遮蔽、電話只到末四碼——要看全名請開案件頁。"""

    case_no: str
    scheme_id: str
    scheme_code: str = ""
    scheme_name: str = ""
    status: str
    tier_code: str
    payment_channel_code: str
    intake_channel: str
    applicant_name_masked: str
    tool_name: str
    purchase_amount: int | None
    revision_count: int
    first_submitted_at: datetime | None
    last_submitted_at: datetime | None
    supplement_deadline: datetime | None
    assigned_reviewer_id: str | None
    assigned_reviewer: ReviewerOut | None = None
    verdict: str | None = None
    version: int


class ApplicationDetailOut(ApplicationOut):
    """案件頁（契約 §CaseDetail）。"""

    applicant_name: str
    email: str
    phone_masked: str
    id_last4_masked: str = ""
    purchase_date: date | None
    paid_by_proxy: bool
    note: str
    approved_amount: int | None
    payment_date: datetime | None
    payment_amount: int | None
    documents_purge_at: datetime | None
    supplement_items: list[dict[str, Any]]
    required_document_types: list[str]
    # 案件頁的補件／退件表單要照方案設定長出來，所以設定跟著案件一起給——
    # 否則每開一件案子就得多打一支 `/api/admin/schemes/{code}/settings`。
    scheme_settings: SchemeSettingsOut
    allowed_transitions: list[AllowedTransitionOut]
    approval_blockers: list[BlockerOut]
    rules: list[dict[str, Any]]
    documents: list[DocumentOut]
    events: list[EventOut]
    findings: list[FindingOut]


class QueueOut(BaseModel):
    total: int
    items: list[ApplicationOut]
