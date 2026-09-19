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
      {/* 序號用 `01`…`06` 的兩位數：等寬、視覺上是一組編號而不是一堆散落的數字。
          手機上序號在上、標籤在下（連接線收起來，寬度不夠畫）；
          桌面攤成一條橫線，序號與標籤並排，中間用細線連起來。 */}
      <ol className="apply-steps flex items-center gap-1">
        {steps.map((step, index) => {
          const done = index < current
          const active = index === current
          return (
            <li
              key={step.key}
              // 手機：每步等寬（`flex-1`），序號與標籤上下排。
              // 桌面：寬度由內容決定，只有最後一格不長連接線——等寬會把長標籤壓扁。
              className={cx(
                'flex min-w-0 flex-1 flex-col items-center gap-1.5',
                'lg:w-auto lg:flex-row lg:gap-2',
                index < steps.length - 1 ? 'lg:flex-1' : 'lg:flex-none',
              )}
            >
              <span
                aria-hidden
                className={cx(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums',
                  // 完成：淡底 + accent 勾。目前：實心 accent + 白字。之後：安靜的灰圈。
                  done && 'border-transparent bg-accent-bg text-accent',
                  active && 'border-accent bg-accent text-on-accent',
                  !done && !active && 'border-border bg-canvas text-secondary',
                )}
              >
                {done ? <Check size={13} strokeWidth={3} /> : String(index + 1).padStart(2, '0')}
              </span>
              <span
                aria-current={active ? 'step' : undefined}
                className={cx(
                  // 桌面不截字：步驟名是「我現在在哪」，截成「購…」等於沒說。
                  // 連接線用 flex-1 吸收剩下的寬度，所以標籤本身不必縮。
                  'text-[11px] whitespace-nowrap lg:text-[13px]',
                  active ? 'font-semibold text-accent' : 'text-muted',
                )}
              >
                {step.label}
              </span>
              {/* 連接線把六步串成一條路：沒有線，六個圈看起來是六個獨立的按鈕。
                  手機排不下（序號與標籤已經上下疊），所以只在桌面畫。 */}
              {index < steps.length - 1 && (
                <span aria-hidden className="hidden h-px min-w-4 flex-1 bg-border lg:block" />
              )}
            </li>
          )
        })}
      </ol>
      {/* 螢幕閱讀器與小螢幕都需要一句「現在在哪」；視覺上手機已有標籤，所以只留給輔具。 */}
      <p className="sr-only">
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
