/**
 * A focused canvas-style mask editor.
 *
 * The interaction model follows SOP_Tutor's BoxEditor/LayoutEditor:
 * - the stage owns pointer capture and keyboard focus;
 * - masks use normalized image coordinates;
 * - blank clicks only deselect; creating a mask is always an explicit action;
 * - the selected mask moves from its body and resizes from its four corners.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { Hand, Maximize2, Minus, MousePointer2, Plus, Trash2, X } from 'lucide-react'
import { Button, cx } from '@maydru/ui'
import { MIN_MASK_HEIGHT, MIN_MASK_WIDTH, type MaskRect } from './mask'

interface Props {
  source: HTMLCanvasElement
  masks: MaskRect[]
  onChange: (masks: MaskRect[]) => void
  disabled?: boolean
}

type Tool = 'select' | 'pan'
type Corner = 'nw' | 'ne' | 'sw' | 'se'
type Interaction =
  | { kind: 'pan'; pointerId: number; x: number; y: number; panX: number; panY: number }
  | { kind: 'move'; pointerId: number; index: number; x: number; y: number; original: MaskRect }
  | { kind: 'resize'; pointerId: number; index: number; corner: Corner; original: MaskRect }

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 0.1
const DEFAULT_MASK: Pick<MaskRect, 'x' | 'y' | 'w' | 'h'> = { x: 0.35, y: 0.45, w: 0.3, h: 0.1 }
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export function MaskCanvas({ source, masks, onChange, disabled = false }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const interaction = useRef<Interaction | null>(null)
  const pendingMasks = useRef<MaskRect[] | null>(null)
  const changeFrame = useRef<number | null>(null)
  const selectedIndex = selected !== null && selected < masks.length ? selected : null

  useEffect(() => () => {
    if (changeFrame.current !== null) cancelAnimationFrame(changeFrame.current)
  }, [])

  /** 拖曳最多每個 animation frame 更新一次，避免高解析圖片上每個 pointer event 都重繪 React。 */
  const scheduleChange = (next: MaskRect[]) => {
    pendingMasks.current = next
    if (changeFrame.current !== null) return
    changeFrame.current = requestAnimationFrame(() => {
      changeFrame.current = null
      const value = pendingMasks.current
      pendingMasks.current = null
      if (value) onChange(value)
    })
  }

  const flushChange = () => {
    if (changeFrame.current !== null) cancelAnimationFrame(changeFrame.current)
    changeFrame.current = null
    const value = pendingMasks.current
    pendingMasks.current = null
    if (value) onChange(value)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = source.width
    canvas.height = source.height
    canvas.getContext('2d')?.drawImage(source, 0, 0)
  }, [source])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const fit = () => {
      const bounds = stage.getBoundingClientRect()
      const availableWidth = Math.max(1, bounds.width - 48)
      const availableHeight = Math.max(1, bounds.height - 48)
      const scale = Math.min(availableWidth / source.width, availableHeight / source.height, 1)
      setFitSize({ width: Math.max(1, source.width * scale), height: Math.max(1, source.height * scale) })
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [source])

  const pointOnImage = (clientX: number, clientY: number) => {
    const bounds = surfaceRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width === 0 || bounds.height === 0) return { x: 0, y: 0 }
    return {
      x: clamp((clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((clientY - bounds.top) / bounds.height, 0, 1),
    }
  }

  const addMask = () => {
    if (disabled) return
    const next = [...masks, { ...DEFAULT_MASK, source: 'MANUAL' as const }]
    onChange(next)
    setSelected(next.length - 1)
    setTool('select')
    stageRef.current?.focus()
  }

  const removeMask = (index: number) => {
    if (disabled) return
    onChange(masks.filter((_, maskIndex) => maskIndex !== index))
    setSelected(null)
  }

  const setZoomAround = (nextZoom: number, anchor?: { clientX: number; clientY: number }) => {
    const stage = stageRef.current
    const next = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    if (!stage || next === zoom) return
    const bounds = stage.getBoundingClientRect()
    const anchorX = anchor ? anchor.clientX - (bounds.left + bounds.width / 2) : 0
    const anchorY = anchor ? anchor.clientY - (bounds.top + bounds.height / 2) : 0
    const ratio = next / zoom
    setPan((current) => ({
      x: anchorX - (anchorX - current.x) * ratio,
      y: anchorY - (anchorY - current.y) * ratio,
    }))
    setZoom(next)
  }

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    stageRef.current?.setPointerCapture?.(event.pointerId)
    interaction.current = {
      kind: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y,
    }
  }

  const onStageDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    stageRef.current?.focus()
    if (tool === 'pan' || event.button === 1) {
      beginPan(event)
      return
    }
    if (event.button === 0) setSelected(null)
  }

  const onMaskDown = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    event.stopPropagation()
    if (disabled || event.button !== 0) return
    stageRef.current?.focus()
    if (tool === 'pan') {
      beginPan(event)
      return
    }
    event.preventDefault()
    stageRef.current?.setPointerCapture?.(event.pointerId)
    const point = pointOnImage(event.clientX, event.clientY)
    setSelected(index)
    interaction.current = {
      kind: 'move', pointerId: event.pointerId, index, x: point.x, y: point.y, original: masks[index],
    }
  }

  const onHandleDown = (event: ReactPointerEvent<HTMLButtonElement>, index: number, corner: Corner) => {
    event.stopPropagation()
    if (disabled || event.button !== 0) return
    event.preventDefault()
    stageRef.current?.focus()
    stageRef.current?.setPointerCapture?.(event.pointerId)
    interaction.current = { kind: 'resize', pointerId: event.pointerId, index, corner, original: masks[index] }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interaction.current
    if (!active) return
    event.preventDefault()
    if (active.kind === 'pan') {
      setPan({ x: active.panX + event.clientX - active.x, y: active.panY + event.clientY - active.y })
      return
    }
    const point = pointOnImage(event.clientX, event.clientY)
    if (active.kind === 'move') {
      const x = clamp(active.original.x + point.x - active.x, 0, 1 - active.original.w)
      const y = clamp(active.original.y + point.y - active.y, 0, 1 - active.original.h)
      scheduleChange(masks.map((mask, index) => (index === active.index ? { ...mask, x, y } : mask)))
      return
    }
    let left = active.original.x
    let top = active.original.y
    let right = active.original.x + active.original.w
    let bottom = active.original.y + active.original.h
    if (active.corner.includes('n')) top = clamp(point.y, 0, bottom - MIN_MASK_HEIGHT)
    if (active.corner.includes('s')) bottom = clamp(point.y, top + MIN_MASK_HEIGHT, 1)
    if (active.corner.includes('w')) left = clamp(point.x, 0, right - MIN_MASK_WIDTH)
    if (active.corner.includes('e')) right = clamp(point.x, left + MIN_MASK_WIDTH, 1)
    scheduleChange(masks.map((mask, index) => (
      index === active.index ? { ...mask, x: left, y: top, w: right - left, h: bottom - top } : mask
    )))
  }

  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interaction.current) return
    flushChange()
    try {
      stageRef.current?.releasePointerCapture?.(event.pointerId)
    } catch {
      // The browser may already have released capture.
    }
    interaction.current = null
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    setZoomAround(zoom * Math.exp(-event.deltaY * 0.0015), { clientX: event.clientX, clientY: event.clientY })
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIndex !== null) {
      event.preventDefault()
      removeMask(selectedIndex)
    } else if (event.key === 'Escape') {
      setSelected(null)
      interaction.current = null
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      setZoomAround(zoom + ZOOM_STEP)
    } else if (event.key === '-') {
      event.preventDefault()
      setZoomAround(zoom - ZOOM_STEP)
    }
  }

  const width = fitSize ? fitSize.width * zoom : 1
  const height = fitSize ? fitSize.height * zoom : 1

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background-lite">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-canvas px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={addMask} disabled={disabled} icon={<Plus size={14} />}>
            新增遮罩
          </Button>
          <Button
            size="sm" variant={tool === 'select' ? 'secondary' : 'ghost'} aria-pressed={tool === 'select'}
            onClick={() => setTool('select')} icon={<MousePointer2 size={14} />}
          >
            選取
          </Button>
          <Button
            size="sm" variant={tool === 'pan' ? 'secondary' : 'ghost'} aria-pressed={tool === 'pan'}
            onClick={() => setTool('pan')} icon={<Hand size={14} />}
          >
            移動畫布
          </Button>
          {selectedIndex !== null && (
            <Button size="sm" variant="ghost" onClick={() => removeMask(selectedIndex)} icon={<Trash2 size={14} />}>
              刪除選取
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1" aria-label="圖片縮放工具">
          <Button size="sm" variant="ghost" aria-label="縮小圖片" onClick={() => setZoomAround(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} icon={<Minus size={14} />} />
          <input
            type="range" min={MIN_ZOOM * 100} max={MAX_ZOOM * 100} step={5} value={Math.round(zoom * 100)}
            onChange={(event) => setZoomAround(Number(event.target.value) / 100)} aria-label="圖片縮放"
            className="h-8 w-24 cursor-pointer accent-current sm:w-32"
          />
          <span className="w-12 text-center text-[12px] tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="ghost" aria-label="放大圖片" onClick={() => setZoomAround(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} icon={<Plus size={14} />} />
          <Button size="sm" variant="ghost" aria-label="讓圖片符合編輯區" onClick={resetView} icon={<Maximize2 size={14} />} />
        </div>
      </div>

      <div
        ref={stageRef}
        data-testid="mask-stage"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onStageDown}
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onWheel={onWheel}
        className={cx(
          'relative min-h-0 flex-1 touch-none overflow-hidden bg-[#e9edf3] outline-none select-none focus:ring-2 focus:ring-inset focus:ring-accent',
          tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        )}
      >
        <div
          ref={surfaceRef}
          data-testid="mask-surface"
          className="absolute left-1/2 top-1/2 bg-canvas shadow-xl"
          style={{
            width: `${width}px`, height: `${height}px`,
            transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
            visibility: fitSize ? 'visible' : 'hidden',
            willChange: 'transform',
            contain: 'layout paint',
          }}
        >
          <canvas ref={canvasRef} data-testid="mask-canvas" className="pointer-events-none block h-full w-full" />
          {masks.map((mask, index) => {
            const active = selectedIndex === index
            return (
              <div
                key={`${mask.source}-${index}`}
                data-testid="mask-rect"
                onPointerDown={(event) => onMaskDown(event, index)}
                className={cx(
                  'group absolute border-2 bg-[#0f172a]/82',
                  active ? 'z-10 cursor-move border-accent shadow-[0_0_0_2px_white]' : 'cursor-move border-white/80 hover:border-accent',
                  tool === 'pan' && 'pointer-events-none',
                )}
                style={{ left: `${mask.x * 100}%`, top: `${mask.y * 100}%`, width: `${mask.w * 100}%`, height: `${mask.h * 100}%` }}
              >
                {active && tool === 'select' && (
                  <>
                    <span className="pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-on-accent shadow-sm">
                      遮罩 {index + 1}
                    </span>
                    <button
                      type="button" aria-label={`刪除遮罩 ${index + 1}`} title="刪除遮罩"
                      onPointerDown={(event) => event.stopPropagation()} onClick={() => removeMask(index)}
                      className="absolute -right-3 -top-3 z-20 flex size-6 items-center justify-center rounded-full border-2 border-white bg-danger text-white shadow-md"
                    >
                      <X size={12} />
                    </button>
                    {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                      <button
                        key={corner} type="button" aria-label={`調整遮罩${corner.toUpperCase()}角`}
                        onPointerDown={(event) => onHandleDown(event, index, corner)}
                        className={cx(
                          'absolute z-20 size-5 rounded-sm border-2 border-white bg-accent shadow-md hover:scale-110',
                          corner.includes('n') ? '-top-2.5' : '-bottom-2.5',
                          corner.includes('w') ? '-left-2.5' : '-right-2.5',
                          corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
                        )}
                      />
                    ))}
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-primary/75 px-3 py-1.5 text-[11px] text-white backdrop-blur">
          滾輪縮放 · 遮罩本體可移動 · 拉四角調整大小
        </div>
      </div>
    </section>
  )
}
