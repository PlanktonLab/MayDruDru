"""申請與審核資料表（SPEC §6.3）。

狀態只能由 `services/application.py::transition()` 改變（CLAUDE.md 規則 5）；
`application_status_events` 是不可變的稽核軌跡——Postgres 用 trigger 擋
UPDATE/DELETE（alembic 0013），這裡再掛一組 SQLAlchemy event listener，讓同一條
規則在 aiosqlite 測試環境也成立（決策 D15）。

申請人個資只以兩種形式落地：完整手機號 Fernet 加密（推播綁定用），以及手機／身分證
末四碼的加鹽 hash（查詢驗證用）。兩者的工具都在 `app/pii.py`（SPEC §11）。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.orm import Mapped, Mapper, mapped_column, relationship

from .base import Base, TsMixin, VersionMixin, new_id, now

__all__ = [
    "ACTOR_TYPES",
    "FINDING_STATUSES",
    "INTAKE_CHANNELS",
    "OPEN_STATUSES",
    "STATUSES",
    "TERMINAL_STATUSES",
    "Application",
    "ApplicationDocument",
    "ApplicationStatusEvent",
    "CaseNoCounter",
    "CaseVerification",
    "DocumentOcrResult",
    "ImmutableEventError",
    "ReviewFinding",
]

STATUSES = (
    "SUBMITTED",
    "UNDER_REVIEW",
    "NEEDS_REVISION",
    "REVISION_SUBMITTED",
    "APPROVED",
    "DISBURSING",
    "DISBURSED",
    "REJECTED",
    "WITHDRAWN",
    "CANCELLED_BY_STAFF",
    "EXPIRED",
)
TERMINAL_STATUSES = frozenset({"DISBURSED", "REJECTED", "WITHDRAWN", "CANCELLED_BY_STAFF", "EXPIRED"})
OPEN_STATUSES = tuple(s for s in STATUSES if s not in TERMINAL_STATUSES)
# WEB：apply-web 送件。PAPER：承辦人代為建檔。LEGACY：自 youth-line-bot 搬遷（決策 D13）。
INTAKE_CHANNELS = ("WEB", "PAPER", "LEGACY")
ACTOR_TYPES = ("APPLICANT", "STAFF", "SYSTEM")
FINDING_STATUSES = ("PENDING", "MATCH", "MISMATCH", "UNREADABLE")


class Application(TsMixin, VersionMixin, Base):
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("tenant_id", "case_no", name="uq_application_case_no"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    case_no: Mapped[str] = mapped_column(String(40), index=True)
    scheme_id: Mapped[str] = mapped_column(ForeignKey("schemes.id", ondelete="RESTRICT"), index=True)
    tier_code: Mapped[str] = mapped_column(String(40), default="")
    payment_channel_code: Mapped[str] = mapped_column(String(40), default="")
    intake_channel: Mapped[str] = mapped_column(String(20), default="WEB")

    applicant_name: Mapped[str] = mapped_column(String(120), default="")
    phone_encrypted: Mapped[str] = mapped_column(Text, default="")      # Fernet(PII_ENCRYPTION_KEY)
    phone_last4_hash: Mapped[str] = mapped_column(String(64), default="", index=True)
    id_last4_hash: Mapped[str] = mapped_column(String(64), default="")
    # 完整身分證字號：Fernet 密文（D36）。解密受 `application.read_pii` 控管並寫稽核。
    id_number_encrypted: Mapped[str] = mapped_column(Text, default="")
    email: Mapped[str] = mapped_column(String(320), default="")

    tool_name: Mapped[str] = mapped_column(String(200), default="")
    tool_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    billing_cycle: Mapped[str] = mapped_column(String(10), default="MONTHLY")
    billing_periods: Mapped[int] = mapped_column(Integer, default=1)
    original_currency: Mapped[str] = mapped_column(String(3), default="TWD")
    original_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    purchase_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    paid_by_proxy: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(Text, default="")

    status: Mapped[str] = mapped_column(String(30), default="SUBMITTED", index=True)
    first_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revision_count: Mapped[int] = mapped_column(Integer, default=0)
    supplement_items: Mapped[list] = mapped_column(JSON, default=list)
    supplement_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    approved_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payment_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payment_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)

    documents_purge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    documents_purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_reviewer_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    documents: Mapped[list[ApplicationDocument]] = relationship(
        back_populates="application", cascade="all, delete-orphan", order_by="ApplicationDocument.uploaded_at"
    )
    # 事件不走 ORM 級聯刪除：它們不可變，連 orphan 清理都不該對它們下 DELETE。
    # 真的刪掉一筆申請時由資料庫的 ON DELETE CASCADE 處理。
    events: Mapped[list[ApplicationStatusEvent]] = relationship(
        back_populates="application", cascade="save-update, merge", passive_deletes=True,
        order_by="ApplicationStatusEvent.created_at",
    )
    findings: Mapped[list[ReviewFinding]] = relationship(back_populates="application", cascade="all, delete-orphan")
    verifications: Mapped[list[CaseVerification]] = relationship(back_populates="application", cascade="all, delete-orphan")

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES


class ApplicationDocument(TsMixin, Base):
    __tablename__ = "application_documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    document_type_code: Mapped[str] = mapped_column(String(40), index=True)
    period_index: Mapped[int] = mapped_column(Integer, default=1)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    supersedes_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    object_key: Mapped[str] = mapped_column(String(300), default="")   # private bucket
    mime: Mapped[str] = mapped_column(String(80), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    page_count: Mapped[int] = mapped_column(Integer, default=1)
    preview_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    masked: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    application: Mapped[Application] = relationship(back_populates="documents")
    ocr_results: Mapped[list[DocumentOcrResult]] = relationship(back_populates="document", cascade="all, delete-orphan")


class DocumentOcrResult(Base):
    """瀏覽器端辨識出來的文字。`source=applicant` 的結果一律視為不可信，
    伺服器端規則引擎會重跑（SPEC §11）。"""

    __tablename__ = "document_ocr_results"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("application_documents.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(20), default="applicant")  # applicant | reviewer
    engine: Mapped[str] = mapped_column(String(40), default="")
    lang: Mapped[str] = mapped_column(String(40), default="")
    text: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    lines: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    document: Mapped[ApplicationDocument] = relationship(back_populates="ocr_results")


class ReviewFinding(TsMixin, Base):
    __tablename__ = "review_findings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    rule_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    rule_code: Mapped[str] = mapped_column(String(40), default="", index=True)
    document_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    extracted_value: Mapped[str] = mapped_column(Text, default="")
    expected_value: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    bbox: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # purge 時清空
    source: Mapped[str] = mapped_column(String(20), default="auto")  # auto | reviewer
    note: Mapped[str] = mapped_column(Text, default="")
    reviewer_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    application: Mapped[Application] = relationship(back_populates="findings")


class ApplicationStatusEvent(Base):
    """不可變的狀態轉移紀錄（SPEC §7）。只寫入，永不修改或刪除。"""

    __tablename__ = "application_status_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    to_status: Mapped[str] = mapped_column(String(30))
    transition_code: Mapped[str] = mapped_column(String(10))
    actor_type: Mapped[str] = mapped_column(String(20), default="SYSTEM")
    actor_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    rejection_codes: Mapped[list] = mapped_column(JSON, default=list)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)

    application: Mapped[Application] = relationship(back_populates="events")


class CaseVerification(TsMixin, Base):
    """LINE 使用者與案件的綁定（取代 youth-line-bot 的 `user_cases`）。"""

    __tablename__ = "case_verifications"
    __table_args__ = (UniqueConstraint("application_id", "line_user_id", name="uq_case_verification"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    line_user_id: Mapped[str] = mapped_column(String(64), index=True)
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    method: Mapped[str] = mapped_column(String(20), default="line")

    application: Mapped[Application] = relationship(back_populates="verifications")


class CaseNoCounter(Base):
    """案件編號流水號（決策 D16）：每個 tenant、每個年度一列。

    Postgres 以 `SELECT … FOR UPDATE` 取號；SQLite 沒有列鎖，但同一個 session
    本來就是序列化的，測試拿得到一樣的結果。
    """

    __tablename__ = "case_no_counters"
    __table_args__ = (UniqueConstraint("tenant_id", "year", name="uq_case_no_counter"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    year: Mapped[int] = mapped_column(Integer)
    next_seq: Mapped[int] = mapped_column(Integer, default=1)


class ImmutableEventError(RuntimeError):
    """`application_status_events` 被嘗試修改或刪除時丟出。"""


IMMUTABLE_EVENT_MESSAGE = "application_status_events 不可變更或刪除"


def _refuse_event_write(mapper: Mapper, connection: object, target: object) -> None:
    raise ImmutableEventError(IMMUTABLE_EVENT_MESSAGE)


event.listen(ApplicationStatusEvent, "before_update", _refuse_event_write, propagate=True)
event.listen(ApplicationStatusEvent, "before_delete", _refuse_event_write, propagate=True)
