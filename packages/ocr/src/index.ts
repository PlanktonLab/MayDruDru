/** `@maydru/ocr` — 瀏覽器端 OCR 包裝（tesseract.js 6 + pdf.js）。
 *
 * SPEC §8.1 的上傳流程前三步都在這裡：
 *   1. `loadImage()` 讀檔（HEIC 有明確的「怎麼修」訊息）→ 縮至長邊 2400 → 品質探測
 *   2. `pdfToPageCanvases()` 把 PDF 前 5 頁轉成 canvas
 *   3. `createOcrWorker()` + `recognize()` 產出標準 OCR 結果
 *
 * 伺服器端永遠不做 OCR，圖片也不離開瀏覽器記憶體（SPEC §11）。
 */

export type {
  BoundingBox,
  LoadedImage,
  OcrLine,
  OcrResult,
  OcrWord,
  QualityProbe,
} from './types'
export { EMPTY_OCR_RESULT } from './types'

export {
  HEIC_UNSUPPORTED_MESSAGE,
  JPEG_QUALITY,
  MAX_LONG_EDGE,
  QUALITY_THRESHOLDS,
  UNREADABLE_FILE_MESSAGE,
  centredSample,
  detectFormat,
  disposeCanvas,
  isHeic,
  loadImage,
  probeQuality,
  qualityIssue,
  resizeDimensions,
  toBlob,
  toJpegDataUrl,
} from './image'

export type { RawBlock, RawLine, RawPage, RawParagraph, RawWord } from './normalize'
export { toLines, toOcrResult } from './normalize'

export type { PdfPages, PdfToCanvasOptions } from './pdf'
export { PDF_UNREADABLE_MESSAGE, pdfToPageCanvases, setPdfWorkerSrc } from './pdf'

export type { CreateOcrWorkerOptions, OcrSource } from './worker'
export { DEFAULT_LANGS, DEFAULT_LANG_PATH, createOcrWorker, recognize } from './worker'
