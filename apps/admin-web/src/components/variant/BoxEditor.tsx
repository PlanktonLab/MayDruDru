/**
 * Generic image + overlay editor, shared by the Focus Box tool and the
 * Annotation tool. Boxes are stored as fractions (0..1) of the image.
 *
 * Interaction model:
 *  - pointer-down on empty area + drag → draws → `onDraw(rect, stroke)`; the
 *    rect is the dragged rectangle, the stroke is where the finger went down
 *    and came up (a swipe tool wants the stroke, not the rectangle)
 *  - pointer-down on a box → selects it; dragging moves it (clamped to image)
 *  - Delete / Backspace while the editor has focus → `onDelete(selectedId)`
 *  - each box shows an optional badge (top-left) and a × button
 *
 * A caller can take over how a box looks: `frameOf` places the wrapper and
 * `renderBox` fills it (the swipe glyph does this); the default is a tinted
 * rectangle, or a round marker for boxes with no area.
 */
import { clsx } from 'clsx'
import { X } from 'lucide-react'
import { useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'

export interface EditorBox { id: string; x: number; y: number; w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }
export interface Stroke { from: Pt; to: Pt }

interface Props<B extends EditorBox> {
  src: string | null
  placeholder?: ReactNode
  /** natural width / height, used to reserve the aspect ratio */
  aspect: number
  boxes: B[]
  onChange: (boxes: B[]) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDraw?: (rect: Rect, stroke: Stroke) => void
  onDelete?: (id: string) => void
  colorOf: (b: B) => string
  badgeOf?: (b: B) => ReactNode
  /** boxes with no area are drawn as a round marker centred on (x, y) */
  isPoint?: (b: B) => boolean
  /** Custom placement for a box's wrapper (absolute CSS); null = the default rectangle. */
  frameOf?: (b: B) => CSSProperties | null
  /** What goes inside a custom-framed wrapper. */
  renderBox?: (b: B, selected: boolean) => ReactNode
  /** Live preview while the current tool is being dragged; null = the default dashed rectangle. */
  renderStroke?: (stroke: Stroke) => ReactNode
  readOnly?: boolean
  drawColor?: string
  showDelete?: boolean
}

type Drag =
  | { kind: 'draw'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'move'; id: string; sx: number; sy: number; ox: number; oy: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const pct = (v: number) => `${v * 100}%`

export function BoxEditor<B extends EditorBox>({
  src, placeholder, aspect, boxes, onChange, selectedId, onSelect, onDraw, onDelete, colorOf, badgeOf, isPoint,
  frameOf, renderBox, renderStroke, readOnly, drawColor = 'var(--accent)', showDelete = true,
}: Props<B>) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const toFrac = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }
  }

  const onBgDown = (e: RPointerEvent<HTMLDivElement>) => {
    onSelect(null)
    if (readOnly || e.button !== 0) return
    e.preventDefault()
    const { x, y } = toFrac(e)
    ref.current?.setPointerCapture(e.pointerId)
    setDrag({ kind: 'draw', sx: x, sy: y, cx: x, cy: y })
  }
  const onBoxDown = (e: RPointerEvent<HTMLDivElement>, b: B) => {
    e.stopPropagation()
    onSelect(b.id)
    ref.current?.focus()
    if (readOnly || e.button !== 0) return
    e.preventDefault()
    const { x, y } = toFrac(e)
    ref.current?.setPointerCapture(e.pointerId)
    setDrag({ kind: 'move', id: b.id, sx: x, sy: y, ox: b.x, oy: b.y })
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const { x, y } = toFrac(e)
    if (drag.kind === 'draw') { setDrag({ ...drag, cx: x, cy: y }); return }
    const b = boxes.find((o) => o.id === drag.id)
    if (!b) return
    const nx = clamp(drag.ox + (x - drag.sx), 0, 1 - b.w)
    const ny = clamp(drag.oy + (y - drag.sy), 0, 1 - b.h)
    if (nx !== b.x || ny !== b.y) onChange(boxes.map((o) => (o.id === drag.id ? { ...o, x: nx, y: ny } : o)))
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    try { ref.current?.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (drag.kind === 'draw') {
      const x = Math.min(drag.sx, drag.cx), y = Math.min(drag.sy, drag.cy)
      onDraw?.({ x, y, w: Math.abs(drag.cx - drag.sx), h: Math.abs(drag.cy - drag.sy) }, { from: { x: drag.sx, y: drag.sy }, to: { x: drag.cx, y: drag.cy } })
    }
    setDrag(null)
  }
  const onKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (readOnly || !selectedId) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); onDelete?.(selectedId) }
    if (e.key === 'Escape') { e.stopPropagation(); onSelect(null) }
  }

  const stroke: Stroke | null = drag?.kind === 'draw' ? { from: { x: drag.sx, y: drag.sy }, to: { x: drag.cx, y: drag.cy } } : null
  const drawRect: Rect | null = drag?.kind === 'draw'
    ? { x: Math.min(drag.sx, drag.cx), y: Math.min(drag.sy, drag.cy), w: Math.abs(drag.cx - drag.sx), h: Math.abs(drag.cy - drag.sy) }
    : null
  const preview = stroke && renderStroke ? renderStroke(stroke) : null

  return (
    <div className="select-none">
      <div
        ref={ref}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={clsx('relative w-full overflow-hidden rounded-lg border border-border bg-background outline-none focus:border-accent', !readOnly && 'cursor-crosshair')}
        style={{ aspectRatio: aspect > 0 ? String(aspect) : undefined, touchAction: 'none' }}
      >
        {src ? (
          <img src={src} alt="" draggable={false} className="block h-full w-full" style={{ objectFit: 'fill' }} />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-4 text-center text-xs text-muted">{placeholder ?? '無圖片'}</div>
        )}
        {boxes.map((b) => {
          const color = colorOf(b)
          const selected = b.id === selectedId
          const frame = frameOf?.(b) ?? null
          const point = !frame && (isPoint?.(b) ?? false)
          const style: CSSProperties = frame
            ? { ...frame, boxShadow: selected ? `0 0 0 2px var(--canvas), 0 0 0 4px ${color}` : undefined, borderRadius: 9999 }
            : {
              left: pct(b.x), top: pct(b.y),
              ...(point
                ? { width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: 9999, background: color }
                : { width: pct(b.w), height: pct(b.h), minWidth: 18, minHeight: 18, background: `color-mix(in oklab, ${color} ${selected ? 22 : 12}%, transparent)` }),
              borderColor: point ? 'var(--canvas)' : color,
              boxShadow: selected ? `0 0 0 2px var(--canvas), 0 0 0 4px ${color}` : undefined,
            }
          return (
            <div
              key={b.id}
              onPointerDown={(e) => onBoxDown(e, b)}
              className={clsx('group absolute', frame ? '' : point ? 'rounded-full border-2' : 'rounded-sm border-2', !readOnly && 'cursor-move')}
              style={style}
            >
              {frame && renderBox?.(b, selected)}
              {badgeOf && (
                <span
                  className={clsx('absolute flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none text-on-accent',
                    point ? 'inset-0 m-auto' : '-left-2.5 -top-2.5')}
                  style={{ background: color }}
                >
                  {badgeOf(b)}
                </span>
              )}
              {showDelete && !readOnly && (
                <button
                  type="button"
                  title="刪除"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onDelete?.(b.id) }}
                  className={clsx('absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-canvas text-muted shadow-control hover:text-danger', selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )
        })}
        {preview}
        {!preview && drawRect && drawRect.w > 0 && drawRect.h > 0 && (
          <div className="pointer-events-none absolute rounded-sm border-2 border-dashed" style={{ left: pct(drawRect.x), top: pct(drawRect.y), width: pct(drawRect.w), height: pct(drawRect.h), borderColor: drawColor, background: `color-mix(in oklab, ${drawColor} 10%, transparent)` }} />
        )}
      </div>
    </div>
  )
}
