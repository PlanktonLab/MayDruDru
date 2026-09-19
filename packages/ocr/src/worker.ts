/** tesseract.js v6 的薄包裝（SPEC §4：chi_tra + eng，跑在瀏覽器）。
 *
 * 語言資料預設從 CDN 取；要完全離線（或把資料放進自家網域）時傳 `langPath`，
 * 指向放著 `chi_tra.traineddata.gz` / `eng.traineddata.gz` 的目錄。
 *
 * ```ts
 * const worker = await createOcrWorker({ onProgress: (p) => setProgress(p) })
 * const result = await recognize(worker, canvas)
 * await worker.terminate()
 * ```
 */

import { createWorker, type Worker } from 'tesseract.js'
import { toOcrResult } from './normalize'
import type { OcrResult } from './types'

/** SPEC §4：繁中 + 英文。 */
export const DEFAULT_LANGS = ['chi_tra', 'eng'] as const

/** tesseract.js 官方 CDN 的 4.0.0 語言資料。 */
export const DEFAULT_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0'

export interface CreateOcrWorkerOptions {
  langs?: readonly string[]
  /** 辨識進度 0–1；只有 `recognizing text` 階段會回報。 */
  onProgress?: (progress: number) => void
  /** 語言資料目錄；自架時指到自己的靜態檔。 */
  langPath?: string
  /** 放 `tesseract-core*.wasm` 的目錄，離線部署時一起換掉。 */
  corePath?: string
  /** 放 `worker.min.js` 的網址，離線部署時一起換掉。 */
  workerPath?: string
}

export async function createOcrWorker(options: CreateOcrWorkerOptions = {}): Promise<Worker> {
  const { langs = DEFAULT_LANGS, onProgress, langPath = DEFAULT_LANG_PATH, corePath, workerPath } = options
  return createWorker([...langs], undefined, {
    langPath,
    ...(corePath ? { corePath } : {}),
    ...(workerPath ? { workerPath } : {}),
    logger(message) {
      if (message.status === 'recognizing text') onProgress?.(message.progress)
    },
  })
}

/** 可以餵給 tesseract 的來源；送件流程用的是 canvas。 */
export type OcrSource = HTMLCanvasElement | HTMLImageElement | Blob | File | string

/**
 * 辨識一張圖，回傳標準 OCR 結果。
 *
 * `rotateAuto: false` 是刻意的：自動轉正會讓回傳的 bbox 不再是來源 canvas 的座標，
 * 遮罩與審核頁的高亮就會錯位。照片方向已由 `createImageBitmap` 處理過。
 */
export async function recognize(worker: Worker, image: OcrSource): Promise<OcrResult> {
  const { data } = await worker.recognize(image, { rotateAuto: false }, { blocks: true, text: true })
  return toOcrResult(data)
}
