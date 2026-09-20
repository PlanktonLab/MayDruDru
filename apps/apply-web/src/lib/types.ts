/** 市民端會碰到的 API 形狀（P3 契約，SPEC §10.2 `/api/apply/*`）。
 *
 * 欄位一律 snake_case，和後端、OpenAPI、`@maydru/review-rules` 的 fixtures 同名，
 * 所以規則引擎的輸出可以原樣送出、原樣顯示。
 */

import type { OcrResult } from '@maydru/ocr'
import type { Finding, ReviewRule, Verdict } from '@maydru/review-rules'

export type { Finding, OcrResult, ReviewRule, Verdict }

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

export interface SchemeSummary {
  code: string
  name: string
  category: string
  description: string
  application_start: string | null
  application_end: string | null
  amount_note: string
  tags: string[]
  active: boolean
}

export interface SchemeTier {
  code: string
  label: string
  subsidy_rate: number
  cap_amount: number
  required_proof_doc_types: string[]
}

export interface SchemeDocumentType {
  code: string
  label: string
  hint: string
  required: boolean
  must_mask: boolean
  accepted_mime: string[]
  max_pages: number
  sort_order: number
  /** `proxy`、`tier:LOW_INCOME` 之類的條件；由伺服器決定要不要列入必備。 */
  required_when: string | null
  /**
   * 「請保留清楚可見」的欄位，例如「持卡人姓名、卡號末四碼」。
   * 遮罩編輯器少了它，市民就只知道要遮、不知道不能遮掉什麼（SPEC §8.1 第 2 步）。
   */
  keep_visible: string | null
}

export interface SchemePaymentChannel {
  code: string
  label: string
  /** 這個管道是什麼的一句話。 */
  hint: string
  /** 舉例，例如「例如：VISA／MasterCard／JCB 等各家信用卡」。伺服器還沒回這欄。 */
  example?: string
  required_document_type_codes: string[]
  guide_content_key: string | null
}

export interface SchemeRejectionCode {
  code: string
  /** 給市民看的「哪裡不對」。 */
  public_what_wrong: string
  /** 給市民看的「怎麼修」（SPEC §15.5）。 */
  public_how_to_fix: string
  related_document_type_codes: string[]
  related_sop_flow_ids: string[]
}

/** `APPROVED` 可補助、`REJECTED` 不予補助、`PENDING` 待人工認定。 */
export type ToolStatus = 'APPROVED' | 'REJECTED' | 'PENDING'

export interface EligibleTool {
  id: string
  name: string
  vendor: string
  aliases: string[]
  status: ToolStatus
  /**
   * 判定理由。`GET /api/apply/schemes/{code}` 目前**沒有**回這個欄位，
   * 所以不予補助的工具現在只說「不予補助」說不出為什麼（見 README「契約缺口」）。
   */
  verdict_note?: string
}

export interface SchemeDetail {
  label: string
  value: string
}

export interface SchemePublic extends SchemeSummary {
  eligibility: string
  age_min: number | null
  age_max: number | null
  official_url: string
  contact: string
  identity_tags: string[]
  details: SchemeDetail[]
  supplement_days: number
  max_revisions: number
  tiers: SchemeTier[]
  document_types: SchemeDocumentType[]
  payment_channels: SchemePaymentChannel[]
  rejection_codes: SchemeRejectionCode[]
  review_rules: ReviewRule[]
  eligible_tools: EligibleTool[]
}

export interface CaseSupplementItem {
  period_index?: number
  document_type_code: string
  rejection_code: string
  note: string
}

export interface CaseDocument {
  document_type_code: string
  revision: number
  is_current: boolean
  uploaded_at: string
  page_count: number
}

export interface CaseEvent {
  transition_code: string
  from_status: CaseStatus | null
  to_status: CaseStatus
  actor_type: string
  created_at: string
  rejection_codes: string[]
}

export interface CasePublic {
  case_no: string
  scheme: { code: string; name: string }
  status: CaseStatus
  /** `contents` 的 key；`public_label` / `next_action_text` 是伺服器已經渲染好的同一段字。 */
  public_label_key?: string | null
  next_action?: string | null
  public_label?: string | null
  next_action_text?: string | null
  first_submitted_at: string
  last_submitted_at: string
  revision_count: number
  supplement_items: CaseSupplementItem[]
  supplement_deadline: string | null
  payment_date: string | null
  tool_name: string
  purchase_amount: number
  documents: CaseDocument[]
  events: CaseEvent[]
  can_supplement: boolean
  can_withdraw: boolean
}

export interface VerifyResponse {
  token: string
  expires_at: string
  case_no: string
}

export interface Faq {
  id: string
  category: string
  question: string
  answer: string
  priority: number
}

/** `POST /api/apply/applications` 與補件端點共用的回應。 */
export interface SubmitResponse {
  case_no: string
  status: CaseStatus
  verdict: Verdict
  findings: Finding[]
}

/** multipart 的 `documents` 欄位，一份文件一筆，順序對應 `file_0…`。 */
export interface DocumentPayload {
  period_index?: number
  document_type_code: string
  masked: boolean
  mime: string
  page_count: number
  ocr: OcrResult | null
}
