/** 案件狀態的市民用語（SPEC §7 表末列「文案」）。
 *
 * 唯一來源是 `contents` 的 `status.{STATUS}.public_label / next_action`（P2）。
 * 這裡的常數只是**離線備援**：contents 還沒上線、或這次請求失敗時，畫面仍然要說人話，
 * 不能退回顯示 `NEEDS_REVISION` 這種代號。字面逐字沿用 submit-flow 的
 * `STATUS_PUBLIC_LABEL`（盤點 §A7）。
 */

import type { BadgeTone } from '@maydru/ui'
import type { CaseStatus } from './types'

export const STATUS_PUBLIC_LABEL: Record<CaseStatus, string> = {
  SUBMITTED: '已收件，等待審核',
  UNDER_REVIEW: '審核中',
  NEEDS_REVISION: '需要補件',
  REVISION_SUBMITTED: '已收到補件，等待再次審核',
  APPROVED: '已核定，準備撥款',
  DISBURSING: '撥款作業中',
  DISBURSED: '已撥款完成',
  REJECTED: '未通過',
  WITHDRAWN: '已撤回',
  CANCELLED_BY_STAFF: '已註銷',
  EXPIRED: '補件逾期，已結案',
}

/** 「現在換你做什麼」——沒有事要做時也要明講，免得市民乾等（SPEC §15.1）。 */
export const STATUS_NEXT_ACTION: Record<CaseStatus, string> = {
  SUBMITTED: '不用做任何事。承辦人員會依送件順序開始審核，有結果會通知你。',
  UNDER_REVIEW: '不用做任何事。若需要補件，這一頁會出現要補的文件清單。',
  NEEDS_REVISION: '請在期限前補齊下列文件。只要重傳被標示的那幾份，其他已通過的不用再傳。',
  REVISION_SUBMITTED: '補件已收到，不用再傳一次。審核順序仍依第一次送件的時間，不會重新排隊。',
  APPROVED: '不用做任何事。撥款作業會在核定後依序進行。',
  DISBURSING: '不用做任何事。款項撥出後這裡會更新。',
  DISBURSED: '已完成。證明文件會依保存期限自動刪除。',
  REJECTED: '這件案子已結案。若對結果有疑義，請洽承辦單位。',
  WITHDRAWN: '你已撤回這件申請。如要重新申請，請從首頁重新送件。',
  CANCELLED_BY_STAFF: '這件案子已由承辦註銷。若有疑義，請洽承辦單位。',
  EXPIRED: '補件期限已過，案件結案。如仍要申請，請從首頁重新送件。',
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

/** 標籤用的短名：`STATUS_PUBLIC_LABEL` 是一整句，塞不進一顆 badge。 */
export const STATUS_SHORT: Record<CaseStatus, string> = {
  SUBMITTED: '已收件',
  UNDER_REVIEW: '審核中',
  NEEDS_REVISION: '待補件',
  REVISION_SUBMITTED: '已補件',
  APPROVED: '已核定',
  DISBURSING: '撥款中',
  DISBURSED: '已撥款',
  REJECTED: '未通過',
  WITHDRAWN: '已撤回',
  CANCELLED_BY_STAFF: '已註銷',
  EXPIRED: '已逾期',
}

export const ALL_STATUSES = Object.keys(STATUS_PUBLIC_LABEL) as CaseStatus[]

/** contents 的 key 命名（SPEC §7）；查詢頁一次要到所有狀態的兩種文案。 */
export function contentKeys(): string[] {
  return ALL_STATUSES.flatMap((status) => [`status.${status}.public_label`, `status.${status}.next_action`])
}

export type ContentOverlay = Record<string, string>

export function publicLabel(status: CaseStatus, overlay: ContentOverlay = {}): string {
  return overlay[`status.${status}.public_label`] || STATUS_PUBLIC_LABEL[status] || status
}

export function nextAction(status: CaseStatus, overlay: ContentOverlay = {}): string {
  return overlay[`status.${status}.next_action`] || STATUS_NEXT_ACTION[status] || ''
}
