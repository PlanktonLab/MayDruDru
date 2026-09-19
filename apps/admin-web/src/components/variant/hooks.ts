/** Data hooks shared by the three sheet stages (SPEC §6.2). */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'
import { ApiError, apiFetch, ensureOk, get } from '../../lib/api'
import type { Variant } from '../../lib/types'
import { isBusy } from '../../canvas/status'

export interface AnnotationMeta {
  limits: { title: number; instruction: number; label: number }
  focus_area_limit: number
}

export const useMeta = () =>
  useQuery({ queryKey: ['annotation-meta'], queryFn: () => get<AnnotationMeta>('/api/meta/annotation-types'), staleTime: 60_000 })

export const useVariant = (id: string | undefined) =>
  useQuery({
    queryKey: ['variant', id],
    queryFn: () => get<Variant>(`/api/variants/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (isBusy(q.state.data?.status) ? 2000 : false),
  })

/** Invalidate the variant (and the review queue) after a mutation. */
export function useRefreshVariant(id: string | undefined) {
  const qc = useQueryClient()
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['variant', id] }),
      qc.invalidateQueries({ queryKey: ['review-queue'] }),
    ])
  }, [qc, id])
}

/** Fetch a JWT-protected resource as text (e.g. replica.html). */
export async function fetchProtectedText(url: string): Promise<string> {
  const res = await ensureOk(await apiFetch(url))
  return res.text()
}

/* ------------------------------------------------------------ protected images */

export type ImageStatus = 'idle' | 'loading' | 'ok' | 'forbidden' | 'error'
export interface ImageState { src: string | null; status: ImageStatus; message: string }

const IDLE: ImageState = { src: null, status: 'idle', message: '' }
const LOADING: ImageState = { src: null, status: 'loading', message: '' }

interface Entry { refs: number; state: ImageState; listeners: Set<() => void>; abort: AbortController }

/**
 * One download per url+version for the whole app. Entries are ref-counted by
 * the components showing them; the object URL is revoked (and an unfinished
 * download aborted) once the last one lets go. The release is deferred a tick
 * so a remount (StrictMode, a card re-keyed by React) reuses the entry.
 */
const images = new Map<string, Entry>()

const keyOf = (url: string, version?: string) => `${url}\u0000${version ?? ''}`

function setEntry(e: Entry, state: ImageState) {
  e.state = state
  for (const l of e.listeners) l()
}

async function load(url: string, e: Entry) {
  try {
    const res = await apiFetch(url, { signal: e.abort.signal })
    if (res.status === 403) { setEntry(e, { src: null, status: 'forbidden', message: '只有上傳者與 admin 可檢視原圖' }); return }
    await ensureOk(res)
    const blob = await res.blob()
    if (e.abort.signal.aborted) return
    setEntry(e, { src: URL.createObjectURL(blob), status: 'ok', message: '' })
  } catch (err) {
    if (e.abort.signal.aborted) return
    const message = err instanceof ApiError && err.status === 404 ? '找不到圖片' : err instanceof Error ? err.message : String(err)
    setEntry(e, { src: null, status: 'error', message })
  }
}

function acquire(url: string, version?: string): Entry {
  const key = keyOf(url, version)
  let e = images.get(key)
  if (!e) {
    e = { refs: 0, state: LOADING, listeners: new Set(), abort: new AbortController() }
    images.set(key, e)
    void load(url, e)
  }
  e.refs++
  return e
}

function release(url: string, version?: string) {
  const key = keyOf(url, version)
  window.setTimeout(() => {
    const e = images.get(key)
    if (!e || --e.refs > 0) return
    images.delete(key)
    e.abort.abort()
    if (e.state.src) URL.revokeObjectURL(e.state.src)
  }, 0)
}

/**
 * Load a JWT-protected image into an object URL (`<img>` cannot send the
 * Authorization header). `version` is the cache key next to the URL — pass
 * something that changes only when the image does (e.g. `original_version`).
 */
export function useProtectedImage(url: string | null, version?: string): ImageState {
  const subscribe = useCallback((onChange: () => void) => {
    if (!url) return () => {}
    const e = acquire(url, version)
    e.listeners.add(onChange)
    onChange()
    return () => { e.listeners.delete(onChange); release(url, version) }
  }, [url, version])
  const snapshot = () => (url ? images.get(keyOf(url, version))?.state ?? LOADING : IDLE)
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/* ---------------------------------------------------------------------- misc */

/** Save an image the page already holds (an object URL) under a readable file name. */
export function saveImage(src: string, name: string) {
  const a = document.createElement('a')
  a.href = src
  a.download = `${name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'mockup'}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10))
export const fmtTime = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString('zh-TW', { hour12: false }) }

/** Model visual self-check attached to `check_report.visual` (may be absent). */
export interface VisualReview { score: number | null; issues: string[]; privacy_leak: boolean; skipped: boolean }
export function visualReview(v: Variant): VisualReview | null {
  const raw = (v.check_report as unknown as Record<string, unknown> | null)?.visual
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    score: typeof o.score === 'number' ? o.score : null,
    issues: Array.isArray(o.issues) ? o.issues.map(String) : [],
    privacy_leak: !!o.privacy_leak,
    skipped: !!o.skipped,
  }
}

export const VISUAL_PASS_SCORE = 0.85

/** The model's self-check counts as passed above the threshold with no leak. */
export function visualPassed(vis: VisualReview | null): boolean {
  return !!vis && !vis.skipped && !vis.privacy_leak && vis.score !== null && vis.score >= VISUAL_PASS_SCORE
}

/** Everything the reviewer must look at, as one red bullet list. A passed
 *  visual check keeps its (minor) suggestions out of the red list. */
export function reviewProblems(v: Variant): string[] {
  const vis = visualReview(v)
  const visualFailed = !!vis && !visualPassed(vis)
  return [
    ...(v.check_report && !v.check_report.ok ? v.check_report.problems : []),
    ...(vis?.privacy_leak ? ['視覺檢查：復刻圖上仍看得到原圖的真實資料'] : []),
    ...(visualFailed ? (vis?.issues ?? []) : []),
  ]
}

/** "3 小時前" style relative time for the review queue. */
export function sinceText(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小時前`
  return `${Math.round(h / 24)} 天前`
}
