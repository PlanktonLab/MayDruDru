/**
 * What the flow's graph looks like, in the same terms the server's publish
 * check uses (dag.py): one start, no cycles, every step reachable from the
 * start, at least one end the start can reach. Computed locally so the guide
 * bar can answer instantly, and so it can *suggest* the endpoints from the
 * connections — a clerk should rarely have to set 起點 / 終點 by hand.
 */

import type { Edge, Step } from '../lib/types'

export interface Structure {
  /** Steps flagged is_start / is_end. */
  starts: string[]
  ends: string[]
  /** Nothing points at these (start candidates) / these point at nothing (end candidates). */
  noPrev: string[]
  noNext: string[]
  /** Steps the (single) start cannot reach. Empty while there is no single start. */
  unreachable: string[]
  cycle: boolean
  /** Some flagged end is reachable from the start. */
  endReachable: boolean
  /** The server's DAG check would pass. */
  ok: boolean
}

export function flowStructure(steps: Step[], edges: Edge[]): Structure {
  const ids = new Set(steps.map((s) => s.id))
  const out = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const s of steps) { out.set(s.id, []); indeg.set(s.id, 0) }
  for (const e of edges) {
    if (!ids.has(e.from_step_id) || !ids.has(e.to_step_id) || e.from_step_id === e.to_step_id) continue
    out.get(e.from_step_id)!.push(e.to_step_id)
    indeg.set(e.to_step_id, indeg.get(e.to_step_id)! + 1)
  }

  const starts = steps.filter((s) => s.is_start).map((s) => s.id)
  const ends = steps.filter((s) => s.is_end).map((s) => s.id)
  const noPrev = steps.filter((s) => indeg.get(s.id) === 0).map((s) => s.id)
  const noNext = steps.filter((s) => out.get(s.id)!.length === 0).map((s) => s.id)

  // Kahn: if the topological order does not cover every step, there is a cycle.
  const deg = new Map(indeg)
  const queue = steps.filter((s) => deg.get(s.id) === 0).map((s) => s.id)
  let seen = 0
  while (queue.length) {
    const id = queue.shift()!
    seen += 1
    for (const to of out.get(id)!) {
      deg.set(to, deg.get(to)! - 1)
      if (deg.get(to) === 0) queue.push(to)
    }
  }
  const cycle = steps.length > 0 && seen !== steps.length

  const reach = starts.length === 1 ? reachable(out, starts[0]) : null
  const unreachable = reach ? steps.filter((s) => !reach.has(s.id)).map((s) => s.id) : []
  const endReachable = !!reach && ends.some((id) => reach.has(id))
  const ok = steps.length > 0 && starts.length === 1 && !cycle && unreachable.length === 0 && ends.length > 0 && endReachable
  return { starts, ends, noPrev, noNext, unreachable, cycle, endReachable, ok }
}

function reachable(out: Map<string, string[]>, from: string): Set<string> {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(out.get(id) ?? []))
  }
  return seen
}

export interface EndpointPatch { id: string; is_start?: boolean; is_end?: boolean }

/**
 * Read the endpoints off the connections: the one step nothing leads to is
 * the start, the steps that lead nowhere are the ends. Returns the patches
 * that would make the flags match, or null when the graph does not say
 * (several loose starts, or a cycle) — then a person has to connect things.
 */
export function suggestEndpoints(steps: Step[], edges: Edge[]): EndpointPatch[] | null {
  const st = flowStructure(steps, edges)
  if (!steps.length || st.cycle) return null
  const start = st.noPrev.length === 1 ? st.noPrev[0]
    : st.starts.length === 1 && st.noPrev.includes(st.starts[0]) ? st.starts[0]
      : null
  if (!start) return null
  const ends = new Set(st.noNext)
  const patches: EndpointPatch[] = []
  for (const s of steps) {
    const p: EndpointPatch = { id: s.id }
    const wantStart = s.id === start
    const wantEnd = ends.has(s.id)
    if (s.is_start !== wantStart) p.is_start = wantStart
    if (s.is_end !== wantEnd) p.is_end = wantEnd
    if ('is_start' in p || 'is_end' in p) patches.push(p)
  }
  return patches
}
