"""initial schema

Explicit DDL for the schema the v1 models produced when this revision was
first applied (it used to call metadata.create_all, which tied it to whatever
the models looked like at run time). Later changes go in new revisions.

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

TABLES = (  # dependency order; downgrade drops in reverse
    "eval_cases", "eval_runs", "event_logs", "llm_usage", "tenants", "api_keys", "goals", "platforms", "users",
    "flows", "style_docs", "flow_versions", "steps", "style_doc_versions", "edges", "variants",
)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table('eval_cases',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('image_key', sa.String(length=300), nullable=False),
    sa.Column('platform_id', sa.String(length=32), nullable=False),
    sa.Column('step_id', sa.String(length=32), nullable=True),
    sa.Column('goal_id', sa.String(length=32), nullable=True),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('note', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_eval_cases_tenant_id'), 'eval_cases', ['tenant_id'], unique=False)
    op.create_table('eval_runs',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('label', sa.String(length=200), nullable=False),
    sa.Column('config', sa.JSON(), nullable=False),
    sa.Column('results', sa.JSON(), nullable=False),
    sa.Column('summary', sa.JSON(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_eval_runs_tenant_id'), 'eval_runs', ['tenant_id'], unique=False)
    op.create_table('event_logs',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('session_id', sa.String(length=64), nullable=False),
    sa.Column('event_type', sa.String(length=40), nullable=False),
    sa.Column('flow_id', sa.String(length=32), nullable=True),
    sa.Column('step_id', sa.String(length=32), nullable=True),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_event_logs_created_at'), 'event_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_event_logs_event_type'), 'event_logs', ['event_type'], unique=False)
    op.create_index(op.f('ix_event_logs_flow_id'), 'event_logs', ['flow_id'], unique=False)
    op.create_index(op.f('ix_event_logs_session_id'), 'event_logs', ['session_id'], unique=False)
    op.create_index(op.f('ix_event_logs_tenant_id'), 'event_logs', ['tenant_id'], unique=False)
    op.create_table('llm_usage',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=True),
    sa.Column('task', sa.String(length=40), nullable=False),
    sa.Column('model', sa.String(length=80), nullable=False),
    sa.Column('input_tokens', sa.Integer(), nullable=False),
    sa.Column('cached_tokens', sa.Integer(), nullable=False),
    sa.Column('output_tokens', sa.Integer(), nullable=False),
    sa.Column('latency_ms', sa.Integer(), nullable=False),
    sa.Column('cost_usd', sa.Float(), nullable=False),
    sa.Column('ref_type', sa.String(length=20), nullable=False),
    sa.Column('ref_id', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_llm_usage_created_at'), 'llm_usage', ['created_at'], unique=False)
    op.create_index(op.f('ix_llm_usage_task'), 'llm_usage', ['task'], unique=False)
    op.create_index(op.f('ix_llm_usage_tenant_id'), 'llm_usage', ['tenant_id'], unique=False)
    op.create_table('tenants',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('settings', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    op.create_table('api_keys',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('prefix', sa.String(length=12), nullable=False),
    sa.Column('key_hash', sa.String(length=128), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('rate_limit_per_minute', sa.Integer(), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('key_hash')
    )
    op.create_index(op.f('ix_api_keys_prefix'), 'api_keys', ['prefix'], unique=False)
    op.create_index(op.f('ix_api_keys_tenant_id'), 'api_keys', ['tenant_id'], unique=False)
    op.create_table('goals',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('aliases', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_goals_tenant_id'), 'goals', ['tenant_id'], unique=False)
    op.create_table('platforms',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('display_name', sa.String(length=160), nullable=False),
    sa.Column('brand', sa.String(length=120), nullable=False),
    sa.Column('channel', sa.String(length=30), nullable=False),
    sa.Column('category', sa.String(length=40), nullable=False),
    sa.Column('aliases', sa.JSON(), nullable=False),
    sa.Column('canvas_x', sa.Float(), nullable=False),
    sa.Column('canvas_y', sa.Float(), nullable=False),
    sa.Column('collapsed', sa.Boolean(), nullable=False),
    sa.Column('owner_tenant_id', sa.String(length=32), nullable=True),
    sa.Column('forked_from_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_platforms_tenant_id'), 'platforms', ['tenant_id'], unique=False)
    op.create_table('users',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('password_hash', sa.String(length=200), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'email', name='uq_user_tenant_email')
    )
    op.create_index(op.f('ix_users_tenant_id'), 'users', ['tenant_id'], unique=False)
    op.create_table('flows',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('platform_id', sa.String(length=32), nullable=False),
    sa.Column('goal_id', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('current_version_id', sa.String(length=32), nullable=True),
    sa.Column('canvas_x', sa.Float(), nullable=False),
    sa.Column('canvas_y', sa.Float(), nullable=False),
    sa.Column('drift_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['goal_id'], ['goals.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['platform_id'], ['platforms.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_flows_goal_id'), 'flows', ['goal_id'], unique=False)
    op.create_index(op.f('ix_flows_platform_id'), 'flows', ['platform_id'], unique=False)
    op.create_index(op.f('ix_flows_tenant_id'), 'flows', ['tenant_id'], unique=False)
    op.create_table('style_docs',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('platform_id', sa.String(length=32), nullable=False),
    sa.Column('ai_generated', sa.JSON(), nullable=False),
    sa.Column('human_notes', sa.Text(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('embedding', Vector(1536), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['platform_id'], ['platforms.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('platform_id')
    )
    op.create_index('ix_style_docs_embedding', 'style_docs', ['embedding'], unique=False, postgresql_using='hnsw', postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.create_table('flow_versions',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('flow_id', sa.String(length=32), nullable=False),
    sa.Column('tenant_id', sa.String(length=32), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('snapshot', sa.JSON(), nullable=False),
    sa.Column('published_by', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['flow_id'], ['flows.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('flow_id', 'version', name='uq_flow_version')
    )
    op.create_index(op.f('ix_flow_versions_flow_id'), 'flow_versions', ['flow_id'], unique=False)
    op.create_index(op.f('ix_flow_versions_tenant_id'), 'flow_versions', ['tenant_id'], unique=False)
    op.create_table('steps',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('flow_id', sa.String(length=32), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('instruction', sa.Text(), nullable=False),
    sa.Column('stuck_hint', sa.Text(), nullable=False),
    sa.Column('canvas_x', sa.Float(), nullable=False),
    sa.Column('canvas_y', sa.Float(), nullable=False),
    sa.Column('is_start', sa.Boolean(), nullable=False),
    sa.Column('is_end', sa.Boolean(), nullable=False),
    sa.Column('drift_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['flow_id'], ['flows.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_steps_flow_id'), 'steps', ['flow_id'], unique=False)
    op.create_table('style_doc_versions',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('style_doc_id', sa.String(length=32), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('ai_generated', sa.JSON(), nullable=False),
    sa.Column('human_notes', sa.Text(), nullable=False),
    sa.Column('reason', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['style_doc_id'], ['style_docs.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_style_doc_versions_style_doc_id'), 'style_doc_versions', ['style_doc_id'], unique=False)
    op.create_table('edges',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('flow_id', sa.String(length=32), nullable=False),
    sa.Column('from_step_id', sa.String(length=32), nullable=False),
    sa.Column('to_step_id', sa.String(length=32), nullable=False),
    sa.Column('condition_label', sa.String(length=120), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['flow_id'], ['flows.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['from_step_id'], ['steps.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['to_step_id'], ['steps.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_edges_flow_id'), 'edges', ['flow_id'], unique=False)
    op.create_index(op.f('ix_edges_from_step_id'), 'edges', ['from_step_id'], unique=False)
    op.create_index(op.f('ix_edges_to_step_id'), 'edges', ['to_step_id'], unique=False)
    op.create_table('variants',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('step_id', sa.String(length=32), nullable=False),
    sa.Column('theme', sa.String(length=10), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('original_key', sa.String(length=300), nullable=True),
    sa.Column('original_uploaded_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('original_uploaded_by', sa.String(length=32), nullable=True),
    sa.Column('original_width', sa.Integer(), nullable=False),
    sa.Column('original_height', sa.Integer(), nullable=False),
    sa.Column('focus_boxes', sa.JSON(), nullable=False),
    sa.Column('structure', sa.JSON(), nullable=True),
    sa.Column('replica_html_key', sa.String(length=300), nullable=True),
    sa.Column('replica_png_key', sa.String(length=300), nullable=True),
    sa.Column('replica_width', sa.Integer(), nullable=False),
    sa.Column('replica_height', sa.Integer(), nullable=False),
    sa.Column('kept_texts', sa.JSON(), nullable=False),
    sa.Column('fake_data', sa.JSON(), nullable=False),
    sa.Column('check_report', sa.JSON(), nullable=True),
    sa.Column('review_history', sa.JSON(), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('progress', sa.String(length=60), nullable=False),
    sa.Column('error', sa.Text(), nullable=False),
    sa.Column('thread_id', sa.String(length=64), nullable=True),
    sa.Column('annotations', sa.JSON(), nullable=False),
    sa.Column('stepcard_key', sa.String(length=300), nullable=True),
    sa.Column('stepcard_preview_key', sa.String(length=300), nullable=True),
    sa.Column('stepcard_width', sa.Integer(), nullable=False),
    sa.Column('stepcard_height', sa.Integer(), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('embedding', Vector(1536), nullable=True),
    sa.Column('drift_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['step_id'], ['steps.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('step_id', 'theme', name='uq_variant_step_theme')
    )
    op.create_index('ix_variants_embedding', 'variants', ['embedding'], unique=False, postgresql_using='hnsw', postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.create_index(op.f('ix_variants_step_id'), 'variants', ['step_id'], unique=False)

def downgrade() -> None:
    for name in reversed(TABLES):
        op.drop_table(name)
