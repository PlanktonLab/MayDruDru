/** `@maydru/ocr` — 瀏覽器端 OCR 包裝（tesseract.js 6，chi_tra + eng）。
 *
 * P0 佔位：實作在 P3（SPEC §16）。伺服器端永遠不做 OCR，圖片也不離開瀏覽器記憶體
 * （SPEC §11）。這裡先把輸出格式定下來，讓 `review-rules` 與審核頁可以先對型別開發。
 */

/** 單字在原圖上的位置，單位為原圖像素。 */
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface OcrWord {
  text: string
  confidence: number
  bbox: BoundingBox
}

export interface OcrLine {
  text: string
  confidence: number
  bbox: BoundingBox
  words: OcrWord[]
}

/** 沿用 proreview 的輸出格式（SPEC §2）。 */
export interface OcrResult {
  text: string
  confidence: number
  lines: OcrLine[]
}

export const EMPTY_OCR_RESULT: OcrResult = { text: '', confidence: 0, lines: [] }

/** P0 佔位：回傳空結果，不載入 tesseract.js。 */
export async function recognize(_image: Blob): Promise<OcrResult> {
  return EMPTY_OCR_RESULT
}
