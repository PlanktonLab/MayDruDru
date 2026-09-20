import { disposeCanvas, pdfToPageCanvases, toBlob } from '@maydru/ocr'
import type { BoundingBox } from '@maydru/review-rules'
import type { CaseDocument, CaseFinding } from './types'

export const REVIEW_CANVAS_MULTIPLIER = 3
export const REVIEW_CANVAS_GAP = 120
export const REVIEW_CANVAS_MAX_SIDE = 16_384
export const REVIEW_CANVAS_MAX_PIXELS = 64_000_000

export interface ReviewCanvasSize {
  width: number
  height: number
}

export interface ReviewCanvasPlacement extends ReviewCanvasSize {
  x: number
  y: number
}

export interface ReviewCanvasLayout extends ReviewCanvasSize {
  placements: ReviewCanvasPlacement[]
  /** 原始文件像素到輸出像素的共同倍率。 */
  scale: number
}

export interface ExportReviewCanvasOptions {
  documents: CaseDocument[]
  findings: Pick<CaseFinding, 'document_id' | 'bbox' | 'superseded'>[]
  loadUrl: (documentId: string) => Promise<string>
  fileName: string
}

interface RenderedDocument {
  document: CaseDocument
  canvas: HTMLCanvasElement
}

/**
 * 文件群組置中，外圍畫布的寬高各保留 3 倍空間；超過瀏覽器常見安全上限時，
 * 整張圖等比縮小，仍維持文件與外圍畫布的比例。
 */
export function planReviewCanvas(
  sizes: ReviewCanvasSize[],
  multiplier = REVIEW_CANVAS_MULTIPLIER,
  gap = REVIEW_CANVAS_GAP,
): ReviewCanvasLayout {
  if (!sizes.length) throw new Error('沒有可匯出的文件。')
  if (sizes.some(({ width, height }) => width <= 0 || height <= 0)) throw new Error('文件尺寸無效。')

  const contentWidth = sizes.reduce((sum, size) => sum + size.width, 0) + gap * (sizes.length - 1)
  const contentHeight = Math.max(...sizes.map((size) => size.height))
  const rawWidth = contentWidth * multiplier
  const rawHeight = contentHeight * multiplier
  const scale = Math.min(
    1,
    REVIEW_CANVAS_MAX_SIDE / rawWidth,
    REVIEW_CANVAS_MAX_SIDE / rawHeight,
    Math.sqrt(REVIEW_CANVAS_MAX_PIXELS / (rawWidth * rawHeight)),
  )
  const width = Math.max(1, Math.floor(rawWidth * scale))
  const height = Math.max(1, Math.floor(rawHeight * scale))
  const scaledContentWidth = contentWidth * scale
  const scaledContentHeight = contentHeight * scale
  let nextX = (width - scaledContentWidth) / 2

  return {
    width,
    height,
    scale,
    placements: sizes.map((size) => {
      const placement = {
        x: nextX,
        y: (height - scaledContentHeight) / 2 + ((contentHeight - size.height) * scale) / 2,
        width: size.width * scale,
        height: size.height * scale,
      }
      nextX += (size.width + gap) * scale
      return placement
    }),
  }
}

export function evidenceBoxesForDocument(
  findings: Pick<CaseFinding, 'document_id' | 'bbox' | 'superseded'>[],
  documentId: string,
): BoundingBox[] {
  const unique = new Map<string, BoundingBox>()
  findings
    .filter((finding) => finding.document_id === documentId && finding.bbox && !finding.superseded)
    .forEach((finding) => {
      const bbox = finding.bbox
      if (!bbox || bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0) return
      unique.set(`${bbox.x0}:${bbox.y0}:${bbox.x1}:${bbox.y1}`, bbox)
    })
  return [...unique.values()]
}

async function imageBlobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  try {
    const bitmap = await createImageBitmap(blob)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('瀏覽器無法建立文件畫布。')
      context.drawImage(bitmap, 0, 0)
      return canvas
    } finally {
      bitmap.close()
    }
  } catch {
    // Safari 與部分 Chromium 對極小 PNG / 特定編碼的 createImageBitmap 支援不完整；
    // 標準 img decoder 能顯示時仍可安全畫進同源的 blob canvas。
    const objectUrl = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.src = objectUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('瀏覽器無法建立文件畫布。')
      context.drawImage(image, 0, 0)
      return canvas
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }
}

async function pdfBlobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const pages = await pdfToPageCanvases(blob, { maxPages: 5 })
  if (!pages.canvases.length) throw new Error('PDF 沒有可匯出的頁面。')
  const width = Math.max(...pages.canvases.map((canvas) => canvas.width))
  const height = pages.canvases.reduce((sum, canvas) => sum + canvas.height, 0)
  const merged = document.createElement('canvas')
  merged.width = width
  merged.height = height
  const context = merged.getContext('2d')
  if (!context) {
    pages.canvases.forEach(disposeCanvas)
    throw new Error('瀏覽器無法建立 PDF 匯出畫布。')
  }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  let y = 0
  for (const canvas of pages.canvases) {
    context.drawImage(canvas, 0, y)
    y += canvas.height
    disposeCanvas(canvas)
  }
  return merged
}

async function renderDocument(documentItem: CaseDocument, loadUrl: (documentId: string) => Promise<string>): Promise<RenderedDocument> {
  const url = await loadUrl(documentItem.id)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${documentItem.document_type_label}下載失敗（${response.status}）。`)
  const blob = await response.blob()
  const canvas = documentItem.mime === 'application/pdf'
    ? await pdfBlobToCanvas(blob)
    : await imageBlobToCanvas(blob)
  return { document: documentItem, canvas }
}

function drawDotGrid(context: CanvasRenderingContext2D, width: number, height: number, spacing: number): void {
  context.fillStyle = '#cbd5e1'
  const radius = Math.max(1, spacing / 18)
  for (let y = spacing / 2; y < height; y += spacing) {
    for (let x = spacing / 2; x < width; x += spacing) {
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  }
}

function drawHighlights(
  context: CanvasRenderingContext2D,
  boxes: BoundingBox[],
  placement: ReviewCanvasPlacement,
  source: ReviewCanvasSize,
): void {
  const xScale = placement.width / source.width
  const yScale = placement.height / source.height
  context.save()
  context.fillStyle = 'rgba(255, 232, 75, 0.34)'
  context.strokeStyle = 'rgba(245, 158, 11, 0.9)'
  context.lineWidth = Math.max(2, 3 * Math.min(xScale, yScale))
  for (const box of boxes) {
    const x0 = Math.max(0, Math.min(source.width, box.x0))
    const y0 = Math.max(0, Math.min(source.height, box.y0))
    const x1 = Math.max(x0, Math.min(source.width, box.x1))
    const y1 = Math.max(y0, Math.min(source.height, box.y1))
    context.fillRect(placement.x + x0 * xScale, placement.y + y0 * yScale, (x1 - x0) * xScale, (y1 - y0) * yScale)
    context.strokeRect(placement.x + x0 * xScale, placement.y + y0 * yScale, (x1 - x0) * xScale, (y1 - y0) * yScale)
  }
  context.restore()
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // 讓瀏覽器先接手 blob；同步 revoke 在部分 Chrome 版本會取消尚未開始的下載。
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function exportReviewCanvas(options: ExportReviewCanvasOptions): Promise<void> {
  const current = options.documents.filter((documentItem) => documentItem.is_current && !documentItem.purged_at)
  if (!current.length) throw new Error('沒有可匯出的目前版本文件。')

  const rendered = await Promise.all(current.map((documentItem) => renderDocument(documentItem, options.loadUrl)))
  try {
    const layout = planReviewCanvas(rendered.map(({ canvas }) => ({ width: canvas.width, height: canvas.height })))
    const output = document.createElement('canvas')
    try {
      output.width = layout.width
      output.height = layout.height
      const context = output.getContext('2d')
      if (!context) throw new Error('瀏覽器無法建立匯出畫布。')

      context.fillStyle = '#f8fafc'
      context.fillRect(0, 0, output.width, output.height)
      drawDotGrid(context, output.width, output.height, Math.max(24, Math.round(48 * layout.scale)))

      rendered.forEach(({ document: documentItem, canvas }, index) => {
        const placement = layout.placements[index]
        context.save()
        context.shadowColor = 'rgba(15, 23, 42, 0.18)'
        context.shadowBlur = Math.max(12, 28 * layout.scale)
        context.shadowOffsetY = Math.max(4, 10 * layout.scale)
        context.drawImage(canvas, placement.x, placement.y, placement.width, placement.height)
        context.restore()
        drawHighlights(
          context,
          evidenceBoxesForDocument(options.findings, documentItem.id),
          placement,
          { width: canvas.width, height: canvas.height },
        )
      })

      triggerDownload(await toBlob(output, 'image/png'), options.fileName)
    } finally {
      disposeCanvas(output)
    }
  } finally {
    rendered.forEach(({ canvas }) => disposeCanvas(canvas))
  }
}
