/** 一份文件從「選檔」到「可以送出」的四個步驟（SPEC §8.1 上傳流程）。
 *
 *   1. 讀檔：照片走 `loadImage()`（HEIC 有明確訊息），PDF 走 `pdfToPageCanvases()`（前 5 頁）
 *   2. `must_mask` 的文件進遮罩編輯器（在 `DocField` 裡，不在這支檔案）
 *   3. `recognize()` 逐頁辨識，bbox 換算成最後那張合併圖的座標
 *   4. 合併成**一個** JPEG 送出——契約是一份文件一個檔案
 *
 * 把這些包成純函式，測試才能只換掉 `@maydru/ocr` 就驗完整條流程。
 */

import {
  disposeCanvas,
  loadImage,
  pdfToPageCanvases,
  recognize,
  toBlob,
  type OcrLine,
  type OcrResult,
} from '@maydru/ocr'
import type { Worker } from 'tesseract.js'

export const OUTPUT_MIME = 'image/jpeg'

export interface PreparedFile {
  /** 已縮圖、已轉正的頁面；`must_mask` 時會逐頁進遮罩編輯器。 */
  canvases: HTMLCanvasElement[]
  originalFormat: string
  /** 模糊／過暗的一句提醒，通過則 null。 */
  qualityNote: string | null
  /** PDF 實際頁數（可能大於 `canvases.length`）。 */
  pageCount: number
  /** 超過上限而沒有處理的頁數。 */
  truncated: number
}

export const TRUNCATED_MESSAGE = (pages: number, max: number) =>
  `這份 PDF 有 ${pages} 頁，只會上傳前 ${max} 頁。如果需要的內容在後面，請先把那幾頁單獨匯出再上傳。`

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

/** 步驟 1：把使用者選的檔案變成一疊 canvas。 */
export async function prepareFile(file: File, maxPages = 5): Promise<PreparedFile> {
  if (isPdf(file)) {
    const pages = await pdfToPageCanvases(file, { maxPages })
    return {
      canvases: pages.canvases,
      originalFormat: 'PDF',
      qualityNote: pages.truncated > 0 ? TRUNCATED_MESSAGE(pages.pageCount, maxPages) : null,
      pageCount: pages.canvases.length,
      truncated: pages.truncated,
    }
  }
  const image = await loadImage(file)
  return {
    canvases: [image.canvas],
    originalFormat: image.originalFormat,
    qualityNote: image.qualityNote,
    pageCount: 1,
    truncated: 0,
  }
}

function shiftLines(lines: OcrLine[], dy: number): OcrLine[] {
  if (dy === 0) return lines
  return lines.map((line) => ({
    ...line,
    bbox: { ...line.bbox, y0: line.bbox.y0 + dy, y1: line.bbox.y1 + dy },
    words: line.words.map((word) => ({
      ...word,
      bbox: { ...word.bbox, y0: word.bbox.y0 + dy, y1: word.bbox.y1 + dy },
    })),
  }))
}

/**
 * 步驟 3：逐頁辨識並合併。
 *
 * bbox 加上該頁在合併圖裡的 y 位移，承辦端的高亮才會落在正確的地方——
 * 送出去的是合併後的那一張圖，座標系就必須是它的。
 */
export async function recognizePages(
  worker: Worker,
  canvases: HTMLCanvasElement[],
  onPage?: (index: number, total: number) => void,
): Promise<OcrResult> {
  const results: OcrResult[] = []
  let offset = 0
  const lines: OcrLine[] = []
  for (let index = 0; index < canvases.length; index++) {
    onPage?.(index, canvases.length)
    const page = await recognize(worker, canvases[index])
    results.push(page)
    lines.push(...shiftLines(page.lines, offset))
    offset += canvases[index].height
  }
  const confidences = results.map((result) => result.confidence).filter((value) => value > 0)
  return {
    text: results.map((result) => result.text).join('\n'),
    confidence: confidences.length
      ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
      : 0,
    lines,
  }
}

/**
 * 步驟 4：把幾頁疊成一張直式長圖再輸出 JPEG。
 *
 * 一份文件對一個檔案是契約寫死的；多頁的 PDF 若各自成檔，承辦端就得自己拼回去。
 * 單頁時直接編碼，省一次整張重繪。
 */
export async function encodePages(canvases: HTMLCanvasElement[]): Promise<Blob> {
  if (canvases.length === 0) throw new Error('沒有可以上傳的頁面，請重新選擇檔案。')
  if (canvases.length === 1) return toBlob(canvases[0], OUTPUT_MIME)

  const width = Math.max(...canvases.map((canvas) => canvas.width))
  const height = canvases.reduce((sum, canvas) => sum + canvas.height, 0)
  const merged = document.createElement('canvas')
  merged.width = width
  merged.height = height
  const context = merged.getContext('2d')
  if (!context) throw new Error('這支瀏覽器無法合併多頁文件，請改用單頁圖片上傳。')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  let y = 0
  for (const canvas of canvases) {
    context.drawImage(canvas, 0, y)
    y += canvas.height
  }
  const blob = await toBlob(merged, OUTPUT_MIME)
  disposeCanvas(merged)
  return blob
}

/** 送出或換檔之後把來源影像清掉（SPEC §11：只在記憶體）。 */
export function disposeAll(canvases: HTMLCanvasElement[]): void {
  for (const canvas of canvases) disposeCanvas(canvas)
}
