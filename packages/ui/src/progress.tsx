import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cx } from './cx'
import type { BadgeTone } from './surfaces'

export interface Step {
  /** 穩定的識別字，用英文。 */
  key: string
  /** 給市民看的短標題。 */
  label: string
}

/**
 * 送件流程的步驟指示（SPEC §8.1 的 6 步）。
 *
 * 只說「現在在哪、還有幾步」，不說「還要多久」。完成的步驟打勾，
 * 目前這步用 accent，之後的步驟維持安靜。
 */
export function Stepper({
  steps,
  current,
  className,
}: {
  steps: readonly Step[]
  /** 目前步驟的索引，0 起算。 */
  current: number
  className?: string
}) {
  return (
    <nav aria-label="申辦步驟" className={className}>
      <ol className="flex items-center gap-1">
        {steps.map((step, index) => {
          const done = index < current
          const active = index === current
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center gap-2">
              <span
                aria-hidden
                className={cx(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-medium tabular-nums',
                  done && 'border-accent bg-accent text-on-accent',
                  active && 'border-accent bg-accent-bg text-accent',
                  !done && !active && 'border-border bg-canvas text-secondary',
                )}
              >
                {done ? <Check size={14} strokeWidth={3} /> : index + 1}
              </span>
              <span
                aria-current={active ? 'step' : undefined}
                className={cx(
                  'truncate text-[13px]',
                  active ? 'font-medium text-primary' : 'text-muted',
                  'hidden sm:inline',
                )}
              >
                {step.label}
              </span>
              {index < steps.length - 1 && (
                <span aria-hidden className={cx('h-px min-w-2 flex-1', done ? 'bg-accent' : 'bg-border')} />
              )}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-[13px] text-muted sm:hidden">
        第 {Math.min(current + 1, steps.length)} / {steps.length} 步 · {steps[Math.min(current, steps.length - 1)]?.label}
      </p>
    </nav>
  )
}

export interface TimelineEvent {
  key: string
  /** 狀態名稱，例如「已收件」。 */
  title: ReactNode
  /** 已格式化好的時間字串；格式交給呼叫端統一。 */
  at?: string
  /** 這個狀態下市民該做什麼，或不必做什麼。 */
  description?: ReactNode
  tone?: BadgeTone
}

const DOT: Record<BadgeTone, string> = {
  neutral: 'bg-tertiary',
  accent: 'bg-accent',
  good: 'bg-good',
  warn: 'bg-warn',
  danger: 'bg-danger',
}

/**
 * 案件進度時間軸（SPEC §15.3「深度」）。最新的事件放最上面，
 * `current` 那一筆用實心點強調。
 */
export function Timeline({
  events,
  currentKey,
  className,
}: {
  events: readonly TimelineEvent[]
  currentKey?: string
  className?: string
}) {
  return (
    <ol className={cx('relative space-y-0', className)}>
      {events.map((event, index) => {
        const current = event.key === currentKey
        return (
          <li key={event.key} className="relative flex gap-3 pb-5 last:pb-0">
            <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
              <span
                className={cx(
                  'mt-1.5 size-3 shrink-0 rounded-full',
                  DOT[event.tone ?? 'neutral'],
                  current && 'ring-4 ring-accent-bg',
                )}
              />
              {index < events.length - 1 && (
                <span className="absolute top-5 bottom-[-1.25rem] w-px bg-border" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={cx('text-[15px]', current ? 'font-semibold text-primary' : 'text-primary')}>
                  {event.title}
                </span>
                {event.at && <span className="text-[12px] tabular-nums text-secondary">{event.at}</span>}
              </div>
              {event.description && (
                <p className="mt-1 text-[14px] leading-6 text-muted">{event.description}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
