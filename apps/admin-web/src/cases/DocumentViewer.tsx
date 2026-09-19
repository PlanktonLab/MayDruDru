/** 文件檢視器（SPEC §8.2「左：文件檢視器 pan/zoom + OCR 高亮」）。
 *
 * 審核頁以文件為主體（SPEC §15.2），所以這一側佔掉一半畫面：分頁切換目前的文件、
 * 可展開歷史版本、滾輪縮放、拖曳平移、旋轉，以及把 OCR 的行框疊在圖上。
 *
 * 高亮用**百分比**定位：presigned 出來的圖顯示尺寸不固定（而且 5 分鐘就換一張），
 * 用像素換算得一直追著 naturalWidth 跑；bbox 除以原圖尺寸之後，縮放與旋轉都不必重算。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { History, Highlighter, Maximize2, RotateCw, ScanLine, ZoomIn, ZoomOut } from 'lucide-react'
import { Badge, Button, Spinner, cx } from '@maydru/ui'
import { disposeCanvas, pdfToPageCanvases, toBlob } from '@maydru/ocr'
import type { BoundingBox } from '@maydru/review-rules'
import { dateTime } from './labels'
import type { CaseDocument, CaseFinding } from './types'

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3

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

/**
 * bbox（原圖像素）→ 百分比。缺尺寸時回 null，寧可不畫也不要畫錯位置——
 * 一個歪掉的框會讓承辦以為系統抓錯欄位。
 */
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

export interface DocumentViewerProps {
  documents: CaseDocument[]
  /** 目前選到的文件 id；由上層控制，才能被 findings 的「定位」連動。 */
  selectedId: string | null
  onSelect: (documentId: string) => void
  /** 取 presigned URL（5 分鐘有效）。 */
  loadUrl: (documentId: string) => Promise<string>
  /** 由選到的 finding 傳進來，畫成強調框。 */
  focusBbox?: BoundingBox | null
  /** 規則引擎找到的證據；ProReview 會把這些位置全部畫成螢光筆重點。 */
  findings?: Pick<CaseFinding, 'id' | 'rule_code' | 'document_id' | 'bbox' | 'superseded'>[]
  /** 在承辦的瀏覽器重跑 tesseract。 */
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

export function DocumentViewer({
  documents,
  selectedId,
  onSelect,
  loadUrl,
  focusBbox,
  findings = [],
  onReRecognise,
  recognising = false,
  recogniseProgress = 0,
  reviewContext,
}: DocumentViewerProps) {
  const current = documents.filter((doc) => doc.is_current)
  const history = documents.filter((doc) => !doc.is_current)
  const [showHistory, setShowHistory] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [renderedPdfUrl, setRenderedPdfUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [showHighlights, setShowHighlights] = useState(true)
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const selected = documents.find((doc) => doc.id === selectedId) ?? current[0] ?? null
  const isPdf = selected?.mime === 'application/pdf'

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setLoading(true)
    setError('')
    setUrl(null)
    setRenderedPdfUrl(null)
    setNatural({ width: 0, height: 0 })
    setZoom(1)
    setRotation(0)
    setPan({ x: 0, y: 0 })
    loadUrl(selected.id)
      .then((next) => {
        if (!cancelled) setUrl(next)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '文件連結取得失敗，請重新整理。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadUrl, selected])

  // PDF 原件不能在瀏覽器內建 iframe 上可靠疊 DOM 標記，因此和 ProReview 一樣先轉成畫布。
  // 多頁由上往下接成一張長圖；重新 OCR 也使用相同座標系，bbox 才能準確落在文字上。
  useEffect(() => {
    if (!url || !isPdf) {
      setRenderedPdfUrl(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    const render = async () => {
      setLoading(true)
      setError('')
      try {
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
        const blob = await toBlob(merged, 'image/jpeg')
        disposeCanvas(merged)
        objectUrl = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          objectUrl = null
        } else {
          setRenderedPdfUrl(objectUrl)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'PDF 轉換失敗，請重新整理。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void render()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [isPdf, url])

  const highlights = useMemo<HighlightBox[]>(() => {
    if (!selected) return []
    const boxes: HighlightBox[] = []
    let focusIsEvidence = false
    if (showHighlights) {
      const evidenceByBox = new Map<string, HighlightBox>()
      findings
        .filter((finding) => !finding.superseded && finding.document_id === selected.id && finding.bbox)
        .forEach((finding) => {
          const box = toPercentBox(finding.bbox, natural.width, natural.height)
          const emphasis = Boolean(
            focusBbox
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
              key: coordinateKey,
              emphasis,
              label: finding.rule_code,
            })
          }
        })
      boxes.push(...evidenceByBox.values())
    }
    // focus 通常已經是上面某個 evidence；只有舊資料沒有 finding id 時才補畫，避免兩層
    // 半透明色疊在一起把文字蓋住。
    if (!focusIsEvidence) {
      const focus = toPercentBox(focusBbox, natural.width, natural.height)
      if (focus) boxes.push({ ...focus, key: 'focus', emphasis: true, label: '目前定位的重點' })
    }
    return boxes
  }, [findings, focusBbox, natural.height, natural.width, selected, showHighlights])

  const evidenceCount = findings.filter(
    (finding) => !finding.superseded && finding.document_id === selected?.id && finding.bbox,
  ).length
  const displayUrl = isPdf ? renderedPdfUrl : url

  const fitToWidth = useCallback((width = natural.width) => {
    const available = (stageRef.current?.clientWidth ?? 0) - 32
    if (!width || available <= 0) return
    setZoom(clampZoom(Math.min(1, available / width)))
    setPan({ x: 0, y: 0 })
  }, [natural.width])

  const onWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault()
    setZoom((current) => clampZoom(current - event.deltaY * 0.002))
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      dragRef.current = { x: event.clientX - pan.x, y: event.clientY - pan.y }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [pan.x, pan.y],
  )

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = dragRef.current
    if (!start) return
    setPan({ x: event.clientX - start.x, y: event.clientY - start.y })
  }, [])

  const endDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  if (documents.length === 0)
    return <div className="p-6 text-sm text-muted">這件案子還沒有文件。</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="文件" className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {current.map((doc) => (
          <button
            key={doc.id}
            role="tab"
            type="button"
            aria-selected={doc.id === selected?.id}
            onClick={() => onSelect(doc.id)}
            className={cx(
              'min-h-9 rounded-lg px-3 py-1.5 text-[13px]',
              doc.id === selected?.id ? 'bg-accent-bg font-medium text-accent' : 'text-muted hover:bg-background-lite',
            )}
          >
            {doc.document_type_label}{(doc.period_index ?? 1) > 1 ? `（第 ${doc.period_index} 期）` : ''}
            {doc.revision > 0 && <span className="ml-1 tabular-nums">v{doc.revision + 1}</span>}
          </button>
        ))}
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((value) => !value)}
            aria-expanded={showHistory}
            className="ml-auto flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-background-lite"
          >
            <History size={14} />
            歷史版本（{history.length}）
          </button>
        )}
      </div>

      {showHistory && history.length > 0 && (
        <ul className="border-b border-border bg-background-lite px-3 py-2 text-[13px]">
          {history.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => onSelect(doc.id)}
                className={cx(
                  'flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-canvas',
                  doc.id === selected?.id && 'text-accent',
                )}
              >
                <span className="flex-1 truncate">
                  {doc.document_type_label}{(doc.period_index ?? 1) > 1 ? `（第 ${doc.period_index} 期）` : ''}
                </span>
                <span className="tabular-nums text-muted">第 {doc.revision + 1} 版</span>
                <span className="text-muted">{dateTime(doc.uploaded_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <>
            <Button size="sm" icon={<ZoomOut size={14} />} onClick={() => setZoom((z) => clampZoom(z - 0.25))} aria-label="縮小">
              縮小
            </Button>
            <Button size="sm" icon={<ZoomIn size={14} />} onClick={() => setZoom((z) => clampZoom(z + 0.25))} aria-label="放大">
              放大
            </Button>
            <Button size="sm" icon={<RotateCw size={14} />} onClick={() => setRotation((r) => (r + 90) % 360)}>
              旋轉
            </Button>
            <Button size="sm" icon={<ScanLine size={14} />} onClick={() => fitToWidth()}>
              適合寬度
            </Button>
            <Button
              size="sm"
              icon={<Maximize2 size={14} />}
              onClick={() => {
                setRotation(0)
                fitToWidth()
              }}
            >
              回到開頭
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
            {selected && onReRecognise && (
              <Button size="sm" loading={recognising} onClick={() => onReRecognise(selected)}>
                重新辨識
              </Button>
            )}
            <span className="ml-auto text-[12px] tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
        </>
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[12px] text-muted">
          {selected.masked && <Badge tone="good">已遮罩</Badge>}
          <Badge tone="neutral">{selected.page_count} 頁</Badge>
          {selected.ocr ? (
            <Badge tone={selected.ocr.source === 'reviewer' ? 'accent' : 'neutral'}>
              {`OCR 來源：${selected.ocr.source === 'reviewer' ? '承辦重新辨識' : '申請人上傳'}`}
            </Badge>
          ) : (
            <Badge tone="warn">沒有 OCR 結果</Badge>
          )}
          {isPdf && <Badge tone="neutral">PDF 審核畫布</Badge>}
          <span>上傳於 {dateTime(selected.uploaded_at)}</span>
        </div>
      )}

      {recognising && (
        <div className="px-3 pb-2">
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
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
      >
        {reviewContext && (
          <div className="pointer-events-none absolute left-3 top-3 z-30 max-w-[min(360px,calc(100%-24px))] rounded-xl border border-white/70 bg-canvas/90 p-3 text-xs shadow-lg backdrop-blur" aria-label="畫布案件資訊">
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
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner label="取得文件連結…" />
          </div>
        )}
        {error && (
          <p role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-sm text-danger">
            {error}
          </p>
        )}
        {displayUrl && (
          <div
            data-testid="document-stage"
            className="absolute left-1/2 top-4 origin-top"
            style={{
              transform: `translateX(-50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            }}
          >
            <img
              src={displayUrl}
              alt={selected ? `${selected.document_type_label}（第 ${selected.revision + 1} 版）` : '文件'}
              draggable={false}
              onLoad={(event) =>
                {
                  const width = event.currentTarget.naturalWidth
                  const height = event.currentTarget.naturalHeight
                  setNatural({ width, height })
                  fitToWidth(width)
                }
              }
              className="max-w-none select-none"
            />
            {highlights.map((box) => (
              <span
                key={box.key}
                data-testid={box.emphasis ? 'highlight-focus' : 'highlight-line'}
                aria-hidden
                title={box.label}
                className={cx(
                  'pointer-events-none absolute rounded-[1px] transition-all',
                  box.emphasis ? 'z-10 animate-pulse ring-2 ring-amber-500' : 'z-[1]',
                )}
                style={{
                  left: `${box.left}%`,
                  top: `${box.top}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                  background: box.emphasis ? 'rgba(255, 224, 0, 0.48)' : 'rgba(255, 232, 75, 0.26)',
                }}
              >
                <span className="absolute bottom-full left-0 mb-1 max-w-48 truncate rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-slate-950 shadow-sm">
                  {box.label}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
