import { describe, expect, it } from 'vitest'
import {
  centerIn,
  digitsOfLine,
  digitsOfWord,
  joinDigits,
  normalizeOcrDigit,
  passesLuhn,
  type WordLike,
} from './luhn'

const word = (text: string, x0 = 0, x1 = 100): WordLike => ({
  text,
  confidence: 90,
  bbox: { x0, y0: 10, x1, y1: 50 },
})

describe('passesLuhn', () => {
  it('接受真實格式的卡號（測試用號碼）', () => {
    expect(passesLuhn('4111111111111111')).toBe(true) // Visa 16 碼
    expect(passesLuhn('378282246310005')).toBe(true) // Amex 15 碼
    expect(passesLuhn('4222222222222')).toBe(true) // 13 碼
  })

  it('檢查碼錯了就不過', () => {
    expect(passesLuhn('4111111111111112')).toBe(false)
  })

  it('長度不在 13–19 一律不過', () => {
    expect(passesLuhn('4826')).toBe(false)
    expect(passesLuhn('411111111111')).toBe(false) // 12 碼
    expect(passesLuhn('41111111111111111111')).toBe(false) // 20 碼
  })

  it('含非數字一律不過', () => {
    expect(passesLuhn('4111-1111-1111-1111')).toBe(false)
    expect(passesLuhn('')).toBe(false)
  })
})

describe('normalizeOcrDigit', () => {
  it('O 當成 0、I/l/| 當成 1', () => {
    expect(normalizeOcrDigit('O')).toBe('0')
    expect(normalizeOcrDigit('I')).toBe('1')
    expect(normalizeOcrDigit('l')).toBe('1')
    expect(normalizeOcrDigit('|')).toBe('1')
  })

  it('其餘字元原樣回傳（小寫 o 不動，避免誤改人名）', () => {
    expect(normalizeOcrDigit('o')).toBe('o')
    expect(normalizeOcrDigit('5')).toBe('5')
    expect(normalizeOcrDigit('A')).toBe('A')
  })
})

describe('digitsOfWord', () => {
  it('完全沒有數字的詞直接跳過——名字不會變成卡號', () => {
    expect(digitsOfWord(word('WILLIAM'))).toEqual([])
    expect(digitsOfWord(word('OLIVIA'))).toEqual([])
  })

  it('已經含數字的詞才套用 O→0、I→1 修正', () => {
    expect(joinDigits(digitsOfWord(word('4I1O')))).toBe('4110')
  })

  it('把詞的 bbox 平均切給每個字元', () => {
    const digits = digitsOfWord(word('482', 0, 300))
    expect(digits.map((digit) => digit.text)).toEqual(['4', '8', '2'])
    expect(digits[0].bbox).toEqual({ x0: 0, y0: 10, x1: 100, y1: 50 })
    expect(digits[1].bbox.x0).toBe(100)
    expect(digits[2].bbox.x1).toBe(300)
  })

  it('非數字字元不佔位置，但仍計入切分的分母', () => {
    const digits = digitsOfWord(word('4-8', 0, 300))
    expect(digits.map((digit) => digit.text)).toEqual(['4', '8'])
    expect(digits[1].bbox.x0).toBe(200)
  })
})

describe('digitsOfLine', () => {
  it('跨詞收集數字並由左到右排序', () => {
    const line = { words: [word('5678', 400, 700), word('1234', 0, 300)] }
    expect(joinDigits(digitsOfLine(line))).toBe('12345678')
  })
})

describe('centerIn', () => {
  const region = { x0: 0, y0: 0, x1: 100, y1: 100 }

  it('看的是中心點而不是整個框', () => {
    expect(centerIn({ x0: -10, y0: 40, x1: 30, y1: 60 }, region)).toBe(true)
    expect(centerIn({ x0: 90, y0: 40, x1: 200, y1: 60 }, region)).toBe(false)
  })
})
