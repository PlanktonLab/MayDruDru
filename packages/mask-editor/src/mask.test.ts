import { describe, expect, it, vi } from 'vitest'
import {
  MASK_FILL,
  applyMasks,
  containsPoint,
  isMaskBigEnough,
  maskPixels,
  rectFromDrag,
  topmostMaskAt,
  type MaskRect,
} from './mask'
import { paddedMask } from './cardOcr'

const mask = (patch: Partial<MaskRect>): MaskRect => ({
  x: 0,
  y: 0,
  w: 0.2,
  h: 0.1,
  source: 'MANUAL',
  ...patch,
})

describe('rectFromDrag', () => {
  const expectRect = (rect: { x: number; y: number; w: number; h: number }) => {
    expect(rect.x).toBeCloseTo(0.1, 6)
    expect(rect.y).toBeCloseTo(0.2, 6)
    expect(rect.w).toBeCloseTo(0.4, 6)
    expect(rect.h).toBeCloseTo(0.4, 6)
  }

  it('往右下拖', () => {
    expectRect(rectFromDrag({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 }))
  })

  it('往左上拖也得到同一個矩形', () => {
    expectRect(rectFromDrag({ x0: 0.5, y0: 0.6, x1: 0.1, y1: 0.2 }))
  })
})

describe('isMaskBigEnough', () => {
  it('誤觸的一點點不算遮罩', () => {
    expect(isMaskBigEnough({ w: 0.001, h: 0.001 })).toBe(false)
    expect(isMaskBigEnough({ w: 0.015, h: 0.5 })).toBe(false) // 剛好等於門檻，不算
  })

  it('夠大就算', () => {
    expect(isMaskBigEnough({ w: 0.02, h: 0.02 })).toBe(true)
  })
})

describe('maskPixels', () => {
  it('比例換成像素並四捨五入', () => {
    expect(maskPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 800, 600)).toEqual({
      x: 200,
      y: 300,
      w: 400,
      h: 150,
    })
    expect(maskPixels({ x: 0.333, y: 0, w: 0.1, h: 0.1 }, 1000, 1000).x).toBe(333)
  })
})

describe('containsPoint / topmostMaskAt', () => {
  it('點在矩形內（含邊界）', () => {
    const rect = mask({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })
    expect(containsPoint(rect, 0.2, 0.2)).toBe(true)
    expect(containsPoint(rect, 0.1, 0.1)).toBe(true)
    expect(containsPoint(rect, 0.31, 0.2)).toBe(false)
  })

  it('重疊時最後加上去的那個先被移除', () => {
    const below = mask({ x: 0, y: 0, w: 0.5, h: 0.5, label: 'below' })
    const above = mask({ x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: 'above' })
    expect(topmostMaskAt([below, above], 0.2, 0.2)?.label).toBe('above')
    expect(topmostMaskAt([below, above], 0.45, 0.45)?.label).toBe('below')
    expect(topmostMaskAt([below, above], 0.9, 0.9)).toBeUndefined()
  })
})

describe('paddedMask', () => {
  it('依字高加內距，並夾回畫布範圍', () => {
    // 字高 100 → padX 20、padY 15；左上角被夾在 0
    const rect = paddedMask({ x0: 10, y0: 5, x1: 60, y1: 105 }, 1000, 1000)
    expect(rect.x).toBeCloseTo(0, 6)
    expect(rect.y).toBeCloseTo(0, 6)
    expect(rect.x * 1000 + rect.w * 1000).toBeCloseTo(80, 6)
    expect(rect.source).toBe('AUTO')
    expect(rect.label).toBe('自動遮蔽數字')
  })

  it('小字也至少有 3px 內距', () => {
    const rect = paddedMask({ x0: 100, y0: 100, x1: 105, y1: 105 }, 1000, 1000)
    expect(rect.x * 1000).toBeCloseTo(97, 6)
    expect(rect.w * 1000).toBeCloseTo(11, 6)
  })
})

describe('applyMasks', () => {
  it('在新的 canvas 上依序塗黑，原圖不動', () => {
    const calls: unknown[][] = []
    const context = {
      drawImage: (...args: unknown[]) => calls.push(['drawImage', ...args]),
      fillRect: (...args: unknown[]) => calls.push(['fillRect', ...args]),
      fillStyle: '',
    }
    const source = { width: 800, height: 600 } as HTMLCanvasElement
    const out = document.createElement('canvas')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(out)
    vi.spyOn(out, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)

    const result = applyMasks(source, [mask({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 })])

    expect(result).toBe(out)
    expect(out.width).toBe(800)
    expect(out.height).toBe(600)
    expect(context.fillStyle).toBe(MASK_FILL)
    expect(calls).toEqual([
      ['drawImage', source, 0, 0],
      ['fillRect', 200, 300, 400, 150],
    ])
    // 來源的尺寸沒被動過
    expect(source.width).toBe(800)
    vi.restoreAllMocks()
  })

  it('拿不到 2D context 時丟出看得懂的錯誤', () => {
    const out = document.createElement('canvas')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(out)
    vi.spyOn(out, 'getContext').mockReturnValue(null)
    expect(() => applyMasks({ width: 10, height: 10 } as HTMLCanvasElement, [])).toThrowError(/Safari/)
    vi.restoreAllMocks()
  })
})
