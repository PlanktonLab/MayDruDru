import { describe, expect, it } from 'vitest'
import { EMPTY_MASK_STATE, canSubmit } from './index'

describe('@maydru/mask-editor', () => {
  it('沒遮罩或沒確認都不能送出', () => {
    expect(canSubmit(EMPTY_MASK_STATE)).toBe(false)
    expect(canSubmit({ rects: [{ x: 0, y: 0, width: 1, height: 1 }], confirmed: false })).toBe(false)
    expect(canSubmit({ rects: [{ x: 0, y: 0, width: 1, height: 1 }], confirmed: true })).toBe(true)
  })
})
