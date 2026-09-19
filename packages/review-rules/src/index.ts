/** `@maydru/review-rules` — 規則引擎的 TypeScript 版。
 *
 * 只用於送件流程的**即時回饋**；判定以伺服器的 Python 版為準（SPEC §14）。
 * 兩版共用同一組 JSON fixtures，CI 會比對兩者對同一輸入的輸出。
 *
 * P0 佔位：四種 rule_type 的實作在 P3（SPEC §16）。
 */

/** 單條規則對單一欄位的判定結果。 */
export type FindingStatus = 'pending' | 'pass' | 'fail' | 'unreadable'

export interface Finding {
  ruleId: string
  field: string
  status: FindingStatus
  /** 給市民看的說明；正式文案一律來自 `contents`，這裡只放 key。 */
  messageKey?: string
}

export interface PrecheckInput {
  /** 欄位名 → 市民端擷取到的值（OCR 或手動輸入）。 */
  fields: Record<string, string>
}

export interface PrecheckResult {
  findings: Finding[]
  /** 任一 finding 為 fail 時為 false。 */
  ok: boolean
}

/** P0 佔位：沒有規則就沒有 finding，一律放行。 */
export function precheck(input: PrecheckInput): PrecheckResult {
  void input
  return { findings: [], ok: true }
}
