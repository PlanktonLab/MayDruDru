/** OCR 輸出格式（SPEC §2、§8.1）。
 *
 * 逐字沿用 proreview `ocr.js` 的形狀，讓 `review-rules`（TS）與
 * `services/review.py`（Python）可以吃同一份 JSON。座標一律是**原圖像素**，
 * 原點左上；`lines` 依 `bbox.y0` 再 `bbox.x0` 排序；空字串的行與字會被丟掉；
 * 所有 confidence 都四捨五入成整數。
 */

/** tesseract 的框：左上 (x0,y0)、右下 (x1,y1)，單位為原圖像素。 */
export interface BoundingBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  bbox: BoundingBox
  confidence: number
}

export interface OcrLine {
  text: string
  confidence: number
  bbox: BoundingBox
  words: OcrWord[]
}

export interface OcrResult {
  /** 整頁文字（tesseract 原樣輸出，含換行）。 */
  text: string
  confidence: number
  lines: OcrLine[]
}

export const EMPTY_OCR_RESULT: OcrResult = { text: '', confidence: 0, lines: [] }

/** 影像品質量測值（SPEC §8.1「品質探測（模糊/過暗警告）」）。 */
export interface QualityProbe {
  /** 縮圖**前**的原始長邊，用來判斷解析度夠不夠。 */
  longEdge: number
  /** 0–1；以 Laplacian 變異數估計，越低越模糊。 */
  sharpness: number
  /** 0–1 灰階平均。 */
  brightness: number
}

export interface LoadedImage {
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** 由副檔名與 MIME 推得，例如 `HEIC`、`PDF`、`JPEG`。 */
  originalFormat: string
  probe: QualityProbe
  /** 品質不佳時給市民的一句話（說「怎麼修」），通過則為 null。 */
  qualityNote: string | null
}
