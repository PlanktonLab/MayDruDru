/**
 * 圖文選單的版面計算（SPEC §8.4）。
 *
 * 純函式、沒有 React：畫面只負責把百分比塞進 style，算錯了在單元測試就會被抓到，
 * 不必開瀏覽器比對。畫布固定 2500×1686、3 欄 × 2 列，六格必須「剛好」鋪滿——
 * 少一塊民眾按下去沒反應，重疊則是兩個動作搶同一個位置。
 */

import type { RichMenuTile } from '../../lib/types'

export const RICH_MENU_CANVAS = { width: 2500, height: 1686 } as const
export const RICH_MENU_GRID = { cols: 3, rows: 2 } as const

export interface TileBounds { x: number; y: number; width: number; height: number }
/** 百分比（0–100），直接對應 CSS 的 `left` / `top` / `width` / `height`。 */
export interface TileRect { left: number; top: number; width: number; height: number }

/**
 * 一格的畫布座標，與後端 `services/line/richmenu.bounds()` 同一套算法：
 * 最後一欄與最後一列貼齊畫布邊緣，四捨五入的餘數才不會變成一條看不見的縫。
 */
export function gridBounds(column: number, row: number): TileBounds {
  const { cols, rows } = RICH_MENU_GRID
  const tileW = RICH_MENU_CANVAS.width / cols
  const tileH = RICH_MENU_CANVAS.height / rows
  const x = Math.round(column * tileW)
  const y = Math.round(row * tileH)
  const nextX = column === cols - 1 ? RICH_MENU_CANVAS.width : Math.round((column + 1) * tileW)
  const nextY = row === rows - 1 ? RICH_MENU_CANVAS.height : Math.round((row + 1) * tileH)
  return { x, y, width: nextX - x, height: nextY - y }
}

/** 後端還沒給 tiles（憑證未設定）時，至少把空格子畫出來。 */
export const defaultGridBounds = (): TileBounds[] =>
  Array.from({ length: RICH_MENU_GRID.cols * RICH_MENU_GRID.rows }, (_, i) =>
    gridBounds(i % RICH_MENU_GRID.cols, Math.floor(i / RICH_MENU_GRID.cols)),
  )

/** 畫布像素 → 百分比。容器只要 `aspect-ratio: 2500/1686`，縮放就自己對。 */
export const tileRect = (b: TileBounds): TileRect => ({
  left: (b.x / RICH_MENU_CANVAS.width) * 100,
  top: (b.y / RICH_MENU_CANVAS.height) * 100,
  width: (b.width / RICH_MENU_CANVAS.width) * 100,
  height: (b.height / RICH_MENU_CANVAS.height) * 100,
})

export const tileRects = (tiles: Pick<RichMenuTile, 'bounds'>[]): TileRect[] => tiles.map((t) => tileRect(t.bounds))

/**
 * 兩格是否相交（只碰到邊不算）。
 *
 * 比較帶一個極小的容差：畫布座標是整數、相鄰兩格剛好接在一起，但換算成百分比
 * 之後 `833/2500 + 834/2500` 不會剛好等於 `1667/2500`。少了容差，兩格「貼著」
 * 會被判成「重疊」——那是浮點數的誤差，不是版面的問題。
 */
const EPSILON = 1e-9

export function rectsOverlap(a: TileRect, b: TileRect): boolean {
  return (
    a.left + EPSILON < b.left + b.width &&
    b.left + EPSILON < a.left + a.width &&
    a.top + EPSILON < b.top + b.height &&
    b.top + EPSILON < a.top + a.height
  )
}

/** 全部格子的面積和（百分比²）。鋪滿整張畫布時等於 10000。 */
export const coveredArea = (rects: TileRect[]): number => rects.reduce((sum, r) => sum + r.width * r.height, 0)
