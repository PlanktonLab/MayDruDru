import { describe, expect, it } from 'vitest'
import { evidenceBoxesForDocument, planReviewCanvas } from './reviewCanvasExport'

describe('審核證據畫布', () => {
  it('把兩份文件放在寬高各 3 倍的畫布正中央', () => {
    const layout = planReviewCanvas([
      { width: 100, height: 200 },
      { width: 100, height: 100 },
    ], 3, 20)

    expect(layout).toMatchObject({ width: 660, height: 600, scale: 1 })
    expect(layout.placements).toEqual([
      { x: 220, y: 200, width: 100, height: 200 },
      { x: 340, y: 250, width: 100, height: 100 },
    ])
  })

  it('大圖只在瀏覽器安全上限內等比縮小', () => {
    const layout = planReviewCanvas([{ width: 20_000, height: 20_000 }])
    expect(layout.scale).toBeLessThan(1)
    expect(layout.width).toBeLessThanOrEqual(16_384)
    expect(layout.height).toBeLessThanOrEqual(16_384)
    expect(layout.width * layout.height).toBeLessThanOrEqual(64_000_000)
  })

  it('只保留目前文件未被取代且不重複的螢光標記', () => {
    const box = { x0: 1, y0: 2, x1: 10, y1: 12 }
    expect(evidenceBoxesForDocument([
      { document_id: 'doc-a', bbox: box, superseded: false },
      { document_id: 'doc-a', bbox: box, superseded: false },
      { document_id: 'doc-a', bbox: { x0: 5, y0: 5, x1: 5, y1: 10 }, superseded: false },
      { document_id: 'doc-a', bbox: { x0: 2, y0: 3, x1: 4, y1: 5 }, superseded: true },
      { document_id: 'doc-b', bbox: { x0: 2, y0: 3, x1: 4, y1: 5 }, superseded: false },
    ], 'doc-a')).toEqual([box])
  })
})
