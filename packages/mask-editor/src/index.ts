/** `@maydru/mask-editor` — 證件/收據遮罩編輯器。
 *
 * 自 submit-flow 的 `MaskEditor` 搬遷：卡號自動偵測 + 手動遮罩 + **必須確認**才能送出。
 * P0 佔位：元件在 P3（SPEC §16）。遮罩一律在瀏覽器端燒進圖片，原圖永不上傳（SPEC §11）。
 */

/** 以圖片寬高的比例表示，縮圖與原圖共用同一組座標。 */
export interface MaskRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MaskState {
  rects: MaskRect[]
  /** 市民必須明確確認「已遮住敏感資訊」才能繼續。 */
  confirmed: boolean
}

export const EMPTY_MASK_STATE: MaskState = { rects: [], confirmed: false }

/** 送出前的硬性條件：有遮罩且已確認。 */
export function canSubmit(state: MaskState): boolean {
  return state.confirmed && state.rects.length > 0
}
