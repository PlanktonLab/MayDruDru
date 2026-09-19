"""variants.keywords — the screen's own words for hybrid retrieval

Revision ID: 0009
Revises: 0008
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("variants", sa.Column("keywords", sa.JSON(), nullable=False, server_default="[]"))
    # Backfill from the structure analysis of every variant that already went
    # through approval (its sensitive_texts were scrubbed at that point).
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, structure FROM variants WHERE structure IS NOT NULL AND status IN ('approved','annotating','rendering','completed')"
    )).fetchall()
    for vid, structure in rows:
        st = structure if isinstance(structure, dict) else (json.loads(structure) if structure else {})
        words: list[str] = []
        for t in [*(st.get("structural_texts") or []), *(st.get("visible_keywords") or [])]:
            if isinstance(t, str) and t.strip() and t.strip() not in words:
                words.append(t.strip())
        conn.execute(sa.text("UPDATE variants SET keywords = :kw WHERE id = :id"), {"kw": json.dumps(words, ensure_ascii=False), "id": vid})
    # the server default stays so rows written by code predating this column are still valid


def downgrade() -> None:
    op.drop_column("variants", "keywords")
