"""舊系統資料搬遷（SPEC §12）。

- `youth.py`：youth-line-bot 的 SQLite（contents、subsidies、faqs、knowledge_documents、
  cases + history、line_users、user_cases）。
- `sop_tutor.md`：SOP_Tutor 的 Postgres 與 MinIO 是整份接手，用 pg_dump / mc mirror，
  不需要程式。

共同規則：唯讀讀來源、冪等 upsert、輸出 inserted / updated / skipped / failed 報表。
"""
