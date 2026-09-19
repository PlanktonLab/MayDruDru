import { describe, expect, it } from 'vitest'
import { evaluate, pickKeyword, precheck, suggestedSupplements, valueAfterKeyword, withinTolerance } from './engine'
import type { ApplicationFacts, Finding, OcrDocument, ReviewRule } from './types'

const rule = (patch: Partial<ReviewRule> & Pick<ReviewRule, 'code' | 'rule_type'>): ReviewRule => ({
  label: patch.code,
  document_type_code: null,
  config: {},
  required: true,
  severity: 'error',
  sort_order: 10,
  active: true,
  ...patch,
})

const facts: ApplicationFacts = {
  purchase_amount: 1200,
  purchase_date: null,
  tier_code: 'GENERAL',
  payment_channel_code: 'CREDIT_CARD',
  paid_by_proxy: false,
  required_document_type_codes: [],
}

const line = (text: string, confidence = 90) => ({
  text,
  confidence,
  bbox: { x0: 0, y0: 0, x1: 100, y1: 40 },
  words: [],
})

const document = (code: string, texts: string[]): OcrDocument => ({
  document_type_code: code,
  ocr: { text: texts.join('\n'), confidence: 90, lines: texts.map((text) => line(text)) },
})

describe('pickKeyword', () => {
  it('含拉丁字母的關鍵字優先', () => {
    expect(pickKeyword('Amount 金額 NT$1,200', ['金額', 'amount'])).toBe('amount')
  })

  it('沒有拉丁關鍵字時退回一般子字串', () => {
    expect(pickKeyword('臺幣金額 NT$1,200', ['金額', 'total'])).toBe('金額')
  })

  it('最後才用去空白比對', () => {
    expect(pickKeyword('卡 號 末 四 碼 4826', ['卡號末四碼'])).toBe('卡號末四碼')
  })

  it('完全對不上時回 undefined', () => {
    expect(pickKeyword('NORTHSTAR AI', ['金額'])).toBeUndefined()
  })
})

describe('valueAfterKeyword', () => {
  it('去掉開頭的分隔符號', () => {
    expect(valueAfterKeyword('臺幣金額：NT$1,200', '臺幣金額')).toBe('NT$1,200')
    expect(valueAfterKeyword('品項 — Pro Plan', '品項')).toBe('Pro Plan')
    expect(valueAfterKeyword('卡號#4826', '卡號')).toBe('4826')
  })

  it('關鍵字只在去空白後才對上（indexOf 為 -1）時退回整行', () => {
    expect(valueAfterKeyword('卡 號 4826', '卡號')).toBe('卡 號 4826')
  })
})

describe('withinTolerance', () => {
  it('百分比與絕對值兩個條件都要成立', () => {
    expect(withinTolerance(1234, 1200, 5, 150)).toBe(true)
    // 百分比過、絕對值不過
    expect(withinTolerance(10151, 10000, 5, 150)).toBe(false)
    // 絕對值過、百分比不過
    expect(withinTolerance(110, 100, 5, 150)).toBe(false)
  })

  it('邊界用 <=', () => {
    expect(withinTolerance(1050, 1000, 5, 150)).toBe(true)
    expect(withinTolerance(10150, 10000, 5, 150)).toBe(true)
  })

  it('申報金額為 0 一律不成立', () => {
    expect(withinTolerance(0, 0, 5, 150)).toBe(false)
  })
})

describe('evaluate', () => {
  it('source_rule_code 排在後面也讀得到', () => {
    const rules = [
      rule({
        code: 'CHECK',
        rule_type: 'amount_tolerance',
        sort_order: 1,
        config: {
          source_rule_code: 'AMOUNT',
          compare_to: 'purchase_amount',
          tolerance_pct: 5,
          tolerance_abs: 150,
        },
      }),
      rule({
        code: 'AMOUNT',
        rule_type: 'keyword_extract',
        sort_order: 2,
        config: { keywords: ['金額'], value_after_keyword: true, normalize: 'amount' },
      }),
    ]
    const findings = evaluate(rules, [document('BILLING_STATEMENT', ['金額 NT$1,200'])], facts)
    expect(findings.map((f) => f.rule_code)).toEqual(['CHECK', 'AMOUNT'])
    expect(findings[0].status).toBe('MATCH')
  })

  it('regex 編不起來時給承辦人看得懂的 note', () => {
    const rules = [rule({ code: 'BAD', rule_type: 'regex_extract', config: { pattern: '([' } })]
    const findings = evaluate(rules, [document('BILLING_STATEMENT', ['金額 1200'])], facts)
    expect(findings[0].status).toBe('UNREADABLE')
    expect(findings[0].note).toContain('方案管理')
  })

  it('沒有任何文件時 note 請市民先上傳', () => {
    const rules = [
      rule({
        code: 'AMOUNT',
        rule_type: 'keyword_extract',
        document_type_code: 'BILLING_STATEMENT',
        config: { keywords: ['金額'], value_after_keyword: true },
      }),
    ]
    expect(evaluate(rules, [], facts)[0].note).toContain('請先上傳')
  })

  it('文件在但還沒辨識出文字時請市民重拍', () => {
    const rules = [
      rule({
        code: 'AMOUNT',
        rule_type: 'keyword_extract',
        document_type_code: 'BILLING_STATEMENT',
        config: { keywords: ['金額'], value_after_keyword: true },
      }),
    ]
    const documents: OcrDocument[] = [{ document_type_code: 'BILLING_STATEMENT', ocr: null }]
    expect(evaluate(rules, documents, facts)[0].note).toContain('重拍')
  })

  it('未知的 rule_type 回 PENDING 而不是爆掉', () => {
    const rules = [rule({ code: 'FUTURE', rule_type: 'llm_vibes' as ReviewRule['rule_type'] })]
    expect(evaluate(rules, [], facts)[0].status).toBe('PENDING')
  })
})

describe('precheck', () => {
  const findingOf = (patch: Partial<Finding> & Pick<Finding, 'rule_code' | 'status'>): Finding => ({
    extracted_value: null,
    expected_value: null,
    confidence: null,
    bbox: null,
    document_type_code: null,
    note: null,
    ...patch,
  })

  it('required + error 的 MISMATCH 擋送出', () => {
    const rules = [rule({ code: 'A', rule_type: 'required_doc' })]
    const result = precheck([findingOf({ rule_code: 'A', status: 'MISMATCH' })], rules)
    expect(result.verdict).toBe('FAIL')
    expect(result.blocking).toHaveLength(1)
    expect(result.warnings).toHaveLength(0)
  })

  it('warning 級的 MISMATCH 只降級', () => {
    const rules = [rule({ code: 'A', rule_type: 'required_doc', severity: 'warning' })]
    const result = precheck([findingOf({ rule_code: 'A', status: 'MISMATCH' })], rules)
    expect(result.verdict).toBe('INDETERMINATE')
    expect(result.warnings).toHaveLength(1)
  })

  it('非必填的 error MISMATCH 也只降級', () => {
    const rules = [rule({ code: 'A', rule_type: 'required_doc', required: false })]
    expect(precheck([findingOf({ rule_code: 'A', status: 'MISMATCH' })], rules).verdict).toBe(
      'INDETERMINATE',
    )
  })

  it('UNREADABLE 與 PENDING 都算 warning', () => {
    const rules = [
      rule({ code: 'A', rule_type: 'keyword_extract' }),
      rule({ code: 'B', rule_type: 'amount_tolerance' }),
    ]
    const result = precheck(
      [
        findingOf({ rule_code: 'A', status: 'UNREADABLE' }),
        findingOf({ rule_code: 'B', status: 'PENDING' }),
      ],
      rules,
    )
    expect(result.verdict).toBe('INDETERMINATE')
    expect(result.warnings).toHaveLength(2)
  })

  it('全部 MATCH → PASS', () => {
    const rules = [rule({ code: 'A', rule_type: 'keyword_extract' })]
    expect(precheck([findingOf({ rule_code: 'A', status: 'MATCH' })], rules).verdict).toBe('PASS')
  })

  it('FAIL 蓋過 INDETERMINATE', () => {
    const rules = [
      rule({ code: 'A', rule_type: 'required_doc' }),
      rule({ code: 'B', rule_type: 'keyword_extract' }),
    ]
    const result = precheck(
      [
        findingOf({ rule_code: 'A', status: 'MISMATCH' }),
        findingOf({ rule_code: 'B', status: 'UNREADABLE' }),
      ],
      rules,
    )
    expect(result.verdict).toBe('FAIL')
  })
})

describe('suggestedSupplements', () => {
  it('合併所有補件建議並去重', () => {
    const findings: Finding[] = [
      {
        rule_code: 'A',
        status: 'MISMATCH',
        extracted_value: null,
        expected_value: null,
        confidence: null,
        bbox: null,
        document_type_code: null,
        note: null,
        suggested_supplement: ['ID_CARD_FRONT', 'BILLING_STATEMENT'],
      },
      {
        rule_code: 'B',
        status: 'MISMATCH',
        extracted_value: null,
        expected_value: null,
        confidence: null,
        bbox: null,
        document_type_code: null,
        note: null,
        suggested_supplement: ['BILLING_STATEMENT', 'AFFIDAVIT'],
      },
    ]
    expect(suggestedSupplements(findings)).toEqual([
      'ID_CARD_FRONT',
      'BILLING_STATEMENT',
      'AFFIDAVIT',
    ])
  })
})
