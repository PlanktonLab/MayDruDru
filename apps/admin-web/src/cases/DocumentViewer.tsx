/** 文件審核畫布（SPEC §8.2）。
 *
 * 目前版本文件會同時排在同一張點狀畫布上；工具列控制整張畫布的平移、縮放與旋轉。
 * finding 的「看文件」會把對應 bbox 移到畫布中央並放大，螢光標記也會重新閃爍。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileText, History, Highlighter, Maximize2, RotateCw, ScanLine, ZoomIn, ZoomOut } from 'lucide-react'
import { Badge, Button, Spinner, cx } from '@maydru/ui'
import { disposeCanvas, pdfToPageCanvases, toBlob } from '@maydru/ocr'
import type { BoundingBox } from '@maydru/review-rules'
import { dateTime } from './labels'
import { exportReviewCanvas } from './reviewCanvasExport'
import type { CaseDocument, CaseFinding } from './types'

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3
export const WORKSPACE_GAP = 96
export const DOCUMENT_HEADER_HEIGHT = 48

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export interface HighlightBox {
  key: string
  /** 百分比（0–100）。 */
  left: number
  top: number
  width: number
  height: number
  emphasis: boolean
  label: string
}

export function toPercentBox(
  bbox: BoundingBox | null | undefined,
  width: number,
  height: number,
): Omit<HighlightBox, 'key' | 'emphasis' | 'label'> | null {
  if (!bbox || !width || !height) return null
  return {
    left: (bbox.x0 / width) * 100,
    top: (bbox.y0 / height) * 100,
    width: ((bbox.x1 - bbox.x0) / width) * 100,
    height: ((bbox.y1 - bbox.y0) / height) * 100,
  }
}

export interface WorkspaceDocumentSize {
  id: string
  width: number
  height: number
}

export interface WorkspacePlacement extends WorkspaceDocumentSize {
  x: number
  y: number
}

export interface DocumentWorkspacePlan {
  width: number
  height: number
  placements: WorkspacePlacement[]
}

export function planDocumentWorkspace(
  sizes: WorkspaceDocumentSize[],
  gap = WORKSPACE_GAP,
): DocumentWorkspacePlan {
  if (!sizes.length) return { width: 0, height: 0, placements: [] }
  const height = Math.max(...sizes.map((size) => size.height + DOCUMENT_HEADER_HEIGHT))
  const width = sizes.reduce((sum, size) => sum + size.width, 0) + gap * (sizes.length - 1)
  let x = 0
  return {
    width,
    height,
    placements: sizes.map((size) => {
      const placement = {
        ...size,
        x,
        y: (height - size.height - DOCUMENT_HEADER_HEIGHT) / 2,
      }
      x += size.width + gap
      return placement
    }),
  }
}

export interface WorkspaceView {
  zoom: number
  pan: { x: number; y: number }
}

export function focusWorkspaceDocument(
  workspace: Pick<DocumentWorkspacePlan, 'width' | 'height'>,
  placement: WorkspacePlacement,
  viewport: { width: number; height: number },
  bbox?: BoundingBox | null,
): WorkspaceView {
  const safeWidth = Math.max(1, viewport.width - 96)
  const safeHeight = Math.max(1, viewport.height - 96)
  const boxWidth = bbox ? Math.max(1, bbox.x1 - bbox.x0) : placement.width
  const boxHeight = bbox ? Math.max(1, bbox.y1 - bbox.y0) : placement.height
  const targetWidth = bbox ? Math.max(boxWidth * 1.25, placement.width * 0.42) : placement.width * 1.12
  const targetHeight = bbox ? Math.max(boxHeight * 2.2, placement.height * 0.34) : placement.height * 1.12
  const zoom = clampZoom(Math.min(safeWidth / targetWidth, safeHeight / targetHeight))
  const targetX = placement.x + (bbox ? (bbox.x0 + bbox.x1) / 2 : placement.width / 2)
  const targetY = placement.y + DOCUMENT_HEADER_HEIGHT
    + (bbox ? (bbox.y0 + bbox.y1) / 2 : placement.height / 2)
  return {
    zoom,
    pan: {
      x: -(targetX - workspace.width / 2) * zoom,
      y: -(targetY - workspace.height / 2) * zoom,
    },
  }
}

export interface DocumentViewerProps {
  documents: CaseDocument[]
  selectedId: string | null
  onSelect: (documentId: string) => void
  loadUrl: (documentId: string) => Promise<string>
  focusBbox?: BoundingBox | null
  /** 每次按「看文件」都遞增，讓相同 bbox 也能重新播放閃爍。 */
  focusKey?: number
  findings?: Pick<CaseFinding, 'id' | 'rule_code' | 'document_id' | 'bbox' | 'superseded'>[]
  onReRecognise?: (document: CaseDocument) => void
  recognising?: boolean
  recogniseProgress?: number
  reviewContext?: {
    caseNo: string
    applicant: string
    scheme: string
    status: string
    amount: string
    reviewer: string
    missingCount: number
  }
}

interface PreparedDocument {
  document: CaseDocument
  url: string | null
  error: string
}

async function renderPdfForReview(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`PDF 下載失敗（${response.status}）`)
  const pages = await pdfToPageCanvases(await response.blob(), { maxPages: 5 })
  if (!pages.canvases.length) throw new Error('PDF 沒有可顯示的頁面。')
  const width = Math.max(...pages.canvases.map((canvas) => canvas.width))
  const height = pages.canvases.reduce((sum, canvas) => sum + canvas.height, 0)
  const merged = document.createElement('canvas')
  merged.width = width
  merged.height = height
  const context = merged.getContext('2d')
  if (!context) throw new Error('瀏覽器無法建立 PDF 審核畫布。')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  let y = 0
  for (const canvas of pages.canvases) {
    context.drawImage(canvas, 0, y)
    y += canvas.height
    disposeCanvas(canvas)
  }
  try {
    return URL.createObjectURL(await toBlob(merged, 'image/jpeg'))
  } finally {
    disposeCanvas(merged)
  }
}

export function DocumentViewer({
  documents,
  selectedId,
  onSelect,
  loadUrl,
  focusBbox,
  focusKey = 0,
  findings = [],
  onReRecognise,
  recognising = false,
  recogniseProgress = 0,
  reviewContext,
}: DocumentViewerProps) {
  const current = useMemo(() => documents.filter((doc) => doc.is_current), [documents])
  const history = useMemo(() => documents.filter((doc) => !doc.is_current), [documents])
  const selected = documents.find((doc) => doc.id === selectedId) ?? current[0] ?? null
  const historicalSelection = selected && !selected.is_current ? selected : null
  const canvasDocuments = useMemo(
    () => historicalSelection ? [...current, historicalSelection] : current,
    [current, historicalSelection],
  )
  const documentKey = canvasDocuments.map((doc) => `${doc.id}:${doc.revision}`).join('|')

  const [showHistory, setShowHistory] = useState(false)
  const [prepared, setPrepared] = useState<PreparedDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [showHighlights, setShowHighlights] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [naturalById, setNaturalById] = useState<Record<string, { width: number; height: number }>>({})
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const fittedDocumentKey = useRef('')

  useEffect(() => {
    let cancelled = false
    const ownedUrls: string[] = []
    setLoading(true)
    setPrepared([])
    setNaturalById({})
    fittedDocumentKey.current = ''
    Promise.all(
      canvasDocuments.map(async (documentItem): Promise<PreparedDocument> => {
        try {
          const sourceUrl = await loadUrl(documentItem.id)
          if (documentItem.mime !== 'application/pdf') return { document: documentItem, url: sourceUrl, error: '' }
          const renderedUrl = await renderPdfForReview(sourceUrl)
          ownedUrls.push(renderedUrl)
          return { document: documentItem, url: renderedUrl, error: '' }
        } catch (cause) {
          return {
            document: documentItem,
            url: null,
            error: cause instanceof Error ? cause.message : '文件載入失敗，請重新整理。',
          }
        }
      }),
    )
      .then((next) => {
        if (!cancelled) setPrepared(next)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      ownedUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [canvasDocuments, documentKey, loadUrl])

  const workspace = useMemo(
    () => planDocumentWorkspace(
      prepared
        .filter((item) => item.url && naturalById[item.document.id])
        .map((item) => ({ id: item.document.id, ...naturalById[item.document.id] })),
    ),
    [naturalById, prepared],
  )

  const fitAll = useCallback(() => {
    const stage = stageRef.current
    if (!stage || !workspace.width || !workspace.height) return
    const nextZoom = clampZoom(Math.min(
      1,
      (stage.clientWidth - 72) / workspace.width,
      (stage.clientHeight - 72) / workspace.height,
    ))
    setZoom(nextZoom)
    setPan({ x: 0, y: 0 })
  }, [workspace.height, workspace.width])

  useEffect(() => {
    if (
      !workspace.width
      || workspace.placements.length !== canvasDocuments.length
      || fittedDocumentKey.current === documentKey
    ) return
    fittedDocumentKey.current = documentKey
    fitAll()
  }, [canvasDocuments.length, documentKey, fitAll, workspace.placements.length, workspace.width])

  const focusDocument = useCallback((documentId: string, bbox?: BoundingBox | null) => {
    const stage = stageRef.current
    const placement = workspace.placements.find((item) => item.id === documentId)
    if (!stage || !placement) return
    const view = focusWorkspaceDocument(
      workspace,
      placement,
      { width: stage.clientWidth, height: stage.clientHeight },
      bbox,
    )
    setRotation(0)
    setZoom(view.zoom)
    setPan(view.pan)
  }, [workspace])

  useEffect(() => {
    if (selectedId) focusDocument(selectedId, focusBbox)
  }, [focusBbox, focusDocument, focusKey, selectedId])

  const highlightsFor = useCallback((documentItem: CaseDocument): HighlightBox[] => {
    const natural = naturalById[documentItem.id]
    if (!natural) return []
    const boxes: HighlightBox[] = []
    let focusIsEvidence = false
    if (showHighlights) {
      const evidenceByBox = new Map<string, HighlightBox>()
      findings
        .filter((finding) => !finding.superseded && finding.document_id === documentItem.id && finding.bbox)
        .forEach((finding) => {
          const box = toPercentBox(finding.bbox, natural.width, natural.height)
          const emphasis = Boolean(
            documentItem.id === selectedId
            && focusBbox
            && finding.bbox
            && finding.bbox.x0 === focusBbox.x0
            && finding.bbox.y0 === focusBbox.y0
            && finding.bbox.x1 === focusBbox.x1
            && finding.bbox.y1 === focusBbox.y1,
          )
          if (emphasis) focusIsEvidence = true
          if (!box || !finding.bbox) return
          const coordinateKey = `${finding.bbox.x0}:${finding.bbox.y0}:${finding.bbox.x1}:${finding.bbox.y1}`
          const existing = evidenceByBox.get(coordinateKey)
          if (existing) {
            existing.emphasis ||= emphasis
            existing.label = `${existing.label}、${finding.rule_code}`
          } else {
            evidenceByBox.set(coordinateKey, {
              ...box,
              key: `${documentItem.id}:${coordinateKey}${emphasis ? `:${focusKey}` : ''}`,
              emphasis,
              label: finding.rule_code,
            })
          }
        })
      boxes.push(...evidenceByBox.values())
    }
    if (documentItem.id === selectedId && !focusIsEvidence) {
      const focus = toPercentBox(focusBbox, natural.width, natural.height)
      if (focus) {
        boxes.push({
          ...focus,
          key: `${documentItem.id}:focus:${focusKey}`,
          emphasis: true,
          label: '目前定位的重點',
        })
      }
    }
    return boxes
  }, [findings, focusBbox, focusKey, naturalById, selectedId, showHighlights])

  const evidenceCount = findings.filter((finding) => !finding.superseded && finding.bbox).length

  const onWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault()
    setZoom((currentZoom) => clampZoom(currentZoom - event.deltaY * 0.002))
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button')) return
    dragRef.current = { x: event.clientX - pan.x, y: event.clientY - pan.y }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [pan.x, pan.y])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = dragRef.current
    if (!start) return
    setPan({ x: event.clientX - start.x, y: event.clientY - start.y })
  }, [])

  const endDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  const reviewCaseNo = reviewContext?.caseNo
  const downloadCanvas = useCallback(async () => {
    setExporting(true)
    setExportError('')
    try {
      const caseNo = reviewCaseNo?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'case'
      await exportReviewCanvas({
        documents,
        findings,
        loadUrl,
        fileName: `${caseNo}-review-canvas.png`,
      })
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : '證據畫布匯出失敗，請再試一次。')
    } finally {
      setExporting(false)
    }
  }, [documents, findings, loadUrl, reviewCaseNo])

  if (documents.length === 0) return <div className="p-6 text-sm text-muted">這件案子還沒有文件。</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-canvas px-3 py-2">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
          <FileText size={14} />畫布文件 <Badge tone="neutral">{canvasDocuments.length}</Badge>
        </span>
        <div role="tablist" aria-label="畫布文件" className="flex flex-wrap gap-1.5">
          {current.map((doc) => (
            <button
              key={doc.id}
              role="tab"
              type="button"
              aria-selected={doc.id === selected?.id}
              onClick={() => {
                onSelect(doc.id)
                focusDocument(doc.id)
              }}
              className={cx(
                'min-h-8 rounded-full border px-3 text-[12px] transition-colors',
                doc.id === selected?.id
                  ? 'border-accent/30 bg-accent-bg font-semibold text-accent'
                  : 'border-border bg-background-lite text-muted hover:text-primary',
              )}
            >
              {doc.document_type_label}
              {doc.revision > 1 && <span className="ml-1 tabular-nums">v{doc.revision}</span>}
            </button>
          ))}
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((value) => !value)}
            aria-expanded={showHistory}
            className="ml-auto flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-muted hover:bg-background-lite"
          >
            <History size={13} />歷史版本（{history.length}）
          </button>
        )}
      </div>

      {showHistory && history.length > 0 && (
        <ul className="border-b border-border bg-background-lite px-3 py-2 text-[12px]">
          {history.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => onSelect(doc.id)}
                className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-canvas"
              >
                <span className="flex-1 truncate">{doc.document_type_label}</span>
                <span className="tabular-nums text-muted">第 {doc.revision} 版</span>
                <span className="text-muted">{dateTime(doc.uploaded_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-canvas px-3 py-2">
        <Button size="sm" icon={<ZoomOut size={14} />} onClick={() => setZoom((value) => clampZoom(value - 0.25))} aria-label="縮小">縮小</Button>
        <Button size="sm" icon={<ZoomIn size={14} />} onClick={() => setZoom((value) => clampZoom(value + 0.25))} aria-label="放大">放大</Button>
        <Button size="sm" icon={<RotateCw size={14} />} onClick={() => setRotation((value) => (value + 90) % 360)}>旋轉</Button>
        <Button size="sm" icon={<ScanLine size={14} />} onClick={fitAll}>適合畫布</Button>
        <Button
          size="sm"
          icon={<Maximize2 size={14} />}
          onClick={() => {
            setRotation(0)
            fitAll()
          }}
        >
          顯示全部
        </Button>
        <Button
          size="sm"
          variant={showHighlights ? 'primary' : 'secondary'}
          icon={<Highlighter size={14} />}
          aria-pressed={showHighlights}
          onClick={() => setShowHighlights((value) => !value)}
        >
          重點標記{evidenceCount ? `（${evidenceCount}）` : ''}
        </Button>
        <Button size="sm" icon={<Download size={14} />} loading={exporting} onClick={() => void downloadCanvas()}>
          匯出 3× 畫布
        </Button>
        {selected && onReRecognise && (
          <Button size="sm" loading={recognising} onClick={() => onReRecognise(selected)}>重新辨識</Button>
        )}
        <span className="ml-auto text-[12px] tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-white/80 px-3 py-1.5 text-[12px] text-muted">
          <span className="font-semibold text-primary">目前定位：{selected.document_type_label}</span>
          <Badge tone={selected.ocr ? 'neutral' : 'warn'}>
            {selected.ocr
              ? `OCR 來源：${selected.ocr.source === 'reviewer' ? '承辦重新辨識' : '申請人上傳'}`
              : '沒有 OCR 結果'}
          </Badge>
          <span>上傳於 {dateTime(selected.uploaded_at)}</span>
        </div>
      )}

      {exportError && <p role="alert" className="px-3 py-2 text-[13px] text-danger">{exportError}</p>}

      {recognising && (
        <div className="bg-canvas px-3 pb-2">
          <div
            role="progressbar"
            aria-label="重新辨識進度"
            aria-valuenow={Math.round(recogniseProgress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-full overflow-hidden rounded-full bg-background-lite"
          >
            <div className="h-full bg-accent" style={{ width: `${Math.round(recogniseProgress * 100)}%` }} />
          </div>
        </div>
      )}

      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{
          cursor: dragRef.current ? 'grabbing' : 'grab',
          backgroundColor: '#eef1f5',
          backgroundImage: 'radial-gradient(circle, #c8d0dc 1.2px, transparent 1.2px)',
          backgroundSize: '24px 24px',
        }}
      >
        <div aria-hidden className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
          {prepared.filter((item) => item.url && !naturalById[item.document.id]).map((item) => (
            <img
              key={item.document.id}
              src={item.url!}
              alt=""
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget
                if (!width || !height) return
                setNaturalById((currentSizes) => {
                  const existing = currentSizes[item.document.id]
                  if (existing?.width === width && existing.height === height) return currentSizes
                  return { ...currentSizes, [item.document.id]: { width, height } }
                })
              }}
            />
          ))}
        </div>

        {reviewContext && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-30 max-w-[min(330px,calc(100%-24px))] rounded-xl border border-white/80 bg-canvas/88 p-3 text-xs shadow-lg backdrop-blur" aria-label="畫布案件資訊">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold text-primary">{reviewContext.caseNo}</span>
              <Badge tone="accent">{reviewContext.status}</Badge>
              {reviewContext.missingCount > 0 && <Badge tone="warn">缺 {reviewContext.missingCount} 份文件</Badge>}
            </div>
            <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
              <span>申請人</span><span className="truncate text-primary">{reviewContext.applicant}</span>
              <span>方案</span><span className="truncate text-primary">{reviewContext.scheme}</span>
              <span>申報</span><span className="text-primary">{reviewContext.amount}</span>
              <span>審核人</span><span className="truncate text-primary">{reviewContext.reviewer}</span>
            </div>
          </div>
        )}

        {loading && prepared.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center"><Spinner label="準備文件畫布…" /></div>
        )}

        {workspace.width > 0 && (
          <div
            data-testid="document-workspace-anchor"
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
          >
            <div
              data-testid="document-workspace"
              className="absolute"
              style={{
                left: `${-(workspace.width * zoom) / 2}px`,
                top: `${-(workspace.height * zoom) / 2}px`,
                width: `${workspace.width * zoom}px`,
                height: `${workspace.height * zoom}px`,
                transform: `rotate(${rotation}deg)`,
                transformOrigin: 'center',
              }}
            >
              <div
                className="relative origin-top-left"
                style={{ width: `${workspace.width}px`, height: `${workspace.height}px`, transform: `scale(${zoom})` }}
              >
                {workspace.placements.map((placement) => {
                  const item = prepared.find((entry) => entry.document.id === placement.id)
                  if (!item?.url) return null
                  const documentHighlights = highlightsFor(item.document)
                  const isSelected = selected?.id === item.document.id
                  return (
                    <article
                      key={item.document.id}
                      data-testid={`canvas-document-${item.document.id}`}
                      className={cx(
                        'absolute overflow-hidden rounded-xl border bg-white shadow-[0_18px_55px_rgba(28,39,59,0.18)] transition-shadow',
                        isSelected ? 'border-accent ring-4 ring-accent/15' : 'border-slate-300',
                      )}
                      style={{
                        left: `${placement.x}px`,
                        top: `${placement.y}px`,
                        width: `${placement.width}px`,
                        height: `${placement.height + DOCUMENT_HEADER_HEIGHT}px`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(item.document.id)
                          focusDocument(item.document.id)
                        }}
                        className="flex h-12 w-full items-center gap-2 border-b border-slate-200 bg-white px-4 text-left"
                      >
                        <FileText size={18} className="shrink-0 text-accent" />
                        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-800">{item.document.document_type_label}</span>
                        {item.document.masked && <Badge tone="good">已遮罩</Badge>}
                        <Badge tone="neutral">{item.document.page_count} 頁</Badge>
                      </button>
                      <div className="relative" style={{ width: placement.width, height: placement.height }}>
                        <img
                          src={item.url}
                          alt={`${item.document.document_type_label}（第 ${item.document.revision} 版）`}
                          draggable={false}
                          className="block max-w-none select-none"
                          style={{ width: placement.width, height: placement.height }}
                        />
                        {documentHighlights.map((box) => (
                          <span
                            key={box.key}
                            data-testid={box.emphasis ? 'highlight-focus' : 'highlight-line'}
                            aria-hidden
                            title={box.label}
                            className={cx(
                              'pointer-events-none absolute rounded-sm border border-amber-400/70',
                              box.emphasis ? 'evidence-focus z-10 ring-4 ring-amber-400/55' : 'z-[1]',
                            )}
                            style={{
                              left: `${box.left}%`,
                              top: `${box.top}%`,
                              width: `${box.width}%`,
                              height: `${box.height}%`,
                              background: box.emphasis ? 'rgba(255, 221, 0, 0.48)' : 'rgba(255, 232, 75, 0.3)',
                            }}
                          >
                            <span className="absolute bottom-full left-0 mb-1 max-w-64 truncate rounded-md bg-amber-500 px-2 py-1 text-[12px] font-bold leading-4 text-slate-950 shadow">
                              {box.label}
                            </span>
                          </span>
                        ))}
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {prepared.filter((item) => item.error).map((item) => (
          <p key={item.document.id} role="alert" className="absolute left-1/2 top-1/2 -translate-x-1/2 rounded-lg bg-canvas p-4 text-sm text-danger shadow">
            {item.document.document_type_label}：{item.error}
          </p>
        ))}
      </div>
    </div>
  )
}
