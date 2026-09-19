# Decisions derived from the surveys (to be recorded in SPEC §18 by the implementing agent)

## D13 — legacy youth-line-bot status → SPEC §7 status mapping (migrate_legacy)
| youth status | MayDru status | note |
|---|---|---|
| submitted | SUBMITTED | |
| eligibility_review | UNDER_REVIEW | |
| document_review | UNDER_REVIEW | |
| supplement_required | NEEDS_REVISION | supplement_items (string list) → supplement_items JSON `[{document_type_code: null, rejection_code: "OTHER", note: <item>}]`; supplement_deadline copied |
| review_completed | APPROVED | 審查完成 precedes 撥款 in the legacy timeline |
| approved | APPROVED | payment_status pending/processing → DISBURSING |
| rejected | REJECTED | reason = note or "（舊系統匯入）" |
| paid | DISBURSED | payment_date/payment_amount copied |
Legacy `case_id` (8 digits e.g. 20260001) becomes `case_no` verbatim; `intake_channel = LEGACY`.
Legacy phone is full number: store `phone_encrypted` (Fernet with PII_ENCRYPTION_KEY) + `phone_last4_hash`.

## D14 — roles (SPEC §6.5) replace SOP_Tutor's viewer/reviewer/editor/admin/owner
New ROLES = ("viewer", "sop_editor", "sop_reviewer", "case_reviewer", "case_supervisor", "admin", "owner").
`viewer` is kept only as a legacy read-only rank (not offered in UI). Migration: editor→sop_editor, reviewer→sop_reviewer, viewer stays viewer.
Authorization is capability-based: `deps.require_cap(cap)` where caps = sop_edit, sop_review, case_review, case_supervise, admin, owner.
- sop_editor: sop_edit
- sop_reviewer: sop_review
- case_reviewer: case_review
- case_supervisor: case_review, case_supervise
- admin: all of the above + admin
- owner: all + owner
Existing `require("editor")` → `require_cap("sop_edit")`, `require_any("reviewer")` → `require_cap("sop_review")`, `require("admin")` → `require_cap("admin")`. Frontend `atLeast/can` updated accordingly.

## D15 — tests use aiosqlite in-memory DB
- New tables use JSON (not ARRAY) for list columns so SQLite works; Vector columns stay pgvector but tests never insert embeddings (SQLite accepts the type name).
- `application_status_events` immutability: Postgres trigger in the alembic migration (guarded `if bind.dialect.name == "postgresql"`), plus an SQLAlchemy `before_update`/`before_delete` event listener on the model that raises, so the invariant also holds in tests.
- conftest provides: `db` (async session on aiosqlite, `Base.metadata.create_all`), `tenant`, `users` per role, `client` (httpx ASGITransport with `get_db` override), `auth_headers(role)`, `api_key_headers(scopes)`. Redis-dependent code must be injectable/mocked (fake in-memory redis for rate limits / locks).

## D16 — case_no format
`HC-YYYY-NNNNNN`, sequence per tenant per year (Postgres sequence or a `case_no_counters` row with SELECT ... FOR UPDATE; in SQLite fall back to max+1). Legacy 8-digit ids are allowed as-is.

## D17 — the second factor is phone_last4 (SPEC) not the full phone (legacy)
Lockout: 5 failures → 15 min lock keyed by `case_no` AND by client ip, in Redis; tests use fake redis.
