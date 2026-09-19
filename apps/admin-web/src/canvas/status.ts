/**
 * Variant status, in one table. Every place that asks "what does this status
 * mean" — the sheet's stage, polling, the card's word and button, the AI
 * status panel, which pictures exist — reads it from `STATUS`, so there is one
 * vocabulary in the whole product.
 *
 * The canvas card shows the light variant only (light is what a flow needs to
 * publish; dark is an optional extra).
 */

import type { Step, Theme, VariantStatus, VariantSummary } from '../lib/types'

export type Tone = 'idle' | 'wait' | 'busy' | 'done' | 'failed'

export interface StatusInfo {
  /** Sheet stage: 0 截圖與重點, 1 審核, 2 標註與產出. */
  stage: 0 | 1 | 2
  /** A background job owns the variant: uploads and edits are refused, poll until it ends. */
  busy: boolean
  /** idle = nothing yet · wait = a person has to act · busy = AI / renderer at work · done · failed */
  tone: Tone
  /** The one word everyone uses for this state. */
  label: string
  /** The card's one button (what a person does next); null while nobody needs to act. */
  action: string | null
  /** The uploaded original is still stored (the review deletes it). */
  original: boolean
  /** A replica PNG exists. */
  replica: boolean
  /** A finished Step Card exists. */
  card: boolean
}

const S = (stage: 0 | 1 | 2, tone: Tone, label: string, rest: Partial<StatusInfo> = {}): StatusInfo => ({
  stage, tone, label, busy: false, action: null, original: false, replica: false, card: false, ...rest,
})

export const STATUS: Record<VariantStatus, StatusInfo> = {
  not_uploaded: S(0, 'idle', '尚未上傳'),
  uploaded: S(0, 'wait', '待框重點', { action: 'AI 復刻', original: true }),
  focusing: S(0, 'wait', '待框重點', { action: 'AI 復刻', original: true }),
  processing: S(0, 'busy', '復刻中', { busy: true, original: true }),
  failed: S(0, 'failed', '復刻失敗', { action: '重試', original: true }),
  pending_review: S(1, 'wait', '待審核', { action: '審核', original: true, replica: true }),
  approved: S(2, 'busy', '整理中', { busy: true, replica: true }),
  annotating: S(2, 'wait', '待標註', { action: '標註', replica: true }),
  rendering: S(2, 'busy', '產生教學圖中', { busy: true, replica: true }),
  completed: S(2, 'done', '已完成', { replica: true, card: true }),
}

export const THEME_LABEL: Record<Theme, string> = { light: '淺色', dark: '深色' }

export const isBusy = (status: VariantStatus | undefined) => !!status && STATUS[status].busy
/** A Step Card render ended in an error: back to annotating with `error` set. */
export const renderFailed = (v: { status: VariantStatus; error: string } | undefined) => !!v && v.status === 'annotating' && !!v.error

export const variantOf = (step: Step, theme: Theme): VariantSummary | undefined => step.variants.find((v) => v.theme === theme)
export const statusOf = (step: Step, theme: Theme): VariantStatus => variantOf(step, theme)?.status ?? 'not_uploaded'

/** Does this step hold processed assets? (asked before a destructive delete) */
export const hasWork = (step: Step) => step.variants.some((v) => v.status !== 'not_uploaded')
export const themeHasWork = (step: Step, theme: Theme) => statusOf(step, theme) !== 'not_uploaded'

/** The light variant as the card shows it — a failed render overrides the table's word. */
export function cardInfo(step: Step): StatusInfo {
  const light = variantOf(step, 'light')
  const status = light?.status ?? 'not_uploaded'
  const base = STATUS[status]
  return renderFailed(light) ? { ...base, tone: 'failed', action: '重試', label: '產生失敗' } : base
}

/** Public Step Card images for the card, smallest first (the thumbnail may 404 on older cards). */
export function thumbnailCandidates(step: Step): string[] {
  const light = variantOf(step, 'light')
  if (!light) return []
  return [light.stepcard_thumb_url, light.stepcard_preview_url, light.stepcard_url].filter((u): u is string => !!u)
}

/**
 * JWT-protected original screenshot. Only the uploader and admins may read it;
 * anyone else gets a 403 and the card falls back to its placeholder.
 */
export function originalUrl(v: VariantSummary | undefined): string | null {
  return v && v.has_original && STATUS[v.status].original ? `/api/variants/${v.id}/original.png` : null
}

/** JWT-protected replica PNG. */
/**
 * The replica image, tagged with the version of the render it came from. Every
 * re-render — a new attempt, an admin HTML edit, a corrected 假資料 value —
 * changes the URL, so neither the app's image cache nor the browser's can keep
 * showing the previous picture.
 */
export function replicaUrl(v: { id: string; status: VariantStatus; replica_png_url: string | null; replica_version?: string | null } | undefined): string | null {
  if (!v || !v.replica_png_url || !STATUS[v.status].replica) return null
  return `/api/variants/${v.id}/replica.png${v.replica_version ? `?v=${v.replica_version}` : ''}`
}

/* ------------------------------------------------------------ AI phases */

export interface AiPhases {
  /** The phases of this job, in order, in plain words. */
  phases: string[]
  /** Index of the phase running now; -1 while the job is still queued. */
  current: number
  /** One line for compact places (the card). */
  headline: string
}

const REPLICA_PHASES = ['分析畫面結構', '重製介面', '渲染畫面', '檢查結果']

/**
 * Turn the worker's short progress string into a phase list the panel can
 * draw. The strings come from the ingestion graph and the worker tasks; when
 * one does not match, the first phase is assumed so the panel never goes blank.
 */
export function aiPhases(status: VariantStatus, progress: string): AiPhases {
  const p = progress || ''
  if (status === 'processing') {
    const current = p.includes('排隊') ? -1
      : p.includes('結構') ? 0
        : p.includes('渲染') ? 2
          : p.includes('自檢') || p.includes('檢查') ? 3
            : 1
    return { phases: REPLICA_PHASES, current, headline: current < 0 ? '排隊中' : REPLICA_PHASES[current] }
  }
  if (status === 'approved') return { phases: ['記錄平台風格'], current: 0, headline: '整理中' }
  if (status === 'rendering') {
    const current = p.includes('排隊') ? -1 : 0
    return { phases: ['排版與輸出教學圖'], current, headline: current < 0 ? '排隊中' : '產生教學圖' }
  }
  return { phases: [], current: 0, headline: STATUS[status].label }
}
