/** 規則引擎的型別（SPEC §6.2 `review_rules`、§6.3 `review_findings`、§8.3）。
 *
 * 欄位名一律用 snake_case，和資料表／OpenAPI／Python 版同名，fixtures 才能直接共用。
 */

import type { BoundingBox, OcrResult } from '@maydru/ocr'

export type { BoundingBox, OcrResult }

export type RuleType = 'keyword_extract' | 'regex_extract' | 'amount_tolerance' | 'required_doc'

export type Severity = 'error' | 'warning'

export type FindingStatus = 'MATCH' | 'MISMATCH' | 'UNREADABLE' | 'PENDING'

export type Normalizer = 'amount' | 'date' | 'last4'

export interface KeywordExtractConfig {
  keywords: string[]
  /** true：取關鍵字後面的字；false：整行都算值。 */
  value_after_keyword: boolean
  /** 可選的抽值 regex；命中時取 `match[0]`（或 `group`）。 */
  regex?: string
  group?: number
  normalize?: Normalizer
}

export interface RegexExtractConfig {
  pattern: string
  group?: number
  normalize?: Normalizer
}

export interface AmountToleranceConfig {
  /** 去哪一條規則拿金額。 */
  source_rule_code: string
  compare_to: 'purchase_amount'
  /** 百分比，5 代表 5%。 */
  tolerance_pct: number
  /** 絕對金額（元）。 */
  tolerance_abs: number
}

export interface RequiredDocConfig {
  /** 空陣列 → 改用 `facts.required_document_type_codes`。 */
  document_type_codes?: string[]
}

export type RuleConfig =
  | KeywordExtractConfig
  | RegexExtractConfig
  | AmountToleranceConfig
  | RequiredDocConfig
  | Record<string, unknown>

export interface ReviewRule {
  code: string
  label: string
  /** null → 不限文件類型，所有文件一起找。 */
  document_type_code: string | null
  rule_type: RuleType
  config: RuleConfig
  required: boolean
  severity: Severity
  sort_order: number
  active: boolean
}

export interface OcrDocument {
  document_type_code: string
  /** 還沒辨識完就是 null。 */
  ocr: OcrResult | null
}

export interface ApplicationFacts {
  purchase_amount: number | null
  purchase_date?: string | null
  tier_code: string
  payment_channel_code: string
  paid_by_proxy: boolean
  /** 由 `payment_channels.required_document_type_codes` 推導而來。 */
  required_document_type_codes: string[]
}

export interface Finding {
  rule_code: string
  status: FindingStatus
  extracted_value: string | null
  expected_value: string | null
  /** 來源那一行的 OCR 信心值（0–100），沒有就是 null。 */
  confidence: number | null
  bbox: BoundingBox | null
  document_type_code: string | null
  /** 給承辦人與市民看的一句話；沒有就是 null。 */
  note: string | null
  /** 只有 `required_doc` 判 MISMATCH 時才有：缺的文件類型代碼。 */
  suggested_supplement?: string[]
}

export type Verdict = 'PASS' | 'FAIL' | 'INDETERMINATE'

export interface PrecheckResult {
  verdict: Verdict
  /** 擋住送出的 findings（required + severity error + MISMATCH）。 */
  blocking: Finding[]
  /** 不擋送出、但需要人工看一眼的 findings。 */
  warnings: Finding[]
}
