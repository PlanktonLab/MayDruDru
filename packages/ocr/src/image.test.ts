import { describe, expect, it, vi } from 'vitest'
import {
  HEIC_UNSUPPORTED_MESSAGE,
  MAX_LONG_EDGE,
  QUALITY_THRESHOLDS,
  UNREADABLE_FILE_MESSAGE,
  centredSample,
  detectFormat,
  isHeic,
  loadImage,
  probeQuality,
  qualityIssue,
  resizeDimensions,
} from './image'

const file = (name: string, type = ''): File => new File([new Uint8Array([1, 2, 3])], name, { type })

describe('detectFormat / isHeic', () => {
  it('從副檔名認出 HEIC 與 HEIF', () => {
    expect(detectFormat(file('IMG_0001.HEIC'))).toBe('HEIC')
    expect(detectFormat(file('img.heif'))).toBe('HEIF')
    expect(isHeic(file('img.heif'))).toBe(true)
  })

  it('從 MIME 認出 HEIC（有些相機不給副檔名）', () => {
    expect(detectFormat(file('capture', 'image/heic'))).toBe('HEIC')
    expect(isHeic(file('capture', 'image/heic'))).toBe(true)
  })

  it('認得 PDF / PNG / JPEG，其餘回副檔名或 UNKNOWN', () => {
    expect(detectFormat(file('bill.pdf', 'application/pdf'))).toBe('PDF')
    expect(detectFormat(file('shot.png', 'image/png'))).toBe('PNG')
    expect(detectFormat(file('shot.jpg', 'image/jpeg'))).toBe('JPEG')
    expect(detectFormat(file('scan.tiff'))).toBe('TIFF')
    expect(detectFormat(file('noextension'))).toBe('UNKNOWN')
    expect(isHeic(file('shot.jpg', 'image/jpeg'))).toBe(false)
  })
})

describe('resizeDimensions', () => {
  it('長邊縮到 2400，比例四捨五入', () => {
    expect(resizeDimensions(4032, 3024)).toEqual({
      width: 2400,
      height: 1800,
      scale: MAX_LONG_EDGE / 4032,
    })
    // 直式：長邊是高
    expect(resizeDimensions(3000, 4000).height).toBe(2400)
    expect(resizeDimensions(3000, 4000).width).toBe(1800)
  })

  it('小圖不放大', () => {
    expect(resizeDimensions(800, 600)).toEqual({ width: 800, height: 600, scale: 1 })
  })

  it('剛好在門檻上不動', () => {
    expect(resizeDimensions(2400, 1000)).toEqual({ width: 2400, height: 1000, scale: 1 })
  })

  it('尊重自訂上限', () => {
    expect(resizeDimensions(1000, 500, 400)).toEqual({ width: 400, height: 200, scale: 0.4 })
  })
})

describe('centredSample', () => {
  it('取中央最多 640×640', () => {
    expect(centredSample(2400, 1800)).toEqual([880, 580, 640, 640])
    expect(centredSample(300, 200)).toEqual([0, 0, 300, 200])
  })
})

/**
 * 造一塊 ImageData：`pattern(x, y)` 回 0–255 的灰階值。
 * jsdom 沒有內建 `ImageData` 建構子，這裡自己組一個同形狀的物件。
 */
function imageData(size: number, pattern: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = pattern(x, y)
      const p = (y * size + x) * 4
      data[p] = value
      data[p + 1] = value
      data[p + 2] = value
      data[p + 3] = 255
    }
  }
  return { data, width: size, height: size, colorSpace: 'srgb' } as unknown as ImageData
}

describe('probeQuality', () => {
  it('高對比直條紋 → 清晰、亮度中間', () => {
    // 棋盤在 stride 2 取樣下每個取樣點的 Laplacian 都一樣（變異數 0），
    // 所以用寬度 4px 的直條紋模擬文件上的筆畫邊緣。
    const probe = probeQuality(imageData(64, (x) => (x % 8 < 4 ? 255 : 0)), 2400)
    expect(probe.longEdge).toBe(2400)
    expect(probe.sharpness).toBeGreaterThan(QUALITY_THRESHOLDS.minSharpness)
    expect(probe.brightness).toBeCloseTo(0.5, 1)
  })

  it('純色 → 完全不清晰', () => {
    const probe = probeQuality(imageData(64, () => 128), 2400)
    expect(probe.sharpness).toBeCloseTo(0, 5)
    expect(probe.brightness).toBeCloseTo(128 / 255, 3)
  })

  it('幾乎全黑 / 全白 → 亮度落在兩端', () => {
    expect(probeQuality(imageData(32, () => 10), 2400).brightness).toBeLessThan(
      QUALITY_THRESHOLDS.minBrightness,
    )
    expect(probeQuality(imageData(32, () => 250), 2400).brightness).toBeGreaterThan(
      QUALITY_THRESHOLDS.maxBrightness,
    )
  })
})

describe('qualityIssue', () => {
  const ok = { longEdge: 2400, sharpness: 0.6, brightness: 0.5 }

  it('通過時回 null', () => {
    expect(qualityIssue(ok)).toBeNull()
  })

  it('解析度不足優先報，且告訴市民怎麼做', () => {
    const note = qualityIssue({ ...ok, longEdge: 800, sharpness: 0.1 })
    expect(note).toContain('解析度')
    expect(note).toContain('重拍')
  })

  it('模糊、過暗、過亮各有一句話', () => {
    expect(qualityIssue({ ...ok, sharpness: 0.1 })).toContain('模糊')
    expect(qualityIssue({ ...ok, brightness: 0.05 })).toContain('偏暗')
    expect(qualityIssue({ ...ok, brightness: 0.95 })).toContain('反光')
  })

  it('剛好踩在門檻上算通過', () => {
    expect(qualityIssue({ longEdge: 1000, sharpness: 0.35, brightness: 0.2 })).toBeNull()
    expect(qualityIssue({ longEdge: 1000, sharpness: 0.35, brightness: 0.9 })).toBeNull()
  })
})

describe('loadImage 的錯誤訊息', () => {
  it('HEIC 解不開時給「怎麼修」的訊息', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('unsupported'))),
    )
    await expect(loadImage(file('IMG_0001.HEIC'))).rejects.toThrowError(HEIC_UNSUPPORTED_MESSAGE)
    vi.unstubAllGlobals()
  })

  it('其他格式解不開時給通用訊息', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('unsupported'))),
    )
    await expect(loadImage(file('broken.jpg', 'image/jpeg'))).rejects.toThrowError(
      UNREADABLE_FILE_MESSAGE,
    )
    vi.unstubAllGlobals()
  })
})
