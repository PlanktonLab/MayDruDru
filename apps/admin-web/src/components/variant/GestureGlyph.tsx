/**
 * The swipe glyph — how a gesture is drawn, in the editor and on the 教學圖.
 *
 * No arrows. A swipe is shown the way the finger leaves it: a thin ring where
 * the finger first touches, a soft trail that gathers colour along the path,
 * and a solid touch dot where the finger ends. The eye reads the motion from
 * the trail's fade, the way a comet's tail says where it came from. A long
 * press is the same dot, held still, with two ripples around it.
 *
 * The renderer (backend/app/services/stepcard.py) draws the identical glyph
 * with the same geometry, so what is drawn here is what is printed.
 */

import type { CSSProperties } from 'react'
import type { Annotation } from '../../lib/types'

/** Trail thickness and touch-dot diameter, in replica px (the phone replica is 390 wide). */
export const GESTURE_T = 28
/** A drag shorter than this (in replica px) is a long press, not a swipe. */
export const HOLD_BELOW = 14
/** Track length used for old gesture boxes that never had one. */
const DEFAULT_LEN = 64

export type Direction = NonNullable<Annotation['direction']>
type Axis = 'v' | 'h'

const pct = (v: number) => `${v * 100}%`

/** A long press: asked for, or an old point with no direction. A zero-length swipe still draws as a swipe. */
export const isHold = (a: { w: number; h: number; direction?: string }) => a.direction === 'long_press' || (!a.direction && a.w === 0 && a.h === 0)
const axisOf = (a: { w: number; h: number; direction?: string }, aspect: number): Axis =>
  a.direction === 'up' || a.direction === 'down' ? 'v' : a.direction === 'left' || a.direction === 'right' ? 'h' : a.h / aspect >= a.w ? 'v' : 'h'

/** The direction the glyph is drawn with: a long press, the stored one, or the box's longer side for old data. */
export const effectiveDirection = (a: Annotation, aspect: number): Direction =>
  isHold(a) ? 'long_press' : (a.direction || (axisOf(a, aspect) === 'v' ? 'down' : 'right'))

/**
 * Where the glyph sits over the image, as CSS for an absolutely positioned
 * wrapper: the trail's bounding box grown by the touch dot. `unit` is the
 * on-screen size of one replica px, so the glyph keeps its proportions at any
 * zoom. Old rectangular gesture boxes get a trail through their centre.
 */
export function gestureFrame(a: Annotation, unit: number, aspect: number): CSSProperties {
  const T = GESTURE_T * unit
  if (isHold(a)) {
    const d = T * 2.8
    return { left: pct(a.x + a.w / 2), top: pct(a.y + a.h / 2), width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2 }
  }
  if (axisOf(a, aspect) === 'v') {
    return { left: pct(a.x + a.w / 2), top: pct(a.y), width: T, height: a.h ? `calc(${pct(a.h)} + ${T}px)` : DEFAULT_LEN * unit + T, marginLeft: -T / 2, marginTop: -T / 2 }
  }
  return { left: pct(a.x), top: pct(a.y + a.h / 2), width: a.w ? `calc(${pct(a.w)} + ${T}px)` : DEFAULT_LEN * unit + T, height: T, marginLeft: -T / 2, marginTop: -T / 2 }
}

/**
 * The gesture a drag describes: from where the finger went down to where it
 * came up, in image fractions. Straightened to the dominant axis — gesture
 * illustrations read best straight — and a drag too short to be a swipe is a
 * long press at the starting point.
 */
export function gestureFromStroke(from: { x: number; y: number }, to: { x: number; y: number }, replicaW: number, replicaH: number)
  : Pick<Annotation, 'x' | 'y' | 'w' | 'h' | 'direction'> {
  const dx = (to.x - from.x) * replicaW
  const dy = (to.y - from.y) * replicaH
  if (Math.hypot(dx, dy) < HOLD_BELOW) return { x: from.x, y: from.y, w: 0, h: 0, direction: 'long_press' }
  if (Math.abs(dy) >= Math.abs(dx)) {
    return { x: from.x, y: Math.min(from.y, to.y), w: 0, h: Math.abs(to.y - from.y), direction: dy < 0 ? 'up' : 'down' }
  }
  return { x: Math.min(from.x, to.x), y: from.y, w: Math.abs(to.x - from.x), h: 0, direction: dx < 0 ? 'left' : 'right' }
}

/** Fills its wrapper (see `gestureFrame`) with the trail, the start ring and the touch dot. */
export function GestureGlyph({ direction, color, unit, muted }: { direction: Direction | ''; color: string; unit: number; muted?: boolean }) {
  const T = GESTURE_T * unit
  const alpha = muted ? 0.6 : 1
  const dot: CSSProperties = {
    position: 'absolute', width: T, height: T, borderRadius: '50%', background: color, opacity: alpha,
    boxShadow: `0 0 0 ${2.5 * unit}px rgba(255,255,255,.85), 0 ${2 * unit}px ${6 * unit}px rgba(0,0,0,.18)`,
  }
  const ring = (d: number, width: number, a: number): CSSProperties => ({
    position: 'absolute', left: '50%', top: '50%', width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2,
    borderRadius: '50%', boxSizing: 'border-box', border: `${width}px solid color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`,
  })

  if (direction === 'long_press' || direction === '') {
    return (
      <>
        <span style={ring(T * 2.8, 2 * unit, 0.28 * alpha)} />
        <span style={ring(T * 1.9, 2.5 * unit, 0.55 * alpha)} />
        <span style={{ ...dot, left: '50%', top: '50%', marginLeft: -T / 2, marginTop: -T / 2 }} />
      </>
    )
  }

  const to = { up: 'to top', down: 'to bottom', left: 'to left', right: 'to right' }[direction]
  const start: CSSProperties = { up: { left: 0, bottom: 0 }, down: { left: 0, top: 0 }, left: { right: 0, top: 0 }, right: { left: 0, top: 0 } }[direction]
  const end: CSSProperties = { up: { left: 0, top: 0 }, down: { left: 0, bottom: 0 }, left: { left: 0, top: 0 }, right: { right: 0, top: 0 } }[direction]
  return (
    <>
      <span style={{ position: 'absolute', inset: 0, borderRadius: 9999, background: `linear-gradient(${to}, transparent, color-mix(in srgb, ${color} ${Math.round(45 * alpha)}%, transparent))` }} />
      <span style={{ ...ring(T, 2.5 * unit, 0.7 * alpha), left: undefined, top: undefined, marginLeft: 0, marginTop: 0, ...start }} />
      <span style={{ ...dot, ...end }} />
    </>
  )
}
