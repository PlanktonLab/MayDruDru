/** Name lookups shared by the eval case list and run results. */
import type { CanvasData, Goal, Platform } from '../../lib/types'

export interface EvalLookup {
  platform: (id: string | null | undefined) => string
  step: (id: string | null | undefined) => string
  goal: (id: string | null | undefined) => string
  flowOfStep: (id: string | null | undefined) => string
}

export function buildLookup(platforms: Platform[] | undefined, goals: Goal[] | undefined, canvas: CanvasData | undefined): EvalLookup {
  const p = new Map((platforms ?? []).map((x) => [x.id, x.display_name]))
  const g = new Map((goals ?? []).map((x) => [x.id, x.name]))
  const f = new Map((canvas?.flows ?? []).map((x) => [x.id, x.name]))
  const s = new Map((canvas?.steps ?? []).map((x) => [x.id, x]))
  const short = (id: string) => `${id.slice(0, 8)}…`
  return {
    platform: (id) => (id ? p.get(id) ?? short(id) : '—'),
    step: (id) => (id ? s.get(id)?.title ?? short(id) : '—'),
    goal: (id) => (id ? g.get(id) ?? short(id) : '—'),
    flowOfStep: (id) => { const st = id ? s.get(id) : undefined; return st ? f.get(st.flow_id) ?? '' : '' },
  }
}
