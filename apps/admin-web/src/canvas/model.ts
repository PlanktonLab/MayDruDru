/**
 * Scene model for ONE open flow.
 *
 * The editor shows a single flow at a time, so the scene is just its steps
 * (fixed-size cards at absolute world coordinates) and the edges between them.
 * Platform / flow positions no longer draw anything — only step positions are
 * meaningful, and only they get saved back through the layout endpoint.
 *
 * Two layers sit on top of the server positions:
 *  - `overrides` — a move committed locally but not yet confirmed by a refetch;
 *  - `drag` — the live offset applied to the dragged ids during a drag.
 */

import type { Edge, Step } from '../lib/types'
import { edgePath, unionBoxes, type Box, type EdgePath, type Point } from './geometry'

export const STEP_W = 200
export const STEP_H = 150
/** Horizontal / vertical spacing used when placing a new step automatically. */
export const GAP_X = 92
export const GAP_Y = 44
export const GRID = 24

export interface Override { x: number; y: number; gen: number }
export type Overrides = Map<string, Override>
export interface DragDelta { ids: Set<string>; dx: number; dy: number }

export interface StepNode { id: string; step: Step; box: Box }
export interface EdgeNode {
  id: string; edge: Edge; path: EdgePath
  /** source step has 2+ outgoing edges → it is a 分岔 and wants a label */
  branch: boolean
  /** On a 分岔: the documents this way leads to (the 終點 goals below it) — what the fork means when no label says. */
  goalsBelow: string[]
}

export interface FlowScene {
  steps: StepNode[]
  edges: EdgeNode[]
  byId: Map<string, StepNode>
  /** Union of all step boxes (fallback box when the flow is empty). */
  bounds: Box
}

export const EMPTY_SCENE: FlowScene = { steps: [], edges: [], byId: new Map(), bounds: { x: 0, y: 0, w: STEP_W, h: STEP_H } }

/** step id → the goal ids of every 終點 reachable from it (its own included). */
export function goalsBelow(steps: Step[], edges: Edge[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const s of steps) out.set(s.id, [])
  for (const e of edges) out.get(e.from_step_id)?.push(e.to_step_id)
  const own = new Map(steps.map((s) => [s.id, s.is_end && s.goal_id ? s.goal_id : null]))
  const memo = new Map<string, string[]>()
  const visit = (id: string, trail: Set<string>): string[] => {
    const hit = memo.get(id)
    if (hit) return hit
    const found: string[] = own.get(id) ? [own.get(id)!] : []
    trail.add(id)
    for (const next of out.get(id) ?? []) {
      if (trail.has(next)) continue
      for (const g of visit(next, trail)) if (!found.includes(g)) found.push(g)
    }
    trail.delete(id)
    memo.set(id, found)
    return found
  }
  for (const s of steps) visit(s.id, new Set())
  return memo
}

export function buildScene(steps: Step[], edges: Edge[], overrides: Overrides, drag: DragDelta | null): FlowScene {
  const nodes: StepNode[] = steps.map((step) => {
    const o = overrides.get(step.id)
    let x = o ? o.x : step.canvas_x
    let y = o ? o.y : step.canvas_y
    if (drag && drag.ids.has(step.id)) { x += drag.dx; y += drag.dy }
    return { id: step.id, step, box: { x, y, w: STEP_W, h: STEP_H } }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const outDeg = new Map<string, number>()
  for (const e of edges) outDeg.set(e.from_step_id, (outDeg.get(e.from_step_id) ?? 0) + 1)
  const below = goalsBelow(steps, edges)

  const edgeNodes: EdgeNode[] = []
  for (const edge of edges) {
    const a = byId.get(edge.from_step_id)
    const b = byId.get(edge.to_step_id)
    if (!a || !b) continue
    const branch = (outDeg.get(edge.from_step_id) ?? 0) > 1
    edgeNodes.push({ id: edge.id, edge, path: edgePath(a.box, b.box), branch, goalsBelow: branch ? below.get(edge.to_step_id) ?? [] : [] })
  }

  return { steps: nodes, edges: edgeNodes, byId, bounds: unionBoxes(nodes.map((n) => n.box)) ?? EMPTY_SCENE.bounds }
}

/* ------------------------------------------------------------- placement */

const overlaps = (scene: FlowScene, p: Point) =>
  scene.steps.some((s) => Math.abs(s.box.x - p.x) < STEP_W * 0.9 && Math.abs(s.box.y - p.y) < STEP_H * 0.9)

/** Nudge a candidate position downwards until it no longer sits on a card. */
export function freeSpot(scene: FlowScene, p: Point): Point {
  const out = { x: Math.round(p.x), y: Math.round(p.y) }
  let guard = 0
  while (overlaps(scene, out) && guard++ < 40) out.y += STEP_H + GAP_Y
  return out
}

/** Where the "+" handle of a step puts the next step: to its right. */
export const nextStepPos = (scene: FlowScene, from: Box): Point => freeSpot(scene, { x: from.x + STEP_W + GAP_X, y: from.y })

/** Where a step created by double-clicking empty canvas goes (centred on the cursor). */
export const dropPos = (p: Point): Point => ({ x: Math.round(p.x - STEP_W / 2), y: Math.round(p.y - STEP_H / 2) })
