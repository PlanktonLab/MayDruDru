/**
 * 整理排列 — lay a flow out left to right. Steps are placed in columns by
 * their distance from the start (longest path, so a branch that merges lands
 * after both branches), and each column is centred vertically. Steps the start
 * cannot reach go in their own rows below, so nothing is lost.
 */

import type { Edge, Step } from '../lib/types'
import { GAP_X, GAP_Y, STEP_H, STEP_W } from './model'

export interface Placed { id: string; x: number; y: number }

export function arrangeSteps(steps: Step[], edges: Edge[], origin = { x: 0, y: 0 }): Placed[] {
  if (!steps.length) return []
  const ids = new Set(steps.map((s) => s.id))
  const out = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const s of steps) { out.set(s.id, []); indeg.set(s.id, 0) }
  for (const e of edges) {
    if (!ids.has(e.from_step_id) || !ids.has(e.to_step_id) || e.from_step_id === e.to_step_id) continue
    out.get(e.from_step_id)!.push(e.to_step_id)
    indeg.set(e.to_step_id, (indeg.get(e.to_step_id) ?? 0) + 1)
  }

  // Roots: the flagged start, else every step nothing points at, else the first step.
  const starts = steps.filter((s) => s.is_start).map((s) => s.id)
  const roots = starts.length ? starts : steps.filter((s) => (indeg.get(s.id) ?? 0) === 0).map((s) => s.id)
  const rootSet = roots.length ? roots : [steps[0].id]

  // Longest path from a root, by relaxing until no column grows: a step that
  // two branches lead to has to sit after the longer of them. Depth is capped
  // at the number of steps, which bounds the work and cuts cycles — nothing
  // can sit further right than the flow is long.
  const depth = new Map<string, number>()
  const queue = [...rootSet]
  for (const r of rootSet) depth.set(r, 0)
  const maxDepth = Math.max(0, steps.length - 1)
  while (queue.length) {
    const id = queue.shift()!
    const d = depth.get(id) ?? 0
    if (d >= maxDepth) continue
    for (const to of out.get(id) ?? []) {
      if ((depth.get(to) ?? -1) >= d + 1) continue
      depth.set(to, d + 1)
      queue.push(to)
    }
  }

  const byStep = new Map(steps.map((s) => [s.id, s]))
  const order = (a: string, b: string) => (byStep.get(a)!.canvas_y - byStep.get(b)!.canvas_y) || a.localeCompare(b)
  const columns = new Map<number, string[]>()
  for (const [id, d] of depth) columns.set(d, [...(columns.get(d) ?? []), id])
  const maxRows = Math.max(...[...columns.values()].map((c) => c.length))
  const totalH = maxRows * STEP_H + (maxRows - 1) * GAP_Y

  const placed: Placed[] = []
  for (const [d, col] of columns) {
    col.sort(order)
    const h = col.length * STEP_H + (col.length - 1) * GAP_Y
    const top = origin.y + Math.round((totalH - h) / 2)
    col.forEach((id, i) => placed.push({ id, x: origin.x + d * (STEP_W + GAP_X), y: top + i * (STEP_H + GAP_Y) }))
  }

  // Unreachable steps: a row under everything, in their old left-to-right order.
  const rest = steps.filter((s) => !depth.has(s.id)).sort((a, b) => a.canvas_x - b.canvas_x)
  rest.forEach((s, i) => placed.push({ id: s.id, x: origin.x + i * (STEP_W + GAP_X), y: origin.y + totalH + GAP_Y * 2 }))
  return placed
}
