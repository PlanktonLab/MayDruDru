/** 版面計算與代碼翻譯——純函式，不需要 DOM。 */
import { describe, expect, it } from 'vitest'
import { RICH_MENU_GRID, coveredArea, defaultGridBounds, rectsOverlap, tileRects } from './tiles'
import { describeDifference, describeImageProblem, imageProblemCodes, substitute } from './labels'

describe('圖文選單版面', () => {
  const rects = tileRects(defaultGridBounds().map((bounds) => ({ bounds })))

  it('六格剛好鋪滿整張畫布，沒有死角也沒有重疊', () => {
    expect(rects).toHaveLength(RICH_MENU_GRID.cols * RICH_MENU_GRID.rows)
    // 百分比座標下，鋪滿＝面積和剛好 100 × 100。
    expect(coveredArea(rects)).toBeCloseTo(10000, 6)
    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        expect(rectsOverlap(rects[a], rects[b])).toBe(false)
      }
    }
  })

  it('最後一欄與最後一列貼齊畫布邊緣', () => {
    const right = Math.max(...rects.map((r) => r.left + r.width))
    const bottom = Math.max(...rects.map((r) => r.top + r.height))
    expect(right).toBeCloseTo(100, 6)
    expect(bottom).toBeCloseTo(100, 6)
    expect(Math.min(...rects.map((r) => r.left))).toBe(0)
    expect(Math.min(...rects.map((r) => r.top))).toBe(0)
  })
})

describe('差異代碼', () => {
  it('已知的代碼翻成完整的中文句子', () => {
    expect(describeDifference('size')).toContain('畫布尺寸')
    expect(describeDifference('chat_bar_text')).toContain('選單標籤')
    expect(describeDifference('area_count')).toContain('格子數量')
  })

  it('area_n_* 換算成第幾格（後端從 0 起算）', () => {
    expect(describeDifference('area_0_action')).toContain('第 1 格')
    expect(describeDifference('area_0_action')).toContain('動作')
    expect(describeDifference('area_3_bounds')).toContain('第 4 格')
    expect(describeDifference('area_3_bounds')).toContain('位置或大小')
  })

  it('沒見過的代碼也給得出一句看得懂的話', () => {
    const text = describeDifference('selected_flag')
    expect(text).toContain('selected_flag')
    expect(text).toContain('重新同步')
  })
})

describe('圖檔問題代碼', () => {
  it('三個已知問題都講得出該怎麼修，並帶上 LINE 允許的尺寸', () => {
    expect(describeImageProblem('not_png_or_jpeg')).toContain('PNG')
    expect(describeImageProblem('bad_size')).toContain('2500×1686')
    expect(describeImageProblem('bad_size')).toContain('1200×810')
    expect(describeImageProblem('too_large')).toContain('1 MB')
  })

  it('invalid_image:… 帶著 LINE 自己給的原因', () => {
    expect(describeImageProblem('invalid_image:corrupted')).toContain('corrupted')
  })

  it('未知代碼退回一句含尺寸規定的說明', () => {
    const text = describeImageProblem('weird_code')
    expect(text).toContain('weird_code')
    expect(text).toContain('2500×1686')
  })

  it('從 502 的 error 字串裡撈出 invalid_image 代碼', () => {
    expect(imageProblemCodes(['bad_size'], 'line api: invalid_image:truncated')).toEqual(['bad_size', 'invalid_image:truncated'])
    expect(imageProblemCodes(undefined, undefined)).toEqual([])
  })
})

describe('變數代入', () => {
  it('有範例值就代入，沒有的保留原樣才看得出少了什麼', () => {
    expect(substitute('共 {{count}} 件，{{applicant}} 您好', { count: '3' })).toBe('共 3 件，{{applicant}} 您好')
  })
})
