import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from './api'
import type { CanvasData, Goal, Platform } from './types'
import { isBusy } from '../canvas/status'

/** A background job is running on some variant (its card will change without anyone touching it). */
const jobsRunning = (d: CanvasData | undefined) => !!d && d.steps.some((s) => s.variants.some((v) => isBusy(v.status)))

/** The whole tenant's canvas. Polls every 3 s only while a job is running somewhere. */
export const useCanvas = () =>
  useQuery({
    queryKey: ['canvas'],
    queryFn: () => get<CanvasData>('/api/canvas'),
    refetchInterval: (q) => (jobsRunning(q.state.data) ? 3000 : false),
  })
export const usePlatforms = () => useQuery({ queryKey: ['platforms'], queryFn: () => get<Platform[]>('/api/platforms') })
export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => get<Goal[]>('/api/goals') })
export const useInvalidate = () => {
  const qc = useQueryClient()
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
}
