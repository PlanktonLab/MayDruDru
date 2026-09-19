import { describe, expect, it } from 'vitest'
import { colorTokens, cssVar } from './index'

describe('@maydru/ui tokens', () => {
  it('每個顏色 token 都能轉成 CSS 變數', () => {
    expect(cssVar('accent')).toBe('var(--accent)')
    expect(new Set(colorTokens).size).toBe(colorTokens.length)
  })
})
