/**
 * Debounced position saver (PUT /api/canvas/layout).
 *
 * Every committed drag enqueues step positions tagged with a save generation;
 * ~600ms after the last change they are flushed in one request. The save is
 * silent — only a failure is surfaced (a toast), and the items stay queued so
 * the next change retries them. A successful save writes the positions into
 * the ['canvas'] cache (no refetch) and `onFlushed` lets the editor drop the
 * local overrides the cache now agrees with.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { put } from '../lib/api'
import type { CanvasData, LayoutItem } from '../lib/types'
import { errMsg, useToast } from '../components/ui'

export interface FlushedItem { id: string; gen: number }

const DEBOUNCE_MS = 600

export function useLayoutSaver(onFlushed: (items: FlushedItem[]) => void) {
  const pending = useRef(new Map<string, { item: LayoutItem; gen: number }>())
  const timer = useRef<number | null>(null)
  const genRef = useRef(0)
  const flushedRef = useRef(onFlushed)
  flushedRef.current = onFlushed
  const qc = useQueryClient()
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const flush = useCallback(async () => {
    timer.current = null
    const entries = [...pending.current.entries()]
    if (!entries.length) return
    pending.current.clear()
    try {
      await put('/api/canvas/layout', { items: entries.map(([, e]) => e.item) })
      const saved = new Map(entries.map(([id, e]) => [id, e.item]))
      // A poll that left before this save would bring the old positions back.
      await qc.cancelQueries({ queryKey: ['canvas'] })
      qc.setQueryData<CanvasData>(['canvas'], (d) => d && {
        ...d,
        steps: d.steps.map((s) => {
          const p = saved.get(s.id)
          return p ? { ...s, canvas_x: p.x, canvas_y: p.y } : s
        }),
      })
      flushedRef.current(entries.map(([id, e]) => ({ id, gen: e.gen })))
    } catch (e) {
      for (const [id, entry] of entries) if (!pending.current.has(id)) pending.current.set(id, entry)
      toastRef.current(`位置儲存失敗：${errMsg(e)}`, 'err')
    }
  }, [qc])

  /** Queue step positions; returns the generation they were tagged with. */
  const enqueue = useCallback((positions: { id: string; x: number; y: number }[]): number => {
    const gen = ++genRef.current
    for (const p of positions) pending.current.set(p.id, { item: { id: p.id, x: p.x, y: p.y }, gen })
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void flush() }, DEBOUNCE_MS)
    return gen
  }, [flush])

  // Best-effort flush when the editor unmounts.
  useEffect(() => () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); void flush() }
  }, [flush])

  return { enqueue }
}
