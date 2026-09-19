"""`/api/admin` 方案與案件端點的請求／回應模型。

放在 router 旁邊而不是 `app/schemas.py`，是因為它們只服務這兩支 router，而且是
宣告而不是邏輯——薄殼的規則管的是判斷，不是型別。
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "ApplicationDetailOut",
    "ApplicationOut",
    "ChildIn",
    "DocumentOut",
    "EventOut",
    "FindingOut",
    "QueueOut",
    "SchemeIn",
    "SchemeOut",
    "SchemePatch",
    "SupplementItemIn",
    "TransitionIn",
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
    updated_at: datetime | None = None


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


class DocumentOut(BaseModel):
    id: str
    document_type_code: str
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


class EventOut(BaseModel):
    id: str
    from_status: str | None
    to_status: str
    transition_code: str
    actor_type: str
    actor_id: str | None
    reason: str
    rejection_codes: list[str]
    payload: dict[str, Any]
    created_at: datetime | None = None


class FindingOut(BaseModel):
    id: str
    rule_id: str | None
    rule_code: str
    document_id: str | None
    status: str
    extracted_value: str
    expected_value: str
    confidence: float
    source: str
    note: str
    decided_at: datetime | None = None


class ApplicationOut(BaseModel):
    """佇列列。姓名遮蔽、電話只到末四碼——承辦人要看全名請開案件頁。"""

    case_no: str
    scheme_id: str
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
    version: int


class ApplicationDetailOut(ApplicationOut):
    applicant_name: str
    email: str
    phone_masked: str
    purchase_date: date | None
    paid_by_proxy: bool
    note: str
    approved_amount: int | None
    payment_date: datetime | None
    payment_amount: int | None
    documents_purge_at: datetime | None
    supplement_items: list[dict[str, Any]]
    required_document_types: list[str]
    available_transitions: list[dict[str, Any]]
    documents: list[DocumentOut]
    events: list[EventOut]
    findings: list[FindingOut]


class QueueOut(BaseModel):
    total: int
    items: list[ApplicationOut]
