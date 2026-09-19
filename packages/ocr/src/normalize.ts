/** tesseract 的 `blocks` → 標準 OCR 結果（SPEC §8.1 第 3 步）。
 *
 * 這個檔案**不 import tesseract.js**，只吃結構相符的物件，所以測試可以直接餵假資料。
 * 規則逐字沿用 proreview `ocr.js::toLines()`：
 *   1. 走訪 `blocks[].paragraphs[].lines[]`；
 *   2. 丟掉 `text.trim()` 為空、或沒有 bbox 的行；
 *   3. 每行的 `words` 只留 `text.trim()` 非空者；
 *   4. 所有 confidence `Math.round(value || 0)`；
 *   5. 最後依 `bbox.y0` 再 `bbox.x0` 升冪排序（跨 block 一起排）。
 */

import type { BoundingBox, OcrLine, OcrResult, OcrWord } from './types'

/** 只描述我們會讀到的欄位，讓假資料也能通過型別檢查。 */
export interface RawWord {
  text?: string | null
  bbox?: BoundingBox | null
  confidence?: number | null
}

export interface RawLine {
  text?: string | null
  bbox?: BoundingBox | null
  confidence?: number | null
  words?: RawWord[] | null
}

export interface RawParagraph {
  lines?: RawLine[] | null
}

export interface RawBlock {
  paragraphs?: RawParagraph[] | null
}

export interface RawPage {
  text?: string | null
  confidence?: number | null
  blocks?: RawBlock[] | null
}

const round = (value: number | null | undefined): number => Math.round(value || 0)

function toWord(word: RawWord): OcrWord | null {
  const text = (word.text ?? '').trim()
  if (!text || !word.bbox) return null
  return { text, bbox: word.bbox, confidence: round(word.confidence) }
}

/** 把 tesseract 的 block 樹攤平成排序好的行。 */
export function toLines(blocks: RawBlock[] | null | undefined): OcrLine[] {
  const lines: OcrLine[] = []
  for (const block of blocks ?? []) {
    for (const paragraph of block?.paragraphs ?? []) {
      for (const line of paragraph?.lines ?? []) {
        const text = (line?.text ?? '').trim()
        if (!text || !line?.bbox) continue
        const words: OcrWord[] = []
        for (const word of line.words ?? []) {
          const normalized = toWord(word)
          if (normalized) words.push(normalized)
        }
        lines.push({ text, confidence: round(line.confidence), bbox: line.bbox, words })
      }
    }
  }
  return lines.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
}

/** tesseract 的 `RecognizeResult.data` → `OcrResult`。 */
export function toOcrResult(page: RawPage): OcrResult {
  return {
    text: page.text || '',
    confidence: round(page.confidence),
    lines: toLines(page.blocks),
  }
}
