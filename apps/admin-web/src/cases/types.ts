/** 案件審核區的 API 形狀（P3 契約的 `/api/admin/applications/*`，SPEC §8.2）。 */

import type { OcrResult } from '@maydru/ocr'
import type { Finding, FindingStatus, ReviewRule, Verdict } from '@maydru/review-rules'

export type { Finding, FindingStatus, OcrResult, ReviewRule, Verdict }

export type CaseStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEEDS_REVISION'
  | 'REVISION_SUBMITTED'
  | 'APPROVED'
  | 'DISBURSING'
  | 'DISBURSED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'CANCELLED_BY_STAFF'
  | 'EXPIRED'

export interface Reviewer {
  id: string
  name: string
}

export interface QueueRow {
  case_no: string
  /** 佇列只給遮罩後的姓名；完整姓名要進案件頁才看得到（SPEC §11）。 */
  applicant_name_masked: string
  scheme_id: string
  scheme_code: string
  scheme_name: string
  tier_code: string
  payment_channel_code: string
  tool_name: string
  purchase_amount: number
  status: CaseStatus
  first_submitted_at: string
  last_submitted_at: string
  supplement_deadline: string | null
  revision_count: number
  assigned_reviewer: Reviewer | null
  assigned_reviewer_id: string | null
  verdict: Verdict | null
  intake_channel: string
  /** 樂觀鎖用的版本號。 */
  version: number
}

export interface QueuePage {
  items: QueueRow[]
  total: number
}

export interface CaseDocument {
  id: string
  document_type_code: string
  document_type_label: string
  revision: number
  supersedes_id: string | null
  is_current: boolean
  mime: string
  size: number
  page_count: number
  masked: boolean
  uploaded_at: string
  preview_key: string | null
  purged_at: string | null
  /** 伺服器只存 `lines` 與信心值，不存整頁文字（`OcrOut`）。 */
  ocr: (Pick<OcrResult, 'confidence' | 'lines'> & { source: 'applicant' | 'reviewer'; engine: string }) | null
}

/** 承辦端的 finding 多了來源與覆寫紀錄；同一條規則的最新一筆排在前面。 */
export interface CaseFinding extends Omit<Finding, 'note'> {
  id: string
  rule_id: string | null
  /**
   * 文案 key（`review.note.*`），不是句子——一律經 `renderNote()` 再顯示。
   * `packages/review-rules` 的 TS 版產的是句子，兩種都吃得下。
   */
  note: string | null
  source: 'auto' | 'reviewer'
  reviewer: Reviewer | null
  decided_at: string | null
  document_id: string | null
  /** 舊版本的判定，只在歷程裡出現。 */
  superseded?: boolean
}

export interface CaseEvent {
  transition_code: string
  from_status: CaseStatus | null
  to_status: CaseStatus
  actor_type: string
  actor_name?: string | null
  created_at: string
  reason?: string | null
  rejection_codes: string[]
}



export interface AllowedTransition {
  code: string
  label: string
  to_status: CaseStatus
  needs_reason: boolean
  needs_rejection_codes: boolean
  needs_supplement_items: boolean
}

export interface ApprovalBlocker {
  rule_code: string
  label: string
  /** 目前的判定（多半是 MISMATCH / UNREADABLE / PENDING）。 */
  status: FindingStatus
}

export interface SupplementItem {
  document_type_code: string
  rejection_code: string
  note: string
}

export interface CaseDetail extends QueueRow {
  applicant_name: string
  phone_masked: string
  email: string | null
  id_last4_masked: string
  purchase_date: string
  paid_by_proxy: boolean
  note: string | null
  supplement_items: SupplementItem[]
  supplement_deadline: string | null
  payment_date: string | null
  payment_amount: number | null
  approved_amount: number | null
  /** 伺服器算出來的必備文件代碼；補件表單的選項來源。 */
  required_document_types: string[]
  documents_purge_at: string | null
  documents: CaseDocument[]
  findings: CaseFinding[]
  events: CaseEvent[]
  rules: ReviewRule[]
  allowed_transitions: AllowedTransition[]
  /** 非空時核定（T3）不可按，列出的是還沒 MATCH 的 required 規則。 */
  approval_blockers: ApprovalBlocker[]
}

/**
 * 退件原因。案件詳情沒有帶方案設定，所以這份清單來自
 * `GET /api/apply/schemes/{code}`——那支端點沒有 `staff_label`，
 * 表單只好用給市民看的說法當選項標題（見 README「契約缺口」）。
 */
export interface RejectionCodeOption {
  code: string
  staff_label?: string
  public_what_wrong: string
  public_how_to_fix: string
  related_document_type_codes: string[]
}

export interface DocumentTypeOption {
  code: string
  label: string
}

export interface PresignedUrl {
  url: string
  expires_at: string
}

export interface TransitionInput {
  code: string
  reason?: string
  rejection_codes?: string[]
  supplement_items?: SupplementItem[]
  supplement_deadline?: string
  payload?: Record<string, unknown>
}

export interface FindingOverrideInput {
  status: 'MATCH' | 'MISMATCH' | 'UNREADABLE'
  extracted_value?: string
  note?: string
}
