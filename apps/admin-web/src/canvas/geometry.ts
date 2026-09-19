/**
 * Canvas geometry. Boxes, bezier edge routing between box faces, and viewport
 * helpers (fit / focus / zoom clamping / screen → world conversion).
 *
 * All positions here are "world" coordinates; the viewport maps world to
 * screen through `translate(pan) scale(zoom)`.
 */

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface Viewport { pan: Point; zoom: number }
export interface EdgePath { d: string; p1: Point; p2: Point; mid: Point }

export const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/**
 * A smooth bezier between the nearest faces of two boxes — horizontal when the
 * boxes are mostly side-by-side, vertical otherwise, so lines leave and arrive
 * at sensible edges instead of cutting through cards. The control points are
 * symmetric, so `mid` lies on the curve (t = 0.5) and is a good label anchor.
 */
export function edgePath(a: Box, b: Box): EdgePath {
  const ac = center(a)
  const bc = center(b)
  const dx = bc.x - ac.x
  const dy = bc.y - ac.y
  let p1: Point
  let p2: Point
  let d: string
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? a.x + a.w : a.x
    const tx = dx >= 0 ? b.x : b.x + b.w
    p1 = { x: sx, y: ac.y }
    p2 = { x: tx, y: bc.y }
    const k = Math.max(36, Math.abs(p2.x - p1.x) * 0.5) * (dx >= 0 ? 1 : -1)
    d = `M${p1.x},${p1.y} C${p1.x + k},${p1.y} ${p2.x - k},${p2.y} ${p2.x},${p2.y}`
  } else {
    const sy = dy >= 0 ? a.y + a.h : a.y
    const ty = dy >= 0 ? b.y : b.y + b.h
    p1 = { x: ac.x, y: sy }
    p2 = { x: bc.x, y: ty }
    const k = Math.max(36, Math.abs(p2.y - p1.y) * 0.5) * (dy >= 0 ? 1 : -1)
    d = `M${p1.x},${p1.y} C${p1.x},${p1.y + k} ${p2.x},${p2.y - k} ${p2.x},${p2.y}`
  }
  return { d, p1, p2, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }
}

/** Bezier from a box face towards a free point — the live "connect" preview. */
export function pathToPoint(a: Box, p: Point): string {
  const ac = center(a)
  const dx = p.x - ac.x
  const dy = p.y - ac.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? a.x + a.w : a.x
    const k = Math.max(36, Math.abs(p.x - sx) * 0.5) * (dx >= 0 ? 1 : -1)
    return `M${sx},${ac.y} C${sx + k},${ac.y} ${p.x - k},${p.y} ${p.x},${p.y}`
  }
  const sy = dy >= 0 ? a.y + a.h : a.y
  const k = Math.max(36, Math.abs(p.y - sy) * 0.5) * (dy >= 0 ? 1 : -1)
  return `M${ac.x},${sy} C${ac.x},${sy + k} ${p.x},${p.y - k} ${p.x},${p.y}`
}

/* ---------------------------------------------------------------- boxes */

export function unionBoxes(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const b of boxes) {
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.w > maxX) maxX = b.x + b.w
    if (b.y + b.h > maxY) maxY = b.y + b.h
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export const boxContains = (b: Box, p: Point) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h

/* ------------------------------------------------------------- viewport */

export const ZOOM_MIN = 0.15
export const ZOOM_MAX = 2
export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))

/** Insets kept clear when auto-framing (the floating zoom pill sits at the bottom). */
export const FIT_PADDING = { top: 48, bottom: 72, left: 48, right: 48 }

export const screenToWorld = (p: Point, v: Viewport): Point => ({ x: (p.x - v.pan.x) / v.zoom, y: (p.y - v.pan.y) / v.zoom })

/** Frame a set of boxes centred in the visible canvas (not pinned to a corner). */
export function fitView(boxes: Box[], vw: number, vh: number): Viewport {
  const u = unionBoxes(boxes)
  if (!u) return { pan: { x: vw / 2, y: vh / 2 }, zoom: 0.8 }
  const availW = Math.max(120, vw - FIT_PADDING.left - FIT_PADDING.right)
  const availH = Math.max(120, vh - FIT_PADDING.top - FIT_PADDING.bottom)
  const zoom = clampZoom(Math.min(1, availW / Math.max(1, u.w), availH / Math.max(1, u.h)))
  const c = center(u)
  return { zoom, pan: { x: FIT_PADDING.left + availW / 2 - c.x * zoom, y: FIT_PADDING.top + availH / 2 - c.y * zoom } }
}

/**
 * Centre a single box in the visible area. Keeps the current zoom but nudges
 * it up to a comfortable minimum for small objects, and down so that a large
 * selection still fits.
 */
export function focusView(box: Box, vw: number, vh: number, currentZoom: number): Viewport {
  const availW = Math.max(120, vw - FIT_PADDING.left - FIT_PADDING.right)
  const availH = Math.max(120, vh - FIT_PADDING.top - FIT_PADDING.bottom)
  const zoom = clampZoom(Math.min(Math.max(currentZoom, 0.9), availW / Math.max(1, box.w), availH / Math.max(1, box.h)))
  const c = center(box)
  return { zoom, pan: { x: FIT_PADDING.left + availW / 2 - c.x * zoom, y: FIT_PADDING.top + availH / 2 - c.y * zoom } }
}
