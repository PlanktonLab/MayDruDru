/** 文件檢視器（SPEC §8.2「左：文件檢視器 pan/zoom + OCR 高亮」）。
 *
 * 審核頁以文件為主體（SPEC §15.2），所以這一側佔掉一半畫面：分頁切換目前的文件、
 * 可展開歷史版本、滾輪縮放、拖曳平移、旋轉，以及把 OCR 的行框疊在圖上。
 *
 * 高亮用**百分比**定位：presigned 出來的圖顯示尺寸不固定（而且 5 分鐘就換一張），
 * 用像素換算得一直追著 naturalWidth 跑；bbox 除以原圖尺寸之後，縮放與旋轉都不必重算。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { History, Maximize2, RotateCw, ScanText, ZoomIn, ZoomOut } from 'lucide-react'
import { Badge, Button, Spinner, cx } from '@maydru/ui'
import type { BoundingBox } from '@maydru/review-rules'
import { dateTime } from './labels'
import type { CaseDocument } from './types'

export const MIN_ZOOM = 0.5
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
}

/**
 * bbox（原圖像素）→ 百分比。缺尺寸時回 null，寧可不畫也不要畫錯位置——
 * 一個歪掉的框會讓承辦以為系統抓錯欄位。
 */
export function toPercentBox(
  bbox: BoundingBox | null | undefined,
  width: number,
  height: number,
): Omit<HighlightBox, 'key' | 'emphasis'> | null {
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
  /** 在承辦的瀏覽器重跑 tesseract。 */
  onReRecognise?: (document: CaseDocument) => void
  recognising?: boolean
  recogniseProgress?: number
}

export function DocumentViewer({
  documents,
  selectedId,
  onSelect,
  loadUrl,
  focusBbox,
  onReRecognise,
  recognising = false,
  recogniseProgress = 0,
}: DocumentViewerProps) {
  const current = documents.filter((doc) => doc.is_current)
  const history = documents.filter((doc) => !doc.is_current)
  const [showHistory, setShowHistory] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [showLines, setShowLines] = useState(true)
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  const selected = documents.find((doc) => doc.id === selectedId) ?? current[0] ?? null

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setLoading(true)
    setError('')
    setUrl(null)
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

  const highlights = useMemo<HighlightBox[]>(() => {
    if (!selected) return []
    const boxes: HighlightBox[] = []
    if (showLines && selected.ocr) {
      selected.ocr.lines.forEach((line, index) => {
        const box = toPercentBox(line.bbox, natural.width, natural.height)
        if (box) boxes.push({ ...box, key: `line-${index}`, emphasis: false })
      })
    }
    const focus = toPercentBox(focusBbox, natural.width, natural.height)
    if (focus) boxes.push({ ...focus, key: 'focus', emphasis: true })
    return boxes
  }, [focusBbox, natural.height, natural.width, selected, showLines])

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
            {doc.document_type_label}
            {doc.revision > 1 && <span className="ml-1 tabular-nums">v{doc.revision}</span>}
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
                <span className="flex-1 truncate">{doc.document_type_label}</span>
                <span className="tabular-nums text-muted">第 {doc.revision} 版</span>
                <span className="text-muted">{dateTime(doc.uploaded_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <Button size="sm" icon={<ZoomOut size={14} />} onClick={() => setZoom((z) => clampZoom(z - 0.25))} aria-label="縮小">
          縮小
        </Button>
        <Button size="sm" icon={<ZoomIn size={14} />} onClick={() => setZoom((z) => clampZoom(z + 0.25))} aria-label="放大">
          放大
        </Button>
        <Button size="sm" icon={<RotateCw size={14} />} onClick={() => setRotation((r) => (r + 90) % 360)}>
          旋轉
        </Button>
        <Button
          size="sm"
          icon={<Maximize2 size={14} />}
          onClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
            setRotation(0)
          }}
        >
          重設
        </Button>
        <Button
          size="sm"
          variant={showLines ? 'primary' : 'secondary'}
          icon={<ScanText size={14} />}
          aria-pressed={showLines}
          onClick={() => setShowLines((value) => !value)}
        >
          OCR 高亮
        </Button>
        {selected && onReRecognise && (
          <Button size="sm" loading={recognising} onClick={() => onReRecognise(selected)}>
            重新辨識
          </Button>
        )}
        <span className="ml-auto text-[12px] tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
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
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
      >
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
        {url && (
          <div
            data-testid="document-stage"
            className="absolute left-1/2 top-1/2 origin-center"
            style={{
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            }}
          >
            <img
              src={url}
              alt={selected ? `${selected.document_type_label}（第 ${selected.revision} 版）` : '文件'}
              draggable={false}
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              className="max-h-[70vh] max-w-full select-none"
            />
            {highlights.map((box) => (
              <span
                key={box.key}
                data-testid={box.emphasis ? 'highlight-focus' : 'highlight-line'}
                aria-hidden
                className={cx(
                  'pointer-events-none absolute rounded-[2px] border',
                  box.emphasis ? 'border-2 border-accent bg-accent-bg' : 'border-warn/70',
                )}
                style={{
                  left: `${box.left}%`,
                  top: `${box.top}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
