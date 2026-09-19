/** 案件審核區的用語與格式（SPEC §15.1「數字與日期格式一致」）。
 *
 * 承辦端用的是承辦的說法（`STATUS_STAFF_LABEL`），與市民端的公開說法刻意不同；
 * 兩邊最終都會由 `contents` 提供（P2），這裡是離線備援。
 */

import type { BadgeTone } from '@maydru/ui'
import type { CaseStatus, FindingStatus } from './types'

export const STATUS_STAFF_LABEL: Record<CaseStatus, string> = {
  SUBMITTED: '已送件',
  UNDER_REVIEW: '審核中',
  NEEDS_REVISION: '待補件',
  REVISION_SUBMITTED: '補正待審核',
  APPROVED: '已核定',
  DISBURSING: '撥款中',
  DISBURSED: '已撥款',
  REJECTED: '不通過',
  WITHDRAWN: '已撤回',
  CANCELLED_BY_STAFF: '已註銷',
  EXPIRED: '補件逾期',
}

export const STATUS_TONE: Record<CaseStatus, BadgeTone> = {
  SUBMITTED: 'accent',
  UNDER_REVIEW: 'accent',
  NEEDS_REVISION: 'warn',
  REVISION_SUBMITTED: 'accent',
  APPROVED: 'good',
  DISBURSING: 'good',
  DISBURSED: 'good',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
  CANCELLED_BY_STAFF: 'neutral',
  EXPIRED: 'neutral',
}

export const QUEUE_STATUSES: CaseStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_REVISION',
  'REVISION_SUBMITTED',
  'APPROVED',
  'DISBURSING',
  'DISBURSED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED_BY_STAFF',
  'EXPIRED',
]

/**
 * finding 的狀態只描述**事實**，不做建議。
 *
 * 決策 D2／D3 的精神：審核不用 LLM，系統只說「這裡抽到什麼、對不對得上」，
 * 不說「建議核准」——那是承辦人的判斷，不是系統的。
 */
export const FINDING_LABEL: Record<FindingStatus, string> = {
  PENDING: '待確認',
  MATCH: '符合',
  MISMATCH: '不符',
  UNREADABLE: '無法辨識',
}

export const FINDING_TONE: Record<FindingStatus, BadgeTone> = {
  PENDING: 'neutral',
  MATCH: 'good',
  MISMATCH: 'danger',
  UNREADABLE: 'warn',
}

export const VERDICT_LABEL: Record<string, string> = {
  PASS: '規則全數符合',
  FAIL: '有規則不符',
  INDETERMINATE: '有規則無法辨識',
}

export function money(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '—'
  return `NT$${Math.round(amount).toLocaleString('zh-TW')}`
}

export function date(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return `${parsed.getFullYear()}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return `${date(value)} ${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
}

/** `today + days`，回傳 `<input type="date">` 吃的 `YYYY-MM-DD`。 */
export function deadlineFromToday(days: number, today = new Date()): string {
  const target = new Date(today.getTime() + days * 86_400_000)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
}
