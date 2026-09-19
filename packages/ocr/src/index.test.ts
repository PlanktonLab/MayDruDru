import { describe, expect, it } from 'vitest'
import { EMPTY_OCR_RESULT, recognize } from './index'

describe('@maydru/ocr', () => {
  it('佔位實作回傳空結果，且不碰網路', async () => {
    await expect(recognize(new Blob([]))).resolves.toEqual(EMPTY_OCR_RESULT)
  })
})
