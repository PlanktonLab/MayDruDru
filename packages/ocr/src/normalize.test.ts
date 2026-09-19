import { describe, expect, it } from 'vitest'
import { toLines, toOcrResult, type RawPage } from './normalize'

/** 一份刻意亂序、帶空白與空字串的假 tesseract 輸出。 */
const page: RawPage = {
  text: 'NORTHSTAR AI\n訂閱方案 Pro\nNT$648\n',
  confidence: 87.6,
  blocks: [
    {
      paragraphs: [
        {
          lines: [
            // 比第二行更下面，但排在前面 → 應該被排到後面
            {
              text: ' NT$648 ',
              confidence: 91.4,
              bbox: { x0: 120, y0: 400, x1: 300, y1: 440 },
              words: [
                { text: 'NT$648', confidence: 91.4, bbox: { x0: 120, y0: 400, x1: 300, y1: 440 } },
                { text: '  ', confidence: 3, bbox: { x0: 300, y0: 400, x1: 310, y1: 440 } },
              ],
            },
            {
              text: '訂閱方案 Pro',
              confidence: 84.2,
              bbox: { x0: 60, y0: 200, x1: 420, y1: 240 },
              words: [
                { text: '訂閱方案', confidence: 80, bbox: { x0: 60, y0: 200, x1: 240, y1: 240 } },
                { text: 'Pro', confidence: 88.8, bbox: { x0: 260, y0: 200, x1: 420, y1: 240 } },
              ],
            },
            // 空字串 → 丟掉
            { text: '   ', confidence: 10, bbox: { x0: 0, y0: 10, x1: 5, y1: 12 }, words: [] },
            // 沒有 bbox → 丟掉
            { text: '孤兒行', confidence: 50, words: [] },
          ],
        },
      ],
    },
    {
      paragraphs: [
        {
          lines: [
            // 與第二行同一條 y0，x0 較小 → 排在它前面
            {
              text: 'NORTHSTAR AI',
              confidence: 95,
              bbox: { x0: 10, y0: 200, x1: 50, y1: 240 },
              words: [{ text: 'NORTHSTAR AI', confidence: 95, bbox: { x0: 10, y0: 200, x1: 50, y1: 240 } }],
            },
          ],
        },
      ],
    },
  ],
}

describe('toLines', () => {
  it('依 y0 再 x0 排序，並丟掉空行與沒有 bbox 的行', () => {
    const lines = toLines(page.blocks)
    expect(lines.map((line) => line.text)).toEqual(['NORTHSTAR AI', '訂閱方案 Pro', 'NT$648'])
  })

  it('trim 文字、四捨五入 confidence、濾掉空白字', () => {
    const lines = toLines(page.blocks)
    const amount = lines[2]
    expect(amount.text).toBe('NT$648')
    expect(amount.confidence).toBe(91)
    expect(amount.words).toEqual([
      { text: 'NT$648', bbox: { x0: 120, y0: 400, x1: 300, y1: 440 }, confidence: 91 },
    ])
  })

  it('沒有 blocks 時回空陣列', () => {
    expect(toLines(null)).toEqual([])
    expect(toLines(undefined)).toEqual([])
    expect(toLines([{ paragraphs: null }])).toEqual([])
  })
})

describe('toOcrResult', () => {
  it('產出 proreview 的格式', () => {
    const result = toOcrResult(page)
    expect(result.text).toBe(page.text)
    expect(result.confidence).toBe(88)
    expect(result.lines).toHaveLength(3)
    expect(Object.keys(result)).toEqual(['text', 'confidence', 'lines'])
    expect(Object.keys(result.lines[0])).toEqual(['text', 'confidence', 'bbox', 'words'])
    expect(Object.keys(result.lines[0].words[0])).toEqual(['text', 'bbox', 'confidence'])
  })

  it('缺欄位時給安全的預設值', () => {
    expect(toOcrResult({})).toEqual({ text: '', confidence: 0, lines: [] })
  })
})
