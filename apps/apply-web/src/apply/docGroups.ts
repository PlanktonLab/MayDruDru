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

export interface DocGroupView extends DocGroupDef {
  types: SchemeDocumentType[]
  /** 這一段已經傳好幾份。 */
  done: number
}

/** 把必備文件分成三段；沒有文件的那一段不顯示（例如沒勾代為支付時可能少一份）。 */
export function groupDocuments(
  types: readonly SchemeDocumentType[],
  docs: Record<string, unknown>,
): DocGroupView[] {
  return DOC_GROUPS.map((group) => {
    const members = types.filter((type) => groupOf(type.code) === group.key)
    return { ...group, types: members, done: members.filter((type) => docs[type.code]).length }
  }).filter((group) => group.types.length > 0)
}
