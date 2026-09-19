"""P1 資料層：SPEC §6.2 / §6.3 / §6.4 的全部資料表

Revision ID: 0011
Revises: 0010

清單欄位一律 JSON（不是 ARRAY），embedding 一律 pgvector。向量索引拆到 0014，
事件表的不可變 trigger 拆到 0013，兩者都是 Postgres 專屬的 DDL。
"""
from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy


revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('audit_logs',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('actor_id', sa.String(length=32), nullable=True),
    sa.Column('actor_name', sa.String(length=120), nullable=False),
    sa.Column('action', sa.String(length=40), nullable=False),
    sa.Column('target_type', sa.String(length=40), nullable=False),
    sa.Column('target_id', sa.String(length=64), nullable=False),
    sa.Column('diff', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_logs_action'), 'audit_logs', ['action'], unique=False)
    op.create_index(op.f('ix_audit_logs_actor_id'), 'audit_logs', ['actor_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_created_at'), 'audit_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_audit_logs_target_type'), 'audit_logs', ['target_type'], unique=False)
    op.create_index(op.f('ix_audit_logs_tenant_id'), 'audit_logs', ['tenant_id'], unique=False)
    op.create_table('case_no_counters',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('next_seq', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'year', name='uq_case_no_counter')
    )
    op.create_index(op.f('ix_case_no_counters_tenant_id'), 'case_no_counters', ['tenant_id'], unique=False)
    op.create_table('line_conversations',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('line_user_id', sa.String(length=64), nullable=False),
    sa.Column('flow', sa.String(length=40), nullable=False),
    sa.Column('step', sa.String(length=40), nullable=False),
    sa.Column('data', sa.JSON(), nullable=False),
    sa.Column('sop_session_id', sa.String(length=64), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'line_user_id', name='uq_line_conversation')
    )
    op.create_index(op.f('ix_line_conversations_expires_at'), 'line_conversations', ['expires_at'], unique=False)
    op.create_index(op.f('ix_line_conversations_line_user_id'), 'line_conversations', ['line_user_id'], unique=False)
    op.create_index(op.f('ix_line_conversations_tenant_id'), 'line_conversations', ['tenant_id'], unique=False)
    op.create_table('line_rich_menus',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('layout', sa.JSON(), nullable=False),
    sa.Column('image_key', sa.String(length=300), nullable=False),
    sa.Column('line_rich_menu_id', sa.String(length=80), nullable=True),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('synced_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_line_rich_menus_tenant_id'), 'line_rich_menus', ['tenant_id'], unique=False)
    op.create_table('line_sync_logs',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('resource_type', sa.String(length=40), nullable=False),
    sa.Column('resource_id', sa.String(length=64), nullable=False),
    sa.Column('operation', sa.String(length=40), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('remote_id', sa.String(length=80), nullable=True),
    sa.Column('error', sa.Text(), nullable=False),
    sa.Column('actor_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_line_sync_logs_created_at'), 'line_sync_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_line_sync_logs_status'), 'line_sync_logs', ['status'], unique=False)
    op.create_index(op.f('ix_line_sync_logs_tenant_id'), 'line_sync_logs', ['tenant_id'], unique=False)
    op.create_table('line_users',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('line_user_id', sa.String(length=64), nullable=False),
    sa.Column('display_name', sa.String(length=200), nullable=False),
    sa.Column('followed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('blocked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'line_user_id', name='uq_line_user')
    )
    op.create_index(op.f('ix_line_users_line_user_id'), 'line_users', ['line_user_id'], unique=False)
    op.create_index(op.f('ix_line_users_tenant_id'), 'line_users', ['tenant_id'], unique=False)
    op.create_table('media',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('key', sa.String(length=300), nullable=False),
    sa.Column('mime', sa.String(length=80), nullable=False),
    sa.Column('size', sa.Integer(), nullable=False),
    sa.Column('alt', sa.String(length=300), nullable=False),
    sa.Column('uploaded_by', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_media_key'), 'media', ['key'], unique=False)
    op.create_index(op.f('ix_media_tenant_id'), 'media', ['tenant_id'], unique=False)
    op.create_table('unmatched_messages',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('line_user_id_hash', sa.String(length=64), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('intent_result', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_unmatched_messages_created_at'), 'unmatched_messages', ['created_at'], unique=False)
    op.create_index(op.f('ix_unmatched_messages_tenant_id'), 'unmatched_messages', ['tenant_id'], unique=False)
    op.create_table('schemes',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('category', sa.String(length=40), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('eligibility', sa.Text(), nullable=False),
    sa.Column('age_min', sa.Integer(), nullable=True),
    sa.Column('age_max', sa.Integer(), nullable=True),
    sa.Column('application_start', sa.Date(), nullable=True),
    sa.Column('application_end', sa.Date(), nullable=True),
    sa.Column('official_url', sa.String(length=500), nullable=False),
    sa.Column('contact', sa.String(length=300), nullable=False),
    sa.Column('amount_note', sa.Text(), nullable=False),
    sa.Column('tags', sa.JSON(), nullable=False),
    sa.Column('identity_tags', sa.JSON(), nullable=False),
    sa.Column('details', sa.JSON(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('retention_days', sa.Integer(), nullable=False),
    sa.Column('supplement_days', sa.Integer(), nullable=False),
    sa.Column('max_revisions', sa.Integer(), nullable=False),
    sa.Column('application_method', sa.Text(), nullable=False),
    sa.Column('required_documents', sa.JSON(), nullable=False),
    sa.Column('student_requirement', sa.String(length=20), nullable=False),
    sa.Column('employment_requirement', sa.String(length=20), nullable=False),
    sa.Column('residency_requirement', sa.String(length=80), nullable=False),
    sa.Column('image_url', sa.String(length=500), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'code', name='uq_scheme_tenant_code')
    )
    op.create_index(op.f('ix_schemes_code'), 'schemes', ['code'], unique=False)
    op.create_index(op.f('ix_schemes_tenant_id'), 'schemes', ['tenant_id'], unique=False)
    op.create_table('applications',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('case_no', sa.String(length=40), nullable=False),
    sa.Column('scheme_id', sa.String(length=32), nullable=False),
    sa.Column('tier_code', sa.String(length=40), nullable=False),
    sa.Column('payment_channel_code', sa.String(length=40), nullable=False),
    sa.Column('intake_channel', sa.String(length=20), nullable=False),
    sa.Column('applicant_name', sa.String(length=120), nullable=False),
    sa.Column('phone_encrypted', sa.Text(), nullable=False),
    sa.Column('phone_last4_hash', sa.String(length=64), nullable=False),
    sa.Column('id_last4_hash', sa.String(length=64), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('tool_name', sa.String(length=200), nullable=False),
    sa.Column('tool_id', sa.String(length=32), nullable=True),
    sa.Column('purchase_amount', sa.Integer(), nullable=True),
    sa.Column('purchase_date', sa.Date(), nullable=True),
    sa.Column('paid_by_proxy', sa.Boolean(), nullable=False),
    sa.Column('note', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('first_submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revision_count', sa.Integer(), nullable=False),
    sa.Column('supplement_items', sa.JSON(), nullable=False),
    sa.Column('supplement_deadline', sa.DateTime(timezone=True), nullable=True),
    sa.Column('approved_amount', sa.Integer(), nullable=True),
    sa.Column('payment_date', sa.DateTime(timezone=True), nullable=True),
    sa.Column('payment_amount', sa.Integer(), nullable=True),
    sa.Column('documents_purge_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('documents_purged_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('assigned_reviewer_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'case_no', name='uq_application_case_no')
    )
    op.create_index(op.f('ix_applications_assigned_reviewer_id'), 'applications', ['assigned_reviewer_id'], unique=False)
    op.create_index(op.f('ix_applications_case_no'), 'applications', ['case_no'], unique=False)
    op.create_index(op.f('ix_applications_documents_purge_at'), 'applications', ['documents_purge_at'], unique=False)
    op.create_index(op.f('ix_applications_first_submitted_at'), 'applications', ['first_submitted_at'], unique=False)
    op.create_index(op.f('ix_applications_phone_last4_hash'), 'applications', ['phone_last4_hash'], unique=False)
    op.create_index(op.f('ix_applications_scheme_id'), 'applications', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_applications_status'), 'applications', ['status'], unique=False)
    op.create_index(op.f('ix_applications_tenant_id'), 'applications', ['tenant_id'], unique=False)
    op.create_table('contents',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('key', sa.String(length=120), nullable=False),
    sa.Column('category', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('draft', sa.Text(), nullable=True),
    sa.Column('content_type', sa.String(length=20), nullable=False),
    sa.Column('variables', sa.JSON(), nullable=False),
    sa.Column('scheme_id', sa.String(length=32), nullable=True),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('published_by', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'key', name='uq_content_tenant_key')
    )
    op.create_index(op.f('ix_contents_category'), 'contents', ['category'], unique=False)
    op.create_index(op.f('ix_contents_key'), 'contents', ['key'], unique=False)
    op.create_index(op.f('ix_contents_scheme_id'), 'contents', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_contents_tenant_id'), 'contents', ['tenant_id'], unique=False)
    op.create_table('document_types',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('scheme_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('hint', sa.Text(), nullable=False),
    sa.Column('required', sa.Boolean(), nullable=False),
    sa.Column('required_when', sa.String(length=20), nullable=False),
    sa.Column('must_mask', sa.Boolean(), nullable=False),
    sa.Column('keep_visible', sa.Text(), nullable=False),
    sa.Column('keep_after_disbursed', sa.Boolean(), nullable=False),
    sa.Column('accepted_mime', sa.JSON(), nullable=False),
    sa.Column('max_pages', sa.Integer(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('scheme_id', 'code', name='uq_document_type_code')
    )
    op.create_index(op.f('ix_document_types_scheme_id'), 'document_types', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_document_types_tenant_id'), 'document_types', ['tenant_id'], unique=False)
    op.create_table('eligible_tools',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('scheme_id', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('vendor', sa.String(length=200), nullable=False),
    sa.Column('aliases', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('verdict_note', sa.Text(), nullable=False),
    sa.Column('request_count', sa.Integer(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_eligible_tools_scheme_id'), 'eligible_tools', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_eligible_tools_tenant_id'), 'eligible_tools', ['tenant_id'], unique=False)
    op.create_table('faqs',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=64), nullable=False),
    sa.Column('category', sa.String(length=40), nullable=False),
    sa.Column('question', sa.Text(), nullable=False),
    sa.Column('answer', sa.Text(), nullable=False),
    sa.Column('keywords', sa.JSON(), nullable=False),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('embedding', pgvector.sqlalchemy.vector.VECTOR(dim=1536), nullable=True),
    sa.Column('scheme_id', sa.String(length=32), nullable=True),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_faqs_category'), 'faqs', ['category'], unique=False)
    op.create_index(op.f('ix_faqs_code'), 'faqs', ['code'], unique=False)
    op.create_index(op.f('ix_faqs_scheme_id'), 'faqs', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_faqs_tenant_id'), 'faqs', ['tenant_id'], unique=False)
    op.create_table('knowledge_documents',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=64), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('source_url', sa.String(length=500), nullable=False),
    sa.Column('source_type', sa.String(length=40), nullable=False),
    sa.Column('tags', sa.JSON(), nullable=False),
    sa.Column('embedding', pgvector.sqlalchemy.vector.VECTOR(dim=1536), nullable=True),
    sa.Column('scheme_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_knowledge_documents_code'), 'knowledge_documents', ['code'], unique=False)
    op.create_index(op.f('ix_knowledge_documents_scheme_id'), 'knowledge_documents', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_knowledge_documents_tenant_id'), 'knowledge_documents', ['tenant_id'], unique=False)
    op.create_table('payment_channels',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('scheme_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('hint', sa.Text(), nullable=False),
    sa.Column('required_document_type_codes', sa.JSON(), nullable=False),
    sa.Column('guide_content_key', sa.String(length=120), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('scheme_id', 'code', name='uq_payment_channel_code')
    )
    op.create_index(op.f('ix_payment_channels_scheme_id'), 'payment_channels', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_payment_channels_tenant_id'), 'payment_channels', ['tenant_id'], unique=False)
    op.create_table('rejection_codes',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('scheme_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('staff_label', sa.String(length=200), nullable=False),
    sa.Column('public_what_wrong', sa.Text(), nullable=False),
    sa.Column('public_how_to_fix', sa.Text(), nullable=False),
    sa.Column('related_document_type_codes', sa.JSON(), nullable=False),
    sa.Column('related_sop_flow_ids', sa.JSON(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('scheme_id', 'code', name='uq_rejection_code')
    )
    op.create_index(op.f('ix_rejection_codes_scheme_id'), 'rejection_codes', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_rejection_codes_tenant_id'), 'rejection_codes', ['tenant_id'], unique=False)
    op.create_table('review_rules',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('scheme_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=200), nullable=False),
    sa.Column('document_type_code', sa.String(length=40), nullable=False),
    sa.Column('rule_type', sa.String(length=30), nullable=False),
    sa.Column('config', sa.JSON(), nullable=False),
    sa.Column('required', sa.Boolean(), nullable=False),
    sa.Column('severity', sa.String(length=20), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('scheme_id', 'code', name='uq_review_rule_code')
    )
    op.create_index(op.f('ix_review_rules_scheme_id'), 'review_rules', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_review_rules_tenant_id'), 'review_rules', ['tenant_id'], unique=False)
    op.create_table('scheme_tiers',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('scheme_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('subsidy_rate', sa.Float(), nullable=False),
    sa.Column('cap_amount', sa.Integer(), nullable=False),
    sa.Column('required_proof_doc_types', sa.JSON(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['scheme_id'], ['schemes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('scheme_id', 'code', name='uq_scheme_tier_code')
    )
    op.create_index(op.f('ix_scheme_tiers_scheme_id'), 'scheme_tiers', ['scheme_id'], unique=False)
    op.create_index(op.f('ix_scheme_tiers_tenant_id'), 'scheme_tiers', ['tenant_id'], unique=False)
    op.create_table('webhook_subscriptions',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('api_key_id', sa.String(length=32), nullable=True),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('secret', sa.String(length=128), nullable=False),
    sa.Column('events', sa.JSON(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['api_key_id'], ['api_keys.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_webhook_subscriptions_api_key_id'), 'webhook_subscriptions', ['api_key_id'], unique=False)
    op.create_index(op.f('ix_webhook_subscriptions_tenant_id'), 'webhook_subscriptions', ['tenant_id'], unique=False)
    op.create_table('application_documents',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('application_id', sa.String(length=32), nullable=False),
    sa.Column('document_type_code', sa.String(length=40), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('supersedes_id', sa.String(length=32), nullable=True),
    sa.Column('is_current', sa.Boolean(), nullable=False),
    sa.Column('object_key', sa.String(length=300), nullable=False),
    sa.Column('mime', sa.String(length=80), nullable=False),
    sa.Column('size', sa.Integer(), nullable=False),
    sa.Column('page_count', sa.Integer(), nullable=False),
    sa.Column('preview_key', sa.String(length=300), nullable=True),
    sa.Column('masked', sa.Boolean(), nullable=False),
    sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('purged_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_application_documents_application_id'), 'application_documents', ['application_id'], unique=False)
    op.create_index(op.f('ix_application_documents_document_type_code'), 'application_documents', ['document_type_code'], unique=False)
    op.create_index(op.f('ix_application_documents_tenant_id'), 'application_documents', ['tenant_id'], unique=False)
    op.create_table('application_status_events',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('application_id', sa.String(length=32), nullable=False),
    sa.Column('from_status', sa.String(length=30), nullable=True),
    sa.Column('to_status', sa.String(length=30), nullable=False),
    sa.Column('transition_code', sa.String(length=10), nullable=False),
    sa.Column('actor_type', sa.String(length=20), nullable=False),
    sa.Column('actor_id', sa.String(length=32), nullable=True),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('rejection_codes', sa.JSON(), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_application_status_events_application_id'), 'application_status_events', ['application_id'], unique=False)
    op.create_index(op.f('ix_application_status_events_created_at'), 'application_status_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_application_status_events_tenant_id'), 'application_status_events', ['tenant_id'], unique=False)
    op.create_table('case_verifications',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('application_id', sa.String(length=32), nullable=False),
    sa.Column('line_user_id', sa.String(length=64), nullable=False),
    sa.Column('verified_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('method', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('application_id', 'line_user_id', name='uq_case_verification')
    )
    op.create_index(op.f('ix_case_verifications_application_id'), 'case_verifications', ['application_id'], unique=False)
    op.create_index(op.f('ix_case_verifications_line_user_id'), 'case_verifications', ['line_user_id'], unique=False)
    op.create_index(op.f('ix_case_verifications_tenant_id'), 'case_verifications', ['tenant_id'], unique=False)
    op.create_table('document_type_sop_flows',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('document_type_id', sa.String(length=32), nullable=False),
    sa.Column('flow_id', sa.String(length=32), nullable=False),
    sa.Column('platform_id', sa.String(length=32), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['document_type_id'], ['document_types.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['flow_id'], ['flows.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['platform_id'], ['platforms.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('document_type_id', 'flow_id', 'platform_id', name='uq_document_type_sop_flow')
    )
    op.create_index(op.f('ix_document_type_sop_flows_document_type_id'), 'document_type_sop_flows', ['document_type_id'], unique=False)
    op.create_index(op.f('ix_document_type_sop_flows_flow_id'), 'document_type_sop_flows', ['flow_id'], unique=False)
    op.create_index(op.f('ix_document_type_sop_flows_platform_id'), 'document_type_sop_flows', ['platform_id'], unique=False)
    op.create_index(op.f('ix_document_type_sop_flows_tenant_id'), 'document_type_sop_flows', ['tenant_id'], unique=False)
    op.create_table('notifications',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('application_id', sa.String(length=32), nullable=True),
    sa.Column('line_user_id', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('content_key', sa.String(length=120), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('error', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_notifications_application_id'), 'notifications', ['application_id'], unique=False)
    op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'], unique=False)
    op.create_index(op.f('ix_notifications_status'), 'notifications', ['status'], unique=False)
    op.create_index(op.f('ix_notifications_tenant_id'), 'notifications', ['tenant_id'], unique=False)
    op.create_table('review_findings',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('application_id', sa.String(length=32), nullable=False),
    sa.Column('rule_id', sa.String(length=32), nullable=True),
    sa.Column('rule_code', sa.String(length=40), nullable=False),
    sa.Column('document_id', sa.String(length=32), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('extracted_value', sa.Text(), nullable=False),
    sa.Column('expected_value', sa.Text(), nullable=False),
    sa.Column('confidence', sa.Float(), nullable=False),
    sa.Column('bbox', sa.JSON(), nullable=True),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('note', sa.Text(), nullable=False),
    sa.Column('reviewer_id', sa.String(length=32), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_review_findings_application_id'), 'review_findings', ['application_id'], unique=False)
    op.create_index(op.f('ix_review_findings_rule_code'), 'review_findings', ['rule_code'], unique=False)
    op.create_index(op.f('ix_review_findings_rule_id'), 'review_findings', ['rule_id'], unique=False)
    op.create_index(op.f('ix_review_findings_tenant_id'), 'review_findings', ['tenant_id'], unique=False)
    op.create_table('webhook_deliveries',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('subscription_id', sa.String(length=32), nullable=False),
    sa.Column('event', sa.String(length=60), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['subscription_id'], ['webhook_subscriptions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_webhook_deliveries_created_at'), 'webhook_deliveries', ['created_at'], unique=False)
    op.create_index(op.f('ix_webhook_deliveries_event'), 'webhook_deliveries', ['event'], unique=False)
    op.create_index(op.f('ix_webhook_deliveries_status'), 'webhook_deliveries', ['status'], unique=False)
    op.create_index(op.f('ix_webhook_deliveries_subscription_id'), 'webhook_deliveries', ['subscription_id'], unique=False)
    op.create_index(op.f('ix_webhook_deliveries_tenant_id'), 'webhook_deliveries', ['tenant_id'], unique=False)
    op.create_table('document_ocr_results',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('document_id', sa.String(length=32), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('engine', sa.String(length=40), nullable=False),
    sa.Column('lang', sa.String(length=40), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('confidence', sa.Float(), nullable=False),
    sa.Column('lines', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['application_documents.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_document_ocr_results_document_id'), 'document_ocr_results', ['document_id'], unique=False)
    op.create_index(op.f('ix_document_ocr_results_tenant_id'), 'document_ocr_results', ['tenant_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_document_ocr_results_tenant_id'), table_name='document_ocr_results')
    op.drop_index(op.f('ix_document_ocr_results_document_id'), table_name='document_ocr_results')
    op.drop_table('document_ocr_results')
    op.drop_index(op.f('ix_webhook_deliveries_tenant_id'), table_name='webhook_deliveries')
    op.drop_index(op.f('ix_webhook_deliveries_subscription_id'), table_name='webhook_deliveries')
    op.drop_index(op.f('ix_webhook_deliveries_status'), table_name='webhook_deliveries')
    op.drop_index(op.f('ix_webhook_deliveries_event'), table_name='webhook_deliveries')
    op.drop_index(op.f('ix_webhook_deliveries_created_at'), table_name='webhook_deliveries')
    op.drop_table('webhook_deliveries')
    op.drop_index(op.f('ix_review_findings_tenant_id'), table_name='review_findings')
    op.drop_index(op.f('ix_review_findings_rule_id'), table_name='review_findings')
    op.drop_index(op.f('ix_review_findings_rule_code'), table_name='review_findings')
    op.drop_index(op.f('ix_review_findings_application_id'), table_name='review_findings')
    op.drop_table('review_findings')
    op.drop_index(op.f('ix_notifications_tenant_id'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_status'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_created_at'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_application_id'), table_name='notifications')
    op.drop_table('notifications')
    op.drop_index(op.f('ix_document_type_sop_flows_tenant_id'), table_name='document_type_sop_flows')
    op.drop_index(op.f('ix_document_type_sop_flows_platform_id'), table_name='document_type_sop_flows')
    op.drop_index(op.f('ix_document_type_sop_flows_flow_id'), table_name='document_type_sop_flows')
    op.drop_index(op.f('ix_document_type_sop_flows_document_type_id'), table_name='document_type_sop_flows')
    op.drop_table('document_type_sop_flows')
    op.drop_index(op.f('ix_case_verifications_tenant_id'), table_name='case_verifications')
    op.drop_index(op.f('ix_case_verifications_line_user_id'), table_name='case_verifications')
    op.drop_index(op.f('ix_case_verifications_application_id'), table_name='case_verifications')
    op.drop_table('case_verifications')
    op.drop_index(op.f('ix_application_status_events_tenant_id'), table_name='application_status_events')
    op.drop_index(op.f('ix_application_status_events_created_at'), table_name='application_status_events')
    op.drop_index(op.f('ix_application_status_events_application_id'), table_name='application_status_events')
    op.drop_table('application_status_events')
    op.drop_index(op.f('ix_application_documents_tenant_id'), table_name='application_documents')
    op.drop_index(op.f('ix_application_documents_document_type_code'), table_name='application_documents')
    op.drop_index(op.f('ix_application_documents_application_id'), table_name='application_documents')
    op.drop_table('application_documents')
    op.drop_index(op.f('ix_webhook_subscriptions_tenant_id'), table_name='webhook_subscriptions')
    op.drop_index(op.f('ix_webhook_subscriptions_api_key_id'), table_name='webhook_subscriptions')
    op.drop_table('webhook_subscriptions')
    op.drop_index(op.f('ix_scheme_tiers_tenant_id'), table_name='scheme_tiers')
    op.drop_index(op.f('ix_scheme_tiers_scheme_id'), table_name='scheme_tiers')
    op.drop_table('scheme_tiers')
    op.drop_index(op.f('ix_review_rules_tenant_id'), table_name='review_rules')
    op.drop_index(op.f('ix_review_rules_scheme_id'), table_name='review_rules')
    op.drop_table('review_rules')
    op.drop_index(op.f('ix_rejection_codes_tenant_id'), table_name='rejection_codes')
    op.drop_index(op.f('ix_rejection_codes_scheme_id'), table_name='rejection_codes')
    op.drop_table('rejection_codes')
    op.drop_index(op.f('ix_payment_channels_tenant_id'), table_name='payment_channels')
    op.drop_index(op.f('ix_payment_channels_scheme_id'), table_name='payment_channels')
    op.drop_table('payment_channels')
    op.drop_index(op.f('ix_knowledge_documents_tenant_id'), table_name='knowledge_documents')
    op.drop_index(op.f('ix_knowledge_documents_scheme_id'), table_name='knowledge_documents')
    op.drop_index(op.f('ix_knowledge_documents_code'), table_name='knowledge_documents')
    op.drop_table('knowledge_documents')
    op.drop_index(op.f('ix_faqs_tenant_id'), table_name='faqs')
    op.drop_index(op.f('ix_faqs_scheme_id'), table_name='faqs')
    op.drop_index(op.f('ix_faqs_code'), table_name='faqs')
    op.drop_index(op.f('ix_faqs_category'), table_name='faqs')
    op.drop_table('faqs')
    op.drop_index(op.f('ix_eligible_tools_tenant_id'), table_name='eligible_tools')
    op.drop_index(op.f('ix_eligible_tools_scheme_id'), table_name='eligible_tools')
    op.drop_table('eligible_tools')
    op.drop_index(op.f('ix_document_types_tenant_id'), table_name='document_types')
    op.drop_index(op.f('ix_document_types_scheme_id'), table_name='document_types')
    op.drop_table('document_types')
    op.drop_index(op.f('ix_contents_tenant_id'), table_name='contents')
    op.drop_index(op.f('ix_contents_scheme_id'), table_name='contents')
    op.drop_index(op.f('ix_contents_key'), table_name='contents')
    op.drop_index(op.f('ix_contents_category'), table_name='contents')
    op.drop_table('contents')
    op.drop_index(op.f('ix_applications_tenant_id'), table_name='applications')
    op.drop_index(op.f('ix_applications_status'), table_name='applications')
    op.drop_index(op.f('ix_applications_scheme_id'), table_name='applications')
    op.drop_index(op.f('ix_applications_phone_last4_hash'), table_name='applications')
    op.drop_index(op.f('ix_applications_first_submitted_at'), table_name='applications')
    op.drop_index(op.f('ix_applications_documents_purge_at'), table_name='applications')
    op.drop_index(op.f('ix_applications_case_no'), table_name='applications')
    op.drop_index(op.f('ix_applications_assigned_reviewer_id'), table_name='applications')
    op.drop_table('applications')
    op.drop_index(op.f('ix_schemes_tenant_id'), table_name='schemes')
    op.drop_index(op.f('ix_schemes_code'), table_name='schemes')
    op.drop_table('schemes')
    op.drop_index(op.f('ix_unmatched_messages_tenant_id'), table_name='unmatched_messages')
    op.drop_index(op.f('ix_unmatched_messages_created_at'), table_name='unmatched_messages')
    op.drop_table('unmatched_messages')
    op.drop_index(op.f('ix_media_tenant_id'), table_name='media')
    op.drop_index(op.f('ix_media_key'), table_name='media')
    op.drop_table('media')
    op.drop_index(op.f('ix_line_users_tenant_id'), table_name='line_users')
    op.drop_index(op.f('ix_line_users_line_user_id'), table_name='line_users')
    op.drop_table('line_users')
    op.drop_index(op.f('ix_line_sync_logs_tenant_id'), table_name='line_sync_logs')
    op.drop_index(op.f('ix_line_sync_logs_status'), table_name='line_sync_logs')
    op.drop_index(op.f('ix_line_sync_logs_created_at'), table_name='line_sync_logs')
    op.drop_table('line_sync_logs')
    op.drop_index(op.f('ix_line_rich_menus_tenant_id'), table_name='line_rich_menus')
    op.drop_table('line_rich_menus')
    op.drop_index(op.f('ix_line_conversations_tenant_id'), table_name='line_conversations')
    op.drop_index(op.f('ix_line_conversations_line_user_id'), table_name='line_conversations')
    op.drop_index(op.f('ix_line_conversations_expires_at'), table_name='line_conversations')
    op.drop_table('line_conversations')
    op.drop_index(op.f('ix_case_no_counters_tenant_id'), table_name='case_no_counters')
    op.drop_table('case_no_counters')
    op.drop_index(op.f('ix_audit_logs_tenant_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_target_type'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_created_at'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_actor_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_action'), table_name='audit_logs')
    op.drop_table('audit_logs')
