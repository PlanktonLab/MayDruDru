"""內容、LINE、通知與稽核資料表（SPEC §6.4）。

所有給市民看的文字都住在 `contents`；程式碼裡不得硬編（CLAUDE.md 規則 4）。P1 只
建表與搬遷，`content.t()` 與 registry 預設值在 P2。
"""

from __future__ import annotations

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import EMBED_DIM, Base, TsMixin, VersionMixin, new_id, now

__all__ = [
    "CONTENT_TYPES",
    "NOTIFICATION_STATUSES",
    "SUGGESTION_STATUSES",
    "AuditLog",
    "Content",
    "CopilotSuggestion",
    "Faq",
    "KnowledgeDocument",
    "LineConversation",
    "LineFeedback",
    "LineRichMenu",
    "LineSyncLog",
    "LineUser",
    "Media",
    "Notification",
    "UnmatchedMessage",
    "WebhookDelivery",
    "WebhookSubscription",
]

CONTENT_TYPES = ("text", "button", "label", "flex")
NOTIFICATION_STATUSES = ("queued", "sent", "failed", "skipped")
SUGGESTION_STATUSES = ("pending", "accepted", "dismissed")


class Content(TsMixin, VersionMixin, Base):
    __tablename__ = "contents"
    __table_args__ = (UniqueConstraint("tenant_id", "key", name="uq_content_tenant_key"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    key: Mapped[str] = mapped_column(String(120), index=True)
    category: Mapped[str] = mapped_column(String(40), default="general", index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")     # 已發布
    draft: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str] = mapped_column(String(20), default="text")
    variables: Mapped[list] = mapped_column(JSON, default=list)
    scheme_id: Mapped[str | None] = mapped_column(ForeignKey("schemes.id", ondelete="CASCADE"), nullable=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[str | None] = mapped_column(String(32), nullable=True)


class Faq(TsMixin, VersionMixin, Base):
    __tablename__ = "faqs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    code: Mapped[str] = mapped_column(String(64), default="", index=True)  # 搬遷用的來源 id，冪等 upsert 靠它
    category: Mapped[str] = mapped_column(String(40), default="", index=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text, default="")
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM), nullable=True)
    scheme_id: Mapped[str | None] = mapped_column(ForeignKey("schemes.id", ondelete="SET NULL"), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | copilot


class KnowledgeDocument(TsMixin, VersionMixin, Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    code: Mapped[str] = mapped_column(String(64), default="", index=True)
    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text, default="")
    source_url: Mapped[str] = mapped_column(String(500), default="")
    source_type: Mapped[str] = mapped_column(String(40), default="manual")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM), nullable=True)
    scheme_id: Mapped[str | None] = mapped_column(ForeignKey("schemes.id", ondelete="SET NULL"), nullable=True, index=True)


class Media(TsMixin, Base):
    __tablename__ = "media"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    key: Mapped[str] = mapped_column(String(300), index=True)
    mime: Mapped[str] = mapped_column(String(80), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    alt: Mapped[str] = mapped_column(String(300), default="")
    uploaded_by: Mapped[str | None] = mapped_column(String(32), nullable=True)


class LineUser(TsMixin, Base):
    __tablename__ = "line_users"
    __table_args__ = (UniqueConstraint("tenant_id", "line_user_id", name="uq_line_user"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    line_user_id: Mapped[str] = mapped_column(String(64), index=True)
    display_name: Mapped[str] = mapped_column(String(200), default="")
    followed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LineConversation(TsMixin, Base):
    """一個 LINE 使用者的對話狀態（SPEC §8.4）。每人一列。"""

    __tablename__ = "line_conversations"
    __table_args__ = (UniqueConstraint("tenant_id", "line_user_id", name="uq_line_conversation"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    line_user_id: Mapped[str] = mapped_column(String(64), index=True)
    flow: Mapped[str] = mapped_column(String(40), default="idle")
    step: Mapped[str] = mapped_column(String(40), default="")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    sop_session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)


class LineFeedback(Base):
    """民眾在 LINE 完成功能後留下的文字回饋。

    LINE user id 只留不可逆雜湊；後台可以看內容與情境，不能反推出帳號。
    """

    __tablename__ = "line_feedback"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    application_id: Mapped[str | None] = mapped_column(
        ForeignKey("applications.id", ondelete="SET NULL"), nullable=True, index=True
    )
    line_user_id_hash: Mapped[str] = mapped_column(String(64), default="")
    context: Mapped[str] = mapped_column(String(40), default="general", index=True)
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class LineRichMenu(TsMixin, Base):
    __tablename__ = "line_rich_menus"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(200))
    layout: Mapped[dict] = mapped_column(JSON, default=dict)
    image_key: Mapped[str] = mapped_column(String(300), default="")
    line_rich_menu_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LineSyncLog(Base):
    __tablename__ = "line_sync_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    resource_type: Mapped[str] = mapped_column(String(40))
    resource_id: Mapped[str] = mapped_column(String(64), default="")
    operation: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    remote_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    actor_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UnmatchedMessage(Base):
    """意圖分類沒命中的自由文字，餵給內容助理 (b)（SPEC §8.6）。LINE userId 只存 hash。"""

    __tablename__ = "unmatched_messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    line_user_id_hash: Mapped[str] = mapped_column(String(64), default="")
    text: Mapped[str] = mapped_column(Text, default="")
    intent_result: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    application_id: Mapped[str | None] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), nullable=True, index=True
    )
    line_user_id: Mapped[str] = mapped_column(String(64), default="")
    kind: Mapped[str] = mapped_column(String(40), default="status_changed")
    content_key: Mapped[str] = mapped_column(String(120), default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WebhookSubscription(TsMixin, Base):
    __tablename__ = "webhook_subscriptions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    api_key_id: Mapped[str | None] = mapped_column(ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=True, index=True)
    url: Mapped[str] = mapped_column(String(500))
    secret: Mapped[str] = mapped_column(String(128), default="")
    events: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    subscription_id: Mapped[str] = mapped_column(
        ForeignKey("webhook_subscriptions.id", ondelete="CASCADE"), index=True
    )
    event: Mapped[str] = mapped_column(String(60), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    """每一次 admin 寫入都留一列（SPEC §11）。`diff` 只放欄位變化，不複製案件內容。"""

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    actor_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    actor_name: Mapped[str] = mapped_column(String(120), default="")
    action: Mapped[str] = mapped_column(String(40), index=True)
    target_type: Mapped[str] = mapped_column(String(40), index=True)
    target_id: Mapped[str] = mapped_column(String(64), default="")
    diff: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class CopilotSuggestion(TsMixin, Base):
    """內容助理產出的建議，等承辦人員採用（SPEC §8.6 b / 決策 D8）。

    存下來是因為「採用」是第二次呼叫：`POST …/faq-suggestions/{id}/accept` 需要一個
    穩定的 id，而重跑一次聚類不保證得到同一批建議。`payload` 是整則建議的 JSON
    （問題、答案草稿、引用、樣本句），`sample_count` 讓後台知道這一群有多少人問過。
    樣本句在寫進來之前就已經去識別化（`services/copilot.py`）。
    """

    __tablename__ = "copilot_suggestions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(30), default="faq", index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    target_id: Mapped[str] = mapped_column(String(32), default="")  # 採用後建出來的 FAQ id


# pgvector HNSW 索引（alembic 0014 只在 Postgres 上建立）。
Index("ix_faqs_embedding", Faq.embedding, postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"})
Index(
    "ix_knowledge_documents_embedding",
    KnowledgeDocument.embedding,
    postgresql_using="hnsw",
    postgresql_ops={"embedding": "vector_cosine_ops"},
)
