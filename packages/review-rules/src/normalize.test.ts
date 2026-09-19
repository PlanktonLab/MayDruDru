import { describe, expect, it } from 'vitest'
import {
  applyNormalizer,
  normalizeAmount,
  normalizeDate,
  normalizeLast4,
  parseAmount,
} from './normalize'

describe('normalizeAmount', () => {
  it('去掉幣別、千分位與中文單位', () => {
    expect(normalizeAmount('NT$1,200')).toBe('1200')
    expect(normalizeAmount('TWD 1,200.00')).toBe('1200')
    expect(normalizeAmount('US$ 39.99')).toBe('39.99')
    expect(normalizeAmount('1,200 元')).toBe('1200')
    expect(normalizeAmount('  648  ')).toBe('648')
  })

  it('全形數字也算數', () => {
    expect(normalizeAmount('ＮＴ＄１，２００')).toBe('1200')
  })

  it('整數不帶小數點', () => {
    expect(normalizeAmount('1200.00')).toBe('1200')
    expect(normalizeAmount('1200.50')).toBe('1200.5')
  })

  it('沒有數字、或超過一個小數點 → null', () => {
    expect(normalizeAmount('Visa ending')).toBeNull()
    expect(normalizeAmount('')).toBeNull()
    // 歐式寫法無法判斷千分位與小數點，寧可交給人工
    expect(normalizeAmount('1.200,50')).toBeNull()
  })
})

describe('normalizeDate', () => {
  it('民國年轉西元', () => {
    expect(normalizeDate('民國115年9月1日')).toBe('2026-09-01')
    expect(normalizeDate('扣款日期 115 年 12 月 31 日')).toBe('2026-12-31')
    expect(normalizeDate('115/09/01')).toBe('2026-09-01')
  })

  it('ISO、點分隔與八碼', () => {
    expect(normalizeDate('2026-09-01')).toBe('2026-09-01')
    expect(normalizeDate('2026-9-1')).toBe('2026-09-01')
    expect(normalizeDate('2026.09.01')).toBe('2026-09-01')
    expect(normalizeDate('20260901')).toBe('2026-09-01')
    expect(normalizeDate('2026/09/01')).toBe('2026-09-01')
  })

  it('月日超出範圍或根本沒有日期 → null', () => {
    expect(normalizeDate('2026-13-01')).toBeNull()
    expect(normalizeDate('2026-09-45')).toBeNull()
    expect(normalizeDate('沒有日期')).toBeNull()
  })
})

describe('normalizeLast4', () => {
  it('遮罩字元後面的四碼', () => {
    expect(normalizeLast4('**** **** **** 4826')).toBe('4826')
    expect(normalizeLast4('xxxx-xxxx-xxxx-4826')).toBe('4826')
    expect(normalizeLast4('•••• 4826')).toBe('4826')
  })

  it('結尾剛好四碼', () => {
    expect(normalizeLast4('卡號末四碼 4826')).toBe('4826')
    expect(normalizeLast4('4826')).toBe('4826')
  })

  it('看不出末四碼時回 null，不亂猜', () => {
    expect(normalizeLast4('Visa ending')).toBeNull()
    expect(normalizeLast4('有效期限 12/28')).toBeNull()
    expect(normalizeLast4('')).toBeNull()
  })
})

describe('applyNormalizer / parseAmount', () => {
  it('沒指定 normalizer 時只 trim', () => {
    expect(applyNormalizer('  Pro Plan  ')).toBe('Pro Plan')
  })

  it('指定了就照做', () => {
    expect(applyNormalizer(' NT$1,200 ', 'amount')).toBe('1200')
    expect(applyNormalizer('民國115年9月1日', 'date')).toBe('2026-09-01')
    expect(applyNormalizer('**** 4826', 'last4')).toBe('4826')
  })

  it('parseAmount 把正規化後的字串轉回數字', () => {
    expect(parseAmount('NT$1,200')).toBe(1200)
    expect(parseAmount('1200.5')).toBe(1200.5)
    expect(parseAmount('Visa')).toBeNull()
  })
})
