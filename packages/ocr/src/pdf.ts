/** PDF → 頁面 canvas（SPEC §4「PDF 用 pdf.js 轉頁圖，限 5 頁」）。
 *
 * ## Vite 設定
 *
 * pdf.js 需要一個 worker 檔。Vite 用 `?url` 匯入拿到打包後的網址，在 app 進入點
 * （例如 `apps/apply-web/src/main.tsx`）設定一次即可：
 *
 * ```ts
 * import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
 * import { setPdfWorkerSrc } from '@maydru/ocr'
 *
 * setPdfWorkerSrc(pdfWorkerUrl)
 * ```
 *
 * 不設定的話，pdf.js 會退回主執行緒（fake worker）——能動，但大檔會卡住 UI。
 * `pdfjs-dist` 只在真的遇到 PDF 時才被動態載入，一般上傳流程不會付這個 bundle 成本。
 */

import { MAX_LONG_EDGE } from './image'

let workerSrc: string | null = null

/** 設定 pdf.js worker 的網址（見本檔頂端的 Vite 設定說明）。 */
export function setPdfWorkerSrc(src: string): void {
  workerSrc = src
}

export interface PdfToCanvasOptions {
  /** 最多轉幾頁（SPEC：5）。 */
  maxPages?: number
  /** 轉出來的頁面長邊上限，預設與照片同為 2400。 */
  maxLongEdge?: number
}

export const PDF_UNREADABLE_MESSAGE =
  '這個 PDF 打不開，可能有密碼保護或檔案損毀。請用原本的網站／App 重新下載一份，或改上傳截圖。'

export interface PdfPages {
  canvases: HTMLCanvasElement[]
  /** PDF 實際的總頁數，可能大於 `canvases.length`。 */
  pageCount: number
  /** 超過 `maxPages` 而沒有轉出來的頁數。 */
  truncated: number
}

/**
 * 把 PDF 的前 N 頁轉成 canvas，之後可以直接餵給 `recognize()` 或遮罩編輯器。
 *
 * 縮放比例以「頁面長邊縮到 `maxLongEdge`」回推，因此不論原稿是 A4 還是收據長條，
 * OCR 拿到的解析度都一致。
 */
export async function pdfToPageCanvases(
  file: Blob,
  options: PdfToCanvasOptions = {},
): Promise<PdfPages> {
  const maxPages = options.maxPages ?? 5
  const maxLongEdge = options.maxLongEdge ?? MAX_LONG_EDGE

  const pdfjs = await import('pdfjs-dist')
  if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

  const buffer = await file.arrayBuffer()
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) })
  let document
  try {
    document = await task.promise
  } catch {
    await task.destroy()
    throw new Error(PDF_UNREADABLE_MESSAGE)
  }

  try {
    const pageCount = document.numPages
    const wanted = Math.min(pageCount, Math.max(0, maxPages))
    const canvases: HTMLCanvasElement[] = []
    for (let index = 1; index <= wanted; index++) {
      const page = await document.getPage(index)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(1, maxLongEdge / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const canvasContext = canvas.getContext('2d', { willReadFrequently: true })
      if (!canvasContext) throw new Error(PDF_UNREADABLE_MESSAGE)
      await page.render({ canvas, canvasContext, viewport }).promise
      page.cleanup()
      canvases.push(canvas)
    }
    return { canvases, pageCount, truncated: Math.max(0, pageCount - wanted) }
  } finally {
    await task.destroy()
  }
}
