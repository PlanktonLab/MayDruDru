"""方案設定資料表（SPEC §6.2）。

一個「方案」把機關的一項補助整個資料化：級距、文件類型、繳費管道、審核規則、
退件碼、合格工具，以及文件與 SOP flow 的對照。新增一個方案不需要改任何程式碼
（SPEC 決策 D6），所以這裡的每一張子表都是純設定，沒有任何硬編的業務判斷。

清單欄位一律用 JSON 而不是 Postgres ARRAY，測試才能在 aiosqlite 上跑（決策 D15）。
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TsMixin, VersionMixin, new_id

__all__ = [
    "DOCUMENT_REQUIRED_WHEN",
    "PAYMENT_CHANNEL_CODES",
    "RULE_TYPES",
    "TOOL_STATUSES",
    "DocumentType",
    "DocumentTypeSopFlow",
    "EligibleTool",
    "PaymentChannel",
    "RejectionCode",
    "ReviewRule",
    "Scheme",
    "SchemeTier",
]

# SPEC §8.3 的四種規則型別；`services/review.py` 在 P3 依這個值分派。
RULE_TYPES = ("keyword_extract", "regex_extract", "amount_tolerance", "required_doc")
PAYMENT_CHANNEL_CODES = ("CREDIT_CARD", "TELECOM", "E_PAYMENT", "OTHER")
TOOL_STATUSES = ("APPROVED", "PENDING", "REJECTED")
# `required=False` 的文件什麼時候才變必要：空字串＝只看繳費管道／級距，
# `proxy`＝由他人代付時才要（submit-flow 的 PROXY_AFFIDAVIT）。
DOCUMENT_REQUIRED_WHEN = ("", "proxy")


class Scheme(TsMixin, VersionMixin, Base):
    __tablename__ = "schemes"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_scheme_tenant_code"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(40), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    eligibility: Mapped[str] = mapped_column(Text, default="")
    age_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    age_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    application_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    application_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    official_url: Mapped[str] = mapped_column(String(500), default="")
    contact: Mapped[str] = mapped_column(String(300), default="")
    amount_note: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    identity_tags: Mapped[list] = mapped_column(JSON, default=list)
    details: Mapped[list] = mapped_column(JSON, default=list)  # [{label, value}]
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    retention_days: Mapped[int] = mapped_column(Integer, default=90)     # 終態後幾天硬刪文件（SPEC §7 / D11）
    supplement_days: Mapped[int] = mapped_column(Integer, default=14)    # 補件期限預設天數
    max_revisions: Mapped[int] = mapped_column(Integer, default=3)       # 最多退件補正幾次

    # 次要欄位：youth-line-bot 的方案卡與資格比對用得到，搬遷時原樣帶過來。
    application_method: Mapped[str] = mapped_column(Text, default="")
    required_documents: Mapped[list] = mapped_column(JSON, default=list)  # 給民眾看的文字清單
    student_requirement: Mapped[str] = mapped_column(String(20), default="any")     # required | excluded | any
    employment_requirement: Mapped[str] = mapped_column(String(20), default="any")  # employed | unemployed | any
    residency_requirement: Mapped[str] = mapped_column(String(80), default="")
    image_url: Mapped[str] = mapped_column(String(500), default="")

    tiers: Mapped[list[SchemeTier]] = relationship(back_populates="scheme", cascade="all, delete-orphan", lazy="selectin")
    document_types: Mapped[list[DocumentType]] = relationship(back_populates="scheme", cascade="all, delete-orphan", lazy="selectin")
    payment_channels: Mapped[list[PaymentChannel]] = relationship(back_populates="scheme", cascade="all, delete-orphan", lazy="selectin")
    review_rules: Mapped[list[ReviewRule]] = relationship(back_populates="scheme", cascade="all, delete-orphan", lazy="selectin")
    rejection_codes: Mapped[list[RejectionCode]] = relationship(back_populates="scheme", cascade="all, delete-orphan", lazy="selectin")
    eligible_tools: Mapped[list[EligibleTool]] = relationship(back_populates="scheme", cascade="all, delete-orphan", lazy="selectin")


class SchemeTier(TsMixin, VersionMixin, Base):
    __tablename__ = "scheme_tiers"
    __table_args__ = (UniqueConstraint("scheme_id", "code", name="uq_scheme_tier_code"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    scheme_id: Mapped[str] = mapped_column(ForeignKey("schemes.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))          # GENERAL / LOW_INCOME …
    label: Mapped[str] = mapped_column(String(120), default="")
    subsidy_rate: Mapped[float] = mapped_column(Float, default=0.0)
    cap_amount: Mapped[int] = mapped_column(Integer, default=0)
    required_proof_doc_types: Mapped[list] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    scheme: Mapped[Scheme] = relationship(back_populates="tiers")


class DocumentType(TsMixin, VersionMixin, Base):
    __tablename__ = "document_types"
    __table_args__ = (UniqueConstraint("scheme_id", "code", name="uq_document_type_code"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    scheme_id: Mapped[str] = mapped_column(ForeignKey("schemes.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(120), default="")
    hint: Mapped[str] = mapped_column(Text, default="")
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    required_when: Mapped[str] = mapped_column(String(20), default="")
    must_mask: Mapped[bool] = mapped_column(Boolean, default=False)
    # 遮罩時必須留下可辨識的欄位（submit-flow DOC_META.keep），給遮罩編輯器與退件說明用。
    keep_visible: Mapped[str] = mapped_column(Text, default="")
    keep_after_disbursed: Mapped[bool] = mapped_column(Boolean, default=False)  # True 則不隨 purge 刪除
    accepted_mime: Mapped[list] = mapped_column(JSON, default=list)
    max_pages: Mapped[int] = mapped_column(Integer, default=5)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    scheme: Mapped[Scheme] = relationship(back_populates="document_types")
    sop_flows: Mapped[list[DocumentTypeSopFlow]] = relationship(back_populates="document_type", cascade="all, delete-orphan")


class PaymentChannel(TsMixin, VersionMixin, Base):
    __tablename__ = "payment_channels"
    __table_args__ = (UniqueConstraint("scheme_id", "code", name="uq_payment_channel_code"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    scheme_id: Mapped[str] = mapped_column(ForeignKey("schemes.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(120), default="")
    hint: Mapped[str] = mapped_column(Text, default="")
    required_document_type_codes: Mapped[list] = mapped_column(JSON, default=list)
    guide_content_key: Mapped[str] = mapped_column(String(120), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    scheme: Mapped[Scheme] = relationship(back_populates="payment_channels")


class ReviewRule(TsMixin, VersionMixin, Base):
    __tablename__ = "review_rules"
    __table_args__ = (UniqueConstraint("scheme_id", "code", name="uq_review_rule_code"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    scheme_id: Mapped[str] = mapped_column(ForeignKey("schemes.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(200), default="")
    document_type_code: Mapped[str] = mapped_column(String(40), default="")
    rule_type: Mapped[str] = mapped_column(String(30))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    required: Mapped[bool] = mapped_column(Boolean, default=True)  # T3 的前置條件只看 required 規則
    severity: Mapped[str] = mapped_column(String(20), default="error")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    scheme: Mapped[Scheme] = relationship(back_populates="review_rules")


class RejectionCode(TsMixin, VersionMixin, Base):
    __tablename__ = "rejection_codes"
    __table_args__ = (UniqueConstraint("scheme_id", "code", name="uq_rejection_code"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    scheme_id: Mapped[str] = mapped_column(ForeignKey("schemes.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    staff_label: Mapped[str] = mapped_column(String(200), default="")
    public_what_wrong: Mapped[str] = mapped_column(Text, default="")
    public_how_to_fix: Mapped[str] = mapped_column(Text, default="")
    related_document_type_codes: Mapped[list] = mapped_column(JSON, default=list)
    related_sop_flow_ids: Mapped[list] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    scheme: Mapped[Scheme] = relationship(back_populates="rejection_codes")


class DocumentTypeSopFlow(TsMixin, Base):
    """同一份文件在不同平台有不同的 SOP flow（SPEC §8.5）。"""

    __tablename__ = "document_type_sop_flows"
    __table_args__ = (
        UniqueConstraint("document_type_id", "flow_id", "platform_id", name="uq_document_type_sop_flow"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    document_type_id: Mapped[str] = mapped_column(ForeignKey("document_types.id", ondelete="CASCADE"), index=True)
    flow_id: Mapped[str] = mapped_column(ForeignKey("flows.id", ondelete="CASCADE"), index=True)
    platform_id: Mapped[str] = mapped_column(ForeignKey("platforms.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    document_type: Mapped[DocumentType] = relationship(back_populates="sop_flows")


class EligibleTool(TsMixin, VersionMixin, Base):
    """可申請的工具與待審工具（submit-flow 的 tools / pendingTools）。"""

    __tablename__ = "eligible_tools"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    scheme_id: Mapped[str] = mapped_column(ForeignKey("schemes.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    vendor: Mapped[str] = mapped_column(String(200), default="")
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    verdict_note: Mapped[str] = mapped_column(Text, default="")
    request_count: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    scheme: Mapped[Scheme] = relationship(back_populates="eligible_tools")
