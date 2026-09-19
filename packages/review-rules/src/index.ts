/** `@maydru/review-rules` — 審核規則引擎的 TypeScript 版（SPEC §8.3）。
 *
 * 只用於送件流程的**即時回饋**；判定以伺服器的 Python 版
 * （`apps/api/app/services/review.py`）為準（SPEC §8.1 第 5 步）。
 * 兩版共用 `fixtures/*.json`，CI 比對兩者對同一輸入的輸出（SPEC §14「規則一致性」）。
 *
 * ```ts
 * const findings = evaluate(scheme.review_rules, documents, facts)
 * const { verdict, blocking } = precheck(findings, scheme.review_rules)
 * ```
 */

export type {
  AmountToleranceConfig,
  ApplicationFacts,
  BoundingBox,
  Finding,
  FindingStatus,
  KeywordExtractConfig,
  Normalizer,
  OcrDocument,
  OcrResult,
  PrecheckResult,
  RegexExtractConfig,
  RequiredDocConfig,
  ReviewRule,
  RuleConfig,
  RuleType,
  Severity,
  Verdict,
} from './types'

export {
  NORMALIZERS,
  applyNormalizer,
  normalizeAmount,
  normalizeDate,
  normalizeLast4,
  parseAmount,
} from './normalize'

export {
  evaluate,
  pickKeyword,
  precheck,
  suggestedSupplements,
  valueAfterKeyword,
  withinTolerance,
} from './engine'
