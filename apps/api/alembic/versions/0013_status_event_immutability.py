"""application_status_events 禁止 UPDATE / DELETE（SPEC §7）

Revision ID: 0013
Revises: 0012

案件的狀態軌跡是稽核證據，不是工作資料。Trigger 讓「不可變」變成資料庫層的事實，
連直接連進 psql 的人也改不動；應用層另有一組 SQLAlchemy event listener 擋同一件事，
所以在 aiosqlite 上跑的測試也看得到一樣的行為（決策 D15）。

刪掉整件申請（ON DELETE CASCADE）同樣會被擋下——這是刻意的：要清空一件案子的
影像請走 purge，案件主檔與事件永遠留著。
"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

FUNCTION = """
CREATE OR REPLACE FUNCTION maydru_status_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'application_status_events is append-only (SPEC 7)';
END;
$$ LANGUAGE plpgsql;
"""

TRIGGER = """
CREATE TRIGGER trg_application_status_events_immutable
BEFORE UPDATE OR DELETE ON application_status_events
FOR EACH ROW EXECUTE FUNCTION maydru_status_events_immutable();
"""


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(FUNCTION)
    op.execute(TRIGGER)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP TRIGGER IF EXISTS trg_application_status_events_immutable ON application_status_events")
    op.execute("DROP FUNCTION IF EXISTS maydru_status_events_immutable()")
