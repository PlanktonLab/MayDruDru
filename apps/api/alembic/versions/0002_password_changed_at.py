"""users.password_changed_at; vector indexes guaranteed

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

VECTOR_INDEXES = (("ix_variants_embedding", "variants"), ("ix_style_docs_embedding", "style_docs"))


def upgrade() -> None:
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))
    # 0001 creates these; databases initialised from older model versions may lack them
    for name, table in VECTOR_INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    op.drop_column("users", "password_changed_at")
