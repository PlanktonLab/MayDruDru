/** 遮罩的幾何與套用（SPEC §8.1 第 2 步、§11 隱私）。
 *
 * 座標一律是**圖片寬高的比例 0–1**，和審核頁的高亮同一套語意，
 * 所以縮圖、原圖、不同裝置之間都不必換算。
 */

export interface MaskRect {
  x: number
  y: number
  w: number
  h: number
  /** 系統自動偵測的，或市民手動畫的。 */
  source: 'AUTO' | 'MANUAL'
  label?: string
}

/** 遮罩塗上去的顏色：深到看不出下面有什麼，又不是純黑（純黑容易被誤認為破圖）。 */
export const MASK_FILL = '#0f172a'

/** 小於這個尺寸的拖曳當成誤觸，不建立遮罩。 */
export const MIN_MASK_WIDTH = 0.015
export const MIN_MASK_HEIGHT = 0.01

export interface DragBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 把「按下 → 放開」的兩個點轉成正規化矩形（不管往哪個方向拖）。 */
export function rectFromDrag(drag: DragBox): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0),
    h: Math.abs(drag.y1 - drag.y0),
  }
}

/** 這一筆拖曳夠不夠大到該變成遮罩。 */
export function isMaskBigEnough(rect: { w: number; h: number }): boolean {
  return rect.w > MIN_MASK_WIDTH && rect.h > MIN_MASK_HEIGHT
}

/** 比例座標 → 像素座標（四捨五入，避免邊緣露出半個像素）。 */
export function maskPixels(
  mask: Pick<MaskRect, 'x' | 'y' | 'w' | 'h'>,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(mask.x * width),
    y: Math.round(mask.y * height),
    w: Math.round(mask.w * width),
    h: Math.round(mask.h * height),
  }
}

/** 點 (x, y) 是否落在這個遮罩裡（移除模式的命中測試）。 */
export function containsPoint(mask: MaskRect, x: number, y: number): boolean {
  return x >= mask.x && x <= mask.x + mask.w && y >= mask.y && y <= mask.y + mask.h
}

/** 最上層（最後加上去）的那一個遮罩優先被移除。 */
export function topmostMaskAt(masks: readonly MaskRect[], x: number, y: number): MaskRect | undefined {
  for (let index = masks.length - 1; index >= 0; index--)
    if (containsPoint(masks[index], x, y)) return masks[index]
  return undefined
}

/**
 * 把遮罩燒進一張新的 canvas。**原圖不動**——呼叫端保留原圖是為了讓市民還能調整遮罩，
 * 但只有這裡的輸出會被送出去。
 */
export function applyMasks(source: HTMLCanvasElement, masks: readonly MaskRect[]): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('這個瀏覽器沒辦法處理圖片遮罩，請改用 Safari 或 Chrome 最新版再試一次。')
  ctx.drawImage(source, 0, 0)
  ctx.fillStyle = MASK_FILL
  for (const mask of masks) {
    const { x, y, w, h } = maskPixels(mask, out.width, out.height)
    ctx.fillRect(x, y, w, h)
  }
  return out
}

/** 送出後清掉暫存影像（SPEC §11）。 */
export function disposeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}
