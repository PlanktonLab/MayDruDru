# P3 API contract (shared by the P3 backend agent and the P3 frontend agent)

The backend agent implements exactly this; the frontend agent codes against it (with MSW mocks until integration). Response shapes use snake_case. All times ISO-8601 UTC.

## Public, anonymous, rate-limited: `/api/apply/*`

### `GET /api/apply/schemes`
→ `[{code, name, category, description, application_start, application_end, amount_note, tags[], active}]` (active only)

### `GET /api/apply/schemes/{code}`
→ `SchemePublic`:
```
{ code, name, category, description, eligibility, age_min, age_max, application_start, application_end,
  official_url, contact, amount_note, tags[], identity_tags[], details[{label,value}],
  supplement_days, max_revisions,
  tiers: [{code, label, subsidy_rate, cap_amount, required_proof_doc_types[]}],
  document_types: [{code, label, hint, required, must_mask, accepted_mime[], max_pages, sort_order, required_when}],
  payment_channels: [{code, label, required_document_type_codes[], guide_content_key}],
  rejection_codes: [{code, public_what_wrong, public_how_to_fix, related_document_type_codes[], related_sop_flow_ids[]}],
  review_rules: [{code, label, document_type_code, rule_type, config, required, severity, sort_order, active}],   // same shape as @maydru/review-rules ReviewRule
  eligible_tools: [{id, name, vendor, aliases[], status}] }
```

### `POST /api/apply/schemes/{code}/required-documents`
body `{tier_code, payment_channel_code, paid_by_proxy}` → `{document_type_codes: string[]}` (server-side `scheme.required_document_types`)

### `POST /api/apply/applications`  (multipart/form-data)
- field `application` (JSON string): `{scheme_code, tier_code, payment_channel_code, applicant_name, phone, id_last4?, email?, tool_name, tool_id?, purchase_amount, purchase_date, paid_by_proxy, note?, precheck?: {verdict, findings}}`
- field `documents` (JSON string): `[{document_type_code, masked: bool, mime, page_count, ocr: OcrResult|null}]` — order matches files
- files `file_0`, `file_1`, … (JPEG/PNG/PDF, ≤ 20 MB each)
→ `201 {case_no, status, verdict, findings: Finding[]}` — server re-runs the rule engine (`source=auto`, `document_ocr_results.source=applicant`). Files → MinIO private bucket `applications/{tenant}/{case_no}/{doc_type}/{revision}.{ext}`; optional preview thumbnail → `preview_key`.
- Errors: `422` validation with `{detail:[{loc,msg}]}`; `400 {code:'SCHEME_CLOSED'}`; `413`.

### `POST /api/apply/verify`
body `{case_no, last4}` → `200 {token, expires_at, case_no}`; `401 {code:'VERIFICATION_FAILED'}`; `423 {code:'LOCKED', retry_after_seconds}`.

### Case-token endpoints (`Authorization: Bearer <case token>`; 401 if wrong case)
- `GET /api/apply/applications/{case_no}` → `CasePublic`:
  ```
  { case_no, scheme: {code, name}, status, first_submitted_at, last_submitted_at, revision_count,
    supplement_items: [{document_type_code, rejection_code, note}], supplement_deadline,
    payment_date, tool_name, purchase_amount,
    documents: [{document_type_code, revision, is_current, uploaded_at, page_count}],
    events: [{transition_code, from_status, to_status, actor_type, created_at, rejection_codes[]}],
    can_supplement: bool, can_withdraw: bool }
  ```
- `POST /api/apply/applications/{case_no}/documents` (multipart same as create, only `documents` + files) → T4 → `{status, verdict, findings}`; `400 {code:'NOT_IN_SUPPLEMENT'}`, `400 {code:'UNEXPECTED_DOCUMENT_TYPE'}` if a type is not in supplement_items.
- `POST /api/apply/applications/{case_no}/withdraw` → T10 → `{status}`.

### `GET /api/apply/faqs?q=&scheme=`
→ `[{id, category, question, answer, priority}]` (keyword search on question/keywords; embedding search arrives in P4).

### Status labels
`GET /api/contents?keys=status.SUBMITTED.public_label,…` arrives with P2. Until then the frontend uses local fallback labels (submit-flow `STATUS_PUBLIC_LABEL`) keyed by status code and overlays contents when the endpoint exists.

## Admin (JWT, `require_cap("case_review")` unless noted): `/api/admin/*`

- `GET /api/admin/applications?status=&scheme=&assigned=&q=&page=&page_size=` → `{items:[QueueRow], total}`; `QueueRow = {case_no, applicant_name_masked, scheme_code, scheme_name, tier_code, payment_channel_code, tool_name, purchase_amount, status, first_submitted_at, last_submitted_at, revision_count, assigned_reviewer: {id,name}|null, verdict: 'PASS'|'FAIL'|'INDETERMINATE'|null, intake_channel}` ordered by `first_submitted_at` asc.
- `GET /api/admin/applications/{case_no}` → `CaseDetail = QueueRow + {applicant_name, phone_masked, email, id_last4_masked, purchase_date, paid_by_proxy, note, supplement_items, supplement_deadline, payment_date, payment_amount, approved_amount, documents:[{id, document_type_code, document_type_label, revision, supersedes_id, is_current, mime, size, page_count, masked, uploaded_at, ocr: {source, engine, confidence, lines}|null}], findings:[Finding + {id, source, reviewer:{id,name}|null, decided_at, document_id}] (latest per rule_code first, history included with `superseded: true`), events:[…], rules:[ReviewRule], allowed_transitions:[{code, label, needs_reason, needs_rejection_codes, needs_supplement_items}], approval_blockers:[{rule_code, label}], version}`
- `GET /api/admin/applications/{case_no}/documents/{doc_id}/url` → `{url, expires_at}` (presigned, 5 min)
- `POST /api/admin/applications/{case_no}/documents/{doc_id}/ocr` body `{ocr: OcrResult}` → stores `source=reviewer`, re-evaluates → `{findings}`
- `POST /api/admin/applications/{case_no}/evaluate` → re-runs engine on latest OCR per document → `{findings, verdict}`
- `PUT /api/admin/applications/{case_no}/findings/{rule_code}` body `{status: 'MATCH'|'MISMATCH'|'UNREADABLE', extracted_value?, note?}` → new `source=reviewer` row → `{findings}`
- `POST /api/admin/applications/{case_no}/transitions` body `{code, reason?, rejection_codes?, supplement_items?, supplement_deadline?, payload?}` → `{status, events}`; `403` wrong role; `409 {code:'TRANSITION_NOT_ALLOWED', blockers}`.
- `POST /api/admin/applications/{case_no}/assign` body `{reviewer_id|null}` → `{assigned_reviewer}`

## Finding (identical to `@maydru/review-rules`)
`{rule_code, status, extracted_value, expected_value, confidence, bbox:{x0,y0,x1,y1}|null, document_type_code, note, suggested_supplement?}`

## OcrResult (identical to `@maydru/ocr`)
`{text, confidence, lines:[{text, confidence, bbox:{x0,y0,x1,y1}, words:[{text,bbox,confidence}]}]}`
