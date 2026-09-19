"""faqs / knowledge_documents 的 HNSW 向量索引

Revision ID: 0014
Revises: 0013

與 0002 同一套作法：索引的 DDL 只有 Postgres + pgvector 認得，所以加 dialect 守衛，
並且 `IF NOT EXISTS`——從 model metadata 直接建出來的資料庫早就有了。
"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

VECTOR_INDEXES = (("ix_faqs_embedding", "faqs"), ("ix_knowledge_documents_embedding", "knowledge_documents"))


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for name, table in VECTOR_INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for name, _table in VECTOR_INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
