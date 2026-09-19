/** 整個分頁共用一顆 tesseract worker。
 *
 * 一份文件開一顆 worker 的話，光是載 chi_tra 語言資料就要重來一次——在手機上
 * 每次都是好幾秒與好幾 MB。所以這裡開一顆、大家排隊用；進度回呼用一個可覆寫的
 * 插槽，因為 `createOcrWorker()` 的 logger 在建立時就固定了。
 */

import { createOcrWorker } from '@maydru/ocr'
import type { Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null
let progressSink: ((progress: number) => void) | null = null

export function getOcrWorker(): Promise<Worker> {
  workerPromise ??= createOcrWorker({ onProgress: (progress) => progressSink?.(progress) })
  return workerPromise
}

/** 接管進度回報，回傳一個還原函式；同一時間只有一份文件在辨識。 */
export function captureOcrProgress(sink: (progress: number) => void): () => void {
  const previous = progressSink
  progressSink = sink
  return () => {
    progressSink = previous
  }
}

/** 離開送件流程時收掉，記憶體還給瀏覽器（SPEC §11：影像只在記憶體）。 */
export async function terminateOcrWorker(): Promise<void> {
  const pending = workerPromise
  workerPromise = null
  progressSink = null
  if (!pending) return
  try {
    await (await pending).terminate()
  } catch {
    /* 已經收掉了就算了 */
  }
}
