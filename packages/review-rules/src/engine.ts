/** 規則引擎（SPEC §8.3）。
 *
 * ⚠️ **判定以伺服器的 Python 版（`services/review.py`）為準**，這份 TS 版只做送件時的
 * 即時回饋。兩邊共用 `fixtures/*.json`，CI 會比對同一輸入的輸出，所以任何行為調整
 * 都要兩邊一起改，並補一個 fixture。
 *
 * 引擎**不呼叫任何模型**，也不需要網路（SPEC §8.3 末段）。
 */

import { applyNormalizer, parseAmount } from './normalize'
import type {
  AmountToleranceConfig,
  ApplicationFacts,
  Finding,
  KeywordExtractConfig,
  OcrDocument,
  PrecheckResult,
  RegexExtractConfig,
  RequiredDocConfig,
  ReviewRule,
  Verdict,
} from './types'
import type { OcrLine as Line } from '@maydru/ocr'

interface Candidate {
  document_type_code: string
  line: Line
  value: string
  score: number
}

const finding = (rule_code: string, patch: Partial<Finding>): Finding => ({
  rule_code,
  status: 'PENDING',
  extracted_value: null,
  expected_value: null,
  confidence: null,
  bbox: null,
  document_type_code: null,
  note: null,
  ...patch,
})

/** 這條規則要看哪些文件：`document_type_code` 為 null 時看全部。 */
function documentsFor(rule: ReviewRule, documents: OcrDocument[]): OcrDocument[] {
  if (rule.document_type_code === null) return documents
  return documents.filter((document) => document.document_type_code === rule.document_type_code)
}

function compile(pattern: string | undefined): RegExp | null {
  if (!pattern) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

/**
 * 關鍵字偏好順序（port 自 proreview `detected()`，**順序不可調換**）：
 *   1. 含拉丁字母、且出現在小寫化後的整行裡的關鍵字；
 *   2. 任何出現在小寫化後整行裡的關鍵字；
 *   3. 去掉所有空白後才對上的關鍵字。
 *
 * 第 3 種命中時，`line.text.toLowerCase().indexOf(keyword)` 會是 -1，
 * 於是取值退回「整行」——這是 proreview 的既有行為，刻意保留。
 */
export function pickKeyword(lineText: string, keywords: string[]): string | undefined {
  const lower = lineText.toLowerCase()
  const compact = lower.replace(/\s+/g, '')
  return (
    keywords.find((keyword) => /[a-z]/i.test(keyword) && lower.includes(keyword)) ??
    keywords.find((keyword) => lower.includes(keyword)) ??
    keywords.find((keyword) => compact.includes(keyword.replace(/\s+/g, '')))
  )
}

/** 關鍵字後面的值：去掉開頭的 `[\s:：#—–\-/]+`。 */
export function valueAfterKeyword(lineText: string, keyword: string): string {
  const index = lineText.toLowerCase().indexOf(keyword)
  if (index < 0) return lineText.trim()
  return lineText
    .slice(index + keyword.length)
    .replace(/^[\s:：#—–/-]+/, '')
    .trim()
}

function keywordExtract(
  rule: ReviewRule,
  documents: OcrDocument[],
): Finding {
  const config = rule.config as KeywordExtractConfig
  const keywords = (config.keywords ?? [])
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean)
  const pattern = compile(config.regex)
  const scoped = documentsFor(rule, documents)

  const candidates: Candidate[] = []
  for (const document of scoped) {
    for (const line of document.ocr?.lines ?? []) {
      const keyword = pickKeyword(line.text, keywords)
      if (keywords.length > 0 && keyword === undefined) continue
      const match = pattern ? pattern.exec(line.text) : null
      if (pattern && !match) continue

      let value = ''
      if (match) value = (match[config.group ?? 0] ?? '').trim()
      if (!value && config.value_after_keyword && keyword !== undefined)
        value = valueAfterKeyword(line.text, keyword)
      if (!value) value = line.text.trim()

      // 分數：命中 regex 加 3，OCR 信心值當作小數位的 tie-breaker。
      // 相同分數時「先出現的贏」（下面用嚴格大於，不用大於等於）。
      candidates.push({
        document_type_code: document.document_type_code,
        line,
        value,
        score: 10 + (match ? 3 : 0) + (line.confidence || 0) / 100,
      })
    }
  }

  let best: Candidate | null = null
  for (const candidate of candidates) if (!best || candidate.score > best.score) best = candidate

  if (!best)
    return finding(rule.code, {
      status: 'UNREADABLE',
      document_type_code: rule.document_type_code,
      note: unreadableNote(rule, scoped),
    })

  const normalized = applyNormalizer(best.value, config.normalize)
  if (normalized === null)
    return finding(rule.code, {
      status: 'UNREADABLE',
      extracted_value: best.value,
      confidence: best.line.confidence,
      bbox: best.line.bbox,
      document_type_code: best.document_type_code,
      note: `在「${rule.label}」讀到「${best.value}」，但轉不成標準格式，請人工確認。`,
    })

  return finding(rule.code, {
    status: 'MATCH',
    extracted_value: normalized,
    confidence: best.line.confidence,
    bbox: best.line.bbox,
    document_type_code: best.document_type_code,
  })
}

/** 找出第一行包含這段文字的 OCR 行，用它的 bbox 當高亮位置。 */
function lineContaining(documents: OcrDocument[], raw: string): { document_type_code: string; line: Line } | null {
  const needle = raw.trim()
  if (!needle) return null
  for (const document of documents)
    for (const line of document.ocr?.lines ?? [])
      if (line.text.includes(needle)) return { document_type_code: document.document_type_code, line }
  return null
}

function regexExtract(rule: ReviewRule, documents: OcrDocument[]): Finding {
  const config = rule.config as RegexExtractConfig
  const pattern = compile(config.pattern)
  const scoped = documentsFor(rule, documents)

  if (!pattern)
    return finding(rule.code, {
      status: 'UNREADABLE',
      document_type_code: rule.document_type_code,
      note: `規則「${rule.label}」的 regex 無法編譯，請到方案管理修正這條規則。`,
    })

  for (const document of scoped) {
    const text = document.ocr?.text ?? ''
    if (!text) continue
    const match = pattern.exec(text)
    if (!match) continue
    const raw = (match[config.group ?? 0] ?? '').trim()
    const located = lineContaining([document], raw) ?? lineContaining([document], match[0].trim())
    const normalized = applyNormalizer(raw, config.normalize)
    if (normalized === null)
      return finding(rule.code, {
        status: 'UNREADABLE',
        extracted_value: raw,
        confidence: located?.line.confidence ?? document.ocr?.confidence ?? null,
        bbox: located?.line.bbox ?? null,
        document_type_code: document.document_type_code,
        note: `在「${rule.label}」讀到「${raw}」，但轉不成標準格式，請人工確認。`,
      })
    return finding(rule.code, {
      status: 'MATCH',
      extracted_value: normalized,
      confidence: located?.line.confidence ?? document.ocr?.confidence ?? null,
      bbox: located?.line.bbox ?? null,
      document_type_code: document.document_type_code,
    })
  }

  return finding(rule.code, {
    status: 'UNREADABLE',
    document_type_code: rule.document_type_code,
    note: unreadableNote(rule, scoped),
  })
}

function unreadableNote(rule: ReviewRule, scoped: OcrDocument[]): string {
  if (scoped.length === 0) return `還沒有可以檢查「${rule.label}」的文件，請先上傳。`
  if (scoped.every((document) => !document.ocr || document.ocr.lines.length === 0))
    return `文件還沒辨識出文字，找不到「${rule.label}」。請在光線充足處重拍，確認四個角都在畫面內。`
  return `在文件上找不到「${rule.label}」。請確認這份憑證上看得到這個欄位，或改上傳完整的那一頁。`
}

/**
 * 容差比對：**百分比與絕對金額兩個條件都要成立**（port 自 submit-flow
 * `amountWithinTolerance`）。`expected` 為 0 時一律不成立。
 */
export function withinTolerance(
  value: number,
  expected: number,
  tolerancePct: number,
  toleranceAbs: number,
): boolean {
  if (!expected) return false
  const diff = Math.abs(value - expected)
  return diff / expected <= tolerancePct / 100 && diff <= toleranceAbs
}

function amountTolerance(
  rule: ReviewRule,
  facts: ApplicationFacts,
  byCode: Map<string, Finding>,
): Finding {
  const config = rule.config as AmountToleranceConfig
  const source = byCode.get(config.source_rule_code)

  if (!source || source.extracted_value === null)
    return finding(rule.code, {
      status: 'UNREADABLE',
      document_type_code: rule.document_type_code,
      note: `還沒有從憑證上讀到金額（規則「${config.source_rule_code}」），沒辦法比對。請上傳看得到臺幣金額的那一頁。`,
    })

  const value = parseAmount(source.extracted_value)
  if (value === null)
    return finding(rule.code, {
      status: 'UNREADABLE',
      extracted_value: source.extracted_value,
      confidence: source.confidence,
      bbox: source.bbox,
      document_type_code: source.document_type_code,
      note: `憑證上讀到的「${source.extracted_value}」看不出是多少錢，請人工確認。`,
    })

  const expected = facts.purchase_amount
  if (expected === null)
    return finding(rule.code, {
      status: 'PENDING',
      extracted_value: source.extracted_value,
      confidence: source.confidence,
      bbox: source.bbox,
      document_type_code: source.document_type_code,
      note: '還沒有填寫申報金額，填好之後就會自動比對。',
    })

  const ok = withinTolerance(value, expected, config.tolerance_pct, config.tolerance_abs)
  return finding(rule.code, {
    status: ok ? 'MATCH' : 'MISMATCH',
    extracted_value: source.extracted_value,
    expected_value: String(expected),
    confidence: source.confidence,
    bbox: source.bbox,
    document_type_code: source.document_type_code,
    note: ok
      ? null
      : `憑證上的金額 NT$${value} 與你填的 NT$${expected} 差了 NT$${Math.abs(value - expected)}，超出容許範圍（${config.tolerance_pct}% 且 NT$${config.tolerance_abs} 以內）。請以憑證上實際扣款的臺幣金額為準修改申報金額。`,
  })
}

function requiredDoc(
  rule: ReviewRule,
  documents: OcrDocument[],
  facts: ApplicationFacts,
): Finding {
  const config = rule.config as RequiredDocConfig
  const configured = config.document_type_codes ?? []
  const wanted = configured.length > 0 ? configured : facts.required_document_type_codes
  const present = new Set(documents.map((document) => document.document_type_code))

  const missing: string[] = []
  for (const code of wanted) if (!present.has(code) && !missing.includes(code)) missing.push(code)

  if (missing.length === 0)
    return finding(rule.code, {
      status: 'MATCH',
      expected_value: wanted.join(','),
      document_type_code: rule.document_type_code,
    })

  return finding(rule.code, {
    status: 'MISMATCH',
    expected_value: wanted.join(','),
    document_type_code: rule.document_type_code,
    note: `還缺 ${missing.length} 份文件：${missing.join('、')}。補齊之後就可以送出。`,
    suggested_supplement: missing,
  })
}

/** 兩條規則的先後：`sort_order` 小的在前，同 order 再比 `code`。 */
function bySortOrder(a: ReviewRule, b: ReviewRule): number {
  return a.sort_order - b.sort_order || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
}

/**
 * 跑完一組規則。
 *
 * 只跑 `active` 的規則，輸出順序等於 `sort_order`（同 order 比 code）。
 * `amount_tolerance` 會去拿別條規則的結果，所以分兩輪：第一輪跑其餘三種，
 * 第二輪才跑 `amount_tolerance`——這樣 `source_rule_code` 排在後面也讀得到，
 * 而且結果與規則順序無關。
 */
export function evaluate(
  rules: ReviewRule[],
  documents: OcrDocument[],
  facts: ApplicationFacts,
): Finding[] {
  const active = rules.filter((rule) => rule.active).sort(bySortOrder)
  const byCode = new Map<string, Finding>()

  for (const rule of active) {
    if (rule.rule_type === 'amount_tolerance') continue
    byCode.set(rule.code, evaluateOne(rule, documents, facts, byCode))
  }
  for (const rule of active) {
    if (rule.rule_type !== 'amount_tolerance') continue
    byCode.set(rule.code, evaluateOne(rule, documents, facts, byCode))
  }

  return active.map((rule) => byCode.get(rule.code)!)
}

function evaluateOne(
  rule: ReviewRule,
  documents: OcrDocument[],
  facts: ApplicationFacts,
  byCode: Map<string, Finding>,
): Finding {
  switch (rule.rule_type) {
    case 'keyword_extract':
      return keywordExtract(rule, documents)
    case 'regex_extract':
      return regexExtract(rule, documents)
    case 'amount_tolerance':
      return amountTolerance(rule, facts, byCode)
    case 'required_doc':
      return requiredDoc(rule, documents, facts)
    default:
      return finding(rule.code, {
        status: 'PENDING',
        document_type_code: rule.document_type_code,
        note: `這條規則的類型系統還看不懂，會由承辦人員人工確認。`,
      })
  }
}

/**
 * 把 findings 收斂成一個送件前的結論（SPEC §8.1 第 4 步）。
 *
 * - `blocking`：`required` 且 `severity === 'error'` 的 MISMATCH → **FAIL**，擋住送出。
 * - `warnings`：其餘的 MISMATCH，加上所有 UNREADABLE / PENDING → **INDETERMINATE**，
 *   放行但標記，交給承辦人。
 * - 兩者都空 → **PASS**。
 */
export function precheck(findings: Finding[], rules: ReviewRule[]): PrecheckResult {
  const byCode = new Map(rules.map((rule) => [rule.code, rule]))
  const blocking: Finding[] = []
  const warnings: Finding[] = []

  for (const item of findings) {
    const rule = byCode.get(item.rule_code)
    const isBlocking =
      item.status === 'MISMATCH' && rule !== undefined && rule.required && rule.severity === 'error'
    if (isBlocking) blocking.push(item)
    else if (item.status === 'MISMATCH' || item.status === 'UNREADABLE' || item.status === 'PENDING')
      warnings.push(item)
  }

  const verdict: Verdict = blocking.length > 0 ? 'FAIL' : warnings.length > 0 ? 'INDETERMINATE' : 'PASS'
  return { verdict, blocking, warnings }
}

/** 把所有 `required_doc` findings 建議的補件項目合起來（去重、保持順序）。 */
export function suggestedSupplements(findings: Finding[]): string[] {
  const out: string[] = []
  for (const item of findings)
    for (const code of item.suggested_supplement ?? []) if (!out.includes(code)) out.push(code)
  return out
}
