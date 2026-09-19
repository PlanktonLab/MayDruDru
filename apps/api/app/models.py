"""SQLAlchemy models for SOP Tutor (see SPEC.md §5)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

EMBED_DIM = 1536


def now() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return uuid.uuid4().hex


class TsMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


# ---------------------------------------------------------------- org & access

class Tenant(TsMixin, Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


ROLES = ("viewer", "reviewer", "editor", "admin", "owner")  # ascending privilege


class User(TsMixin, Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # tokens issued before this moment are rejected (set whenever the password is set)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (UniqueConstraint("tenant_id", "email", name="uq_user_tenant_email"),)


class ApiKey(TsMixin, Base):
    __tablename__ = "api_keys"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    prefix: Mapped[str] = mapped_column(String(12), index=True)
    key_hash: Mapped[str] = mapped_column(String(128), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | disabled
    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=120)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------- content

class Goal(TsMixin, Base):
    __tablename__ = "goals"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    aliases: Mapped[list] = mapped_column(JSON, default=list)


class Platform(TsMixin, Base):
    __tablename__ = "platforms"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    display_name: Mapped[str] = mapped_column(String(160))
    brand: Mapped[str] = mapped_column(String(120))
    channel: Mapped[str] = mapped_column(String(30), default="mobile_app")  # mobile_app | web | desktop
    category: Mapped[str] = mapped_column(String(40), default="")            # free tag, unused by the pipeline
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    # 示範資料 (SPEC §6.5): [{key, label, value, real}] — the persona every replica
    # of this platform shows, so a batch of screenshots reads as one story.
    demo_data: Mapped[list] = mapped_column(JSON, default=list)
    # unused since v0.2 (no platform containers on the canvas); column kept
    canvas_x: Mapped[float] = mapped_column(Float, default=0)
    canvas_y: Mapped[float] = mapped_column(Float, default=0)
    collapsed: Mapped[bool] = mapped_column(Boolean, default=False)
    # reserved for v2 cross-tenant sharing
    owner_tenant_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    forked_from_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    style_doc: Mapped[StyleDoc | None] = relationship(back_populates="platform", uselist=False, cascade="all, delete-orphan")
    flows: Mapped[list[Flow]] = relationship(back_populates="platform", cascade="all, delete-orphan")


class StyleDoc(TsMixin, Base):
    __tablename__ = "style_docs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    platform_id: Mapped[str] = mapped_column(ForeignKey("platforms.id", ondelete="CASCADE"), unique=True)
    ai_generated: Mapped[dict] = mapped_column(JSON, default=dict)
    human_notes: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=0)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM), nullable=True)
    platform: Mapped[Platform] = relationship(back_populates="style_doc")


COMPONENT_KINDS = ("nav_bar", "tab_bar", "header", "footer", "other")


class PlatformComponent(TsMixin, Base):
    """平台元件庫 (SPEC §6.5): a chunk of approved replica HTML — usually the
    bottom tab bar or the top nav — that Agent B pastes verbatim into every
    other screen of the same platform."""
    __tablename__ = "platform_components"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    platform_id: Mapped[str] = mapped_column(ForeignKey("platforms.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20), default="other")  # COMPONENT_KINDS
    html: Mapped[str] = mapped_column(Text)  # root element carries data-component / data-kind
    width: Mapped[int] = mapped_column(Integer, default=0)   # CSS px of the snippet
    height: Mapped[int] = mapped_column(Integer, default=0)
    thumb_key: Mapped[str | None] = mapped_column(String(300), nullable=True)  # private bucket
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)


class StyleDocVersion(Base):
    __tablename__ = "style_doc_versions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    style_doc_id: Mapped[str] = mapped_column(ForeignKey("style_docs.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    ai_generated: Mapped[dict] = mapped_column(JSON, default=dict)
    human_notes: Mapped[str] = mapped_column(Text, default="")
    reason: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Flow(TsMixin, Base):
    __tablename__ = "flows"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    platform_id: Mapped[str] = mapped_column(ForeignKey("platforms.id", ondelete="CASCADE"), index=True)
    # Which documents a flow delivers is read off its 終點 steps (Step.goal_id),
    # not stored here: one flow, several ends, several goals.
    name: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | published
    current_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # unused since v0.2 (one flow per canvas page); columns kept
    canvas_x: Mapped[float] = mapped_column(Float, default=0)
    canvas_y: Mapped[float] = mapped_column(Float, default=0)
    drift_count: Mapped[int] = mapped_column(Integer, default=0)  # 疑似改版計數

    platform: Mapped[Platform] = relationship(back_populates="flows")
    steps: Mapped[list[Step]] = relationship(back_populates="flow", cascade="all, delete-orphan")
    edges: Mapped[list[Edge]] = relationship(back_populates="flow", cascade="all, delete-orphan")


class Step(TsMixin, Base):
    __tablename__ = "steps"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    flow_id: Mapped[str] = mapped_column(ForeignKey("flows.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    instruction: Mapped[str] = mapped_column(Text, default="")
    stuck_hint: Mapped[str] = mapped_column(Text, default="")
    canvas_x: Mapped[float] = mapped_column(Float, default=0)
    canvas_y: Mapped[float] = mapped_column(Float, default=0)
    is_start: Mapped[bool] = mapped_column(Boolean, default=False)
    is_end: Mapped[bool] = mapped_column(Boolean, default=False)
    # The document a citizen holds on reaching this 終點 (meaningful only with
    # is_end). A flow's goals are the distinct goal_ids of its end steps.
    goal_id: Mapped[str | None] = mapped_column(ForeignKey("goals.id", ondelete="SET NULL"), nullable=True, index=True)
    drift_count: Mapped[int] = mapped_column(Integer, default=0)

    flow: Mapped[Flow] = relationship(back_populates="steps")
    variants: Mapped[list[Variant]] = relationship(back_populates="step", cascade="all, delete-orphan")


class Edge(TsMixin, Base):
    __tablename__ = "edges"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    flow_id: Mapped[str] = mapped_column(ForeignKey("flows.id", ondelete="CASCADE"), index=True)
    from_step_id: Mapped[str] = mapped_column(ForeignKey("steps.id", ondelete="CASCADE"), index=True)
    to_step_id: Mapped[str] = mapped_column(ForeignKey("steps.id", ondelete="CASCADE"), index=True)
    condition_label: Mapped[str] = mapped_column(String(120), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    flow: Mapped[Flow] = relationship(back_populates="edges")


# Variant.status values (SPEC §6.2): not_uploaded, uploaded, focusing, processing,
# pending_review, approved, annotating, rendering, completed, failed.
# While a background job owns the variant, the API refuses edits to it.
JOB_OWNED_STATUSES = frozenset({"processing", "approved", "rendering"})


class Variant(TsMixin, Base):
    __tablename__ = "variants"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    step_id: Mapped[str] = mapped_column(ForeignKey("steps.id", ondelete="CASCADE"), index=True)
    theme: Mapped[str] = mapped_column(String(10))  # light | dark
    status: Mapped[str] = mapped_column(String(20), default="not_uploaded")
    # original (encrypted in private bucket; cleared after approval)
    original_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    original_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    original_uploaded_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    original_width: Mapped[int] = mapped_column(Integer, default=0)
    original_height: Mapped[int] = mapped_column(Integer, default=0)
    focus_boxes: Mapped[list] = mapped_column(JSON, default=list)
    # free-text steering for Agent A/B, written by the clerk before processing
    prompt_notes: Mapped[str] = mapped_column(Text, default="")
    # pipeline outputs
    structure: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    replica_html_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    replica_png_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    replica_width: Mapped[int] = mapped_column(Integer, default=0)
    replica_height: Mapped[int] = mapped_column(Integer, default=0)
    kept_texts: Mapped[list] = mapped_column(JSON, default=list)
    # 假資料清單 (SPEC §6.5): [{key, label, value, source}] — what the replica put
    # on screen in place of real data, and whether it came from the platform's
    # 示範資料 (source=shared) or the agent made it up (source=new).
    fake_data: Mapped[list] = mapped_column(JSON, default=list)
    # False until the clerk has decided what to do with this report; a new
    # generation clears it so the next one asks again.
    fake_data_reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    check_report: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    review_history: Mapped[list] = mapped_column(JSON, default=list)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    progress: Mapped[str] = mapped_column(String(60), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    thread_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # annotations & step card
    annotations: Mapped[list] = mapped_column(JSON, default=list)
    stepcard_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    stepcard_preview_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    stepcard_width: Mapped[int] = mapped_column(Integer, default=0)
    stepcard_height: Mapped[int] = mapped_column(Integer, default=0)
    stepcard_layout: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # per-step override of the tenant layout
    # retrieval: a one-paragraph description (embedded) plus the screen's own
    # words (structural texts + keywords, personal data removed) for the
    # lexical half of the hybrid search
    description: Mapped[str] = mapped_column(Text, default="")
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM), nullable=True)
    drift_count: Mapped[int] = mapped_column(Integer, default=0)

    step: Mapped[Step] = relationship(back_populates="variants")
    __table_args__ = (UniqueConstraint("step_id", "theme", name="uq_variant_step_theme"),)


class FlowVersion(Base):
    __tablename__ = "flow_versions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    flow_id: Mapped[str] = mapped_column(ForeignKey("flows.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    published_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("flow_id", "version", name="uq_flow_version"),)


# ---------------------------------------------------------------- runtime

class EventLog(Base):
    __tablename__ = "event_logs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    flow_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    step_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(20), default="api")  # api | playground | eval
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class LlmUsage(Base):
    __tablename__ = "llm_usage"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    task: Mapped[str] = mapped_column(String(40), index=True)
    model: Mapped[str] = mapped_column(String(80))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    ref_type: Mapped[str] = mapped_column(String(20), default="")
    ref_id: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class EvalCase(TsMixin, Base):
    __tablename__ = "eval_cases"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    image_key: Mapped[str] = mapped_column(String(300))
    platform_id: Mapped[str] = mapped_column(String(32))
    step_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    goal_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    text: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(String(200), default="")


class EvalRun(Base):
    __tablename__ = "eval_runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(20), default="running")
    label: Mapped[str] = mapped_column(String(200), default="")
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    results: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


Index("ix_variants_embedding", Variant.embedding, postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"})
Index("ix_style_docs_embedding", StyleDoc.embedding, postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"})
