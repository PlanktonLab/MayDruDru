/** 送件前的即時判定（SPEC §8.1 第 4 步）。
 *
 * 用的是 seed 的那一組規則，所以這裡驗的同時也在驗「文案都接得上 rejection_codes」。
 */

import { describe, expect, it } from 'vitest'
import type { ApplicationFacts } from '@maydru/review-rules'
import { rejectionForRule, runPrecheck, sopHref, toProblem } from './precheck'
import { SCHEME } from '../mocks/data'
import type { UploadedDoc } from './state'
import type { OcrResult } from '../lib/types'

function ocr(lines: string[]): OcrResult {
  return {
    text: lines.join('\n'),
    confidence: 90,
    lines: lines.map((text, index) => ({
      text,
      confidence: 90,
      bbox: { x0: 0, y0: index * 30, x1: 300, y1: index * 30 + 24 },
      words: [],
    })),
  }
}

function doc(code: string, lines: string[]): UploadedDoc {
  return {
    document_type_code: code,
    blob: new Blob(['x']),
    previewUrl: 'blob:x',
    mime: 'image/jpeg',
    page_count: 1,
    masked: true,
    ocr: ocr(lines),
    originalFormat: 'JPEG',
    qualityNote: null,
    fileName: `${code}.jpg`,
  }
}

const ALL_CREDIT_CARD_DOCS = [
  'ID_CARD_FRONT',
  'ID_CARD_BACK',
  'OFFICIAL_RECEIPT',
  'CARD_LAST4_PHOTO',
  'BILLING_STATEMENT',
  'BANKBOOK_COVER',
  'AFFIDAVIT',
]

function facts(amount: number): ApplicationFacts {
  return {
    purchase_amount: amount,
    purchase_date: '2026-08-01',
    tier_code: 'GENERAL',
    payment_channel_code: 'CREDIT_CARD',
    paid_by_proxy: false,
    required_document_type_codes: ALL_CREDIT_CARD_DOCS,
  }
}

function completeDocs(billingLines: string[]): UploadedDoc[] {
  return ALL_CREDIT_CARD_DOCS.map((code) =>
    code === 'BILLING_STATEMENT' ? doc(code, billingLines) : doc(code, ['範例文字']),
  )
}

describe('runPrecheck', () => {
  it('帳單金額與申報金額差太多時判 FAIL，並指到帳單那份文件', () => {
    const view = runPrecheck({
      scheme: SCHEME,
      docs: completeDocs(['臺幣 6,000', '扣款日 2026/08/01']),
      facts: facts(20000),
    })
    expect(view.verdict).toBe('FAIL')
    expect(view.blocking.map((item) => item.rule_code)).toContain('AMOUNT_MATCHES_CLAIM')
    expect(view.problemsByDoc.BILLING_STATEMENT).toBeTruthy()
  })

  it('FAIL 的說明用的是 rejection_code 的公開文案，不是規則代號', () => {
    const view = runPrecheck({
      scheme: SCHEME,
      docs: completeDocs(['臺幣 6,000', '扣款日 2026/08/01']),
      facts: facts(20000),
    })
    const problem = view.problemsByDoc.BILLING_STATEMENT[0]
    expect(problem.what_wrong).toBe('帳單上的金額與你填寫的金額不一致')
    expect(problem.how_to_fix).toContain('以帳單上實際扣款的臺幣金額為準')
    expect(problem.sop_href).toBe('/sop?document_type=BILLING_STATEMENT')
  })

  it('金額在容差內時不再阻擋送出', () => {
    const view = runPrecheck({
      scheme: SCHEME,
      docs: completeDocs(['臺幣 6,000', '扣款日 2026/08/01']),
      facts: facts(6000),
    })
    expect(view.verdict).not.toBe('FAIL')
    expect(view.blocking).toHaveLength(0)
  })

  it('缺件會判 FAIL，並列出還缺哪幾份（供補件用）', () => {
    const view = runPrecheck({
      scheme: SCHEME,
      docs: [doc('ID_CARD_FRONT', ['姓名'])],
      facts: facts(6000),
    })
    expect(view.verdict).toBe('FAIL')
    expect(view.missingDocumentTypes).toContain('BILLING_STATEMENT')
    expect(view.missingDocumentTypes).not.toContain('ID_CARD_FRONT')
  })

  it('看不清楚（UNREADABLE）只放進 warnings，不擋送出', () => {
    const view = runPrecheck({
      scheme: SCHEME,
      docs: completeDocs(['這張圖上沒有任何可辨識的金額']),
      facts: facts(6000),
    })
    expect(view.verdict).toBe('INDETERMINATE')
    expect(view.blocking).toHaveLength(0)
    expect(view.warnings.length).toBeGreaterThan(0)
  })

  it('沒有任何文件時不呼叫規則也不會炸掉', () => {
    const view = runPrecheck({ scheme: SCHEME, docs: [], facts: facts(6000) })
    expect(view.findings.length).toBe(SCHEME.review_rules.length)
  })
})

describe('文案對應', () => {
  it('規則的 rejection_code 都找得到對應的公開說明', () => {
    for (const rule of SCHEME.review_rules) {
      const code = (rule.config as { rejection_code?: string }).rejection_code
      if (!code) continue
      expect(rejectionForRule(SCHEME, rule.code)?.code).toBe(code)
    }
  })

  it('沒有對應 rejection_code 的規則退回規則標籤，不露出代號', () => {
    const problem = toProblem(SCHEME, {
      rule_code: 'RECEIPT_AMOUNT',
      status: 'UNREADABLE',
      extracted_value: null,
      expected_value: null,
      confidence: null,
      bbox: null,
      document_type_code: 'OFFICIAL_RECEIPT',
      note: '收據上找不到金額。',
    })
    expect(problem.what_wrong).toBe('收據上的金額')
    expect(problem.how_to_fix).toBe('收據上找不到金額。')
  })

  it('sopHref 沒有文件類型時退回 /sop', () => {
    expect(sopHref(null)).toBe('/sop')
    expect(sopHref('ID_CARD_BACK')).toBe('/sop?document_type=ID_CARD_BACK')
    expect(sopHref('BILLING_STATEMENT', { scheme: 'HCAI115', rejectionCode: 'BAD_BILL' }))
      .toBe('/sop?document_type=BILLING_STATEMENT&scheme=HCAI115&rejection_code=BAD_BILL')
  })
})
