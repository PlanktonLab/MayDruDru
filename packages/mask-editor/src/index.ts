/** `@maydru/mask-editor` — 證件／憑證的遮罩編輯器（SPEC §8.1 第 2 步、§11）。
 *
 * 自 submit-flow 的 `MaskEditor` + `creditCardOcr` 搬遷：
 * 卡號自動偵測（tesseract.js + Luhn）→ 市民手動補遮 → **必須勾選確認**才能送出。
 * 遮罩一律在瀏覽器端燒進圖片，原圖永不上傳。
 */

export { MaskEditor, type MaskEditorMeta, type MaskEditorProps } from './MaskEditor'

export {
  MASK_FILL,
  MIN_MASK_HEIGHT,
  MIN_MASK_WIDTH,
  applyMasks,
  containsPoint,
  disposeCanvas,
  isMaskBigEnough,
  maskPixels,
  rectFromDrag,
  topmostMaskAt,
  type DragBox,
  type MaskRect,
} from './mask'

export {
  centerIn,
  digitsOfLine,
  digitsOfWord,
  joinDigits,
  normalizeOcrDigit,
  passesLuhn,
  type Bbox,
  type DigitSymbol,
  type LineLike,
  type WordLike,
} from './luhn'

export {
  CardOcrDetectionError,
  createCardOcrWorker,
  debugFieldsOf,
  detectCardMasks,
  paddedMask,
  verifyCardMask,
  type CardOcrResult,
  type MaskVerification,
} from './cardOcr'
