/**
 * Mutations used by the editor. Step and edge changes write the returned
 * object straight into the ['canvas'] cache — no tenant-wide refetch per
 * click, so dropping twenty screenshots does not reload the canvas sixty
 * times. Platform / flow / publish changes are rare and simply refetch.
 * Failures raise a toast; success is silent — the canvas itself is the
 * feedback (SPEC §6.1).
 *
 * Actions resolve to `undefined` on failure, so callers can `if (!r) return`.
 */

import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { del, patch, post, put } from '../lib/api'
import type { CanvasData, Channel, DemoDataField, Edge, Flow, Goal, Platform, RenderCards, Step } from '../lib/types'
import { errMsg, useToast } from '../components/ui'

/** Everything the platform inspector can write; create only needs the first three. */
export interface PlatformBody {
  display_name: string
  brand: string
  channel: Channel
  category?: string
  aliases?: string[]
  demo_data?: DemoDataField[]
}
export interface GoalBody { name: string; description: string; aliases: string[] }
export interface FlowBody { platform_id: string; name: string }
export interface StepBody { flow_id: string; title: string; instruction: string; stuck_hint: string; canvas_x: number; canvas_y: number; is_start: boolean; is_end: boolean; goal_id?: string | null }
export interface EdgeBody { flow_id: string; from_step_id: string; to_step_id: string; condition_label: string; sort_order: number }

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]

export function useCanvasActions() {
  const qc = useQueryClient()
  const toast = useToast()

  return useMemo(() => {
    const invalidate = (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
    const edit = (fn: (d: CanvasData) => CanvasData) => qc.setQueryData<CanvasData>(['canvas'], (d) => (d ? fn(d) : d))
    const attempt = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try { return await fn() } catch (e) { toast(errMsg(e), 'err'); return undefined }
    }
    /** For the rare structural changes: call, then refetch. */
    const run = async <T,>(fn: () => Promise<T>, keys: string[] = ['canvas']): Promise<T | undefined> => {
      const r = await attempt(fn)
      if (r !== undefined) await invalidate(...keys)
      return r
    }
    const putStep = (s: Step) => edit((d) => ({ ...d, steps: upsert(d.steps, s) }))
    const putEdge = (e: Edge) => edit((d) => ({ ...d, edges: upsert(d.edges, e) }))

    return {
      /** Refetch the canvas once — the end of a batch that changed things server-side (uploads). */
      refreshCanvas: () => invalidate('canvas'),

      /* ---- platforms (the 平台 list is read by the playground and evals too) */
      createPlatform: (body: PlatformBody) => run(() => post<Platform>('/api/platforms', body), ['canvas', 'platforms']),
      patchPlatform: (id: string, body: Partial<PlatformBody>) => run(() => patch<Platform>(`/api/platforms/${id}`, body), ['canvas', 'platforms']),
      deletePlatform: (id: string) => run(() => del(`/api/platforms/${id}`), ['canvas', 'platforms', 'components']),

      /* ---- goals (admin only, server-side) */
      createGoal: (body: GoalBody) => run(() => post<Goal>('/api/goals', body), ['canvas', 'goals']),
      updateGoal: (id: string, body: GoalBody) => run(() => put<Goal>(`/api/goals/${id}`, body), ['canvas', 'goals']),
      deleteGoal: (id: string) => run(() => del(`/api/goals/${id}`), ['canvas', 'goals']),

      /* ---- flows */
      createFlow: (body: FlowBody) => run(() => post<Flow>('/api/flows', body)),
      patchFlow: (id: string, body: { name?: string }) => run(() => patch<Flow>(`/api/flows/${id}`, body)),
      deleteFlow: (id: string) => run(() => del(`/api/flows/${id}`)),
      /** 422 carries `{detail:{errors}}`; the caller pre-checks with validate, this is the race guard. */
      publishFlow: (id: string) => run(() => post<Flow>(`/api/flows/${id}/publish`), ['canvas', 'flow-versions']),
      unpublishFlow: (id: string) => run(() => post<Flow>(`/api/flows/${id}/unpublish`), ['canvas', 'flow-versions']),
      rollbackFlow: (id: string, versionId: string) => run(() => post<Flow>(`/api/flows/${id}/rollback/${versionId}`), ['canvas', 'flow-versions']),
      /** Every reviewed step's card again (a template change, new demo data); each keeps its own layout patch. */
      renderFlowCards: (id: string) => run(() => post<RenderCards>(`/api/flows/${id}/render-cards`)),

      /* ---- steps */
      createStep: async (body: StepBody) => {
        const s = await attempt(() => post<Step>('/api/steps', body))
        if (s) putStep(s)
        return s
      },
      patchStep: async (id: string, body: Partial<Omit<StepBody, 'flow_id'>>) => {
        const s = await attempt(() => patch<Step>(`/api/steps/${id}`, body))
        if (!s) return s
        putStep(s)
        // A new title / instruction re-renders finished Step Cards (status → rendering).
        if ('title' in body || 'instruction' in body) {
          for (const v of s.variants) void qc.invalidateQueries({ queryKey: ['variant', v.id] })
        }
        return s
      },
      deleteSteps: async (ids: string[]) => {
        const results = await Promise.allSettled(ids.map((id) => del(`/api/steps/${id}`)))
        const gone = new Set(ids.filter((_, i) => results[i].status === 'fulfilled'))
        edit((d) => ({
          ...d,
          steps: d.steps.filter((s) => !gone.has(s.id)),
          edges: d.edges.filter((e) => !gone.has(e.from_step_id) && !gone.has(e.to_step_id)),
        }))
        const failed = ids.length - gone.size
        if (failed) toast(`有 ${failed} 個步驟刪除失敗`, 'err')
      },
      duplicateStep: async (id: string, targetFlowId: string) => {
        const s = await attempt(() => post<Step>(`/api/steps/${id}/duplicate`, { target_flow_id: targetFlowId }))
        if (s) putStep(s)
        return s
      },

      /* ---- edges */
      createEdge: async (body: EdgeBody) => {
        const e = await attempt(() => post<Edge>('/api/edges', body))
        if (e) putEdge(e)
        return e
      },
      patchEdge: async (id: string, body: { condition_label?: string }) => {
        const e = await attempt(() => patch<Edge>(`/api/edges/${id}`, body))
        if (e) putEdge(e)
        return e
      },
      deleteEdge: async (id: string) => {
        const r = await attempt(async () => { await del(`/api/edges/${id}`); return true })
        if (r) edit((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== id) }))
        return r
      },
    }
  }, [qc, toast])
}

export type CanvasActions = ReturnType<typeof useCanvasActions>
