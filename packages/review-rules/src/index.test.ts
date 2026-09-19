import { describe, expect, it } from 'vitest'
import { precheck } from './index'

describe('@maydru/review-rules', () => {
  it('佔位實作沒有規則時放行', () => {
    expect(precheck({ fields: {} })).toEqual({ findings: [], ok: true })
  })
})
