"""資料表總表（SPEC §6）。

拆成四個模組只是為了好讀；`from app.models import X` 的介面和以前一樣，
alembic 的 `target_metadata` 也還是掃得到每一張表。

- `core`：SOP 製作（自 SOP_Tutor 沿用，§6.1）
- `scheme`：方案設定（§6.2）
- `application`：申請與審核（§6.3）
- `content`：內容、LINE、通知、稽核（§6.4）
"""

from __future__ import annotations

from .application import (
    ACTOR_TYPES,
    FINDING_STATUSES,
    INTAKE_CHANNELS,
    OPEN_STATUSES,
    STATUSES,
    TERMINAL_STATUSES,
    Application,
    ApplicationDocument,
    ApplicationStatusEvent,
    CaseNoCounter,
    CaseVerification,
    DocumentOcrResult,
    ImmutableEventError,
    ReviewFinding,
)
from .base import EMBED_DIM, Base, TsMixin, VersionMixin, new_id, now
from .content import (
    CONTENT_TYPES,
    NOTIFICATION_STATUSES,
    SUGGESTION_STATUSES,
    AuditLog,
    Content,
    CopilotSuggestion,
    Faq,
    KnowledgeDocument,
    LineConversation,
    LineFeedback,
    LineRichMenu,
    LineSyncLog,
    LineUser,
    Media,
    Notification,
    UnmatchedMessage,
    WebhookDelivery,
    WebhookSubscription,
)
from .core import (
    API_SCOPES,
    COMPONENT_KINDS,
    JOB_OWNED_STATUSES,
    ROLES,
    ApiKey,
    Edge,
    EvalCase,
    EvalRun,
    EventLog,
    Flow,
    FlowVersion,
    Goal,
    LlmUsage,
    Platform,
    PlatformComponent,
    Step,
    StyleDoc,
    StyleDocVersion,
    Tenant,
    User,
    Variant,
)
from .scheme import (
    DOCUMENT_REQUIRED_WHEN,
    PAYMENT_CHANNEL_CODES,
    RULE_TYPES,
    TOOL_STATUSES,
    DocumentType,
    DocumentTypeSopFlow,
    EligibleTool,
    PaymentChannel,
    RejectionCode,
    ReviewRule,
    Scheme,
    SchemeTier,
)

__all__ = [
    # base
    "EMBED_DIM", "Base", "TsMixin", "VersionMixin", "new_id", "now",
    # core (§6.1)
    "ROLES", "COMPONENT_KINDS", "JOB_OWNED_STATUSES",
    "API_SCOPES", "ApiKey", "Edge", "EvalCase", "EvalRun", "EventLog", "Flow", "FlowVersion", "Goal",
    "LlmUsage", "Platform", "PlatformComponent", "Step", "StyleDoc", "StyleDocVersion",
    "Tenant", "User", "Variant",
    # scheme (§6.2)
    "DOCUMENT_REQUIRED_WHEN", "PAYMENT_CHANNEL_CODES", "RULE_TYPES", "TOOL_STATUSES",
    "DocumentType", "DocumentTypeSopFlow", "EligibleTool", "PaymentChannel",
    "RejectionCode", "ReviewRule", "Scheme", "SchemeTier",
    # application (§6.3)
    "ACTOR_TYPES", "FINDING_STATUSES", "INTAKE_CHANNELS", "OPEN_STATUSES", "STATUSES",
    "TERMINAL_STATUSES", "Application", "ApplicationDocument", "ApplicationStatusEvent",
    "CaseNoCounter", "CaseVerification", "DocumentOcrResult", "ImmutableEventError",
    "ReviewFinding",
    # content (§6.4)
    "CONTENT_TYPES", "NOTIFICATION_STATUSES", "SUGGESTION_STATUSES",
    "AuditLog", "Content", "CopilotSuggestion", "Faq",
    "KnowledgeDocument", "LineConversation", "LineFeedback", "LineRichMenu", "LineSyncLog", "LineUser",
    "Media", "Notification", "UnmatchedMessage", "WebhookDelivery", "WebhookSubscription",
]
