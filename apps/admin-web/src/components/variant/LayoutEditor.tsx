/**
 * Step Card layout editor (SPEC §9.1). The card is the worker's own page,
 * loaded once into an iframe; moving a block only rewrites the CSS custom
 * properties the page reads, so what is on screen is what the renderer prints.
 *
 * A layout is two things. The *template* is the tenant's for this channel —
 * the frame, the text group and its alignment rules, the sizes — and every
 * step renders with it. A step may add a *patch*: only the keys the clerk
 * changed here (a shorter window, a nudge), so a later template edit still
 * reaches everything the step left alone. The sidebar edits one or the other
 * (「版型」/「這一步」); the stage always shows them merged.
 *
 * Two blocks: the replica frame, a window on the replica that is cropped
 * like a photo — pull its top or bottom edge in, zoom about its centre, pan
 * with Space — with the rest dimmed if wanted; and the text group — title
 * then list — which lays itself out by rule: one left edge, or centred with
 * the list as wide as its widest row; at its own y, or on the frame's top,
 * middle or bottom. A strip of the other steps shows the template on them,
 * live, so「套用到每一步」is something you can see before saving.
 */
import { clsx } from 'clsx'
import { X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ApiError, post, put } from '../../lib/api'
import { useCanvas } from '../../lib/hooks'
import type { Annotation, CardPreview, LayoutBlock, LayoutPatch, StepCardLayout, Variant } from '../../lib/types'
import { Button, Select, confirm, errMsg, useToast, type ConfirmAnswer } from '../ui'
import { useCanvasActions } from '../../canvas/actions'
import { TextLink } from './parts'
import { GESTURE_T, isHold } from './GestureGlyph'

type Scope = 'template' | 'step'
type Block = 'frame' | 'text'
type Mode = 'move' | 'width' | 'top' | 'bottom' | 'pan'
const BLOCKS: Block[] = ['frame', 'text']
const BLOCK_LABEL: Record<Block, string> = { frame: '介面圖', text: '文字' }
const BLOCK_SELECTOR: Record<Block, string> = { frame: '.frame', text: '.text' }
const NUDGE = 1
const NUDGE_FAST = 10
const GRID = 8       // the grid `default_layout` lands on in backend/app/services/stepcard.py
const GUIDE_PX = 6   // screen px within which an edge sticks to a guide
const ZOOM_MAX = 3
const CROP_PAD = 24      // replica px 裁到標註範圍 leaves above and below the annotations
const CROP_WHOLE = 0.7   // annotations spanning this much of the screen: show all of it
const SIBLINGS = 3       // other steps shown in the strip
/** Drawn size of an annotation placed as a single point; mirrors POINT_SIZE in stepcard.py. */
const POINT_SIZE: Record<string, [number, number]> = { tap: [48, 48], input: [200, 40] }

/** Where a block's edge sits: at its own coordinate, or by rule on the canvas (mirrors `_placed`).
 *  Centred means centred on the canvas — the margin is a guide, so it never pushes the block off
 *  centre; only the canvas's own top edge clamps, so an oversized block runs off the bottom. */
const placed = (rule: string, free: string, size: string, extent: string) => ({
  start: 'var(--canvas-margin)',
  center: `max(0px, (${extent} - ${size}) / 2)`,
  end: `max(0px, ${extent} - var(--canvas-margin) - ${size})`,
}[rule] ?? free)

/** The same names `layout_vars` writes in backend/app/services/stepcard.py. */
function layoutVars(l: StepCardLayout, replicaW: number, replicaH: number): Record<string, string> {
  const k = l.frame.w / Math.max(replicaW, 1)
  const centred = l.text.align === 'center'
  return {
    '--canvas-w': `${l.canvas.w}px`, '--canvas-h': `${l.canvas.h}px`, '--canvas-margin': `${l.canvas.margin}px`,
    '--frame-x': placed(FRAME_X_RULE[l.frame.align], `${l.frame.x}px`, 'var(--frame-w)', 'var(--canvas-w)'),
    '--frame-y': placed(FRAME_Y_RULE[l.frame.valign], `${l.frame.y}px`, 'var(--frame-h)', 'var(--canvas-h)'),
    '--frame-k': k.toFixed(4), '--frame-w': `${l.frame.w}px`,
    '--frame-h': `${frameH(l, replicaW, replicaH)}px`, '--frame-zoom': l.frame.zoom.toFixed(4),
    '--frame-ox': `${l.frame.ox}px`, '--frame-oy': `${l.frame.oy}px`,
    '--mask-display': l.mask.enabled ? 'block' : 'none', '--mask-opacity': l.mask.opacity.toFixed(3),
    '--mask-pad': `${l.mask.pad}px`, '--mask-radius': `${l.mask.radius}px`, '--mask-blur': `${l.mask.blur}px`,
    // with the mask on, the hole is the highlight: the capture fill and the rings' glow step back
    '--soft-opacity': l.mask.enabled ? '0' : '1', '--ring-glow': l.mask.enabled ? '0px' : '6px',
    '--text-x': `${l.text.x}px`, '--text-y': `${l.text.y}px`, '--text-w': `${l.text.w}px`, '--text-gap': `${l.text.gap}px`,
    '--text-align': centred ? 'center' : 'left', '--text-items': centred ? 'center' : 'flex-start',
    // vertical: the group's own y, or its top / middle / bottom on the frame's
    '--text-top': { top: 'var(--frame-y)', middle: 'calc(var(--frame-y) + var(--frame-h) / 2)', bottom: 'calc(var(--frame-y) + var(--frame-h))', free: 'var(--text-y)' }[l.text.valign],
    '--text-shift': { top: 'none', middle: 'translateY(-50%)', bottom: 'translateY(-100%)', free: 'none' }[l.text.valign],
    '--title-size': `${l.title.size}px`, '--number-display': l.title.number ? 'block' : 'none', '--number-gap': `${l.title.gap}px`,
    '--list-size': `${l.list.size}px`, '--list-icon': `${l.list.icon}px`, '--list-gap': `${l.list.gap}px`,
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const clone = <T,>(l: T): T => JSON.parse(JSON.stringify(l))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const snap = (v: number, on: boolean) => (on ? Math.round(v / GRID) * GRID : Math.round(v))

/** The template with the patch's keys laid over it (mirrors `merge_layout` in card_context.py). */
function merge(template: StepCardLayout, patch: LayoutPatch): StepCardLayout {
  const out = clone(template)
  for (const b of Object.keys(patch) as (keyof LayoutPatch)[]) {
    if (b === 'v') continue
    Object.assign(out[b], patch[b])
  }
  return out
}
const isEmptyPatch = (p: LayoutPatch) => !(Object.keys(p) as (keyof LayoutPatch)[]).some((b) => b !== 'v' && p[b] && Object.keys(p[b]!).length)
const withoutBlock = (p: LayoutPatch, b: LayoutBlock): LayoutPatch => { const { [b]: _drop, ...rest } = p; return rest }

/** The placement rules, as the renderer names them. */
const FRAME_X_RULE: Record<StepCardLayout['frame']['align'], string> = { free: '', left: 'start', center: 'center', right: 'end' }
const FRAME_Y_RULE: Record<StepCardLayout['frame']['valign'], string> = { free: '', top: 'start', middle: 'center', bottom: 'end' }
const ALIGNED = (rule: string) => rule !== 'free'

const scale = (l: StepCardLayout, replicaW: number) => l.frame.w / Math.max(replicaW, 1)
const frameH = (l: StepCardLayout, replicaW: number, replicaH: number) => l.frame.h || Math.round(replicaH * scale(l, replicaW))
/** Where the window actually sits: its own x / y, or the rule's place on the canvas. */
const frameLeft = (l: StepCardLayout) => {
  const m = l.canvas.margin
  return l.frame.align === 'left' ? m
    : l.frame.align === 'center' ? Math.max(0, Math.round((l.canvas.w - l.frame.w) / 2))
      : l.frame.align === 'right' ? Math.max(0, l.canvas.w - m - l.frame.w) : l.frame.x
}
const frameTop = (l: StepCardLayout, replicaW: number, replicaH: number) => {
  const m = l.canvas.margin
  const h = frameH(l, replicaW, replicaH)
  return l.frame.valign === 'top' ? m
    : l.frame.valign === 'middle' ? Math.max(0, Math.round((l.canvas.h - h) / 2))
      : l.frame.valign === 'bottom' ? Math.max(0, l.canvas.h - m - h) : l.frame.y
}

/** True while the frame still shows the whole replica, so a width change keeps it that way. */
const showsAll = (l: StepCardLayout, replicaW: number, replicaH: number) =>
  frameH(l, replicaW, replicaH) >= Math.round(replicaH * scale(l, replicaW) * l.frame.zoom) - 1

/** Keep the replica covering the frame: no empty background inside the window. A frame
 *  height of 0 stays 0 — "the replica's own height" — so a template carries over to
 *  replicas of another height. */
function fixFrame(l: StepCardLayout, replicaW: number, replicaH: number): StepCardLayout {
  const k = scale(l, replicaW)
  const zoom = clamp(l.frame.zoom || 1, 1, ZOOM_MAX)
  const full = Math.round(replicaH * k * zoom)
  const h = l.frame.h ? clamp(l.frame.h, GRID * 5, full) : 0
  const loX = Math.min(0, (replicaW * (1 - zoom)) / zoom)
  const loY = Math.min(0, (h || full) / (k * zoom) - replicaH)
  return { ...l, frame: { ...l.frame, zoom, h, ox: Math.round(clamp(l.frame.ox, loX, 0)), oy: Math.round(clamp(l.frame.oy, loY, 0)) } }
}

/** The swipe glyph's box on the replica (mirrors `_gesture_box` in stepcard.py). */
function gestureBox(a: Annotation, fw: number, fh: number): [number, number, number, number] {
  const T = GESTURE_T
  const [px, py, pw, ph] = [a.x * fw, a.y * fh, a.w * fw, a.h * fh]
  if (isHold(a)) { const d = T * 2.8; return [px + pw / 2 - d / 2, py + ph / 2 - d / 2, d, d] }
  const vertical = a.direction === 'up' || a.direction === 'down' ? true : a.direction === 'left' || a.direction === 'right' ? false : ph >= pw
  if (vertical) return [px + pw / 2 - T / 2, py - T / 2, T, (ph || 64) + T]
  return [px - T / 2, py + ph / 2 - T / 2, (pw || 64) + T, T]
}

/** Where an annotation lands on the replica, in replica px; null when nothing is drawn. */
function pxBox(a: Annotation, fw: number, fh: number): [number, number, number, number] | null {
  if (!['tap', 'input', 'gesture', 'capture'].includes(a.type)) return null
  if (a.type === 'gesture') return gestureBox(a, fw, fh)
  let [px, py, pw, ph] = [a.x * fw, a.y * fh, a.w * fw, a.h * fh]
  if (a.type === 'capture') {
    if (!pw || !ph) return null
  } else if (a.w === 0 && a.h === 0) {
    ;[pw, ph] = POINT_SIZE[a.type]
    ;[px, py] = [px - pw / 2, py - ph / 2]
  } else {
    ;[pw, ph] = [pw || POINT_SIZE[a.type][0], ph || POINT_SIZE[a.type][1]]
  }
  return [px, py, pw, ph]
}

/** The union of everything the step points at, in replica px, padded like the mask. */
function focusUnion(annotations: Annotation[], fw: number, fh: number, pad: number) {
  const boxes = annotations.map((a) => pxBox(a, fw, fh)).filter(Boolean) as [number, number, number, number][]
  if (!boxes.length) return null
  const x0 = Math.min(...boxes.map((b) => b[0])) - pad
  const y0 = Math.min(...boxes.map((b) => b[1])) - pad
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2])) + pad
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3])) + pad
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

interface Sibling { id: string; title: string; preview: CardPreview }

interface Props {
  variant: Variant
  /** Current (possibly unsaved) annotations, so the preview matches the sheet. */
  annotations: Annotation[]
  isAdmin: boolean
  onClose: () => void
  /** A layout was stored: the card wants rendering again. */
  onSaved: () => Promise<unknown>
}

export function LayoutEditor({ variant, annotations, isAdmin, onClose, onSaved }: Props) {
  const toast = useToast()
  const [preview, setPreview] = useState<CardPreview | null>(null)
  const [error, setError] = useState('')
  const [template, setTemplate] = useState<StepCardLayout | null>(null)
  const [patch, setPatch] = useState<LayoutPatch>({})
  const [scope, setScope] = useState<Scope>(isAdmin ? 'template' : 'step')
  const [selected, setSelected] = useState<Block>('frame')
  const [heights, setHeights] = useState<Record<Block, number>>({ frame: 0, text: 0 })
  const [fit, setFit] = useState(1)
  const [busy, setBusy] = useState(false)
  const [grid, setGrid] = useState(true)
  const [panning, setPanning] = useState(false)  // 移動介面內容, or Space held down
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [siblings, setSiblings] = useState<Sibling[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const drag = useRef<{ block: Block; mode: Mode; x: number; y: number; start: StepCardLayout } | null>(null)
  const { replica_width: rw, replica_height: rh } = variant
  const { data: canvas } = useCanvas()
  const actions = useCanvasActions()
  const flowId = canvas?.steps.find((s) => s.id === variant.step_id)?.flow_id

  // What the stage shows: the template with this step's patch over it.
  const layout = useMemo(() => (template ? fixFrame(merge(template, patch), rw, rh) : null), [template, patch, rw, rh])
  const templateDirty = !!preview && !!template && !same(template, preview.template)
  const patchDirty = !!preview && !same(patch, preview.patch)
  const dirty = templateDirty || patchDirty
  const patched = (b: LayoutBlock) => !!patch[b] && Object.keys(patch[b]!).length > 0

  useEffect(() => {
    let alive = true
    post<CardPreview>(`/api/variants/${variant.id}/card-preview`, { annotations })
      .then((p) => { if (alive) { setPreview(p); setTemplate(clone(p.template)); setPatch(clone(p.patch)) } })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : errMsg(e)))
    return () => { alive = false }
    // the preview is taken once, when the editor opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant.id])

  // The other steps of this flow (same theme, with a replica): the template is judged on all of them.
  const siblingIds = useMemo(() => {
    if (!canvas) return []
    const step = canvas.steps.find((s) => s.id === variant.step_id)
    if (!step) return []
    return canvas.steps
      .filter((s) => s.flow_id === step.flow_id && s.id !== step.id)
      .sort((a, b) => a.canvas_x - b.canvas_x || a.canvas_y - b.canvas_y)
      .flatMap((s) => {
        const v = s.variants.find((x) => x.theme === variant.theme && ['annotating', 'rendering', 'completed'].includes(x.status))
        return v ? [{ id: v.id, title: s.title }] : []
      })
      .slice(0, SIBLINGS)
  }, [canvas, variant.step_id, variant.theme])
  useEffect(() => {
    let alive = true
    Promise.all(siblingIds.map((s) => post<CardPreview>(`/api/variants/${s.id}/card-preview`, {}).then((preview) => ({ ...s, preview })).catch(() => null)))
      .then((list) => alive && setSiblings(list.filter(Boolean) as Sibling[]))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblingIds.map((s) => s.id).join()])

  // Fit the card into the stage.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el || !layout) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setFit(Math.min((r.width - 48) / layout.canvas.w, (r.height - 48) / layout.canvas.h, 1))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [layout?.canvas.w, layout?.canvas.h, !!layout]) // eslint-disable-line react-hooks/exhaustive-deps

  const measure = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    const h = (b: Block) => doc.querySelector(BLOCK_SELECTOR[b])?.getBoundingClientRect().height ?? 0
    setHeights({ frame: h('frame'), text: h('text') })
  }, [])

  // Push the layout into the page and re-measure the blocks.
  const apply = useCallback((l: StepCardLayout) => {
    const doc = iframeRef.current?.contentDocument
    if (!doc?.documentElement) return
    const st = doc.documentElement.style
    for (const [k, v] of Object.entries(layoutVars(l, rw, rh))) st.setProperty(k, v)
    measure()
  }, [measure, rw, rh])

  useLayoutEffect(() => { if (layout) apply(layout) }, [layout, apply])

  const onFrameLoad = () => {
    if (layout) apply(layout)
    const doc = iframeRef.current?.contentDocument
    doc?.fonts?.ready.then(measure).catch(() => {})
  }

  /**
   * Change a block. In the template scope the template itself changes; in the
   * step scope only the touched keys (and anything the frame rule had to clamp
   * with them) go into the patch, so the rest keeps following the template.
   */
  const patchBlock = <B extends LayoutBlock>(b: B, p: Partial<StepCardLayout[B]>) => {
    if (!template) return
    if (scope === 'template') {
      setTemplate((t) => (t ? fixFrame({ ...t, [b]: { ...t[b], ...p } }, rw, rh) : t))
      return
    }
    setPatch((cur) => {
      const before = fixFrame(merge(template, cur), rw, rh)
      const next: LayoutPatch = { ...cur, [b]: { ...(cur[b] ?? {}), ...p } }
      const after = fixFrame(merge(template, next), rw, rh)
      const changed: Record<string, unknown> = {}
      for (const k of Object.keys(after[b]) as (keyof StepCardLayout[B])[]) {
        if (k in p || after[b][k] !== before[b][k]) changed[k as string] = after[b][k]
      }
      return { ...cur, v: 2, [b]: { ...(cur[b] ?? {}), ...changed } }
    })
  }
  const follow = (b: LayoutBlock) => setPatch((cur) => withoutBlock(cur, b))
  /** A width change keeps the frame showing what it showed before. */
  const setFrameWidth = (w: number) => {
    if (!layout) return
    patchBlock('frame', showsAll(layout, rw, rh) ? { w, h: 0 } : { w })
  }

  // ---- smart guides: every edge, centre line, canvas centre and safe margin worth sticking to
  /** Where a block's box starts on the canvas: the window at its own y or on its rule; the text
   *  group at its own y or on the window's top / middle / bottom — which moves with the window. */
  const visualLeft = (l: StepCardLayout, b: Block) => (b === 'frame' ? frameLeft(l) : l.text.x)
  const visualTop = (l: StepCardLayout, b: Block) => {
    const ft = frameTop(l, rw, rh)
    if (b === 'frame') return ft
    if (l.text.valign === 'free') return l.text.y
    const fh = frameH(l, rw, rh)
    const th = heights.text || 0
    return l.text.valign === 'top' ? ft : l.text.valign === 'middle' ? ft + fh / 2 - th / 2 : ft + fh - th
  }
  const targets = (l: StepCardLayout, exclude: Block) => {
    const m = l.canvas.margin
    const xs = [m, l.canvas.w / 2, l.canvas.w - m]
    const ys = [m, l.canvas.h / 2, l.canvas.h - m]
    for (const b of BLOCKS) {
      if (b === exclude) continue
      const h = heights[b] || 0
      const left = visualLeft(l, b)
      const top = visualTop(l, b)
      xs.push(left, left + l[b].w / 2, left + l[b].w)
      ys.push(top, top + h / 2, top + h)
    }
    return { xs, ys }
  }
  const stick = (edges: number[], lines: number[], tol: number) => {
    let best: { d: number; line: number } | null = null
    for (const e of edges) for (const line of lines) {
      const d = line - e
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line }
    }
    return best
  }

  // ---- drag / resize (pointer deltas are in screen px; the stage is scaled by `fit`)
  const onPointerDown = (b: Block, mode: Mode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!layout || e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { block: b, mode: mode === 'move' && b === 'frame' && panning ? 'pan' : mode, x: e.clientX, y: e.clientY, start: clone(layout) }
    setSelected(b)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !layout) return
    const on = grid && !e.altKey   // Alt: off the grid for as long as it is held
    const tol = GUIDE_PX / fit
    const dx = (e.clientX - d.x) / fit
    const dy = (e.clientY - d.y) / fit
    const s = d.start[d.block]

    if (d.mode === 'pan') {
      const z = scale(layout, rw) * layout.frame.zoom
      patchBlock('frame', { ox: Math.round(d.start.frame.ox + dx / z), oy: Math.round(d.start.frame.oy + dy / z) })
      return
    }
    const { xs, ys } = targets(layout, d.block)
    if (d.mode === 'move') {
      // a block may sit on a rule (the window on the canvas, the text group on the window's
      // edge) rather than at its own coordinates: drag from where it is drawn, and dragging it
      // off an axis puts that axis back on its own coordinate
      const left0 = visualLeft(d.start, d.block)
      const top0 = visualTop(d.start, d.block)
      let x = snap(left0 + dx, on)
      let top = snap(top0 + dy, on)
      const h = heights[d.block] || 0
      const gx = stick([x, x + s.w / 2, x + s.w], xs, tol)
      const gy = stick([top, top + h / 2, top + h], ys, tol)
      if (gx) x += gx.d
      if (gy) top += gy.d
      setGuides({ x: gx ? [gx.line] : [], y: gy ? [gy.line] : [] })
      const moved = { x: x !== left0, y: top !== top0 }
      if (d.block === 'frame') {
        patchBlock('frame', {
          ...(moved.x ? { x: Math.round(x), ...(ALIGNED(d.start.frame.align) ? { align: 'free' as const } : {}) } : {}),
          ...(moved.y ? { y: Math.round(top), ...(ALIGNED(d.start.frame.valign) ? { valign: 'free' as const } : {}) } : {}),
        })
      } else if (moved.y) {
        patchBlock('text', { x: Math.round(x), y: Math.round(top), valign: 'free' })  // moved: off the frame's edge
      } else {
        patchBlock('text', { x: Math.round(x) })
      }
      return
    }
    if (d.mode === 'width') {
      let right = snap(visualLeft(d.start, d.block) + s.w + dx, on)
      const g = stick([right], xs, tol)
      if (g) right = g.line
      setGuides({ x: g ? [g.line] : [], y: [] })
      const w = Math.max(40, Math.round(right - visualLeft(d.start, d.block)))
      if (d.block === 'frame') setFrameWidth(w)
      else patchBlock(d.block, { w })
      return
    }
    // the frame's top or bottom edge: crop the window, the replica behind it stays where it is
    // (a shorter window on a rule re-places itself, which is what the rule is for)
    const f0 = d.start.frame
    const h0 = frameH(d.start, rw, rh)
    const ft0 = frameTop(d.start, rw, rh)
    if (d.mode === 'bottom') {
      let bottom = snap(ft0 + h0 + dy, on)
      const g = stick([bottom], ys, tol)
      if (g) bottom = g.line
      setGuides({ x: [], y: g ? [g.line] : [] })
      patchBlock('frame', { h: Math.max(GRID * 5, Math.round(bottom - ft0)) })
      return
    }
    let top = snap(ft0 + dy, on)
    const g = stick([top], ys, tol)
    if (g) top = g.line
    top = Math.min(top, ft0 + h0 - GRID * 5)
    setGuides({ x: [], y: g ? [g.line] : [] })
    const cut = Math.round(top - ft0)
    const z = scale(d.start, rw) * f0.zoom
    patchBlock('frame', { y: f0.y + cut, h: h0 - cut, oy: Math.round(f0.oy - cut / z) })
  }
  const onPointerUp = () => { drag.current = null; setGuides({ x: [], y: [] }) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' && selected === 'frame') { e.preventDefault(); setPanning(true); return }
    if (!layout) return
    const on = grid && !e.altKey
    const step = on ? GRID * (e.shiftKey ? 4 : 1) : e.shiftKey ? NUDGE_FAST : NUDGE
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const v = d[e.key]
    if (!v) return
    e.preventDefault()
    const left = visualLeft(layout, selected)
    const top = visualTop(layout, selected)
    if (selected === 'text') {
      patchBlock('text', v[1]
        ? { x: snap(left + v[0], on), y: snap(top + v[1], on), valign: 'free' }
        : { x: snap(left + v[0], on) })
    } else {
      patchBlock('frame', {
        ...(v[0] ? { x: snap(left + v[0], on), ...(ALIGNED(layout.frame.align) ? { align: 'free' as const } : {}) } : {}),
        ...(v[1] ? { y: snap(top + v[1], on), ...(ALIGNED(layout.frame.valign) ? { valign: 'free' as const } : {}) } : {}),
      })
    }
  }
  const onKeyUp = (e: React.KeyboardEvent) => { if (e.key === ' ') setPanning(false) }

  /** Zoom about the window's centre, so what was in the middle stays in the middle. */
  const setZoom = (zoom: number) => {
    if (!layout) return
    const k = scale(layout, rw)
    const z0 = layout.frame.zoom
    const fh = frameH(layout, rw, rh)
    const cx = -layout.frame.ox + rw / (2 * z0)
    const cy = -layout.frame.oy + fh / (2 * k * z0)
    patchBlock('frame', { zoom, ox: Math.round(rw / (2 * zoom) - cx), oy: Math.round(fh / (2 * k * zoom) - cy) })
  }
  /** 裁到標註範圍: crop the window to the annotated region, a little air above and below. Nothing else changes. */
  const cropToAnnotations = () => {
    if (!layout) return
    const u = focusUnion(annotations, rw, rh, CROP_PAD)
    if (!u || u.h <= 0) { toast('這一步沒有畫在畫面上的標註', 'err'); return }
    const y0 = clamp(u.y0, 0, rh)
    const y1 = clamp(u.y1, 0, rh)
    if (y1 - y0 >= rh * CROP_WHOLE) { showAll(); return }
    const k = scale(layout, rw)
    patchBlock('frame', { h: Math.max(GRID * 5, snap((y1 - y0) * k, true)), zoom: 1, ox: 0, oy: -Math.round(y0) })
  }
  const showAll = () => patchBlock('frame', { h: 0, zoom: 1, ox: 0, oy: 0 })
  const cropped = !!layout && !showsAll(layout, rw, rh)

  // ---- saving: the template (all steps of this channel, admin) and this step's patch, whichever changed
  const close = async () => { if (!dirty || await confirm({ title: '放棄這次的版面調整？', body: '還沒儲存的變更會消失。', action: '放棄', danger: true })) onClose() }
  const save = async () => {
    if (!layout || !preview || !template) return
    let answer: ConfirmAnswer = true
    if (templateDirty) {
      answer = await confirm({
        title: '套用到所有步驟？',
        body: '版型會用在這個通道之後產生的每一張教學圖；每一步自己調整過的部分保留。已產生的教學圖不會自動重做，可以順便把這個流程的全部重新產生。',
        action: '儲存版型', secondary: flowId ? '儲存並重新產生整個流程' : undefined,
      })
      if (!answer) return
    }
    setBusy(true)
    try {
      if (templateDirty) await put('/api/tenant/stepcard-layout', { channel: preview.channel, layout: template })
      if (patchDirty) await put(`/api/variants/${variant.id}/stepcard-layout`, { patch: isEmptyPatch(patch) ? null : { ...patch, v: 2 } })
      await onSaved()
      if (answer === 'secondary' && flowId) {
        const r = await actions.renderFlowCards(flowId)
        toast(r ? `版型已儲存，${r.queued} 張教學圖重新產生中` : '版型已儲存')
      } else {
        toast(templateDirty ? '版型已套用到所有步驟' : '已儲存這一步的版面')
      }
      onClose()
    } catch (e) { toast(e instanceof ApiError ? e.message : errMsg(e), 'err') } finally { setBusy(false) }
  }

  const sel = layout?.[selected]
  const frameHeight = layout ? frameH(layout, rw, rh) : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="text-sm font-semibold">教學圖版面</div>
        <div className="flex items-center gap-3 text-xs text-muted">
          {layout && <span>{layout.canvas.w} × {layout.canvas.h}　{Math.round(fit * 100)}%</span>}
          <button type="button" onClick={() => void close()} className="rounded p-1 hover:bg-background-lite" aria-label="關閉"><X size={16} /></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={stageRef} tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onPointerDown={() => setSelected(selected)}
            className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-background outline-none">
            {error && <p className="text-sm text-danger">{error}</p>}
            {!error && !preview && <p className="text-sm text-muted">載入預覽中…</p>}
            {preview && layout && (
              <div style={{ width: layout.canvas.w * fit, height: layout.canvas.h * fit }}>
                <div className="relative origin-top-left" style={{ width: layout.canvas.w, height: layout.canvas.h, transform: `scale(${fit})`, boxShadow: 'var(--shadow-float)' }}>
                  <iframe ref={iframeRef} title="教學圖預覽" srcDoc={preview.html} onLoad={onFrameLoad}
                    className="block border-0" style={{ width: layout.canvas.w, height: layout.canvas.h, pointerEvents: 'none' }} />
                  <div className="pointer-events-none absolute" aria-hidden
                    style={{ inset: layout.canvas.margin, border: `${1 / fit}px dashed color-mix(in oklab, var(--accent) 22%, transparent)` }} />
                  <div className="absolute inset-0" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                    {BLOCKS.map((b) => {
                      const box = layout[b]
                      const h = heights[b] || (b === 'frame' ? frameHeight : 40)
                      const left = visualLeft(layout, b)
                      const on = selected === b
                      const line = 1.5 / fit
                      const pan = b === 'frame' && panning
                      return (
                        <div key={b} onPointerDown={onPointerDown(b, 'move')}
                          className={clsx('absolute select-none', pan ? 'cursor-grab' : 'cursor-move', on ? 'border-accent' : 'border-transparent hover:border-accent/40')}
                          style={{ left, top: visualTop(layout, b), width: box.w, height: h, borderStyle: 'solid', borderWidth: line, boxSizing: 'content-box', marginLeft: -line, marginTop: -line }}>
                          {on && (
                            <>
                              <span className="absolute left-0 whitespace-nowrap bg-accent px-[.5em] py-[.15em] text-on-accent" style={{ bottom: '100%', fontSize: 12 / fit, marginBottom: 2 / fit, marginLeft: -line }}>
                                {pan ? '移動介面內容' : BLOCK_LABEL[b]}{scope === 'step' && patched(b) ? '・已獨立調整' : ''}
                              </span>
                              <div onPointerDown={onPointerDown(b, 'width')} className="absolute cursor-ew-resize bg-accent"
                                style={{ right: -6 / fit, top: '50%', width: 12 / fit, height: 12 / fit, marginTop: -6 / fit, borderRadius: 2 / fit }} title="拖曳改寬度" />
                              {b === 'frame' && (
                                <>
                                  <div onPointerDown={onPointerDown(b, 'top')} className="absolute cursor-ns-resize bg-accent"
                                    style={{ top: -6 / fit, left: '50%', width: 12 / fit, height: 12 / fit, marginLeft: -6 / fit, borderRadius: 2 / fit }} title="往下拉：裁掉上面" />
                                  <div onPointerDown={onPointerDown(b, 'bottom')} className="absolute cursor-ns-resize bg-accent"
                                    style={{ bottom: -6 / fit, left: '50%', width: 12 / fit, height: 12 / fit, marginLeft: -6 / fit, borderRadius: 2 / fit }} title="往上拉：裁掉下面" />
                                </>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}
                    {guides.x.map((x) => <div key={`x${x}`} className="pointer-events-none absolute bg-accent" style={{ left: x, top: 0, width: 1 / fit, height: '100%' }} />)}
                    {guides.y.map((y) => <div key={`y${y}`} className="pointer-events-none absolute bg-accent" style={{ top: y, left: 0, height: 1 / fit, width: '100%' }} />)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {template && siblings.length > 0 && (
            <div className="flex shrink-0 items-end gap-4 border-t border-border bg-background px-6 py-3">
              <div className="w-16 pb-5 text-[11px] leading-4 text-muted">其他步驟<br />套用版型後</div>
              {siblings.map((s) => <SiblingCard key={s.id} sibling={s} template={template} />)}
            </div>
          )}
        </div>

        <aside className="flex w-72 shrink-0 flex-col gap-5 overflow-auto border-l border-border px-5 py-5">
          {isAdmin ? (
            <div className="grid grid-cols-2 rounded-lg bg-background-lite p-0.5 text-[13px]">
              {(['template', 'step'] as Scope[]).map((s) => (
                <button key={s} type="button" onClick={() => setScope(s)}
                  className={clsx('h-7 rounded-md transition-colors', scope === s ? 'bg-canvas text-primary' : 'text-muted hover:text-primary')}
                  style={scope === s ? { boxShadow: 'var(--shadow-card)' } : undefined}>
                  {s === 'template' ? '版型・所有步驟' : '這一步'}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[13px] font-medium">這一步的版面</div>
          )}
          <p className="-mt-2 text-[11px] leading-5 text-secondary">
            {scope === 'template' ? '版型套用到這個通道的每一步；各步自己調整過的地方保留。' : '只影響這一步；沒動到的部分繼續跟著版型。'}
          </p>

          <div className="-mx-2 space-y-0.5">
            {BLOCKS.map((b) => (
              <button key={b} type="button" onClick={() => setSelected(b)}
                className={clsx('flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors', selected === b ? 'bg-background-lite text-primary' : 'text-muted hover:bg-background-lite')}>
                <span>{BLOCK_LABEL[b]}</span>
                {scope === 'step' && patched(b) && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="這一步有獨立調整" />}
              </button>
            ))}
          </div>

          {layout && sel && (
            <div className="space-y-3">
              <Row>
                <Num label="X" value={Math.round(visualLeft(layout, selected))} disabled={selected === 'frame' && ALIGNED(layout.frame.align)}
                  onChange={(x) => patchBlock(selected, { x })} />
                <Num label="Y" value={Math.round(visualTop(layout, selected))}
                  disabled={selected === 'frame' ? ALIGNED(layout.frame.valign) : layout.text.valign !== 'free'}
                  onChange={(y) => patchBlock(selected, { y })} />
                <Num label="寬" value={sel.w} min={40} onChange={(w) => (selected === 'frame' ? setFrameWidth(w) : patchBlock(selected, { w }))} />
              </Row>
              {selected === 'frame' && (
                <>
                  <Row>
                    <Num label="高" value={frameHeight} min={GRID * 5} onChange={(h) => patchBlock('frame', { h })} />
                  </Row>
                  {/*截圖高度每一步都不一樣，所以介面圖也可以用規則擺放，而不是固定的 X／Y */}
                  <Row cols={2}>
                    <label className="block space-y-1">
                      <div className="text-xs font-medium text-muted">水平</div>
                      <Select value={layout.frame.align} onChange={(e) => patchBlock('frame', { align: e.target.value as StepCardLayout['frame']['align'] })} className="h-8 text-sm">
                        <option value="free">自訂 X</option><option value="left">靠左</option><option value="center">置中</option><option value="right">靠右</option>
                      </Select>
                    </label>
                    <label className="block space-y-1">
                      <div className="text-xs font-medium text-muted">垂直</div>
                      <Select value={layout.frame.valign} onChange={(e) => patchBlock('frame', { valign: e.target.value as StepCardLayout['frame']['valign'] })} className="h-8 text-sm">
                        <option value="free">自訂 Y</option><option value="top">對齊上緣</option><option value="middle">垂直置中</option><option value="bottom">對齊下緣</option>
                      </Select>
                    </label>
                  </Row>
                  <p className="text-[11px] leading-5 text-secondary">
                    {ALIGNED(layout.frame.align) || ALIGNED(layout.frame.valign)
                      ? '以畫布的留白與中線為準，所以每一步的截圖高度不同，介面圖仍落在同一個位置；文字對齊介面圖時也跟著走。'
                      : '固定在這個 X／Y。截圖高度不一樣時，改用對齊規則可以讓每一步看起來一致。'}
                  </p>
                  <Slider label="內容縮放" value={layout.frame.zoom} min={1} max={ZOOM_MAX} step={0.05}
                    onChange={setZoom} format={(v) => `${v.toFixed(2)}×`} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={panning} onChange={(e) => setPanning(e.target.checked)} className="accent-[var(--accent)]" />
                    拖曳時移動窗裡的畫面
                  </label>
                  <div className="flex items-center justify-between">
                    <TextLink onClick={cropToAnnotations}>裁到標註範圍</TextLink>
                    {cropped && <TextLink onClick={showAll}>顯示完整畫面</TextLink>}
                  </div>
                  <p className="text-[11px] leading-5 text-secondary">拉窗的上緣或下緣裁掉不要的部分，畫面留在原地；縮放以窗的中心為準。</p>
                </>
              )}
              {selected === 'text' && (
                <>
                  <Row cols={2}>
                    <label className="block space-y-1">
                      <div className="text-xs font-medium text-muted">對齊</div>
                      <Select value={layout.text.align} onChange={(e) => patchBlock('text', { align: e.target.value as StepCardLayout['text']['align'] })} className="h-8 text-sm">
                        <option value="left">靠左</option><option value="center">置中</option>
                      </Select>
                    </label>
                    <label className="block space-y-1">
                      <div className="text-xs font-medium text-muted">垂直</div>
                      <Select value={layout.text.valign} onChange={(e) => patchBlock('text', { valign: e.target.value as StepCardLayout['text']['valign'] })} className="h-8 text-sm">
                        <option value="free">自訂 Y</option><option value="top">對齊介面圖上緣</option><option value="middle">對齊介面圖中線</option><option value="bottom">對齊介面圖下緣</option>
                      </Select>
                    </label>
                  </Row>
                  <p className="text-[11px] leading-5 text-secondary">
                    {layout.text.align === 'center' ? '標題置中；清單取最寬的一行當寬度、每行靠左，整組對齊標題中線。' : '標題與清單共用同一條左緣。'}
                  </p>
                  <Row>
                    <Num label="標題字級" value={layout.title.size} min={12} onChange={(size) => patchBlock('title', { size })} />
                    <Num label="序號間距" value={layout.title.gap} min={-200} max={400} disabled={!layout.title.number} onChange={(gap) => patchBlock('title', { gap })} />
                    <Num label="清單間距" value={layout.text.gap} min={0} onChange={(gap) => patchBlock('text', { gap })} />
                  </Row>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={layout.title.number} onChange={(e) => patchBlock('title', { number: e.target.checked })} className="accent-[var(--accent)]" />
                    顯示步驟序號
                  </label>
                  <p className="text-[11px] leading-5 text-secondary">序號是民眾在這次對話裡的第幾步，送圖時才決定；這裡看到的是它在流程裡的位置。</p>
                  <Row>
                    <Num label="清單字級" value={layout.list.size} min={8} onChange={(size) => patchBlock('list', { size })} />
                    <Num label="圖示" value={layout.list.icon} min={8} onChange={(icon) => patchBlock('list', { icon })} />
                    <Num label="行距" value={layout.list.gap} min={0} onChange={(gap) => patchBlock('list', { gap })} />
                  </Row>
                </>
              )}
              {scope === 'step' && (selected === 'frame' ? patched('frame') : patched('text') || patched('title') || patched('list')) && (
                <TextLink onClick={() => { if (selected === 'frame') follow('frame'); else { follow('text'); follow('title'); follow('list') } }}>
                  {BLOCK_LABEL[selected]}改回跟隨版型
                </TextLink>
              )}
            </div>
          )}

          {layout && (
            <div className="space-y-2.5 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted">聚焦</div>
                {scope === 'step' && patched('mask') && <TextLink onClick={() => follow('mask')}>跟隨版型</TextLink>}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={layout.mask.enabled} onChange={(e) => patchBlock('mask', { enabled: e.target.checked })} className="accent-[var(--accent)]" />
                其他區域變暗
              </label>
              {layout.mask.enabled && (
                <>
                  <Slider label="變暗程度" value={layout.mask.opacity} min={0} max={0.7} step={0.05}
                    onChange={(opacity) => patchBlock('mask', { opacity })} format={(v) => `${Math.round(v * 100)}%`} />
                  <Slider label="模糊" value={layout.mask.blur} min={0} max={30} step={1}
                    onChange={(blur) => patchBlock('mask', { blur })} format={(v) => (v ? `${v} px` : '無')} />
                  <Slider label="清晰區邊距" value={layout.mask.pad} min={0} max={60} step={1}
                    onChange={(pad) => patchBlock('mask', { pad })} format={(v) => `${v} px`} />
                  <Slider label="清晰區圓角" value={layout.mask.radius} min={0} max={80} step={1}
                    onChange={(radius) => patchBlock('mask', { radius })} format={(v) => `${v} px`} />
                </>
              )}
            </div>
          )}

          {layout && scope === 'template' && (
            <div className="space-y-2.5 border-t border-border pt-4">
              <div className="text-xs font-medium text-muted">畫布</div>
              <Row>
                <Num label="寬" value={layout.canvas.w} min={400} max={2400} onChange={(w) => patchBlock('canvas', { w })} />
                <Num label="高" value={layout.canvas.h} min={300} max={4000} onChange={(h) => patchBlock('canvas', { h })} />
                <Num label="留白" value={layout.canvas.margin} min={0} max={600} onChange={(margin) => patchBlock('canvas', { margin })} />
              </Row>
            </div>
          )}
          {layout && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} className="accent-[var(--accent)]" />
              對齊 {GRID} px 格線
            </label>
          )}

          <p className="text-[11px] leading-5 text-secondary">拖曳移動、拉控制點改寬高；方向鍵微調，按住 Alt 暫時不對齊格線。按住空白鍵拖曳介面圖可移動窗裡的畫面。</p>

          <div className="mt-auto space-y-3 border-t border-border pt-4">
            <Button variant="primary" className="w-full justify-center" onClick={save} loading={busy} disabled={!dirty || !layout}>
              {templateDirty ? '儲存版型' : '儲存'}
            </Button>
            <div className="flex items-center justify-between">
              {scope === 'template'
                ? <TextLink onClick={() => preview && setTemplate(clone(preview.built_in))} disabled={busy || !preview || same(template, preview?.built_in)}>回到內建版型</TextLink>
                : <TextLink onClick={() => setPatch({})} disabled={busy || isEmptyPatch(patch)}>全部跟隨版型</TextLink>}
            </div>
            {scope === 'step' && !isEmptyPatch(patch) && <p className="text-[11px] text-secondary">這一步有自己的調整，其餘跟著版型。</p>}
          </div>
        </aside>
      </div>
    </div>
  )
}

/** One of the other steps, drawn small with the template being edited laid under its own patch — live, like the stage. */
function SiblingCard({ sibling, template }: { sibling: Sibling; template: StepCardLayout }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const { replica_w: rw, replica_h: rh, patch } = sibling.preview
  const layout = useMemo(() => fixFrame(merge(template, patch), rw, rh), [template, patch, rw, rh])
  const apply = useCallback(() => {
    const st = ref.current?.contentDocument?.documentElement?.style
    if (!st) return
    for (const [k, v] of Object.entries(layoutVars(layout, rw, rh))) st.setProperty(k, v)
  }, [layout, rw, rh])
  useLayoutEffect(apply, [apply])
  const width = 168
  const k = width / layout.canvas.w
  return (
    <div className="min-w-0">
      <div className="overflow-hidden rounded-md border border-border" style={{ width, height: layout.canvas.h * k }}>
        <iframe ref={ref} title={sibling.title} srcDoc={sibling.preview.html} onLoad={apply}
          className="block origin-top-left border-0" style={{ width: layout.canvas.w, height: layout.canvas.h, transform: `scale(${k})`, pointerEvents: 'none' }} />
      </div>
      <div className="mt-1 truncate text-[11px] text-muted" style={{ width }}>{sibling.title || '未命名步驟'}</div>
    </div>
  )
}

const Row = ({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 }) => <div className={clsx('grid gap-2', cols === 2 ? 'grid-cols-2' : 'grid-cols-3')}>{children}</div>

function Slider({ label, value, min, max, step, onChange, format }:
  { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="block space-y-1">
      <div className="flex items-baseline justify-between text-xs font-medium text-muted">
        <span>{label}</span><span className="tabular-nums">{format(value)}</span>
      </div>
      <input type="range" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))} className="block w-full accent-[var(--accent)]" />
    </label>
  )
}

function Num({ label, value, min, max, disabled, onChange }: { label: string; value: number; min?: number; max?: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-1">
      <div className="text-xs font-medium text-muted">{label}</div>
      <input type="number" value={value} min={min} max={max} disabled={disabled}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.round(v)) }}
        className="h-8 w-full rounded-lg border border-border bg-canvas px-2 text-sm tabular-nums outline-none focus:border-accent disabled:opacity-50" />
    </label>
  )
}
