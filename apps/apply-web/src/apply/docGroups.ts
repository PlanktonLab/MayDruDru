/** 上傳步驟的三個分段（移植自原專案 `ApplyFlow` 的 `DOC_SUBSTEPS`）。
 *
 * 七、八份文件攤在同一頁會變成一面牆，捲到一半就不知道還剩幾份。分成三段之後
 * 每一段只有兩三份，而且分法對得上市民腦中的分類：證明我是誰、證明我買了、
 * 錢要匯去哪。分段只是呈現，過關條件仍然是「所有必備文件都齊了」。
 */

import type { SchemeDocumentType } from '../lib/types'

export type DocGroupKey = 'identity' | 'payment' | 'disbursement'

export interface DocGroupDef {
  key: DocGroupKey
  label: string
  desc: string
}

export const DOC_GROUPS: readonly DocGroupDef[] = [
  { key: 'identity', label: '身分證明', desc: '身分證正反面' },
  { key: 'payment', label: '購買與付款憑證', desc: '帳單、收據與卡片照片' },
  { key: 'disbursement', label: '撥款帳戶與切結', desc: '存摺封面與簽名切結書' },
]

/** 文件代碼 → 分段。沒列到的一律落在「購買與付款憑證」——新增的憑證幾乎都屬於那一段。 */
const GROUP_OF: Record<string, DocGroupKey> = {
  ID_CARD_FRONT: 'identity',
  ID_CARD_BACK: 'identity',
  SPECIAL_STATUS_PROOF: 'identity',
  BANKBOOK_COVER: 'disbursement',
  AFFIDAVIT: 'disbursement',
  PROXY_AFFIDAVIT: 'disbursement',
}

export function groupOf(code: string): DocGroupKey {
  return GROUP_OF[code] ?? 'payment'
}

/**
 * 逐期檢附的文件類型。
 *
 * 申請多期時，收據與繳款憑證是「每一期各一份」——第 3 期的帳單證明不了第 1 期
 * 扣過款。身分證、存摺、切結書則與期數無關，整件案子一份就夠。
 */
const PER_PERIOD = new Set(['OFFICIAL_RECEIPT', 'BILLING_STATEMENT', 'TELECOM_BILL', 'TRANSACTION_DETAIL'])

/**
 * 一個上傳欄位。
 *
 * `code` 是送給伺服器的文件類型，`key` 才是畫面與 `docs` 的鍵——申請多期時
 * 同一個類型會展開成 `BILLING_STATEMENT_1`、`_2`…，所以兩者不一定相同。
 */
export interface DocSlot {
  key: string
  code: string
  label: string
  type: SchemeDocumentType
  periodIndex?: number
}

/** 依期數把文件類型展開成實際要傳的欄位。單期時 `key` 就是 `code`，與展開前相同。 */
export function expandSlots(types: readonly SchemeDocumentType[], periods: number): DocSlot[] {
  const count = Math.max(1, Math.round(periods))
  return types.flatMap((type) => {
    if (count <= 1 || !PER_PERIOD.has(type.code)) {
      return [{ key: type.code, code: type.code, label: type.label, type }]
    }
    return Array.from({ length: count }, (_, index) => ({
      key: `${type.code}_${index + 1}`,
      code: type.code,
      label: `${type.label}（第 ${index + 1} 期）`,
      type,
      periodIndex: index + 1,
    }))
  })
}

export interface DocGroupView extends DocGroupDef {
  slots: DocSlot[]
  /** 這一段已經傳好幾份。 */
  done: number
}

/** 把上傳欄位分成三段；沒有欄位的那一段不顯示（例如沒勾代為支付時可能少一份）。 */
export function groupDocuments(slots: readonly DocSlot[], docs: Record<string, unknown>): DocGroupView[] {
  return DOC_GROUPS.map((group) => {
    const members = slots.filter((slot) => groupOf(slot.code) === group.key)
    return { ...group, slots: members, done: members.filter((slot) => docs[slot.key]).length }
  }).filter((group) => group.slots.length > 0)
}
