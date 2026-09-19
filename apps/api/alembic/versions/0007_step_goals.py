"""goals move from flows to end steps

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("steps", sa.Column("goal_id", sa.String(length=32), nullable=True))
    op.create_index(op.f("ix_steps_goal_id"), "steps", ["goal_id"], unique=False)
    op.create_foreign_key("fk_steps_goal_id_goals", "steps", "goals", ["goal_id"], ["id"], ondelete="SET NULL")
    # every existing flow delivered one document: its 終點 steps now say so
    op.execute("UPDATE steps SET goal_id = flows.goal_id FROM flows WHERE steps.flow_id = flows.id AND steps.is_end")
    op.drop_index(op.f("ix_flows_goal_id"), table_name="flows")
    op.drop_constraint("flows_goal_id_fkey", "flows", type_="foreignkey")
    op.drop_column("flows", "goal_id")


def downgrade() -> None:
    op.add_column("flows", sa.Column("goal_id", sa.String(length=32), nullable=True))
    op.execute("UPDATE flows SET goal_id = (SELECT goal_id FROM steps WHERE steps.flow_id = flows.id AND steps.goal_id IS NOT NULL ORDER BY steps.is_end DESC LIMIT 1)")
    op.create_foreign_key("flows_goal_id_fkey", "flows", "goals", ["goal_id"], ["id"], ondelete="RESTRICT")
    op.create_index(op.f("ix_flows_goal_id"), "flows", ["goal_id"], unique=False)
    op.drop_constraint("fk_steps_goal_id_goals", "steps", type_="foreignkey")
    op.drop_index(op.f("ix_steps_goal_id"), table_name="steps")
    op.drop_column("steps", "goal_id")
