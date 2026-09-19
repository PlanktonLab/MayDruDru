/** React-query hooks for the eval pages (kept out of component files for fast refresh). */
import { useQuery } from '@tanstack/react-query'
import { get } from '../../lib/api'
import type { EvalCase, EvalRun } from '../../lib/types'

export const useEvalCases = () => useQuery({ queryKey: ['eval-cases'], queryFn: () => get<EvalCase[]>('/api/evals/cases') })

/** A run still marked `running` after this long is treated as stuck: no auto-polling, no start lock. */
const STALE_RUN_MS = 20 * 60 * 1000

export const isActiveRun = (r: EvalRun) => r.status === 'running' && Date.now() - new Date(r.started_at).getTime() < STALE_RUN_MS

/** Polls every 2 s only while a run is actively running; otherwise refresh manually. */
export const useEvalRuns = () => useQuery({
  queryKey: ['eval-runs'],
  queryFn: () => get<EvalRun[]>('/api/evals/runs'),
  refetchInterval: (q) => (q.state.data?.some(isActiveRun) ? 2000 : false),
})
