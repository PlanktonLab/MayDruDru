/**
 * How the product shows AI at work — one component, used everywhere a job runs.
 *
 * The rule, borrowed from the assistants people already know: a job is never
 * just a spinner. It has a name for what it is doing right now (shimmering,
 * so it reads as alive), a sense of time (elapsed seconds), and the phases it
 * will pass through, so the wait has a shape. When it fails, the person gets a
 * plain sentence, one button to try again, and the raw reason folded away.
 */
import { clsx } from 'clsx'
import { AlertCircle, Check, ChevronRight, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { VariantStatus } from '../../lib/types'
import { aiPhases } from '../../canvas/status'
import { Button } from '../ui'

/**
 * Seconds a job has been running, ticking once a second.
 *
 * `sinceIso` is the variant's `updated_at`, which the worker rewrites at every
 * phase — counting from it would restart the clock four times during one
 * replica. So the earliest timestamp seen while the job is running wins, and
 * the count only resets when the job does.
 */
export function useElapsed(sinceIso: string | null | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  const start = useRef<number | null>(null)
  const seen = sinceIso ? Date.parse(sinceIso) : NaN
  const candidate = Number.isNaN(seen) ? Date.now() : seen
  if (!active) start.current = null
  else if (start.current === null || candidate < start.current) start.current = candidate

  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])

  if (!active || start.current === null) return 0
  return Math.max(0, Math.round((now - start.current) / 1000))
}

export const fmtElapsed = (s: number) => (s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`)

/** An indeterminate ring: a short arc chasing around. */
export function Ring({ size = 16, className }: { size?: number; className?: string }) {
  const r = (size - 2) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={clsx('pg-ring shrink-0', className)} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray={`${c * 0.28} ${c}`} />
    </svg>
  )
}

interface Props {
  status: VariantStatus
  progress: string
  /** When this state began (the variant's `updated_at`). */
  since: string
  /** Extra line under the phases, e.g. what the person can do meanwhile. */
  aside?: ReactNode
  className?: string
}

/** The full panel: headline, elapsed time, phase list. */
export function AIStatus({ status, progress, since, aside, className }: Props) {
  const { phases, current, headline } = aiPhases(status, progress)
  const elapsed = useElapsed(since, true)
  const queued = current < 0
  return (
    <div className={clsx('pg-fadein rounded-xl border border-border bg-canvas px-4 py-3.5', className)} role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <Ring size={16} className="text-accent" />
        <span className="pg-shimmer text-[14px] font-medium">{queued ? '排隊中' : headline}</span>
        <span className="ml-auto text-[12px] tabular-nums text-secondary">{fmtElapsed(elapsed)}</span>
      </div>
      {phases.length > 1 && (
        <ol className="mt-3 space-y-1.5 border-l border-border pl-3.5">
          {phases.map((p, i) => {
            const done = !queued && i < current
            const on = !queued && i === current
            return (
              <li key={p} className={clsx('flex items-center gap-2 text-[13px] leading-5', on ? 'text-primary' : done ? 'text-muted' : 'text-secondary')}>
                <span className={clsx('flex h-4 w-4 items-center justify-center rounded-full',
                  done ? 'bg-good-bg text-good' : on ? 'text-accent' : 'text-tertiary')}>
                  {done ? <Check size={10} strokeWidth={3} /> : on ? <Ring size={12} /> : <span className="h-1 w-1 rounded-full bg-current" />}
                </span>
                {p}
              </li>
            )
          })}
        </ol>
      )}
      {aside && <p className="mt-3 text-[12px] leading-5 text-secondary">{aside}</p>}
    </div>
  )
}

/** The compact line for a card: ring + shimmering headline. */
export function AIStatusInline({ status, progress, className }: { status: VariantStatus; progress: string; className?: string }) {
  const { headline } = aiPhases(status, progress)
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <Ring size={12} className="text-accent" />
      <span className="pg-shimmer text-[11px] font-medium">{headline}</span>
    </span>
  )
}

/**
 * A failed job: what went wrong in one plain sentence, the retry as the only
 * prominent control, the raw error one click away.
 */
export function AIError({ title, detail, onRetry, retryLabel = '再試一次', busy }: { title: string; detail?: string; onRetry?: () => void; retryLabel?: string; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pg-fadein rounded-xl border border-danger/30 bg-danger-bg px-4 py-3.5 text-danger" role="alert">
      <div className="flex items-start gap-2.5">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">{title}</div>
          {detail && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-0.5 text-[12px] opacity-80 hover:opacity-100">
              <ChevronRight size={12} className={clsx('transition-transform', open && 'rotate-90')} /> 查看原因
            </button>
          )}
          {open && detail && <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-5 opacity-90">{detail}</p>}
        </div>
      </div>
      {onRetry && (
        <div className="mt-3 pl-[26px]">
          <Button variant="default" size="sm" onClick={onRetry} loading={busy}><RotateCcw size={12} /> {retryLabel}</Button>
        </div>
      )}
    </div>
  )
}
