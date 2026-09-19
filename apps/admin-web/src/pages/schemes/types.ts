/**
 * 方案管理區的型別（SPEC §6.2 / §8.2「方案管理」）。
 *
 * 欄位名逐字對齊資料表與 OpenAPI。子設定表的形狀由後端「照實回傳它自己的欄位」
 * （`routers/admin/schemes.py::_child_out`），所以這裡寫的是那些欄位的全集。
 */

import type { ReviewRule as EngineRule, RuleType } from '@maydru/review-rules'

export type { RuleType }

/** 後台可以編輯的六張子設定表；字串就是 URL 片段，兩邊不會走樣。 */
export type ChildKind = 'tiers' | 'document-types' | 'payment-channels' | 'review-rules' | 'rejection-codes' | 'eligible-tools'

export interface SchemeRow {
  id: string
  code: string
  name: string
  category: string
  active: boolean
  version: number
  retention_days: number
  supplement_days: number
  max_revisions: number
  application_start: string | null
  application_end: string | null
  updated_at: string | null
}

/** `GET /api/admin/schemes/{code}`：編輯器要改的每一個 §6.2 欄位。 */
export interface SchemeDetail {
  id: string
  code: string
  name: string
  category: string
  description: string
  eligibility: string
  age_min: number | null
  age_max: number | null
  application_start: string | null
  application_end: string | null
  official_url: string
  contact: string
  amount_note: string
  tags: string[]
  identity_tags: string[]
  details: { label: string; value: string }[]
  active: boolean
  retention_days: number
  supplement_days: number
  max_revisions: number
  application_method: string
  required_documents: string[]
  student_requirement: string
  employment_requirement: string
  residency_requirement: string
  image_url: string
  version: number
}

/** PATCH 的 body：只送改過的欄位，外加樂觀鎖。 */
export type SchemePatch = Partial<Omit<SchemeDetail, 'id' | 'code' | 'version'>> & { expected_version?: number }

export interface Tier {
  id: string
  code: string
  label: string
  subsidy_rate: number
  cap_amount: number
  required_proof_doc_types: string[]
  sort_order: number
  version: number
}

export interface DocumentType {
  id: string
  code: string
  label: string
  hint: string
  required: boolean
  required_when: '' | 'proxy'
  must_mask: boolean
  keep_visible: string
  keep_after_disbursed: boolean
  accepted_mime: string[]
  max_pages: number
  sort_order: number
  version: number
}

export interface PaymentChannel {
  id: string
  code: string
  label: string
  hint: string
  required_document_type_codes: string[]
  guide_content_key: string
  sort_order: number
  version: number
}

export interface ReviewRuleRow extends Omit<EngineRule, 'document_type_code'> {
  id: string
  document_type_code: string
  version: number
}

export interface RejectionCode {
  id: string
  code: string
  staff_label: string
  public_what_wrong: string
  public_how_to_fix: string
  related_document_type_codes: string[]
  related_sop_flow_ids: string[]
  sort_order: number
  active: boolean
  version: number
}

export type ToolStatus = 'APPROVED' | 'PENDING' | 'REJECTED'

export interface EligibleTool {
  id: string
  name: string
  vendor: string
  aliases: string[]
  status: ToolStatus
  verdict_note: string
  inquiry_count?: number
  request_count: number
  sort_order: number
  version: number
}

/** 伺服器端試算的回覆（`POST /{code}/review-rules/evaluate`）。 */
export interface EvaluateResult {
  verdict: 'PASS' | 'FAIL' | 'INDETERMINATE'
  findings: {
    rule_code: string
    status: 'MATCH' | 'MISMATCH' | 'UNREADABLE' | 'PENDING'
    extracted_value: string | null
    expected_value: string | null
    confidence: number | null
    document_type_code: string | null
    note: string | null
    suggested_supplement?: string[] | null
  }[]
  blocking: string[]
  warnings: string[]
  suggested_supplement: string[]
}

export interface Citation { source_type: string; source_id: string; quote: string }

export interface SchemeCopyDraft {
  key: string
  draft: string
  citations: Citation[]
  version: number
}

export interface SchemeCopyResult {
  scheme_code: string
  requested: number
  drafts: SchemeCopyDraft[]
}

/** 內容助理 (b) 的一則建議（未命中訊息頁用）。 */
export interface FaqSuggestion {
  id: string
  question: string
  answer_draft: string
  citations: Citation[]
  keywords: string[]
  category: string
  cluster_size: number
  sample_messages_masked: string[]
  unverified: number
  status: string
}
